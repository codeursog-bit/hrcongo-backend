// ============================================================================
// 📁 src/display-screens/display-screens.service.ts
// Pointage par scan QR dynamique (écran appairé) + code secret / PIN.
//
// Principes :
//  • L'écran (tablette) est appairé UNE fois par un admin ; il reçoit un jeton
//    d'appareil (haché en base, révocable) et n'a plus jamais à se connecter.
//  • Le QR change toutes les 30 s (HMAC sans état) : une capture d'écran est
//    inutilisable après ~60 s.
//  • L'employé scanne UNIQUEMENT depuis son espace connecté (JWT) — aucune
//    route publique ne permet de pointer.
//  • Le scan de l'écran fixe est la preuve de présence : le GPS n'est PAS exigé.
//  • Chaque scan bascule : pas encore d'entrée aujourd'hui → ENTRÉE, sinon SORTIE.
// ============================================================================
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AttendanceBreakService } from '../attendance/services/attendance-break.service';
import { AttemptLimiter, RateLimiter } from './attempt-limiter';
import {
  PAIRING_TTL_MS,
  QR_BATCH_SIZE,
  QR_STEP_MS,
  QR_STEP_SECONDS,
  buildQrToken,
  generatePairingCode,
  normalizeSecret,
  parseQrToken,
  randomToken,
  secretLookup,
  sha256,
  slotOf,
  validateSecretStrength,
  verifyQrSignature,
} from './display-token.util';

export const NOT_IN_COMPANY_MESSAGE = 'Vous ne faites pas partie de cette entreprise';
const REDELIVERY_WINDOW_MS = 2 * 60 * 1000; // si la réponse d'appairage est perdue
const MAX_PENDING_SCREENS = 300;

// Statuts d'employé autorisés à pointer (ON_LEAVE : peut travailler pendant un congé)
const PUNCH_ALLOWED_STATUSES = ['ACTIVE', 'ON_LEAVE'];

export interface PunchResult {
  success: boolean;
  direction?: 'IN' | 'OUT' | 'BREAK_END';
  firstName?: string;
  message?: string;
  code?: string;
  at?: string;
  requiresConfirmation?: boolean;
  reason?: string;
}

interface ScreenLike {
  id: string;
  name: string | null;
  scope: 'COMPANY' | 'PORTFOLIO' | null;
  companyId: string | null;
  ownerUserId: string | null;
}

interface PunchEmployee {
  id: string;
  companyId: string;
  firstName: string;
  userId?: string | null;
}

function httpError(status: number, error: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error, message }, status);
}

@Injectable()
export class DisplayScreensService {
  private readonly secretLimiter = new AttemptLimiter();
  private readonly scanRate = new RateLimiter(); // scans par employé
  private readonly logger = new Logger(DisplayScreensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly breaks: AttendanceBreakService, // 🆕 reprise de pause
  ) {}

  // ==========================================================================
  // 🔗 PÉRIMÈTRE : quelles entreprises un écran peut-il servir ?
  // ==========================================================================
  async companyIdsForScreen(screen: ScreenLike): Promise<string[]> {
    if (screen.scope === 'PORTFOLIO' && screen.ownerUserId) {
      const [links, owner] = await Promise.all([
        this.prisma.userCompany.findMany({
          where: { userId: screen.ownerUserId },
          select: { companyId: true },
        }),
        this.prisma.user.findUnique({
          where: { id: screen.ownerUserId },
          select: {
            companyId: true,
            isActive: true,
            manageMultipleCompanies: true,
            employee: { select: { companyId: true } },
          },
        }),
      ]);
      // Admin désactivé ou plus multi-entreprises → l'écran portefeuille devient inerte
      if (!owner?.isActive || !owner.manageMultipleCompanies) return [];
      const ids = new Set(links.map((l) => l.companyId));
      // Entreprise active de l'admin + entreprise de sa propre fiche employé : elles font
      // partie de son portefeuille même si elles n'ont pas de ligne UserCompany (ex. entreprise
      // d'origine, laissée après un changement d'entreprise active).
      if (owner.companyId) ids.add(owner.companyId);
      if (owner.employee?.companyId) ids.add(owner.employee.companyId);
      return [...ids];
    }
    return screen.companyId ? [screen.companyId] : [];
  }

  /** Vrai s'il existe au moins un écran approuvé qui couvre cette entreprise. */
  async hasScreenFor(companyId: string): Promise<boolean> {
    const [links, multiAdmins] = await Promise.all([
      this.prisma.userCompany.findMany({ where: { companyId }, select: { userId: true } }),
      this.prisma.user.findMany({
        where: {
          manageMultipleCompanies: true,
          OR: [{ companyId }, { employee: { is: { companyId } } }], // 🆕 y compris via sa fiche employé
        },
        select: { id: true },
      }),
    ]);
    const ownerIds = [...new Set([...links.map((l) => l.userId), ...multiAdmins.map((u) => u.id)])];

    const count = await this.prisma.displayScreen.count({
      where: {
        status: 'APPROVED',
        OR: [
          { scope: 'COMPANY', companyId },
          ...(ownerIds.length
            ? [
                {
                  scope: 'PORTFOLIO' as const,
                  ownerUserId: { in: ownerIds },
                  ownerUser: { is: { isActive: true, manageMultipleCompanies: true } },
                },
              ]
            : []),
        ],
      },
    });
    return count > 0;
  }

  // ==========================================================================
  // 📺 ÉCRAN — appairage
  // ==========================================================================
  async startPairing() {
    // Nettoyage opportuniste des demandes expirées depuis plus d'1 h
    await this.prisma.displayScreen
      .deleteMany({
        where: { status: 'PENDING', pairingExpiresAt: { lt: new Date(Date.now() - 3_600_000) } },
      })
      .catch(() => undefined);

    const pending = await this.prisma.displayScreen.count({
      where: { status: 'PENDING', pairingExpiresAt: { gt: new Date() } },
    });
    if (pending >= MAX_PENDING_SCREENS) {
      throw new ServiceUnavailableException('Trop de demandes en cours, réessayez dans quelques minutes.');
    }

    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt++) {
      const pairingCode = generatePairingCode();
      const pollToken = randomToken(24);
      try {
        await this.prisma.displayScreen.create({
          data: {
            status: 'PENDING',
            pairingCode,
            pairingExpiresAt: expiresAt,
            pollTokenHash: sha256(pollToken),
            qrSalt: randomToken(16),
          },
        });
        return { pairingCode, pollToken, expiresAt: expiresAt.getTime() };
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // collision de code → on retente
      }
    }
    throw new ServiceUnavailableException('Impossible de générer un code, réessayez.');
  }

  async pollPairing(pollToken: string) {
    const screen = await this.prisma.displayScreen.findUnique({
      where: { pollTokenHash: sha256(pollToken) },
    });
    if (!screen) return { status: 'EXPIRED' as const };

    if (screen.status === 'PENDING') {
      if (screen.pairingExpiresAt && screen.pairingExpiresAt < new Date()) {
        await this.prisma.displayScreen.delete({ where: { id: screen.id } }).catch(() => undefined);
        return { status: 'EXPIRED' as const };
      }
      return { status: 'PENDING' as const };
    }

    if (screen.status === 'APPROVED') {
      const firstDelivery = screen.tokenDeliveredAt;
      if (firstDelivery && Date.now() - firstDelivery.getTime() > REDELIVERY_WINDOW_MS) {
        return { status: 'EXPIRED' as const };
      }
      // Remise du jeton d'appareil (re-remise possible 2 min si la réponse s'est perdue :
      // l'ancien jeton est alors remplacé).
      const deviceToken = randomToken(32);
      await this.prisma.displayScreen.update({
        where: { id: screen.id },
        data: { deviceTokenHash: sha256(deviceToken), tokenDeliveredAt: firstDelivery ?? new Date() },
      });
      return { status: 'APPROVED' as const, deviceToken };
    }

    return { status: 'EXPIRED' as const };
  }

  // ==========================================================================
  // 📺 ÉCRAN — infos & lot de QR
  // ==========================================================================
  async me(screen: ScreenLike) {
    const ids = await this.companyIdsForScreen(screen);

    let label = 'Écran de pointage';
    if (screen.scope === 'PORTFOLIO') {
      label = 'Toutes mes entreprises';
    } else if (screen.companyId) {
      const c = await this.prisma.company.findUnique({
        where: { id: screen.companyId },
        select: { tradeName: true, legalName: true },
      });
      label = c?.tradeName || c?.legalName || label;
    }

    // Horaires de travail → l'écran se met en veille en dehors (économie tablette + serveur)
    let workHours: { startHour: number; endHour: number } | null = null;
    if (ids.length) {
      const rows = await this.prisma.payrollSettings.findMany({
        where: { companyId: { in: ids } },
        orderBy: { effectiveDate: 'desc' },
        select: { companyId: true, officialStartHour: true, officialEndHour: true },
      });
      const latest = new Map<string, { s: number; e: number }>();
      for (const r of rows) {
        if (!latest.has(r.companyId)) {
          latest.set(r.companyId, { s: r.officialStartHour ?? 8, e: r.officialEndHour ?? 17 });
        }
      }
      if (latest.size) {
        const vals = [...latest.values()];
        workHours = {
          startHour: Math.min(...vals.map((v) => v.s)),
          endHour: Math.max(...vals.map((v) => v.e)),
        };
      }
    }

    return { name: screen.name, scope: screen.scope, label, workHours };
  }

  async qrBatch(screen: { id: string; qrSalt: string }) {
    const now = Date.now();
    const first = slotOf(now);
    const tokens = Array.from({ length: QR_BATCH_SIZE }, (_, i) => {
      const slot = first + i;
      return {
        token: buildQrToken(screen.id, screen.qrSalt, slot),
        validFrom: slot * QR_STEP_MS,
        validUntil: (slot + 1) * QR_STEP_MS,
      };
    });
    return { tokens, serverTime: now, stepSeconds: QR_STEP_SECONDS };
  }

  // ==========================================================================
  // 👤 EMPLOYÉ — configuration + scan (connecté)
  // ==========================================================================
  private async resolveEmployeeOfUser(userId: string): Promise<PunchEmployee> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        employee: { select: { id: true, companyId: true, firstName: true, status: true } },
      },
    });
    if (!user?.isActive || !user.employee) {
      throw httpError(403, 'NO_EMPLOYEE', "Aucune fiche employé n'est liée à votre compte.");
    }
    if (!PUNCH_ALLOWED_STATUSES.includes(user.employee.status as string)) {
      throw httpError(403, 'EMPLOYEE_INACTIVE', "Votre fiche employé n'est pas active.");
    }
    return { ...user.employee, userId: user.id };
  }

  /** Le pointage par scan est « configuré » si un écran approuvé couvre l'entreprise. */
  async employeeConfig(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employee: { select: { companyId: true } } },
    });
    const companyId = user?.employee?.companyId;
    const enabled = companyId ? await this.hasScreenFor(companyId) : false;
    return { enabled, defaultMode: enabled ? ('SCAN' as const) : ('GPS' as const) };
  }

  async qrScan(userId: string, token: string, confirm?: boolean): Promise<PunchResult> {
    // Limite PAR EMPLOYÉ (pas par IP : un bureau entier partage la même IP publique)
    if (!this.scanRate.allow(userId, 10, 60_000)) {
      throw httpError(429, 'TOO_MANY_SCANS', 'Trop de scans en peu de temps. Patientez une minute puis réessayez.');
    }
    const parsed = parseQrToken(token);
    // Même message pour « inconnu / révoqué / signature fausse » : pas d'oracle pour un attaquant
    const invalid = httpError(400, 'QR_INVALID', 'QR code invalide. Scannez le QR affiché sur la tablette.');
    if (!parsed) throw invalid;

    const screen = await this.prisma.displayScreen.findUnique({ where: { id: parsed.screenId } });
    if (!screen || screen.status !== 'APPROVED') throw invalid;
    if (!verifyQrSignature(screen.id, screen.qrSalt, parsed.slot, parsed.sig)) throw invalid;

    // Fenêtre : créneau courant ou précédent (≈ 30–60 s), +1 de tolérance d'horloge
    const current = slotOf(Date.now());
    if (parsed.slot > current + 1 || current - parsed.slot > 1) {
      throw httpError(400, 'QR_EXPIRED', 'QR code expiré. Rescannez celui affiché à l’écran.');
    }

    const employee = await this.resolveEmployeeOfUser(userId);

    const allowed = await this.companyIdsForScreen(screen);
    if (!allowed.includes(employee.companyId)) {
      // Diagnostic serveur (aucune donnée sensible) : écran, périmètre, entreprise de l'employé
      this.logger.warn(
        `NOT_IN_COMPANY screen=${screen.id} scope=${screen.scope} owner=${screen.ownerUserId ?? '-'} ` +
          `employeeCompany=${employee.companyId} allowed=[${allowed.join(',')}]`,
      );
      throw httpError(403, 'NOT_IN_COMPANY', NOT_IN_COMPANY_MESSAGE);
    }

    return this.toggleAttendance(employee, screen.name, 'QR_SCAN', confirm);
  }

  // ==========================================================================
  // 🔑 ÉCRAN — pointage par code secret / PIN (saisi sur la tablette)
  // ==========================================================================
  async secretPunch(screen: ScreenLike, secret: string, confirm?: boolean): Promise<PunchResult> {
    const locked = this.secretLimiter.lockedFor(screen.id);
    if (locked > 0) {
      throw httpError(429, 'LOCKED', `Trop d'essais. Réessayez dans ${locked} s.`);
    }

    const rec = await this.prisma.employeeSecret.findUnique({
      where: { secretLookup: secretLookup(normalizeSecret(secret)) },
      include: { employee: { select: { id: true, firstName: true, companyId: true, status: true } } },
    });

    const allowed = rec ? await this.companyIdsForScreen(screen) : [];
    if (
      !rec ||
      !allowed.includes(rec.employee.companyId) ||
      !PUNCH_ALLOWED_STATUSES.includes(rec.employee.status as string)
    ) {
      // Un code d'une AUTRE entreprise est traité comme inconnu (aucune fuite entre tenants)
      this.secretLimiter.fail(screen.id);
      throw httpError(404, 'SECRET_NOT_FOUND', 'Code non reconnu. Réessayez.');
    }

    this.secretLimiter.reset(screen.id);
    return this.toggleAttendance(rec.employee, screen.name, 'SECRET_CODE', confirm);
  }

  // ==========================================================================
  // ⏱️ CŒUR : entrée si pas encore pointé aujourd'hui, sinon sortie
  // ==========================================================================
  private async toggleAttendance(
    employee: PunchEmployee,
    screenName: string | null,
    method: 'QR_SCAN' | 'SECRET_CODE',
    confirm?: boolean,
  ): Promise<PunchResult> {
    const firstName = employee.firstName;
    const dto: any = {
      employeeId: employee.id,
      notes: `Pointage par ${method === 'SECRET_CODE' ? 'code secret' : 'scan'} (écran « ${screenName || 'QR'} »)`,
      confirmRestDay: !!confirm,
      confirmWorkDuringLeave: !!confirm,
    };
    // actingCompanyId : la règle métier de la BONNE entreprise s'applique (multi-entreprises).
    // skipGeofence   : l'écran fixe est la preuve de présence, le GPS n'est pas exigé.
    const opts = { actingCompanyId: employee.companyId, skipGeofence: true, method, source: screenName ?? undefined };
    const userId = employee.userId ?? '';

    // 🆕 En pause ? Ce scan est la REPRISE du travail (jamais une sortie).
    const resumed = await this.breaks.resumeIfOnBreak({
      employeeId: employee.id,
      companyId: employee.companyId,
      method,
      source: screenName,
    });
    if (resumed) {
      return {
        success: true,
        direction: 'BREAK_END',
        firstName,
        at: new Date().toISOString(),
        message: resumed.message,
      };
    }

    try {
      const r: any = await this.attendance.checkIn(dto, userId, opts);
      if (r?.requiresConfirmation) {
        return {
          success: false,
          requiresConfirmation: true,
          reason: r.reason,
          message: r.message,
          firstName,
        };
      }
      return {
        success: true,
        direction: 'IN',
        firstName,
        at: new Date().toISOString(),
        message:
          r?.earlyArrivalMessage || r?.slightLateMessage || r?.message || 'Entrée enregistrée.',
      };
    } catch (e: any) {
      const already = e?.getResponse?.()?.error === 'ATTENDANCE_ALREADY_EXISTS';
      if (!already) throw e;
    }

    // Entrée déjà pointée aujourd'hui → ce scan est la SORTIE
    try {
      const r: any = await this.attendance.checkOut(dto, userId, opts);
      const hours = Number(r?.totalHours);
      return {
        success: true,
        direction: 'OUT',
        firstName,
        at: new Date().toISOString(),
        message: Number.isFinite(hours)
          ? `Sortie enregistrée — ${hours.toFixed(1)} h travaillées aujourd'hui.`
          : 'Sortie enregistrée.',
      };
    } catch (e: any) {
      if (e?.getResponse?.()?.error === 'ATTENDANCE_ALREADY_CHECKED_OUT') {
        return {
          success: false,
          code: 'ALREADY_DONE',
          firstName,
          message: "Vous avez déjà pointé votre sortie aujourd'hui.",
        };
      }
      throw e;
    }
  }

  // ==========================================================================
  // 🛠️ ADMIN / RH — gestion des écrans
  // ==========================================================================
  async approve(
    user: { id: string; companyId: string | null },
    dto: { code: string; name: string; scope: 'COMPANY' | 'PORTFOLIO' },
  ) {
    const code = dto.code.trim().toUpperCase();
    const screen = await this.prisma.displayScreen.findUnique({ where: { pairingCode: code } });
    if (
      !screen ||
      screen.status !== 'PENDING' ||
      !screen.pairingExpiresAt ||
      screen.pairingExpiresAt < new Date()
    ) {
      throw new NotFoundException('Code invalide ou expiré. Vérifiez le code affiché sur la tablette.');
    }

    let data: Record<string, any>;
    if (dto.scope === 'PORTFOLIO') {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, isActive: true, manageMultipleCompanies: true },
      });
      if (!dbUser?.isActive || !dbUser.manageMultipleCompanies) {
        throw new ForbiddenException('Seuls les admins multi-entreprises peuvent créer un écran « portefeuille ».');
      }
      data = { scope: 'PORTFOLIO', ownerUserId: user.id, companyId: null };
    } else {
      if (!user.companyId) throw new BadRequestException('Aucune entreprise active.');
      data = { scope: 'COMPANY', companyId: user.companyId, ownerUserId: null };
    }

    // Approbation atomique : deux admins ne peuvent pas approuver le même écran
    const res = await this.prisma.displayScreen.updateMany({
      where: { id: screen.id, status: 'PENDING' },
      data: {
        ...data,
        status: 'APPROVED',
        name: dto.name.trim(),
        approvedById: user.id,
        approvedAt: new Date(),
        pairingCode: null,
        pairingExpiresAt: null,
      },
    });
    if (res.count === 0) throw new NotFoundException('Cet écran a déjà été traité.');
    return this.getOwned(user, screen.id);
  }

  private ownedWhere(user: { id: string; companyId: string | null }) {
    return [
      ...(user.companyId ? [{ scope: 'COMPANY' as const, companyId: user.companyId }] : []),
      { scope: 'PORTFOLIO' as const, ownerUserId: user.id },
    ];
  }

  private toAdminView(s: any) {
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      scope: s.scope,
      companyLabel:
        s.scope === 'PORTFOLIO' ? 'Portefeuille' : s.company?.tradeName || s.company?.legalName || null,
      lastSeenAt: s.lastSeenAt,
      approvedAt: s.approvedAt,
    };
  }

  private async getOwned(user: { id: string; companyId: string | null }, id: string) {
    const s = await this.prisma.displayScreen.findFirst({
      where: { id, status: { in: ['APPROVED', 'REVOKED'] }, OR: this.ownedWhere(user) },
      include: { company: { select: { tradeName: true, legalName: true } } },
    });
    if (!s) throw new NotFoundException('Écran introuvable.');
    return this.toAdminView(s);
  }

  async list(user: { id: string; companyId: string | null }) {
    const monthAgo = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.displayScreen.findMany({
      where: {
        OR: this.ownedWhere(user),
        AND: [
          { OR: [{ status: 'APPROVED' }, { status: 'REVOKED', revokedAt: { gt: monthAgo } }] },
        ],
      },
      include: { company: { select: { tradeName: true, legalName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toAdminView(r));
  }

  async rename(user: { id: string; companyId: string | null }, id: string, name: string) {
    await this.getOwned(user, id);
    await this.prisma.displayScreen.update({ where: { id }, data: { name: name.trim() } });
    return this.getOwned(user, id);
  }

  async revoke(user: { id: string; companyId: string | null }, id: string) {
    await this.getOwned(user, id);
    await this.prisma.displayScreen.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date(), deviceTokenHash: null, pollTokenHash: null },
    });
    return { success: true };
  }

  async regenerateQr(user: { id: string; companyId: string | null }, id: string) {
    await this.getOwned(user, id); // contrôle d'appartenance (multi-tenant)
    const screen = await this.prisma.displayScreen.findUnique({ where: { id }, select: { status: true } });
    if (!screen || screen.status !== 'APPROVED') {
      throw httpError(400, 'SCREEN_NOT_ACTIVE', "Cet écran n'est pas actif.");
    }
    await this.prisma.displayScreen.update({ where: { id }, data: { qrSalt: randomToken(16) } });
    return { success: true };
  }

  // ==========================================================================
  // 🔐 CODE SECRET / PIN (défini UNIQUEMENT par l'admin / RH — jamais par l'employé)
  // ==========================================================================
  async hasSecret(employeeId: string) {
    const rec = await this.prisma.employeeSecret.findUnique({
      where: { employeeId },
      select: { updatedAt: true },
    });
    return { hasSecret: !!rec, updatedAt: rec?.updatedAt ?? null };
  }

  async setSecret(employee: { id: string; companyId: string }, secret: string, setByUserId: string | null) {
    const weak = validateSecretStrength(secret);
    if (weak) throw httpError(400, 'SECRET_WEAK', weak);

    const lookup = secretLookup(normalizeSecret(secret));
    const taken = await this.prisma.employeeSecret.findUnique({
      where: { secretLookup: lookup },
      select: { employeeId: true },
    });
    if (taken && taken.employeeId !== employee.id) {
      // Message volontairement vague : n'indique pas à qui appartient le code
      throw httpError(409, 'SECRET_TAKEN', "Ce code n'est pas disponible, choisissez-en un autre.");
    }

    await this.prisma.employeeSecret.upsert({
      where: { employeeId: employee.id },
      create: { employeeId: employee.id, companyId: employee.companyId, secretLookup: lookup, setByUserId },
      update: { secretLookup: lookup, companyId: employee.companyId, setByUserId },
    });
    return { success: true };
  }

  async removeSecret(employeeId: string) {
    await this.prisma.employeeSecret.deleteMany({ where: { employeeId } });
    return { success: true };
  }

  /**
   * Employés de l'entreprise qui ONT un code secret (traçabilité admin / RH).
   * Ne renvoie jamais le code (seule son empreinte est stockée) : uniquement qui en a un,
   * quand il a été défini et par qui.
   */
  async listSecrets(companyId: string | null) {
    if (!companyId) return [];
    const rows = await this.prisma.employeeSecret.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      select: {
        employeeId: true,
        setByUserId: true,
        createdAt: true,
        updatedAt: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            status: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const setterIds = [...new Set(rows.map((r) => r.setByUserId).filter((x): x is string => !!x))];
    const setters = setterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: setterIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const setterName = new Map(setters.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    return rows.map((r) => ({
      employeeId: r.employeeId,
      fullName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
      position: r.employee.position ?? null,
      department: r.employee.department?.name ?? null,
      status: r.employee.status as string,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      setByName: r.setByUserId ? setterName.get(r.setByUserId) ?? null : null,
    }));
  }

  async ownEmployee(userId: string) {
    return this.resolveEmployeeOfUser(userId);
  }

  /** Employé d'une entreprise donnée (contrôle multi-tenant pour la RH). */
  async employeeOfCompany(employeeId: string, companyId: string | null) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, companyId: true },
    });
    if (!emp || !companyId || emp.companyId !== companyId) {
      throw new NotFoundException('Employé introuvable.');
    }
    return emp;
  }
}