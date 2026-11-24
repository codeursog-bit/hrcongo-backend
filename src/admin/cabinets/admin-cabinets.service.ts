// ============================================================================
// src/admin/cabinets/admin-cabinets.service.ts
// GESTION DES CABINETS (super admin)
//
//   • Lecture : vue d'ensemble (wallets, revenus, « à traiter »), liste filtrée,
//     fiche cabinet (membres, PME clientes, wallet, paiements, clôtures).
//   • Tous les effectifs sont recomptés EN DIRECT (jamais lus dans un compteur).
//   • Actions (motif obligatoire + journal d'audit chaîné) : ajuster le solde de
//     bulletins, forfait, essai, activer/désactiver, accès PME, resynchroniser
//     les compteurs.
//
// Journal d'audit : AuditEvent n'a aucune clé étrangère → on utilise l'id du
// CABINET comme clé de chaîne (colonne companyId). Les actions cabinet forment
// ainsi leur propre chaîne infalsifiable, séparée de celles des entreprises.
// ============================================================================

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService } from '../../audit-trail/audit-trail.service';
import { CompanyAccessDto, ListCabinetsQueryDto } from './admin-cabinets.dto';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const num = (v: any) => (v == null ? 0 : Number(v));
const cut = (t: string, n = 500) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const mask = (s?: string | null) => (s ? `••••${s.slice(-3)}` : null);

@Injectable()
export class AdminCabinetsService {
  private readonly logger = new Logger(AdminCabinetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditTrailService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getActor(actorId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: actorId }, select: { id: true, role: true, firstName: true, lastName: true },
    });
    if (!u || u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Accès refusé. Super Admin requis.');
    return { id: u.id, role: u.role as string, label: `${u.firstName} ${u.lastName}` };
  }

  private async getCabinet(cabinetId: string) {
    const c = await this.prisma.cabinet.findUnique({
      where: { id: cabinetId }, select: { id: true, name: true, isActive: true },
    });
    if (!c) throw new NotFoundException('Cabinet introuvable');
    return c;
  }

  private async record(actor: any, cabinet: { id: string; name: string }, action: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL', summary: string, before: any, after: any, route?: string, tx?: any) {
    const run = (db: any) => this.audit.record(db, {
      companyId: cabinet.id, // ← clé de chaîne = id du cabinet (voir en-tête)
      actor, action, entity: 'CABINET', entityId: cabinet.id,
      severity, summary: cut(summary), before, after, context: { route },
    });
    if (tx) return run(tx);
    return this.prisma.$transaction((t) => run(t));
  }

  /** Effectifs actifs EN DIRECT par entreprise (même définition que les limites du cabinet : status ACTIVE). */
  private async liveEmployeesByCompany(companyIds: string[]): Promise<Map<string, number>> {
    if (!companyIds.length) return new Map<string, number>();
    const rows = await this.prisma.employee.groupBy({
      by: ['companyId'], where: { companyId: { in: companyIds }, status: 'ACTIVE' }, _count: { _all: true },
    });
    return new Map<string, number>(rows.map((r) => [r.companyId, r._count._all] as [string, number]));
  }

  private walletFlags(w: any, now = new Date()) {
    if (!w) return { forfaitActive: false, trialActive: false, trialExpired: false, canGenerate: false };
    const forfaitActive = !!(w.isForfait && w.forfaitExpiresAt && now <= w.forfaitExpiresAt);
    const trialExpired = !!(w.trialActive && w.trialExpiresAt && now > w.trialExpiresAt);
    return {
      forfaitActive,
      trialActive: !!(w.trialActive && w.trialExpiresAt && now <= w.trialExpiresAt),
      trialExpired,
      canGenerate: forfaitActive || w.bulletinsBalance > 0,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 📊 VUE D'ENSEMBLE
  // ══════════════════════════════════════════════════════════════════════════

  async overview() {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * DAY);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const stuckBefore = new Date(now.getTime() - HOUR);
    const monthAgo = new Date(now.getTime() - 30 * DAY);

    const noForfait = { OR: [{ isForfait: false }, { forfaitExpiresAt: null }, { forfaitExpiresAt: { lt: now } }] };
    const wSel = { select: { name: true } } as const;

    const [
      total, active, noWallet, noAdmin, links, forfaitActive, trialActive, trialExpired, zeroBalance,
      walletAgg, revMonth, revYear, stuck, failedClosures, zeroList, trialSoon, forfaitSoon, topUsage,
    ] = await Promise.all([
      this.prisma.cabinet.count(),
      this.prisma.cabinet.count({ where: { isActive: true } }),
      this.prisma.cabinet.count({ where: { wallet: { is: null } } }),
      this.prisma.cabinet.count({ where: { isActive: true, users: { none: { role: 'CABINET_ADMIN' } } } }),
      this.prisma.cabinetCompany.count({ where: { isActive: true, cabinet: { isActive: true } } }),
      this.prisma.cabinetWallet.count({ where: { isForfait: true, forfaitExpiresAt: { gt: now } } }),
      this.prisma.cabinetWallet.count({ where: { trialActive: true, trialExpiresAt: { gt: now } } }),
      this.prisma.cabinetWallet.count({ where: { trialActive: true, trialExpiresAt: { lt: now } } }),
      this.prisma.cabinetWallet.count({ where: { bulletinsBalance: { lte: 0 }, ...noForfait, cabinet: { isActive: true } } }),
      this.prisma.cabinetWallet.aggregate({ _sum: { bulletinsBalance: true, bulletinsUsedThisMonth: true } }),
      this.prisma.cabinetPayment.aggregate({ where: { status: 'SUCCEEDED', paidAt: { gte: monthStart } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.cabinetPayment.aggregate({ where: { status: 'SUCCEEDED', paidAt: { gte: yearStart } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.cabinetPayment.findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: stuckBefore } },
        orderBy: { createdAt: 'asc' }, take: 10,
        select: { id: true, amount: true, status: true, createdAt: true, subscription: { select: { cabinet: { select: { id: true, name: true } } } } },
      }),
      this.prisma.cabinetBatchClosure.count({ where: { status: { in: ['FAILED', 'PARTIAL'] }, createdAt: { gte: monthAgo } } }),
      this.prisma.cabinetWallet.findMany({
        where: { bulletinsBalance: { lte: 0 }, ...noForfait, cabinet: { isActive: true } }, take: 10,
        orderBy: { updatedAt: 'desc' }, select: { cabinetId: true, bulletinsBalance: true, cabinet: wSel },
      }),
      this.prisma.cabinetWallet.findMany({
        where: { trialActive: true, trialExpiresAt: { gte: now, lte: in7 } }, take: 10,
        orderBy: { trialExpiresAt: 'asc' }, select: { cabinetId: true, trialExpiresAt: true, bulletinsBalance: true, cabinet: wSel },
      }),
      this.prisma.cabinetWallet.findMany({
        where: { isForfait: true, forfaitExpiresAt: { gte: now, lte: in7 } }, take: 10,
        orderBy: { forfaitExpiresAt: 'asc' }, select: { cabinetId: true, forfaitExpiresAt: true, cabinet: wSel },
      }),
      this.prisma.cabinetWallet.findMany({
        where: { bulletinsUsedThisMonth: { gt: 0 } }, take: 5, orderBy: { bulletinsUsedThisMonth: 'desc' },
        select: { cabinetId: true, bulletinsUsedThisMonth: true, cabinet: wSel },
      }),
    ]);

    return {
      cabinets: { total, active, inactive: total - active, linkedCompanies: links },
      wallets: {
        forfaitActive, trialActive, trialExpired, zeroBalance,
        totalBalance: num(walletAgg._sum.bulletinsBalance),
        usedThisMonth: num(walletAgg._sum.bulletinsUsedThisMonth),
      },
      revenue: {
        thisMonth: num(revMonth._sum.amount), thisMonthCount: revMonth._count._all,
        thisYear: num(revYear._sum.amount), thisYearCount: revYear._count._all,
      },
      topUsage: topUsage.map((w) => ({ cabinetId: w.cabinetId, name: w.cabinet.name, used: w.bulletinsUsedThisMonth })),
      attention: {
        noWallet, activeWithoutAdmin: noAdmin, failedClosuresLast30Days: failedClosures,
        stuckPayments: stuck.map((p) => ({
          id: p.id, amount: p.amount, status: p.status, createdAt: p.createdAt,
          cabinetId: p.subscription.cabinet.id, cabinet: p.subscription.cabinet.name,
        })),
        zeroBalance: zeroList.map((w) => ({ cabinetId: w.cabinetId, name: w.cabinet.name, balance: w.bulletinsBalance })),
        trialEndingSoon: trialSoon.map((w) => ({ cabinetId: w.cabinetId, name: w.cabinet.name, endsAt: w.trialExpiresAt, balance: w.bulletinsBalance })),
        forfaitEndingSoon: forfaitSoon.map((w) => ({ cabinetId: w.cabinetId, name: w.cabinet.name, endsAt: w.forfaitExpiresAt })),
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 📋 LISTE
  // ══════════════════════════════════════════════════════════════════════════

  async list(q: ListCabinetsQueryDto) {
    const now = new Date();
    const page = q.page ?? 1, pageSize = q.pageSize ?? 25;
    const and: any[] = [];

    if (q.q?.trim()) {
      const s = q.q.trim();
      and.push({ OR: [
        { name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { subdomain: { contains: s, mode: 'insensitive' } },
      ] });
    }
    switch (q.state) {
      case 'active': and.push({ isActive: true }); break;
      case 'inactive': and.push({ isActive: false }); break;
      case 'no_wallet': and.push({ wallet: { is: null } }); break;
      case 'trial': and.push({ wallet: { is: { trialActive: true } } }); break;
      case 'forfait': and.push({ wallet: { is: { isForfait: true, forfaitExpiresAt: { gt: now } } } }); break;
      case 'no_balance':
        and.push({ wallet: { is: { bulletinsBalance: { lte: 0 }, OR: [{ isForfait: false }, { forfaitExpiresAt: null }, { forfaitExpiresAt: { lt: now } }] } } });
        break;
    }
    const where = and.length ? { AND: and } : {};

    const [total, cabinets] = await Promise.all([
      this.prisma.cabinet.count({ where }),
      this.prisma.cabinet.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, name: true, email: true, phone: true, subdomain: true, isActive: true, createdAt: true,
          wallet: { select: { bulletinsBalance: true, isForfait: true, forfaitExpiresAt: true, trialActive: true, trialExpiresAt: true, bulletinsUsedThisMonth: true } },
          _count: { select: { users: true } },
        },
      }),
    ]);

    // PME actives + effectifs EN DIRECT pour la page courante
    const links: { cabinetId: string; companyId: string }[] = cabinets.length
      ? await this.prisma.cabinetCompany.findMany({
          where: { cabinetId: { in: cabinets.map((c) => c.id) }, isActive: true }, select: { cabinetId: true, companyId: true },
        })
      : [];
    const emp = await this.liveEmployeesByCompany([...new Set(links.map((l) => l.companyId))]);
    const byCabinet = new Map<string, { companies: number; employees: number }>();
    for (const l of links) {
      const cur = byCabinet.get(l.cabinetId) ?? { companies: 0, employees: 0 };
      cur.companies += 1; cur.employees += emp.get(l.companyId) ?? 0;
      byCabinet.set(l.cabinetId, cur);
    }

    return {
      total, page, pageSize,
      items: cabinets.map((c: any) => {
        const live = byCabinet.get(c.id) ?? { companies: 0, employees: 0 };
        const flags = this.walletFlags(c.wallet, now);
        return {
          id: c.id, name: c.name, email: c.email, phone: c.phone, subdomain: c.subdomain,
          isActive: c.isActive, createdAt: c.createdAt, members: c._count.users,
          companies: live.companies, employees: live.employees,
          wallet: c.wallet
            ? { balance: c.wallet.bulletinsBalance, usedThisMonth: c.wallet.bulletinsUsedThisMonth,
                forfaitExpiresAt: c.wallet.forfaitExpiresAt, trialExpiresAt: c.wallet.trialExpiresAt, ...flags }
            : null,
        };
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔎 FICHE CABINET
  // ══════════════════════════════════════════════════════════════════════════

  async detail(cabinetId: string) {
    const now = new Date();
    const cab: any = await this.prisma.cabinet.findUnique({
      where: { id: cabinetId },
      select: {
        id: true, name: true, email: true, phone: true, subdomain: true, isActive: true, createdAt: true,
        users: {
          select: { role: true, createdAt: true, user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true, lastLoginAt: true, twoFactorEnabled: true } } },
          orderBy: { createdAt: 'asc' },
        },
        companies: {
          select: {
            companyId: true, isActive: true, pmePortalEnabled: true, employeeAccessEnabled: true, startDate: true, endDate: true,
            company: { select: { id: true, legalName: true, tradeName: true, isActive: true, archivedAt: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        wallet: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } } },
        subscription: true,
        affiliateLink: { select: { linkedAt: true, affiliate: { select: { firstName: true, lastName: true, referralCode: true } } } },
      },
    });
    if (!cab) throw new NotFoundException('Cabinet introuvable');

    const activeLinks = cab.companies.filter((c: any) => c.isActive);
    const companyIds = cab.companies.map((c: any) => c.companyId);
    const month = now.getMonth() + 1, year = now.getFullYear();

    const [emp, payrollsMonth, payments, closures, invitations, history] = await Promise.all([
      this.liveEmployeesByCompany(companyIds),
      companyIds.length
        ? this.prisma.payroll.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds }, month, year, status: { not: 'CANCELLED' } }, _count: { _all: true } })
        : [],
      cab.subscription
        ? this.prisma.cabinetPayment.findMany({
            where: { subscriptionId: cab.subscription.id }, orderBy: { createdAt: 'desc' }, take: 15,
            select: { id: true, amount: true, status: true, plan: true, billingPeriod: true, months: true, paidAt: true, createdAt: true, yabetopayOperator: true, yabetopayPhone: true },
          })
        : [],
      this.prisma.cabinetBatchClosure.findMany({
        where: { cabinetId }, orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, month: true, year: true, status: true, totalCompanies: true, successCount: true, failedCount: true, startedAt: true, completedAt: true },
      }),
      this.prisma.userInvitation.findMany({
        where: { cabinetId, accepted: false }, orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      }),
      this.prisma.auditEvent.findMany({
        where: { companyId: cabinetId, entity: 'CABINET', action: { startsWith: 'ADMIN_' } },
        orderBy: { occurredAt: 'desc' }, take: 10,
        select: { id: true, occurredAt: true, action: true, severity: true, summary: true, actorLabel: true },
      }),
    ]);

    const payrollByCompany = new Map((payrollsMonth as any[]).map((p) => [p.companyId, p._count._all]));
    const liveEmployees = activeLinks.reduce((s: number, c: any) => s + (emp.get(c.companyId) ?? 0), 0);
    const w = cab.wallet;
    const flags = this.walletFlags(w, now);
    const sub = cab.subscription;

    return {
      id: cab.id, name: cab.name, email: cab.email, phone: cab.phone, subdomain: cab.subdomain,
      isActive: cab.isActive, createdAt: cab.createdAt,
      affiliate: cab.affiliateLink
        ? { name: `${cab.affiliateLink.affiliate.firstName} ${cab.affiliateLink.affiliate.lastName}`, code: cab.affiliateLink.affiliate.referralCode, linkedAt: cab.affiliateLink.linkedAt }
        : null,
      live: { companies: activeLinks.length, employees: liveEmployees, members: cab.users.length, payrollsThisMonth: [...payrollByCompany.values()].reduce((a: number, b: any) => a + b, 0) },
      wallet: w
        ? {
            balance: w.bulletinsBalance, usedThisMonth: w.bulletinsUsedThisMonth, isForfait: w.isForfait,
            forfaitExpiresAt: w.forfaitExpiresAt, trialExpiresAt: w.trialExpiresAt, lastResetAt: w.lastResetAt, ...flags,
            transactions: w.transactions.map((t: any) => ({ id: t.id, type: t.type, amount: t.amount, description: t.description, balanceBefore: t.balanceBefore, balanceAfter: t.balanceAfter, createdAt: t.createdAt })),
          }
        : null,
      // Ancien modèle d'abonnement (encore en base) : valeurs stockées vs recomptage en direct
      legacySubscription: sub
        ? {
            plan: sub.plan, status: sub.status, maxCompanies: sub.maxCompanies, maxEmployees: sub.maxEmployees,
            stored: { companies: sub.currentCompanies, employees: sub.currentEmployees },
            live: { companies: activeLinks.length, employees: liveEmployees },
            drift: sub.currentCompanies !== activeLinks.length || sub.currentEmployees !== liveEmployees,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      members: cab.users.map((m: any) => ({
        userId: m.user.id, name: `${m.user.firstName} ${m.user.lastName}`, email: m.user.email, role: m.role,
        isActive: m.user.isActive, lastLoginAt: m.user.lastLoginAt, twoFactorEnabled: m.user.twoFactorEnabled,
      })),
      companies: cab.companies.map((c: any) => ({
        id: c.company.id, name: c.company.tradeName || c.company.legalName, linkActive: c.isActive,
        companyActive: c.company.isActive && !c.company.archivedAt,
        pmePortalEnabled: c.pmePortalEnabled, employeeAccessEnabled: c.employeeAccessEnabled,
        startDate: c.startDate, endDate: c.endDate,
        employees: emp.get(c.company.id) ?? 0, payrollsThisMonth: payrollByCompany.get(c.company.id) ?? 0,
      })),
      payments: (payments as any[]).map((p) => ({ ...p, yabetopayPhone: mask(p.yabetopayPhone) })),
      closures, pendingInvitations: invitations, history,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🛠️ ACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  /** Crédit (>0) ou correction (<0) du solde de bulletins. Le solde ne peut jamais devenir négatif. */
  async adjustBulletins(actorId: string, cabinetId: string, delta: number, reason: string, route?: string) {
    if (!Number.isInteger(delta) || delta === 0) throw new BadRequestException('Quantité invalide');
    const actor = await this.getActor(actorId);
    const cabinet = await this.getCabinet(cabinetId);

    const result = await this.prisma.$transaction(async (tx) => {
      const w = await tx.cabinetWallet.findUnique({ where: { cabinetId }, select: { id: true } });
      if (!w) throw new NotFoundException('Ce cabinet n’a pas de wallet');
      await tx.$queryRaw`SELECT id FROM cabinet_wallets WHERE id = ${w.id}::uuid FOR UPDATE`;
      const fresh = await tx.cabinetWallet.findUnique({ where: { id: w.id }, select: { bulletinsBalance: true } });
      const before = fresh!.bulletinsBalance, after = before + delta;
      if (after < 0) throw new BadRequestException(`Solde insuffisant pour retirer ${-delta} bulletin(s) (solde : ${before})`);

      await tx.cabinetWallet.update({ where: { id: w.id }, data: { bulletinsBalance: after } });
      await tx.cabinetWalletTransaction.create({
        data: {
          walletId: w.id, type: 'MANUAL_CREDIT', amount: delta, balanceBefore: before, balanceAfter: after,
          description: cut(`${delta > 0 ? 'Crédit' : 'Correction'} super admin — ${reason}`, 255),
          reference: `ADMIN:${actor.id.slice(0, 8)}`,
        },
      });
      await this.record(actor, cabinet, 'ADMIN_CABINET_BULLETINS_ADJUSTED', delta > 0 ? 'WARN' : 'CRITICAL',
        `Super admin : cabinet ${cabinet.name} ${delta > 0 ? '+' : ''}${delta} bulletin(s) (solde ${before} → ${after}) — motif : ${reason}`,
        { balance: before }, { balance: after }, route, tx);
      return { before, after };
    });
    return { success: true, balance: result.after };
  }

  /** Active (ajoute `months` mois, en prolongeant un forfait déjà en cours) ou termine le forfait illimité. */
  async setForfait(actorId: string, cabinetId: string, active: boolean, months: number | undefined, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const cabinet = await this.getCabinet(cabinetId);
    const w = await this.prisma.cabinetWallet.findUnique({ where: { cabinetId } });
    if (!w) throw new NotFoundException('Ce cabinet n’a pas de wallet');
    const now = new Date();

    if (active) {
      const m = months ?? 1;
      const base = w.isForfait && w.forfaitExpiresAt && w.forfaitExpiresAt > now ? new Date(w.forfaitExpiresAt) : new Date(now);
      base.setMonth(base.getMonth() + m);
      await this.prisma.$transaction(async (tx) => {
        await tx.cabinetWallet.update({ where: { cabinetId }, data: { isForfait: true, forfaitExpiresAt: base, trialActive: false, ...(w.isForfait ? {} : { bulletinsUsedThisMonth: 0, lastResetAt: now }) } });
        await tx.cabinetWalletTransaction.create({
          data: { walletId: w.id, type: 'FORFAIT_ACTIVATION', amount: 0, balanceBefore: w.bulletinsBalance, balanceAfter: w.bulletinsBalance,
            description: cut(`Forfait illimité ${m} mois (super admin) — ${reason}`, 255), reference: `ADMIN:${actor.id.slice(0, 8)}` },
        });
        await this.record(actor, cabinet, 'ADMIN_CABINET_FORFAIT_ACTIVATED', 'WARN',
          `Super admin : forfait illimité de ${cabinet.name} activé/prolongé de ${m} mois, jusqu'au ${base.toLocaleDateString('fr-FR')} — motif : ${reason}`,
          { isForfait: w.isForfait, forfaitExpiresAt: w.forfaitExpiresAt }, { isForfait: true, forfaitExpiresAt: base }, route, tx);
      });
      return { success: true, forfaitExpiresAt: base };
    }

    if (!w.isForfait) throw new BadRequestException('Aucun forfait actif pour ce cabinet');
    await this.prisma.$transaction(async (tx) => {
      await tx.cabinetWallet.update({ where: { cabinetId }, data: { isForfait: false, forfaitExpiresAt: now } });
      await tx.cabinetWalletTransaction.create({
        data: { walletId: w.id, type: 'FORFAIT_RESET', amount: 0, balanceBefore: w.bulletinsBalance, balanceAfter: w.bulletinsBalance,
          description: cut(`Forfait terminé (super admin) — ${reason}`, 255), reference: `ADMIN:${actor.id.slice(0, 8)}` },
      });
      await this.record(actor, cabinet, 'ADMIN_CABINET_FORFAIT_ENDED', 'CRITICAL',
        `Super admin : forfait illimité de ${cabinet.name} terminé — motif : ${reason}`,
        { isForfait: true, forfaitExpiresAt: w.forfaitExpiresAt }, { isForfait: false }, route, tx);
    });
    return { success: true };
  }

  async extendTrial(actorId: string, cabinetId: string, days: number, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const cabinet = await this.getCabinet(cabinetId);
    const w = await this.prisma.cabinetWallet.findUnique({ where: { cabinetId } });
    if (!w) throw new NotFoundException('Ce cabinet n’a pas de wallet');
    const now = new Date();
    const start = w.trialExpiresAt && w.trialExpiresAt > now ? new Date(w.trialExpiresAt) : new Date(now);
    const ends = new Date(start.getTime() + days * DAY);

    await this.prisma.$transaction(async (tx) => {
      await tx.cabinetWallet.update({ where: { cabinetId }, data: { trialActive: true, trialExpiresAt: ends } });
      await tx.cabinetWalletTransaction.create({
        data: { walletId: w.id, type: 'TRIAL_CREDIT', amount: 0, balanceBefore: w.bulletinsBalance, balanceAfter: w.bulletinsBalance,
          description: cut(`Essai prolongé de ${days} jours (super admin) — ${reason}`, 255), reference: `ADMIN:${actor.id.slice(0, 8)}` },
      });
      await this.record(actor, cabinet, 'ADMIN_CABINET_TRIAL_EXTENDED', 'WARN',
        `Super admin : essai de ${cabinet.name} prolongé de ${days} j, jusqu'au ${ends.toLocaleDateString('fr-FR')} — motif : ${reason}`,
        { trialExpiresAt: w.trialExpiresAt }, { trialExpiresAt: ends }, route, tx);
    });
    return { success: true, trialExpiresAt: ends };
  }

  async setActive(actorId: string, cabinetId: string, isActive: boolean, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const cabinet = await this.getCabinet(cabinetId);
    if (cabinet.isActive === isActive) throw new BadRequestException(`Ce cabinet est déjà ${isActive ? 'actif' : 'désactivé'}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.cabinet.update({ where: { id: cabinetId }, data: { isActive } });
      if (!isActive) {
        // Désactiver = couper aussi les sessions ouvertes des membres du cabinet
        const members = await tx.cabinetUser.findMany({ where: { cabinetId }, select: { userId: true } });
        if (members.length) {
          await tx.userSession.updateMany({ where: { userId: { in: members.map((m) => m.userId) }, revokedAt: null }, data: { revokedAt: new Date() } });
        }
      }
      await this.record(actor, cabinet, isActive ? 'ADMIN_CABINET_ACTIVATED' : 'ADMIN_CABINET_DEACTIVATED', isActive ? 'WARN' : 'CRITICAL',
        `Super admin : cabinet ${cabinet.name} ${isActive ? 'réactivé' : 'désactivé (sessions des membres coupées)'} — motif : ${reason}`,
        { isActive: !isActive }, { isActive }, route, tx);
    });
    return { success: true, isActive };
  }

  /** Accès PME / employés d'une entreprise cliente (mêmes réglages que côté cabinet, avec trace). */
  async setCompanyAccess(actorId: string, cabinetId: string, companyId: string, dto: CompanyAccessDto, route?: string) {
    const actor = await this.getActor(actorId);
    const cabinet = await this.getCabinet(cabinetId);
    if (dto.pmePortalEnabled === undefined && dto.employeeAccessEnabled === undefined) {
      throw new BadRequestException('Aucun changement demandé');
    }
    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
      select: { id: true, pmePortalEnabled: true, employeeAccessEnabled: true, company: { select: { legalName: true, tradeName: true } } },
    });
    if (!link) throw new NotFoundException('Cette entreprise n’est pas rattachée à ce cabinet');

    const data: any = {};
    if (dto.pmePortalEnabled !== undefined) data.pmePortalEnabled = dto.pmePortalEnabled;
    if (dto.employeeAccessEnabled !== undefined) data.employeeAccessEnabled = dto.employeeAccessEnabled;
    const name = link.company.tradeName || link.company.legalName;

    await this.prisma.$transaction(async (tx) => {
      await tx.cabinetCompany.update({ where: { id: link.id }, data });
      await this.record(actor, cabinet, 'ADMIN_CABINET_COMPANY_ACCESS_CHANGED', 'WARN',
        `Super admin : accès de ${name} via ${cabinet.name} modifié (${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ')}) — motif : ${dto.reason}`,
        { pmePortalEnabled: link.pmePortalEnabled, employeeAccessEnabled: link.employeeAccessEnabled }, data, route, tx);
    });
    return { success: true };
  }

  // ── Resynchronisation des compteurs de l'ancien modèle d'abonnement ──────────

  private async liveCounts(cabinetId: string) {
    const [companies, employees] = await Promise.all([
      this.prisma.cabinetCompany.count({ where: { cabinetId, isActive: true } }),
      this.prisma.employee.count({ where: { status: 'ACTIVE', company: { cabinetCompanies: { some: { cabinetId, isActive: true } } } } }),
    ]);
    return { companies, employees };
  }

  async recalculateCounters(actorId: string, cabinetId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const cabinet = await this.getCabinet(cabinetId);
    const sub = await this.prisma.cabinetSubscription.findUnique({ where: { cabinetId }, select: { currentCompanies: true, currentEmployees: true } });
    if (!sub) throw new BadRequestException('Ce cabinet n’a pas d’abonnement (ancien modèle) à resynchroniser');
    const live = await this.liveCounts(cabinetId);
    const changed = sub.currentCompanies !== live.companies || sub.currentEmployees !== live.employees;

    if (changed) {
      await this.prisma.$transaction(async (tx) => {
        await tx.cabinetSubscription.update({ where: { cabinetId }, data: { currentCompanies: live.companies, currentEmployees: live.employees } });
        await this.record(actor, cabinet, 'ADMIN_CABINET_COUNTERS_RECALCULATED', 'INFO',
          `Super admin : compteurs de ${cabinet.name} recalculés (PME ${sub.currentCompanies} → ${live.companies}, employés ${sub.currentEmployees} → ${live.employees}) — motif : ${reason}`,
          { companies: sub.currentCompanies, employees: sub.currentEmployees }, { companies: live.companies, employees: live.employees }, route, tx);
      });
    }
    return { success: true, changed, before: { companies: sub.currentCompanies, employees: sub.currentEmployees }, after: live };
  }

  /** Resynchronise TOUS les cabinets en une fois (seuls ceux qui dérivent sont modifiés et tracés). */
  async recalculateAllCounters(actorId: string, reason: string, route?: string) {
    await this.getActor(actorId);
    const subs = await this.prisma.cabinetSubscription.findMany({ select: { cabinetId: true } });
    const corrected: { cabinetId: string }[] = [];
    for (const s of subs) {
      try {
        const r = await this.recalculateCounters(actorId, s.cabinetId, reason, route);
        if (r.changed) corrected.push({ cabinetId: s.cabinetId });
      } catch (e) {
        this.logger.warn(`Resynchronisation du cabinet ${s.cabinetId} impossible : ${(e as Error).message}`);
      }
    }
    return { success: true, checked: subs.length, corrected: corrected.length };
  }
}