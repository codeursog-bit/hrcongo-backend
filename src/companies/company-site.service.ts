import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertCompanyAccess } from '../common/resolve-verified-company.util';
import { normalizeIp } from '../common/ip.util';
import {
  CreateCompanySiteDto,
  UpdateCompanySiteDto,
} from './dto/company-site.dto';

@Injectable()
export class CompanySiteService {
  constructor(private readonly prisma: PrismaService) {}

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
    extra?: { accuracy?: number | null; clientIp?: string | null },
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

    // 1) Dans le rayon (le plus proche en cas de multi-match)
    const exact = withDistances.find((c) => c.distance <= c.radius);
    if (exact) return ok(exact, 'RADIUS', null);

    // 2) Marge selon la précision GPS annoncée par l'appareil
    const cap = company?.gpsToleranceMeters ?? 0;
    const acc = Number(extra?.accuracy);
    const tolerance =
      cap > 0 && Number.isFinite(acc) && acc > 0 ? Math.min(acc, cap) : 0;
    if (tolerance > 0) {
      const soft = withDistances.find((c) => c.distance - tolerance <= c.radius);
      if (soft) {
        return ok(soft, 'TOLERANCE', `GPS avec marge (précision ±${Math.round(acc)} m)`);
      }
    }

    // 3) IP publique d'une connexion de l'entreprise (wifi du site)
    const ip = normalizeIp(extra?.clientIp);
    if (ip) {
      const trusted = await this.prisma.companyTrustedIp.findFirst({
        where: { companyId, ip, isActive: true },
        select: { label: true },
      });
      if (trusted) {
        return ok(closest, 'TRUSTED_IP', `IP de confiance : ${trusted.label}`);
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
}