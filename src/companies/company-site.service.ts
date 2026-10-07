import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertCompanyAccess } from '../common/resolve-verified-company.util';
import type { UserRole } from '@prisma/client';
import { isPrivateOrLocalIp, normalizeIp } from '../common/ip.util';
import {
  CreateCompanySiteDto,
  UpdateCompanySiteDto,
} from './dto/company-site.dto';


// ── Réglages du secours GPS (précision + IP apprise) ────────────────────────
// Plafond absolu : au-delà de cette précision annoncée (en mètres), la position n'est pas
// fiable du tout → ni marge de tolérance ni apprentissage d'IP (→ IP de confiance).
export const GPS_MAX_RELIABLE_ACCURACY_M = 150;
// La marge de tolérance ne s'applique que si la précision est ≤ (ce facteur × la marge réglée).
// Ex. marge 30 m (Standard) → précision exigée ≤ 60 m. Un GPS plus flou doit être dans le rayon exact.
export const GPS_TOLERANCE_ACCURACY_FACTOR = 2;
// L'IP n'est apprise que depuis un GPS BON (c'est une preuve de présence → plus exigeant que la marge).
export const IP_LEARN_MAX_ACCURACY_M = 50;
// IP « apprise » : une IP est digne de confiance quand au moins N personnes
// DIFFÉRENTES ont pointé avec succès au GPS (dans le rayon OU avec marge) depuis
// cette même IP publique pendant la fenêtre ci-dessous (glissante, renouvelée à
// chaque pointage GPS valide).
export const IP_LEARN_QUORUM = 3;
export const IP_LEARN_WINDOW_HOURS = 24;
// On ne réécrit pas en base la même observation plus d'une fois par cet intervalle.
const IP_SIGHTING_WRITE_THROTTLE_MS = 30 * 60 * 1000;
// « Groupe » d'entreprises = le portefeuille d'un admin multi-entreprises (ex. un client avec 5 sociétés dans
// le même immeuble, sur le même wifi). Elles PEUVENT légitimement partager la même IP : ça ne la rend pas
// « partagée par l'opérateur ». Seuls ces rôles définissent un groupe — un cabinet comptable ou le
// super admin, rattachés à des dizaines de clients sans lien entre eux, ne doivent PAS les fusionner.
const IP_GROUP_OWNER_ROLES: UserRole[] = ['ADMIN'];

@Injectable()
export class CompanySiteService {
  constructor(private readonly prisma: PrismaService) {}

  // Anti-écritures répétées : clé « entreprise|ip|personne » → dernier enregistrement (ms)
  private readonly sightingWriteCache = new Map<string, number>();

  // 🔒 CORRECTIF SÉCURITÉ (audit) : les routes /companies/:companyId/sites
  // acceptaient n'importe quel companyId d'URL de la part de n'importe quel
  // utilisateur connecté (lecture ET écriture). Appelé par le controller
  // avant chaque opération ; les méthodes internes (findActive,
  // checkPositionInAnySite...) restent inchangées.
  async assertAccess(userId: string, companyId: string, write: boolean) {
    await assertCompanyAccess(this.prisma, userId, companyId, { write });
  }

  // ── Récupérer tous les sites d'une entreprise ──────────────────────────────
  async findAll(companyId: string) {
    return this.prisma.companySite.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Récupérer uniquement les sites actifs (utilisé au pointage) ───────────
  async findActive(companyId: string) {
    return this.prisma.companySite.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        radius: true,
      },
    });
  }

  // ── Créer un site ──────────────────────────────────────────────────────────
  async create(companyId: string, dto: CreateCompanySiteDto) {
    return this.prisma.companySite.create({
      data: {
        companyId,
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radius: dto.radius ?? 100,
        isActive: dto.isActive ?? true,
      },
    });
  }

  // ── Modifier un site ───────────────────────────────────────────────────────
  async update(siteId: string, companyId: string, dto: UpdateCompanySiteDto) {
    const site = await this.prisma.companySite.findFirst({
      where: { id: siteId, companyId },
    });
    if (!site) throw new NotFoundException('Site introuvable');

    return this.prisma.companySite.update({
      where: { id: siteId },
      data: dto,
    });
  }

  // ── Supprimer un site ──────────────────────────────────────────────────────
  async remove(siteId: string, companyId: string) {
    const site = await this.prisma.companySite.findFirst({
      where: { id: siteId, companyId },
    });
    if (!site) throw new NotFoundException('Site introuvable');

    await this.prisma.companySite.delete({ where: { id: siteId } });
    return { deleted: true };
  }

  // ── L'entreprise a-t-elle configuré une géolocalisation quelconque ? ──────
  // (au moins un CompanySite actif, ou la position principale de la fiche
  // entreprise). Utilisé pour savoir si la position GPS doit être EXIGÉE au
  // pointage, indépendamment de ce que le client a envoyé.
  async isGeofencingConfigured(companyId: string): Promise<boolean> {
    const [siteCount, company] = await Promise.all([
      this.prisma.companySite.count({ where: { companyId, isActive: true } }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { latitude: true, longitude: true },
      }),
    ]);
    return siteCount > 0 || (company?.latitude != null && company?.longitude != null);
  }

  // ── Vérifier si une position GPS est dans l'un des sites actifs ───────────
  // Ordre de décision (le serveur est la SEULE autorité) :
  //   1) distance ≤ rayon                                   → RADIUS
  //   2) distance − min(précision, marge entreprise) ≤ rayon → TOLERANCE
  //      (le cercle d'incertitude du GPS touche la zone ; la marge est plafonnée
  //       par Company.gpsToleranceMeters, 0 = désactivé)
  //   3) IP publique du pointage ∈ IP de confiance          → TRUSTED_IP
  //      (IP saisie par l'admin, OU IP apprise : ≥ IP_LEARN_QUORUM personnes
  //       différentes ont pointé avec succès au GPS depuis cette IP < 24 h)
  //   Un pointage réussi au GPS (rayon ou marge) alimente l'apprentissage ;
  //   un pointage accepté par IP ne l'alimente JAMAIS (sinon boucle d'auto-confiance).
  //      (jamais en 4G : l'IP n'y correspond à aucune IP enregistrée)
  //   4) sinon refus avec la distance au site le plus proche.
  // `detail` : courte trace stockée dans checkInSource / checkOutSource.
  async checkPositionInAnySite(
    companyId: string,
    latitude: number,
    longitude: number,
    utilsGetDistance: (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => number,
    extra?: {
      accuracy?: number | null;
      clientIp?: string | null;
      // Personne qui pointe réellement (compte connecté) : sert uniquement à compter
      // les personnes DIFFÉRENTES pour l'IP apprise. Absent = pas d'apprentissage.
      userId?: string | null;
    },
  ): Promise<{
    matched: boolean;
    siteId: string | null;
    siteName: string | null;
    distance: number | null; // distance au site matché, ou au plus proche si non matché
    configured: boolean; // false = aucun site/position n'est configuré du tout pour cette entreprise
    basis: 'RADIUS' | 'TOLERANCE' | 'TRUSTED_IP' | null;
    detail: string | null;
  }> {
    // Sites multi-sites (table CompanySite)
    const sites = await this.findActive(companyId);

    // Site "principal" de la fiche entreprise + marge GPS autorisée par l'admin
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        latitude: true,
        longitude: true,
        allowedRadius: true,
        gpsToleranceMeters: true,
      },
    });

    const candidates: Array<{
      id: string | null;
      name: string;
      latitude: number;
      longitude: number;
      radius: number;
    }> = sites.map((s) => ({
      id: s.id,
      name: s.name,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      radius: s.radius,
    }));

    if (company?.latitude != null && company?.longitude != null) {
      candidates.push({
        id: null, // pas de ligne CompanySite associée
        name: 'Site principal',
        latitude: Number(company.latitude),
        longitude: Number(company.longitude),
        radius: company.allowedRadius ?? 100,
      });
    }

    // Aucune position configurée nulle part → pas de géofencing possible
    if (candidates.length === 0) {
      return {
        matched: true,
        siteId: null,
        siteName: null,
        distance: null,
        configured: false,
        basis: null,
        detail: null,
      };
    }

    // Distance à chaque candidat, calculée une seule fois
    const withDistances = candidates
      .map((c) => ({
        ...c,
        distance: utilsGetDistance(latitude, longitude, c.latitude, c.longitude),
      }))
      .sort((a, b) => a.distance - b.distance);
    const closest = withDistances[0];

    const ok = (
      m: (typeof withDistances)[number],
      basis: 'RADIUS' | 'TOLERANCE' | 'TRUSTED_IP',
      detail: string | null,
    ) => ({
      matched: true,
      siteId: m.id,
      siteName: m.name,
      distance: Math.round(m.distance),
      configured: true,
      basis,
      detail,
    });

    // Précision annoncée : exploitable seulement si connue et pas absurde
    const acc = Number(extra?.accuracy);
    const accuracyReliable =
      Number.isFinite(acc) && acc > 0 && acc <= GPS_MAX_RELIABLE_ACCURACY_M;
    // GPS assez bon pour que le pointage serve de preuve de présence (apprentissage de l'IP)
    const accuracyGoodForLearning =
      Number.isFinite(acc) && acc > 0 && acc <= IP_LEARN_MAX_ACCURACY_M;
    const clientIp = normalizeIp(extra?.clientIp);

    // 1) Dans le rayon (le plus proche en cas de multi-match)
    const exact = withDistances.find((c) => c.distance <= c.radius);
    if (exact) {
      // Preuve de présence au GPS → on retient l'IP du moment (sans bloquer le pointage)
      if (accuracyGoodForLearning) this.learnIpFromValidPunch(companyId, clientIp, extra?.userId);
      return ok(exact, 'RADIUS', null);
    }

    // 2) Marge selon la précision GPS annoncée par l'appareil
    //    (ignorée si la précision dépasse 2 × la marge : on passe alors à l'IP de confiance)
    const cap = company?.gpsToleranceMeters ?? 0;
    const tolerance =
      cap > 0 && accuracyReliable && acc <= cap * GPS_TOLERANCE_ACCURACY_FACTOR
        ? Math.min(acc, cap)
        : 0;
    if (tolerance > 0) {
      const soft = withDistances.find((c) => c.distance - tolerance <= c.radius);
      if (soft) {
        // Un pointage accepté avec marge compte aussi pour l'apprentissage de l'IP (si GPS bon)
        if (accuracyGoodForLearning) this.learnIpFromValidPunch(companyId, clientIp, extra?.userId);
        return ok(soft, 'TOLERANCE', `GPS avec marge (précision ±${Math.round(acc)} m)`);
      }
    }

    // 3) IP publique d'une connexion de l'entreprise (wifi du site)
    const ip = clientIp;
    if (ip) {
      // 3a) IP saisie / validée par l'admin (permanente)
      const trusted = await this.prisma.companyTrustedIp.findFirst({
        where: { companyId, ip, isActive: true },
        select: { label: true },
      });
      if (trusted) {
        return ok(closest, 'TRUSTED_IP', `IP de confiance : ${trusted.label}`);
      }
      // 3b) IP apprise automatiquement (quorum de personnes différentes, < 24 h)
      if (!isPrivateOrLocalIp(ip)) {
        const people = await this.countLearnedIpPeople(companyId, ip);
        if (people >= IP_LEARN_QUORUM) {
          return ok(
            closest,
            'TRUSTED_IP',
            `IP de confiance apprise (${people} pointages GPS valides < ${IP_LEARN_WINDOW_HOURS} h)`,
          );
        }
      }
    }

    // 4) Refus : on retient le plus proche pour un message d'erreur utile
    return {
      matched: false,
      siteId: closest.id,
      siteName: closest.name,
      distance: Math.round(closest.distance),
      configured: true,
      basis: null,
      detail: null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IP APPRISE (wifi du site) — alimentée par les pointages GPS valides
  // ═══════════════════════════════════════════════════════════════════════════

  private windowStart(): Date {
    return new Date(Date.now() - IP_LEARN_WINDOW_HOURS * 3600 * 1000);
  }

  /**
   * Entreprises du « groupe » de celle-ci : le portefeuille des admins multi-entreprises qui la gèrent
   * (même définition que les écrans d'affichage : liens user_companies + entreprise active de l'admin +
   * entreprise de sa fiche employé). Toujours inclut l'entreprise elle-même.
   */
  private async groupCompanyIds(companyId: string): Promise<Set<string>> {
    const group = new Set<string>([companyId]);
    const [links, direct] = await Promise.all([
      this.prisma.userCompany.findMany({ where: { companyId }, select: { userId: true } }),
      this.prisma.user.findMany({
        where: {
          manageMultipleCompanies: true,
          OR: [{ companyId }, { employee: { is: { companyId } } }],
        },
        select: { id: true },
      }),
    ]);
    const candidateIds = [...new Set([...links.map((l) => l.userId), ...direct.map((u) => u.id)])];
    if (candidateIds.length === 0) return group;

    const owners = await this.prisma.user.findMany({
      where: {
        id: { in: candidateIds },
        isActive: true,
        manageMultipleCompanies: true,
        role: { in: IP_GROUP_OWNER_ROLES },
      },
      select: { id: true, companyId: true, employee: { select: { companyId: true } } },
    });
    if (owners.length === 0) return group;

    const portfolio = await this.prisma.userCompany.findMany({
      where: { userId: { in: owners.map((o) => o.id) } },
      select: { companyId: true },
    });
    for (const l of portfolio) group.add(l.companyId);
    for (const o of owners) {
      if (o.companyId) group.add(o.companyId);
      if (o.employee?.companyId) group.add(o.employee.companyId);
    }
    return group;
  }

  /**
   * Nombre de personnes différentes vues avec cette IP dans la fenêtre, dans le groupe de CETTE entreprise
   * (les sociétés d'un même immeuble/wifi additionnent leurs pointages GPS valides).
   * Renvoie 0 (jamais de confiance) si :
   *  • un admin du groupe a révoqué l'IP (même wifi pour tout le groupe → la révocation vaut pour tous) ;
   *  • la même IP a aussi été vue chez une entreprise HORS du groupe pendant la fenêtre. Une vraie
   *    connexion de bureau n'apparaît que chez des entreprises liées ; une IP vue chez des entreprises
   *    sans lien est partagée par l'opérateur (données mobiles 4G/5G, partage d'IP) : n'importe quel
   *    client de l'opérateur derrière cette IP serait alors accepté depuis chez lui.
   */
  private async countLearnedIpPeople(companyId: string, ip: string): Promise<number> {
    const rows = await this.prisma.companyIpSighting.findMany({
      where: { ip, lastSeenAt: { gte: this.windowStart() } },
      select: { companyId: true, blocked: true },
    });
    // Le groupe n'est calculé que si d'autres entreprises ont vu cette IP (cas rare → 0 requête en plus sinon)
    const group = rows.some((r) => r.companyId !== companyId)
      ? await this.groupCompanyIds(companyId)
      : new Set<string>([companyId]);
    let people = 0;
    for (const r of rows) {
      if (!group.has(r.companyId)) return 0; // IP partagée avec des entreprises sans lien
      if (r.blocked) return 0; // révoquée par un admin du groupe (jusqu'au nettoyage)
      people++; // une ligne par (entreprise, ip, personne) → personnes distinctes
    }
    return people;
  }

  /** Cette IP a-t-elle été vue chez une entreprise SANS LIEN avec celle-ci ? (= connexion partagée) */
  async isIpShared(companyId: string, ip: string): Promise<boolean> {
    const group = await this.groupCompanyIds(companyId);
    const n = await this.prisma.companyIpSighting.count({
      where: { ip, companyId: { notIn: [...group] }, lastSeenAt: { gte: this.windowStart() } },
    });
    return n > 0;
  }

  /**
   * Retient « cette personne était sur site (preuve GPS) avec cette IP ».
   * Jamais bloquant : lancé sans await, toute erreur est avalée.
   */
  private learnIpFromValidPunch(
    companyId: string,
    ip: string | null,
    userId?: string | null,
  ): void {
    if (!ip || !userId) return;
    // IP privée/locale = proxy mal configuré (tout le monde aurait la même) → jamais apprise
    if (isPrivateOrLocalIp(ip)) return;

    const key = `${companyId}|${ip}|${userId}`;
    const nowMs = Date.now();
    const last = this.sightingWriteCache.get(key);
    if (last && nowMs - last < IP_SIGHTING_WRITE_THROTTLE_MS) return;
    this.sightingWriteCache.set(key, nowMs);
    if (this.sightingWriteCache.size > 5000) {
      for (const [k, t] of this.sightingWriteCache) {
        if (nowMs - t > IP_SIGHTING_WRITE_THROTTLE_MS) this.sightingWriteCache.delete(k);
      }
    }

    void (async () => {
      try {
        // Si un admin du groupe a révoqué cette IP, la nouvelle observation naît révoquée aussi
        const group = await this.groupCompanyIds(companyId);
        const blockedRow = await this.prisma.companyIpSighting.findFirst({
          where: { companyId: { in: [...group] }, ip, blocked: true, lastSeenAt: { gte: this.windowStart() } },
          select: { id: true },
        });
        await this.prisma.companyIpSighting.upsert({
          where: { companyId_ip_userId: { companyId, ip, userId } },
          create: { companyId, ip, userId, lastSeenAt: new Date(), blocked: !!blockedRow },
          update: { lastSeenAt: new Date() },
        });
      } catch {
        this.sightingWriteCache.delete(key); // on retentera au prochain pointage
      }
    })();
  }

  /** IP apprises récemment, pour l'écran admin (valider en permanent / révoquer). */
  async listLearnedIps(companyId: string) {
    const group = await this.groupCompanyIds(companyId);
    const groupIds = [...group];
    const rows = await this.prisma.companyIpSighting.findMany({
      where: { companyId: { in: groupIds }, lastSeenAt: { gte: this.windowStart() } },
      select: { ip: true, companyId: true, lastSeenAt: true, blocked: true },
    });
    const byIp = new Map<
      string,
      { ip: string; people: number; lastSeenAt: Date; blocked: boolean }
    >();
    for (const r of rows) {
      const cur = byIp.get(r.ip);
      if (!cur) {
        byIp.set(r.ip, { ip: r.ip, people: 1, lastSeenAt: r.lastSeenAt, blocked: r.blocked });
      } else {
        cur.people += 1;
        if (r.lastSeenAt > cur.lastSeenAt) cur.lastSeenAt = r.lastSeenAt;
        cur.blocked = cur.blocked || r.blocked;
      }
    }
    // IP vues aussi chez une entreprise SANS LIEN = connexion partagée (jamais de confiance)
    const ips = [...byIp.keys()];
    const sharedRows = ips.length
      ? await this.prisma.companyIpSighting.findMany({
          where: {
            ip: { in: ips },
            companyId: { notIn: groupIds },
            lastSeenAt: { gte: this.windowStart() },
          },
          select: { ip: true },
          distinct: ['ip'],
        })
      : [];
    const sharedIps = new Set(sharedRows.map((r) => r.ip));

    return [...byIp.values()]
      .map((x) => {
        const shared = sharedIps.has(x.ip);
        return {
          ...x,
          shared,
          active: !x.blocked && !shared && x.people >= IP_LEARN_QUORUM,
          quorum: IP_LEARN_QUORUM,
        };
      })
      .sort((a, b) => b.people - a.people || +b.lastSeenAt - +a.lastSeenAt);
  }

  /** L'admin révoque une IP apprise (pour tout son groupe) : exclue tant qu'elle est vue, puis oubliée au nettoyage. */
  async blockLearnedIp(companyId: string, ip: string) {
    const group = await this.groupCompanyIds(companyId);
    const r = await this.prisma.companyIpSighting.updateMany({
      where: { companyId: { in: [...group] }, ip },
      data: { blocked: true },
    });
    return { blocked: r.count > 0 };
  }

  /** Vrai s'il existe des observations récentes pour cette IP (sert à valider une promotion). */
  async hasRecentSighting(companyId: string, ip: string): Promise<boolean> {
    const group = await this.groupCompanyIds(companyId);
    const n = await this.prisma.companyIpSighting.count({
      where: { companyId: { in: [...group] }, ip, lastSeenAt: { gte: this.windowStart() } },
    });
    return n > 0;
  }

  /**
   * Nettoyage : supprime les observations EXPIRÉES (plus vues depuis IP_LEARN_WINDOW_HOURS).
   * Elles étaient déjà ignorées à la vérification ; ici on libère juste la base.
   * Une IP révoquée par l'admin disparaît aussi quand elle n'est plus vue pendant la fenêtre.
   */
  async purgeOldSightings(): Promise<number> {
    const r = await this.prisma.companyIpSighting.deleteMany({
      where: { lastSeenAt: { lt: this.windowStart() } },
    });
    return r.count;
  }

  /** Cette IP est-elle reconnue comme wifi de l'entreprise ? (saisie par l'admin ou apprise) */
  async isIpRecognized(
    companyId: string,
    rawIp: string | null | undefined,
  ): Promise<{ recognized: boolean; via: 'ADMIN' | 'LEARNED' | null }> {
    const ip = normalizeIp(rawIp);
    if (!ip || isPrivateOrLocalIp(ip)) return { recognized: false, via: null };
    const trusted = await this.prisma.companyTrustedIp.findFirst({
      where: { companyId, ip, isActive: true },
      select: { id: true },
    });
    if (trusted) return { recognized: true, via: 'ADMIN' };
    const people = await this.countLearnedIpPeople(companyId, ip);
    return people >= IP_LEARN_QUORUM
      ? { recognized: true, via: 'LEARNED' }
      : { recognized: false, via: null };
  }
}