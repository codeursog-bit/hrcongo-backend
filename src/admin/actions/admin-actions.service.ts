// ============================================================================
// src/admin/actions/admin-actions.service.ts
// Actions de support du SUPER ADMIN — remplacent les requêtes SQL manuelles :
//   • bulletins : changer le statut (ex. PAID → DRAFT), supprimer
//   • utilisateurs : débloquer, activer/désactiver, réinitialiser le mot de
//     passe, couper la 2FA, révoquer les sessions
//
// Garde-fous communs :
//   1. Motif obligatoire (5–300 car.)
//   2. Chaque action est écrite dans le journal d'audit chaîné de l'entreprise
//      (AuditTrailService) DANS LA MÊME TRANSACTION que l'action : les deux
//      passent ou les deux échouent. Actions préfixées « ADMIN_ ».
//   3. Aucune donnée sensible dans les listes (pas de montants, pas de salaires).
//   4. Un bulletin transmis à Compta n'est jamais modifié ni supprimé ici
//      (seule l'annulation est permise, comme dans le flux normal).
// ============================================================================

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService } from '../../audit-trail/audit-trail.service';
import { PayrollDeductionsService } from '../../payrolls/services/payroll-deductions.service';
import {
  ChangePayrollStatusDto,
  DeletePayrollDto,
  ListPayrollsQueryDto,
  PayrollStatusValue,
} from './admin-actions.dto';

const PAGE_SIZE = 25;

/** Le résumé d'audit est limité à 500 caractères en base */
const cut = (t: string) => (t.length > 500 ? `${t.slice(0, 497)}…` : t);

const fmtPeriod = (month: number, year: number) => `${String(month).padStart(2, '0')}/${year}`;

@Injectable()
export class AdminActionsService {
  private readonly logger = new Logger(AdminActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditTrailService,
    private readonly deductions: PayrollDeductionsService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getActor(actorId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, firstName: true, lastName: true },
    });
    if (!u || u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Accès refusé. Super Admin requis.');
    return { id: u.id, role: u.role as string, label: `${u.firstName} ${u.lastName}` };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 📄 BULLETINS
  // ══════════════════════════════════════════════════════════════════════════

  /** Liste légère (sans montants) pour retrouver le bulletin à corriger. */
  async listPayrolls(q: ListPayrollsQueryDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: q.companyId },
      select: { id: true, legalName: true, tradeName: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    const where: any = { companyId: q.companyId };
    if (q.month) where.month = q.month;
    if (q.year) where.year = q.year;
    if (q.status) where.status = q.status;
    if (q.search?.trim()) {
      const s = q.search.trim();
      where.employee = {
        OR: [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
        ],
      };
    }

    const page = q.page ?? 1;
    const [total, rows] = await Promise.all([
      this.prisma.payroll.count({ where }),
      this.prisma.payroll.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, month: true, year: true, status: true, validated: true, paid: true,
          paidAt: true, updatedAt: true,
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    // Bulletins transmis à Compta (verrouillés) — une seule requête pour la page
    const delivered = rows.length
      ? await this.prisma.comptaDelivery.findMany({
          where: { payrollId: { in: rows.map((r) => r.id) } },
          select: { payrollId: true },
        })
      : [];
    const lockedIds = new Set(delivered.map((d) => d.payrollId));

    return {
      company: { id: company.id, name: company.tradeName || company.legalName },
      total,
      page,
      pageSize: PAGE_SIZE,
      items: rows.map((r) => ({
        id: r.id,
        period: fmtPeriod(r.month, r.year),
        month: r.month,
        year: r.year,
        status: r.status,
        validated: r.validated,
        paid: r.paid,
        paidAt: r.paidAt,
        updatedAt: r.updatedAt,
        employee: `${r.employee.firstName} ${r.employee.lastName}`,
        employeeId: r.employee.id,
        lockedByCompta: lockedIds.has(r.id),
      })),
    };
  }

  /** Champs à écrire pour que status / validated / paid / paidAt restent COHÉRENTS. */
  private buildStatusData(
    target: PayrollStatusValue,
    current: { validated: boolean; validatedAt: Date | null; paidAt: Date | null; paymentDate: Date | null },
    actorId: string,
  ) {
    const now = new Date();
    switch (target) {
      case 'DRAFT':
        return {
          status: 'DRAFT', validated: false, validatedAt: null, validatedBy: null,
          paid: false, paidAt: null, paymentDate: null, paymentReference: null,
        };
      case 'VALIDATED':
      case 'TO_PAY':
        return {
          status: target, validated: true,
          validatedAt: current.validatedAt ?? now,
          ...(current.validated ? {} : { validatedBy: actorId }),
          paid: false, paidAt: null, paymentDate: null, paymentReference: null,
        };
      case 'PAID':
        return {
          status: 'PAID', validated: true,
          validatedAt: current.validatedAt ?? now,
          ...(current.validated ? {} : { validatedBy: actorId }),
          paid: true,
          paidAt: current.paidAt ?? now,
          paymentDate: current.paymentDate ?? now,
        };
      case 'CANCELLED':
      default:
        return { status: 'CANCELLED', paid: false, paidAt: null, paymentDate: null };
    }
  }

  async changePayrollStatus(actorId: string, payrollId: string, dto: ChangePayrollStatusDto, route?: string) {
    const actor = await this.getActor(actorId);

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      select: {
        id: true, companyId: true, month: true, year: true, status: true, validated: true,
        validatedAt: true, paid: true, paidAt: true, paymentDate: true, paymentReference: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!payroll) throw new NotFoundException('Bulletin introuvable');
    if (payroll.status === dto.status) {
      throw new BadRequestException(`Ce bulletin est déjà au statut ${dto.status}`);
    }

    // Même règle que le flux normal : un bulletin transmis à Compta ne peut qu'être annulé
    const delivered = await this.prisma.comptaDelivery.findFirst({
      where: { payrollId },
      select: { id: true },
    });
    if (delivered && dto.status !== 'CANCELLED') {
      throw new ForbiddenException(
        'Bulletin transmis à Compta : seule une annulation est possible (correction par annulation puis nouvelle écriture).',
      );
    }

    const data = this.buildStatusData(dto.status, payroll, actor.id);
    const leavesPaid = payroll.status === 'PAID' || dto.status === 'PAID';
    const who = `${payroll.employee.firstName} ${payroll.employee.lastName}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payroll.update({
        where: { id: payrollId },
        data: { ...(data as any), updatedAt: new Date() },
        select: { status: true, validated: true, paid: true, paymentReference: true },
      });

      await this.audit.record(tx, {
        companyId: payroll.companyId,
        actor,
        action: 'ADMIN_PAYROLL_STATUS_CHANGED',
        entity: 'PAYROLL',
        entityId: payroll.id,
        severity: leavesPaid ? 'CRITICAL' : 'WARN',
        summary: cut(
          `Super admin : bulletin ${who} ${fmtPeriod(payroll.month, payroll.year)} ` +
          `${payroll.status} → ${dto.status} — motif : ${dto.reason}`,
        ),
        before: {
          status: payroll.status, validated: payroll.validated, paid: payroll.paid,
          paymentReference: payroll.paymentReference,
        },
        after: row as any,
        context: { route },
      });
      return row;
    });

    this.logger.warn(`🛠️ [Super admin ${actor.label}] bulletin ${payroll.id} : ${payroll.status} → ${dto.status}`);
    return { success: true, payroll: { id: payroll.id, ...updated } };
  }

  async deletePayroll(actorId: string, payrollId: string, dto: DeletePayrollDto, route?: string) {
    const actor = await this.getActor(actorId);

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      select: {
        id: true, companyId: true, employeeId: true, month: true, year: true,
        status: true, validated: true, paid: true, paymentReference: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!payroll) throw new NotFoundException('Bulletin introuvable');

    const delivered = await this.prisma.comptaDelivery.findFirst({
      where: { payrollId },
      select: { id: true },
    });
    if (delivered) {
      throw new ForbiddenException(
        'Bulletin transmis à Compta : conservez l’historique et utilisez une annulation.',
      );
    }

    if ((payroll.status === 'PAID' || payroll.status === 'TO_PAY') && !dto.force) {
      throw new BadRequestException(
        `Ce bulletin est au statut ${payroll.status}. Pour le supprimer quand même, confirmez l'action critique (force).`,
      );
    }

    const who = `${payroll.employee.firstName} ${payroll.employee.lastName}`;

    const restored = await this.prisma.$transaction(
      async (tx) => {
        // ♻️ Même logique que la suppression normale : prêts/avances/retenues remis en état
        const r = await this.deductions.restoreDebtsForDeletedPayroll(
          tx, payroll.employeeId, payroll.month, payroll.year,
        );
        await tx.payroll.delete({ where: { id: payrollId } });

        await this.audit.record(tx, {
          companyId: payroll.companyId,
          actor,
          action: 'ADMIN_PAYROLL_DELETED',
          entity: 'PAYROLL',
          entityId: payroll.id,
          severity: 'CRITICAL',
          summary: cut(
            `Super admin : bulletin ${who} ${fmtPeriod(payroll.month, payroll.year)} supprimé ` +
            `(statut ${payroll.status}) — motif : ${dto.reason}`,
          ),
          before: {
            status: payroll.status, validated: payroll.validated, paid: payroll.paid,
            paymentReference: payroll.paymentReference, month: payroll.month, year: payroll.year,
          },
          after: null,
          context: { route },
        });
        return r;
      },
      { timeout: 30_000 },
    );

    this.logger.warn(`🛠️ [Super admin ${actor.label}] bulletin ${payroll.id} SUPPRIMÉ (${payroll.status})`);
    return { success: true, message: 'Bulletin supprimé', restoredDebts: restored };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 👤 UTILISATEURS
  // ══════════════════════════════════════════════════════════════════════════

  async searchUsers(q?: string, companyId?: string) {
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (q?.trim()) {
      const s = q.trim();
      where.OR = [
        { email: { contains: s, mode: 'insensitive' } },
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
      ];
    }
    if (!q?.trim() && !companyId) return []; // jamais de dump complet de la table

    const users = await this.prisma.user.findMany({
      where,
      take: 30,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true, isActive: true,
        lockedUntil: true, failedLoginAttempts: true, twoFactorEnabled: true,
        lastLoginAt: true, mustChangePassword: true,
        company: { select: { id: true, legalName: true, tradeName: true } },
      },
    });

    const now = Date.now();
    return users.map((u) => ({
      id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`, role: u.role,
      isActive: u.isActive,
      isLocked: !!u.lockedUntil && u.lockedUntil.getTime() > now,
      lockedUntil: u.lockedUntil,
      failedLoginAttempts: u.failedLoginAttempts,
      twoFactorEnabled: u.twoFactorEnabled,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      company: u.company ? { id: u.company.id, name: u.company.tradeName || u.company.legalName } : null,
    }));
  }

  /** Charge l'utilisateur cible et refuse de toucher à un autre super admin. */
  private async getTargetUser(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, role: true, firstName: true, lastName: true,
        companyId: true, isActive: true, twoFactorEnabled: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.role === 'SUPER_ADMIN' && user.id !== actorId) {
      throw new ForbiddenException('Action interdite sur un autre compte Super Admin');
    }
    return user;
  }

  /** Journal d'audit de l'entreprise de l'utilisateur ; sans entreprise → simple log serveur. */
  private async auditUserAction(
    tx: any,
    actor: { id: string; role: string; label: string },
    user: { id: string; firstName: string; lastName: string; companyId: string | null },
    action: string,
    summary: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL',
    route?: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ) {
    if (!user.companyId) {
      this.logger.warn(`🛠️ [Super admin ${actor.label}] ${action} sur ${user.id} (sans entreprise) — ${summary}`);
      return;
    }
    await this.audit.record(tx, {
      companyId: user.companyId, actor, action, entity: 'USER', entityId: user.id,
      severity, summary: cut(summary), before: before ?? null, after: after ?? null, context: { route },
    });
  }

  async unlockUser(actorId: string, userId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const user = await this.getTargetUser(actorId, userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      await this.auditUserAction(
        tx, actor, user, 'ADMIN_USER_UNLOCKED',
        `Super admin : compte ${user.firstName} ${user.lastName} débloqué — motif : ${reason}`,
        'INFO', route,
      );
    });
    return { success: true };
  }

  async setUserActive(actorId: string, userId: string, isActive: boolean, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const user = await this.getTargetUser(actorId, userId);
    if (user.id === actor.id) throw new BadRequestException('Vous ne pouvez pas modifier votre propre compte');
    if (user.isActive === isActive) {
      throw new BadRequestException(`Ce compte est déjà ${isActive ? 'actif' : 'désactivé'}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { isActive } });
      if (!isActive) {
        // Désactiver = couper immédiatement les sessions ouvertes
        await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.auditUserAction(
        tx, actor, user, isActive ? 'ADMIN_USER_ACTIVATED' : 'ADMIN_USER_DEACTIVATED',
        `Super admin : compte ${user.firstName} ${user.lastName} ${isActive ? 'réactivé' : 'désactivé'} — motif : ${reason}`,
        isActive ? 'WARN' : 'CRITICAL', route,
      );
    });
    return { success: true, isActive };
  }

  async resetUserPassword(actorId: string, userId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const user = await this.getTargetUser(actorId, userId);
    if (user.id === actor.id) throw new BadRequestException('Utilisez la page profil pour votre propre mot de passe');

    // 12 caractères lisibles (sans 0/O/1/l/I) — affiché UNE seule fois au super admin
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(12);
    const tempPassword = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    const hash = await bcrypt.hash(tempPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          password: hash, mustChangePassword: true, passwordChangedAt: new Date(),
          failedLoginAttempts: 0, lockedUntil: null,
        },
      });
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      // ⚠️ Le mot de passe n'est JAMAIS écrit dans le journal
      await this.auditUserAction(
        tx, actor, user, 'ADMIN_USER_PASSWORD_RESET',
        `Super admin : mot de passe de ${user.firstName} ${user.lastName} réinitialisé (changement obligatoire à la connexion) — motif : ${reason}`,
        'CRITICAL', route,
      );
    });
    return {
      success: true,
      email: user.email,
      tempPassword, // à transmettre au client par un canal sûr ; ne sera plus jamais affiché
      mustChangePassword: true,
    };
  }

  async disableUserTwoFactor(actorId: string, userId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const user = await this.getTargetUser(actorId, userId);
    if (!user.twoFactorEnabled) throw new BadRequestException("La 2FA n'est pas activée pour ce compte");

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
      });
      await this.auditUserAction(
        tx, actor, user, 'ADMIN_USER_2FA_DISABLED',
        `Super admin : 2FA de ${user.firstName} ${user.lastName} désactivée — motif : ${reason}`,
        'CRITICAL', route,
      );
    });
    return { success: true };
  }

  async revokeUserSessions(actorId: string, userId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const user = await this.getTargetUser(actorId, userId);
    const res = await this.prisma.$transaction(async (tx) => {
      const r = await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.auditUserAction(
        tx, actor, user, 'ADMIN_USER_SESSIONS_REVOKED',
        `Super admin : ${r.count} session(s) de ${user.firstName} ${user.lastName} révoquée(s) — motif : ${reason}`,
        'WARN', route,
      );
      return r;
    });
    return { success: true, revoked: res.count };
  }

  /** Corrige l'adresse email d'un compte (faute de frappe…). Unicité vérifiée. */
  async changeUserEmail(actorId: string, userId: string, newEmail: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const user = await this.getTargetUser(actorId, userId);
    const email = newEmail.trim().toLowerCase();

    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (current?.email.toLowerCase() === email) throw new BadRequestException('Cette adresse est déjà celle du compte');
    const taken = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (taken) throw new BadRequestException('Cette adresse email est déjà utilisée par un autre compte');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { email } });
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.auditUserAction(
        tx, actor, user, 'ADMIN_USER_EMAIL_CHANGED',
        `Super admin : email de ${user.firstName} ${user.lastName} changé (${current?.email} → ${email}) — motif : ${reason}`,
        'CRITICAL', route, { email: current?.email }, { email },
      );
    });
    return { success: true, email };
  }

  /** Change le rôle « entreprise » d'un compte. Garde-fou : jamais le dernier ADMIN actif de l'entreprise. */
  async changeUserRole(actorId: string, userId: string, role: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const user = await this.getTargetUser(actorId, userId);
    if (user.id === actor.id) throw new BadRequestException('Vous ne pouvez pas modifier votre propre rôle');
    if (['SUPER_ADMIN', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE'].includes(user.role as string)) {
      throw new ForbiddenException('Le rôle de ce type de compte ne se modifie pas ici');
    }
    if (user.role === role) throw new BadRequestException(`Ce compte a déjà le rôle ${role}`);

    if (user.role === 'ADMIN' && user.companyId) {
      const otherAdmins = await this.prisma.user.count({
        where: { companyId: user.companyId, role: 'ADMIN', isActive: true, id: { not: userId } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException("C'est le dernier administrateur actif de l'entreprise : nommez-en un autre avant de le rétrograder.");
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role: role as any } });
      // Le rôle est lu dans le jeton : on force une reconnexion pour appliquer les nouveaux droits
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.auditUserAction(
        tx, actor, user, 'ADMIN_USER_ROLE_CHANGED',
        `Super admin : rôle de ${user.firstName} ${user.lastName} ${user.role} → ${role} — motif : ${reason}`,
        'CRITICAL', route, { role: user.role }, { role },
      );
    });
    return { success: true, role };
  }

  /** Annule une invitation en attente (lien d'invitation devenu inutilisable). */
  async revokeInvitation(actorId: string, invitationId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const inv = await this.prisma.userInvitation.findUnique({
      where: { id: invitationId },
      select: { id: true, email: true, role: true, accepted: true, companyId: true, cabinetId: true },
    });
    if (!inv) throw new NotFoundException('Invitation introuvable');
    if (inv.accepted) throw new BadRequestException('Cette invitation a déjà été acceptée');

    await this.prisma.$transaction(async (tx) => {
      await tx.userInvitation.delete({ where: { id: invitationId } });
      const scopeId = inv.companyId ?? inv.cabinetId; // invitation PME ou invitation de cabinet
      if (scopeId) {
        await this.audit.record(tx, {
          companyId: scopeId, actor, action: 'ADMIN_INVITATION_REVOKED', entity: 'USER_INVITATION',
          entityId: inv.id, severity: 'WARN',
          summary: cut(`Super admin : invitation de ${inv.email} (${inv.role}) annulée — motif : ${reason}`),
          before: { email: inv.email, role: inv.role }, after: null, context: { route },
        });
      }
    });
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🧾 JOURNAL DES ACTIONS SUPER ADMIN
  // ══════════════════════════════════════════════════════════════════════════

  async history(companyId?: string, page = 1) {
    const where: any = { action: { startsWith: 'ADMIN_' } };
    if (companyId) where.companyId = companyId;

    const [total, rows] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, companyId: true, occurredAt: true, action: true, entity: true, entityId: true,
          severity: true, summary: true, actorLabel: true, changes: true,
        },
      }),
    ]);

    const companyIds = [...new Set(rows.map((r) => r.companyId))];
    const companies = companyIds.length
      ? await this.prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, legalName: true, tradeName: true },
        })
      : [];
    const names = new Map(companies.map((c) => [c.id, c.tradeName || c.legalName]));
    // Les actions sur un CABINET sont rangées sous l'id du cabinet : on résout aussi ces noms
    const unresolved = companyIds.filter((id) => !names.has(id));
    if (unresolved.length) {
      const cabinets = await this.prisma.cabinet.findMany({ where: { id: { in: unresolved } }, select: { id: true, name: true } });
      for (const c of cabinets) names.set(c.id, `Cabinet · ${c.name}`);
    }

    return {
      total, page, pageSize: PAGE_SIZE,
      items: rows.map((r) => ({ ...r, company: names.get(r.companyId) ?? null })),
    };
  }
}