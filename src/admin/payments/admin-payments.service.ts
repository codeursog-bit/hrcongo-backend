// ============================================================================
// src/admin/payments/admin-payments.service.ts
// PAIEMENTS & ABONNEMENTS (super admin) — vue d'ensemble, liste, fiche, actions
//
//   • Lecture : MRR/ARR, revenus, abonnements par statut, « à traiter »
//     (paiements bloqués, abonnements expirés encore actifs, expirations
//     proches, impayés), liste filtrée, fiche paiement.
//   • Actions (motif obligatoire + journal d'audit chaîné de l'entreprise) :
//     revérifier chez le prestataire, valider à la main, marquer échoué,
//     marquer remboursé.
//
// Jamais exposé : clientSecret, jetons prestataire. Les numéros de téléphone du
// moyen de paiement sont masqués.
// ============================================================================

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService } from '../../audit-trail/audit-trail.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { ListPaymentsQueryDto } from './admin-payments.dto';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const num = (v: any) => (v == null ? 0 : Number(v));
const cut = (t: string) => (t.length > 500 ? `${t.slice(0, 497)}…` : t);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Masque tout ce qui ressemble à un numéro (garde les 3 derniers chiffres). */
function maskDetails(v: any): any {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(maskDetails);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /phone|msisdn|tel|number/i.test(k) && typeof x === 'string' ? `••••${x.slice(-3)}` : maskDetails(x)]));
  return v;
}

@Injectable()
export class AdminPaymentsService {
  private readonly logger = new Logger(AdminPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditTrailService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private async getActor(actorId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: actorId }, select: { id: true, role: true, firstName: true, lastName: true },
    });
    if (!u || u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Accès refusé. Super Admin requis.');
    return { id: u.id, role: u.role as string, label: `${u.firstName} ${u.lastName}` };
  }

  private companyName = (c: any) => (c ? c.tradeName || c.legalName : null);

  // ══════════════════════════════════════════════════════════════════════════
  // 📊 VUE D'ENSEMBLE
  // ══════════════════════════════════════════════════════════════════════════

  async overview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const in7 = new Date(now.getTime() + 7 * DAY);
    const in30 = new Date(now.getTime() + 30 * DAY);
    const stuckBefore = new Date(now.getTime() - HOUR);

    const revenue = (from: Date, to?: Date) =>
      this.prisma.payment.aggregate({
        where: { status: 'SUCCEEDED', paidAt: { gte: from, ...(to ? { lt: to } : {}) } },
        _sum: { amount: true }, _count: { _all: true },
      });

    const subSelect = {
      companyId: true, plan: true, status: true, currentPeriodEnd: true, pricePerMonth: true,
      company: { select: { legalName: true, tradeName: true } },
    } as const;

    const [
      revMonth, revPrev, revYear, revByProvider, subByStatus, mrrAgg, planDist,
      stuckPayments, expiredActive, expiringSoon, pastDue, failed7, canceled30, expiring30Count, refundedMonth,
    ] = await Promise.all([
      revenue(monthStart), revenue(prevMonthStart, monthStart), revenue(yearStart),
      this.prisma.payment.groupBy({ by: ['provider'], where: { status: 'SUCCEEDED', paidAt: { gte: yearStart } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscription.aggregate({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, currentPeriodEnd: { gt: now } }, _sum: { pricePerMonth: true }, _count: { _all: true } }),
      this.prisma.subscription.groupBy({ by: ['plan'], where: { status: { in: ['ACTIVE', 'TRIALING'] } }, _count: { _all: true }, _sum: { pricePerMonth: true } }),
      this.prisma.payment.findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: stuckBefore } },
        orderBy: { createdAt: 'asc' }, take: 10,
        select: { id: true, amount: true, status: true, provider: true, createdAt: true, company: { select: { id: true, legalName: true, tradeName: true } } },
      }),
      this.prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'TRIALING'] }, plan: { not: 'FREE' }, currentPeriodEnd: { lt: now } }, orderBy: { currentPeriodEnd: 'asc' }, take: 10, select: subSelect }),
      this.prisma.subscription.findMany({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, currentPeriodEnd: { gte: now, lte: in7 } }, orderBy: { currentPeriodEnd: 'asc' }, take: 10, select: subSelect }),
      this.prisma.subscription.findMany({ where: { status: 'PAST_DUE' }, orderBy: { currentPeriodEnd: 'asc' }, take: 10, select: subSelect }),
      this.prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
      this.prisma.subscription.count({ where: { canceledAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, currentPeriodEnd: { gte: now, lte: in30 } } }),
      this.prisma.payment.aggregate({ where: { status: 'REFUNDED', refundedAt: { gte: monthStart } }, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const mrr = num(mrrAgg._sum.pricePerMonth);
    const mapSub = (s: any) => ({ companyId: s.companyId, company: this.companyName(s.company), plan: s.plan, status: s.status, currentPeriodEnd: s.currentPeriodEnd });
    const cur = num(revMonth._sum.amount), prev = num(revPrev._sum.amount);

    return {
      revenue: {
        thisMonth: cur, thisMonthCount: revMonth._count._all,
        lastMonth: prev, variationPct: prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null,
        thisYear: num(revYear._sum.amount),
        refundedThisMonth: { amount: num(refundedMonth._sum.amount), count: refundedMonth._count._all },
        byProvider: revByProvider.map((r) => ({ provider: r.provider, amount: num(r._sum.amount), count: r._count._all })),
      },
      recurring: {
        mrr, arr: mrr * 12, payingCompanies: mrrAgg._count._all,
        arpa: mrrAgg._count._all ? Math.round(mrr / mrrAgg._count._all) : 0,
        byPlan: planDist.map((p) => ({ plan: p.plan, companies: p._count._all, mrr: num(p._sum.pricePerMonth) })),
      },
      subscriptions: {
        byStatus: Object.fromEntries(subByStatus.map((s) => [s.status, s._count._all])),
        expiringIn30Days: expiring30Count, canceledLast30Days: canceled30, failedPaymentsLast7Days: failed7,
      },
      attention: {
        stuckPayments: stuckPayments.map((p) => ({ id: p.id, amount: p.amount, status: p.status, provider: p.provider, createdAt: p.createdAt, company: this.companyName(p.company), companyId: p.company.id })),
        expiredStillActive: expiredActive.map(mapSub),
        expiringSoon: expiringSoon.map(mapSub),
        pastDue: pastDue.map(mapSub),
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 📋 LISTE DES PAIEMENTS
  // ══════════════════════════════════════════════════════════════════════════

  async list(q: ListPaymentsQueryDto) {
    const page = q.page ?? 1, pageSize = q.pageSize ?? 25;
    const and: any[] = [];
    if (q.status) and.push({ status: q.status });
    if (q.provider) and.push({ provider: q.provider });
    if (q.companyId) and.push({ OR: [{ companyId: q.companyId }, { coveredCompanyIds: { has: q.companyId } }] });
    if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ createdAt: { lte: new Date(q.to) } });
    if (q.stuck) and.push({ status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: new Date(Date.now() - HOUR) } });
    if (q.q?.trim()) {
      const s = q.q.trim();
      and.push({
        OR: [
          ...(UUID_RE.test(s) ? [{ id: s }] : []),
          { description: { contains: s, mode: 'insensitive' } },
          { yabetooIntentId: { contains: s } }, { yabetooChargeId: { contains: s } },
          { motekiOrderNumber: { contains: s, mode: 'insensitive' } }, { motekiPaymentReference: { contains: s } },
          { chariowSaleId: { contains: s } },
          { company: { OR: [{ legalName: { contains: s, mode: 'insensitive' } }, { tradeName: { contains: s, mode: 'insensitive' } }] } },
        ],
      });
    }
    const where = and.length ? { AND: and } : {};

    const [total, sum, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where: { AND: [...and, { status: 'SUCCEEDED' }] }, _sum: { amount: true } }),
      this.prisma.payment.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, amount: true, currency: true, status: true, provider: true, paymentMethod: true,
          createdAt: true, paidAt: true, metadata: true, customQuoteId: true, discountAmount: true,
          coveredCompanyIds: true, invoice: { select: { number: true } },
          company: { select: { id: true, legalName: true, tradeName: true } },
        },
      }),
    ]);
    const stuckBefore = Date.now() - HOUR;

    return {
      total, page, pageSize, succeededAmount: num(sum._sum.amount),
      items: rows.map((p: any) => ({
        id: p.id, amount: p.amount, currency: p.currency, status: p.status, provider: p.provider,
        method: p.paymentMethod, createdAt: p.createdAt, paidAt: p.paidAt,
        plan: p.metadata?.plan ?? null, billingPeriod: p.metadata?.billingPeriod ?? null,
        isQuote: !!p.customQuoteId, hasDiscount: num(p.discountAmount) > 0,
        coveredCount: p.coveredCompanyIds?.length ?? 0,
        invoiceNumber: p.invoice?.number ?? null,
        stuck: ['PENDING', 'PROCESSING'].includes(p.status) && p.createdAt.getTime() < stuckBefore,
        company: { id: p.company.id, name: this.companyName(p.company) },
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔎 FICHE PAIEMENT
  // ══════════════════════════════════════════════════════════════════════════

  async detail(paymentId: string) {
    const p: any = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true, amount: true, currency: true, status: true, provider: true, paymentMethod: true,
        paymentMethodDetails: true, description: true, metadata: true, originalAmount: true, discountAmount: true,
        createdAt: true, paidAt: true, failedAt: true, refundedAt: true,
        yabetooIntentId: true, yabetooChargeId: true, yabetooTransactionId: true,
        motekiOrderNumber: true, motekiPaymentReference: true, chariowSaleId: true,
        coveredCompanyIds: true, activatedCompanyIds: true,
        company: { select: { id: true, legalName: true, tradeName: true } },
        subscription: { select: { id: true, plan: true, status: true, currentPeriodEnd: true } },
        invoice: { select: { id: true, number: true, issuedAt: true, total: true } },
        discountCode: { select: { code: true } },
        customQuote: { select: { id: true, plan: true, amount: true, months: true, coversPortfolio: true } },
      },
    });
    if (!p) throw new NotFoundException('Paiement introuvable');

    const coveredIds: string[] = p.coveredCompanyIds ?? [];
    const [covered, history] = await Promise.all([
      coveredIds.length
        ? this.prisma.company.findMany({ where: { id: { in: coveredIds } }, select: { id: true, legalName: true, tradeName: true } })
        : [],
      this.prisma.auditEvent.findMany({
        where: { companyId: p.company.id, entity: 'PAYMENT', entityId: p.id },
        orderBy: { occurredAt: 'desc' }, take: 10,
        select: { id: true, occurredAt: true, action: true, severity: true, summary: true, actorLabel: true },
      }),
    ]);
    const activated = new Set<string>(p.activatedCompanyIds ?? []);

    return {
      id: p.id, amount: p.amount, currency: p.currency, status: p.status, provider: p.provider,
      method: p.paymentMethod, methodDetails: maskDetails(p.paymentMethodDetails), description: p.description,
      originalAmount: p.originalAmount, discountAmount: p.discountAmount, discountCode: p.discountCode?.code ?? null,
      quote: p.customQuote ?? null,
      plan: p.metadata?.plan ?? null, billingPeriod: p.metadata?.billingPeriod ?? null, months: p.metadata?.months ?? null,
      manualValidation: p.metadata?.manualValidation ?? null, refund: p.metadata?.refund ?? null,
      dates: { createdAt: p.createdAt, paidAt: p.paidAt, failedAt: p.failedAt, refundedAt: p.refundedAt },
      references: {
        yabetooIntentId: p.yabetooIntentId, yabetooChargeId: p.yabetooChargeId, yabetooTransactionId: p.yabetooTransactionId,
        motekiOrderNumber: p.motekiOrderNumber, motekiPaymentReference: p.motekiPaymentReference, chariowSaleId: p.chariowSaleId,
      },
      company: { id: p.company.id, name: this.companyName(p.company) },
      subscription: p.subscription ?? null,
      invoice: p.invoice ?? null,
      coveredCompanies: (covered as any[]).map((c) => ({ id: c.id, name: this.companyName(c), activated: activated.has(c.id) })),
      history,
      // Actions possibles selon l'état (le front n'affiche que celles-ci)
      allowed: {
        recheck: ['PENDING', 'PROCESSING', 'FAILED'].includes(p.status) && ['YABETOOPAY', 'MOTEKI', 'CHARIOW'].includes(p.provider),
        validate: ['PENDING', 'PROCESSING', 'FAILED'].includes(p.status),
        fail: ['PENDING', 'PROCESSING'].includes(p.status),
        refund: p.status === 'SUCCEEDED',
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🛠️ ACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  private async record(actor: any, payment: { id: string; companyId: string; amount: number }, action: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL', summary: string, before: any, after: any, route?: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        companyId: payment.companyId, actor, action, entity: 'PAYMENT', entityId: payment.id,
        severity, summary: cut(summary), before, after, context: { route },
      });
    });
  }

  private async load(paymentId: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, companyId: true, amount: true, status: true, provider: true, metadata: true, paymentMethod: true },
    });
    if (!p) throw new NotFoundException('Paiement introuvable');
    return p;
  }

  /** Interroge le prestataire (filet de sécurité) : active automatiquement si l'argent est bien reçu. */
  async recheck(actorId: string, paymentId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const p = await this.load(paymentId);
    if (p.status === 'SUCCEEDED' || p.status === 'REFUNDED') throw new BadRequestException('Ce paiement est déjà finalisé');

    let result: { activated: boolean; status: string };
    if (p.provider === 'YABETOOPAY') result = await this.subscriptions.checkAndActivateYabetooPayment(p.id);
    else if (p.provider === 'MOTEKI') result = await this.subscriptions.checkAndActivateMotekiOrder(p.id);
    else if (p.provider === 'CHARIOW') result = await this.subscriptions.checkAndActivateChariowSale(p.id);
    else throw new BadRequestException('Paiement manuel : aucun prestataire à interroger');

    await this.record(actor, p, 'ADMIN_PAYMENT_RECHECKED', 'INFO',
      `Super admin : paiement ${p.provider} revérifié chez le prestataire → ${result.status}${result.activated ? ' (abonnement activé)' : ''} — motif : ${reason}`,
      { status: p.status }, { status: result.status, activated: result.activated }, route);
    return { success: true, ...result };
  }

  /** Validation manuelle : l'argent est reçu mais la plateforme ne l'a pas vu. */
  async validate(actorId: string, paymentId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const p = await this.load(paymentId);

    await this.subscriptions.adminForceSucceed(p.id);

    // Trace de la validation manuelle dans le paiement lui-même
    await this.prisma.payment.update({
      where: { id: p.id },
      data: {
        paymentMethod: p.paymentMethod ?? 'MANUAL_ADMIN',
        metadata: { ...(p.metadata as any), manualValidation: { by: actor.label, reason, at: new Date().toISOString() } },
      },
    });

    await this.record(actor, p, 'ADMIN_PAYMENT_VALIDATED', 'CRITICAL',
      `Super admin : paiement ${p.provider} de ${p.amount} F validé manuellement, abonnement(s) activé(s) — motif : ${reason}`,
      { status: p.status }, { status: 'SUCCEEDED' }, route);
    this.logger.warn(`🛠️ [Super admin ${actor.label}] paiement ${p.id} validé manuellement`);
    return { success: true };
  }

  async markFailed(actorId: string, paymentId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const p = await this.load(paymentId);
    if (!['PENDING', 'PROCESSING'].includes(p.status)) {
      throw new BadRequestException('Seul un paiement en attente ou en cours peut être marqué échoué');
    }
    await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'FAILED', failedAt: new Date() } });
    await this.record(actor, p, 'ADMIN_PAYMENT_FAILED', 'WARN',
      `Super admin : paiement ${p.provider} marqué échoué — motif : ${reason}`,
      { status: p.status }, { status: 'FAILED' }, route);
    return { success: true };
  }

  /**
   * Remboursement : ÉCRITURE COMPTABLE uniquement (statut REFUNDED + date).
   * L'argent est rendu hors plateforme, et l'accès du client n'est pas modifié :
   * utiliser « Suspendre » sur l'abonnement si l'accès doit être coupé.
   */
  async markRefunded(actorId: string, paymentId: string, reason: string, route?: string) {
    const actor = await this.getActor(actorId);
    const p = await this.load(paymentId);
    if (p.status !== 'SUCCEEDED') throw new BadRequestException('Seul un paiement réussi peut être remboursé');

    await this.prisma.payment.update({
      where: { id: p.id },
      data: {
        status: 'REFUNDED', refundedAt: new Date(),
        metadata: { ...(p.metadata as any), refund: { by: actor.label, reason, at: new Date().toISOString() } },
      },
    });
    await this.record(actor, p, 'ADMIN_PAYMENT_REFUNDED', 'CRITICAL',
      `Super admin : paiement ${p.provider} de ${p.amount} F marqué remboursé (accès inchangé) — motif : ${reason}`,
      { status: p.status }, { status: 'REFUNDED' }, route);
    return { success: true };
  }
}