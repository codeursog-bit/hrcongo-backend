// ============================================================================
// src/admin/accounts/accounts.service.ts
// GESTION DES COMPTES (super admin) — lecture : liste filtrée, statistiques, fiche
//
// Jamais exposé : mot de passe, secret 2FA, codes de secours, jetons de session
// (jti), token push. Les actions (débloquer, désactiver, reset…) sont dans
// AdminActionsService : motif obligatoire + journal d'audit.
// ============================================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAccountsQueryDto } from './accounts.dto';

const DAY = 86_400_000;
const cut = (t: string | null | undefined, n = 200) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t ?? '');

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Conditions Prisma pour chaque « état » de compte (réutilisées par la liste ET les compteurs). */
  private stateWhere(state: string, now: Date): any {
    switch (state) {
      case 'active': return { isActive: true, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
      case 'disabled': return { isActive: false };
      case 'locked': return { lockedUntil: { gt: now } };
      case 'never_logged': return { isActive: true, lastLoginAt: null };
      case 'inactive_90': return {
        isActive: true,
        OR: [{ lastLoginAt: { lt: new Date(now.getTime() - 90 * DAY) } },
             { lastLoginAt: null, createdAt: { lt: new Date(now.getTime() - 90 * DAY) } }],
      };
      case 'no_2fa': return { isActive: true, twoFactorEnabled: false, role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] } };
      case 'multi': return { manageMultipleCompanies: true };
      case 'must_change': return { mustChangePassword: true };
      default: return {};
    }
  }

  async stats() {
    const now = new Date();
    const count = (state?: string) => this.prisma.user.count({ where: state ? this.stateWhere(state, now) : {} });

    const [total, active, disabled, locked, neverLogged, inactive90, no2fa, multi, mustChange, new30, byRole] =
      await Promise.all([
        count(), count('active'), count('disabled'), count('locked'), count('never_logged'),
        count('inactive_90'), count('no_2fa'), count('multi'), count('must_change'),
        this.prisma.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
        this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      ]);

    return {
      total, active, disabled, locked, neverLogged, inactive90, privilegedWithout2fa: no2fa,
      multiCompany: multi, mustChangePassword: mustChange, newLast30Days: new30,
      byRole: Object.fromEntries(byRole.map((r) => [r.role, r._count._all])),
    };
  }

  async list(q: ListAccountsQueryDto) {
    const now = new Date();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const and: any[] = [];
    if (q.state) and.push(this.stateWhere(q.state, now));
    if (q.role) and.push({ role: q.role });
    if (q.companyId) {
      and.push({ OR: [{ companyId: q.companyId }, { ownedCompanies: { some: { companyId: q.companyId } } }] });
    }
    if (q.q?.trim()) {
      const s = q.q.trim();
      and.push({
        OR: [
          { email: { contains: s, mode: 'insensitive' } },
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
        ],
      });
    }
    const where = and.length ? { AND: and } : {};

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, email: true, firstName: true, lastName: true, role: true, isActive: true,
          lockedUntil: true, twoFactorEnabled: true, mustChangePassword: true,
          manageMultipleCompanies: true, lastLoginAt: true, createdAt: true,
          company: { select: { id: true, legalName: true, tradeName: true } },
          _count: { select: { ownedCompanies: true } },
        },
      }),
    ]);

    return {
      total, page, pageSize,
      items: users.map((u: any) => ({
        id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`, role: u.role,
        isActive: u.isActive, isLocked: !!u.lockedUntil && u.lockedUntil > now,
        twoFactorEnabled: u.twoFactorEnabled, mustChangePassword: u.mustChangePassword,
        multiCompany: u.manageMultipleCompanies, linkedCompanies: u._count.ownedCompanies,
        lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
        company: u.company ? { id: u.company.id, name: u.company.tradeName || u.company.legalName } : null,
      })),
    };
  }

  async detail(userId: string) {
    const now = new Date();
    const u: any = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true, isActive: true,
        manageMultipleCompanies: true, maxCompanies: true,
        twoFactorEnabled: true, mustChangePassword: true, failedLoginAttempts: true, lockedUntil: true,
        lastLoginAt: true, lastLoginIp: true, lastActiveAt: true, firstLoginAt: true, passwordChangedAt: true,
        createdAt: true, pushNotifEnabled: true,
        company: { select: { id: true, legalName: true, tradeName: true, isActive: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        ownedCompanies: {
          select: { companyId: true, createdAt: true, company: { select: { id: true, legalName: true, tradeName: true, isActive: true } } },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { pushSubscriptions: true, cabinetUsers: true } },
      },
    });
    if (!u) throw new NotFoundException('Utilisateur introuvable');

    const companyIds = [...new Set([u.company?.id, ...u.ownedCompanies.map((c: any) => c.companyId)].filter(Boolean))] as string[];

    const [subs, sessions, activeSessions, activity, invitations, adminActions] = await Promise.all([
      companyIds.length
        ? this.prisma.subscription.findMany({
            where: { companyId: { in: companyIds } },
            select: { companyId: true, plan: true, status: true, currentPeriodEnd: true },
          })
        : [],
      this.prisma.userSession.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
      }),
      this.prisma.userSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.activityLog.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: 15,
        select: { id: true, action: true, entity: true, description: true, createdAt: true },
      }),
      this.prisma.userInvitation.findMany({
        where: { email: u.email, accepted: false },
        orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, role: true, expiresAt: true, createdAt: true, companyId: true },
      }),
      u.company?.id
        ? this.prisma.auditEvent.findMany({
            where: { companyId: u.company.id, entity: 'USER', entityId: userId, action: { startsWith: 'ADMIN_' } },
            orderBy: { occurredAt: 'desc' }, take: 10,
            select: { id: true, occurredAt: true, action: true, severity: true, summary: true, actorLabel: true },
          })
        : [],
    ]);

    const subByCompany = new Map((subs as any[]).map((s) => [s.companyId, s]));
    const name = (c: any) => c.tradeName || c.legalName;
    const linked = new Map<string, any>();
    if (u.company) linked.set(u.company.id, { id: u.company.id, name: name(u.company), isActive: u.company.isActive, primary: true });
    for (const l of u.ownedCompanies) {
      if (!linked.has(l.company.id)) linked.set(l.company.id, { id: l.company.id, name: name(l.company), isActive: l.company.isActive, primary: false, linkedAt: l.createdAt });
    }

    return {
      id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`, firstName: u.firstName, lastName: u.lastName,
      role: u.role, isActive: u.isActive,
      isLocked: !!u.lockedUntil && u.lockedUntil > now, lockedUntil: u.lockedUntil,
      failedLoginAttempts: u.failedLoginAttempts,
      twoFactorEnabled: u.twoFactorEnabled, mustChangePassword: u.mustChangePassword,
      multiCompany: { enabled: u.manageMultipleCompanies, maxCompanies: u.maxCompanies },
      security: {
        lastLoginAt: u.lastLoginAt, lastLoginIp: u.lastLoginIp ? String(u.lastLoginIp) : null,
        lastActiveAt: u.lastActiveAt, firstLoginAt: u.firstLoginAt, passwordChangedAt: u.passwordChangedAt,
      },
      createdAt: u.createdAt,
      employee: u.employee ? { id: u.employee.id, name: `${u.employee.firstName} ${u.employee.lastName}` } : null,
      push: { enabled: u.pushNotifEnabled, devices: u._count.pushSubscriptions },
      cabinetMemberships: u._count.cabinetUsers,
      companies: [...linked.values()].map((c) => {
        const s = subByCompany.get(c.id);
        return { ...c, subscription: s ? { plan: s.plan, status: s.status, currentPeriodEnd: s.currentPeriodEnd } : null };
      }),
      sessions: { active: activeSessions, recent: sessions.map((s) => ({ ...s, active: !s.revokedAt && s.expiresAt > now })) },
      activity: activity.map((a) => ({ ...a, description: cut(a.description) })),
      pendingInvitations: invitations,
      adminActions,
    };
  }
}