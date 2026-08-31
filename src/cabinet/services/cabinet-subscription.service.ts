// src/cabinet/services/cabinet-subscription.service.ts
// ============================================================================
// CORRECTION : handleWebhook appelait handleSuccessfulPayment(payment.id)
//              → c'est le handler PME. Remplacé par handleSuccessfulCabinetPayment()
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { YabetooPayService } from '../../payments/yabetoopay.service';
import { AffiliateService } from '../../affiliate/affiliate.service';

export type CabinetPlan = 'STARTER' | 'PRO' | 'EXPERT';
export type CabinetBillingPeriod =
  'MONTHLY' | 'QUARTERLY' | 'SEMESTRIAL' | 'YEARLY';

const PLAN_CONFIG: Record<
  CabinetPlan,
  {
    maxCompanies: number;
    maxEmployees: number;
    priceMonthly: number;
    label: string;
  }
> = {
  STARTER: {
    maxCompanies: 5,
    maxEmployees: 100,
    priceMonthly: 25_000,
    label: 'Starter',
  },
  PRO: {
    maxCompanies: 15,
    maxEmployees: 500,
    priceMonthly: 65_000,
    label: 'Pro',
  },
  EXPERT: {
    maxCompanies: 50,
    maxEmployees: 2_000,
    priceMonthly: 150_000,
    label: 'Expert',
  },
};

const PERIOD_CONFIG: Record<
  CabinetBillingPeriod,
  { months: number; discountPct: number; label: string }
> = {
  MONTHLY: { months: 1, discountPct: 0, label: 'Mensuel' },
  QUARTERLY: { months: 3, discountPct: 5, label: 'Trimestriel' },
  SEMESTRIAL: { months: 6, discountPct: 10, label: 'Semestriel' },
  YEARLY: { months: 12, discountPct: 15, label: 'Annuel' },
};

function calcPrice(plan: CabinetPlan, period: CabinetBillingPeriod) {
  const p = PLAN_CONFIG[plan];
  const per = PERIOD_CONFIG[period];
  const base = p.priceMonthly * per.months;
  const discount = Math.round((base * per.discountPct) / 100);
  return {
    totalAmount: base - discount,
    discountPct: per.discountPct,
    discountAmount: discount,
    months: per.months,
    periodLabel: per.label,
    pricePerMonth: p.priceMonthly,
  };
}

@Injectable()
export class CabinetSubscriptionService {
  private readonly logger = new Logger(CabinetSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yabetoo: YabetooPayService,
    private readonly affiliates: AffiliateService,
  ) {}

  // ── GET ──────────────────────────────────────────────────────────────────

  async getSubscription(cabinetId: string) {
    let sub = await this.prisma.cabinetSubscription.findUnique({
      where: { cabinetId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });

    if (!sub) {
      sub = await this.prisma.cabinetSubscription.create({
        data: {
          cabinetId,
          plan: 'STARTER',
          status: 'TRIALING',
          maxCompanies: 5,
          maxEmployees: 100,
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
          trialEndsAt: new Date(Date.now() + 30 * 86_400_000),
          pricePerMonth: 0,
        },
        include: { payments: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });
    }

    if (
      sub.status === 'TRIALING' &&
      sub.trialEndsAt &&
      sub.trialEndsAt < new Date()
    ) {
      await this.prisma.cabinetSubscription.update({
        where: { cabinetId },
        data: { status: 'PAST_DUE' },
      });
      (sub as any).status = 'PAST_DUE';
    }

    const { currentCompanies, currentEmployees } =
      await this._refreshCounts(cabinetId);
    const daysLeftInTrial = sub.trialEndsAt
      ? Math.max(
          0,
          Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000),
        )
      : 0;

    return {
      ...sub,
      currentCompanies,
      currentEmployees,
      daysLeftInTrial,
      canAddCompany: currentCompanies < sub.maxCompanies,
      canAddEmployee: currentEmployees < sub.maxEmployees,
      availablePlans: this._buildAvailablePlans(),
    };
  }

  // ── INITIER PAIEMENT ─────────────────────────────────────────────────────

  async initiateUpgrade(
    cabinetId: string,
    dto: { plan: CabinetPlan; billingPeriod: CabinetBillingPeriod },
  ) {
    if (!PLAN_CONFIG[dto.plan])
      throw new BadRequestException(`Plan inconnu : ${dto.plan}`);
    if (!PERIOD_CONFIG[dto.billingPeriod])
      throw new BadRequestException(`Période inconnue : ${dto.billingPeriod}`);

    const pricing = calcPrice(dto.plan, dto.billingPeriod);
    const subRecord =
      (await this.prisma.cabinetSubscription.findUnique({
        where: { cabinetId },
      })) ??
      (await this.getSubscription(cabinetId).then(() =>
        this.prisma.cabinetSubscription.findUnique({ where: { cabinetId } }),
      ));

    if (!subRecord) throw new NotFoundException('Abonnement introuvable');

    const intent = await this.yabetoo.createPaymentIntent({
      amount: pricing.totalAmount,
      currency: 'xaf',
      metadata: {
        type: 'cabinet_subscription',
        cabinetId,
        plan: dto.plan,
        billingPeriod: dto.billingPeriod,
        months: pricing.months,
      },
    });

    await this.prisma.cabinetPayment.create({
      data: {
        subscriptionId: subRecord.id,
        amount: pricing.totalAmount,
        currency: 'XAF',
        status: 'PENDING',
        yabetopayIntentId: intent.id,
        reference: `CAB-${cabinetId.slice(0, 8)}-${dto.plan}-${Date.now()}`,
        plan: dto.plan,
        billingPeriod: dto.billingPeriod,
        months: pricing.months,
      },
    });

    this.logger.log(
      `💳 Cabinet ${cabinetId} → intent ${intent.id} — ${dto.plan} ${dto.billingPeriod}`,
    );

    return {
      intentId: intent.id,
      clientSecret: intent.client_secret,
      plan: dto.plan,
      planLabel: PLAN_CONFIG[dto.plan].label,
      billingPeriod: dto.billingPeriod,
      periodLabel: pricing.periodLabel,
      amount: pricing.totalAmount,
      pricePerMonth: pricing.pricePerMonth,
      months: pricing.months,
      discountPct: pricing.discountPct,
      discountAmount: pricing.discountAmount,
      currency: 'XAF',
    };
  }

  // ── CONFIRMER PAIEMENT ────────────────────────────────────────────────────

  async confirmPayment(
    cabinetId: string,
    dto: {
      intentId: string;
      clientSecret: string;
      phone: string;
      operator: 'MTN' | 'AIRTEL' | 'ORANGE';
    },
  ) {
    const confirmation = await this.yabetoo.confirmPaymentIntent({
      intentId: dto.intentId,
      clientSecret: dto.clientSecret,
      paymentMethod: { type: 'momo', phone: dto.phone, operator: dto.operator },
    });

    const payment = await this.prisma.cabinetPayment.findFirst({
      where: { yabetopayIntentId: dto.intentId },
    });

    if (payment) {
      await this.prisma.cabinetPayment.update({
        where: { id: payment.id },
        data: {
          yabetopayOperator: dto.operator,
          yabetopayPhone: dto.phone,
          status:
            confirmation.status === 'succeeded' ? 'SUCCEEDED' : 'PROCESSING',
          paidAt: confirmation.status === 'succeeded' ? new Date() : null,
        },
      });
    }

    if (confirmation.status === 'succeeded') {
      await this._activatePlan(cabinetId, dto.intentId);
      return { status: 'succeeded', message: 'Plan activé.' };
    }

    return {
      status: 'pending',
      message: 'En attente de confirmation sur votre téléphone.',
    };
  }

  // ── WEBHOOK ───────────────────────────────────────────────────────────────
  // Appelé depuis webhooks.controller.ts après intent.succeeded pour un paiement cabinet

  async handleWebhookSuccess(cabinetPaymentId: string) {
    await this.prisma.cabinetPayment.update({
      where: { id: cabinetPaymentId },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });

    const payment = await this.prisma.cabinetPayment.findUnique({
      where: { id: cabinetPaymentId },
      include: { subscription: { select: { cabinetId: true } } },
    });

    if (!payment || !payment.yabetopayIntentId) return;

    await this._activatePlan(
      payment.subscription.cabinetId,
      payment.yabetopayIntentId,
    );

    // ── COMMISSION AFFILIÉ CABINET ──────────────────────────────────────
    // ✅ CORRIGÉ : on appelle handleSuccessfulCabinetPayment (pas handleSuccessfulPayment)
    try {
      await this.affiliates.handleSuccessfulCabinetPayment(cabinetPaymentId);
    } catch (err: any) {
      // Non bloquant
      this.logger.error(
        `[Affiliate] Erreur commission cabinet ${cabinetPaymentId}: ${err.message}`,
      );
    }
  }

  // ── GUARDS ────────────────────────────────────────────────────────────────

  async guardCabinetCompanyAccess(cabinetId: string) {
    const sub = await this.prisma.cabinetSubscription.findUnique({
      where: { cabinetId },
    });
    if (!sub) return;
    if (sub.status === 'CANCELED')
      throw new ForbiddenException({
        code: 'CABINET_SUBSCRIPTION_CANCELED',
        message: "L'abonnement cabinet est annulé.",
      });
    if (sub.status === 'PAST_DUE') {
      const days = Math.floor(
        (Date.now() - (sub.currentPeriodEnd?.getTime() ?? Date.now())) /
          86_400_000,
      );
      if (days > 7)
        throw new ForbiddenException({
          code: 'CABINET_SUBSCRIPTION_PAST_DUE',
          message: 'Paiement cabinet en retard.',
        });
    }
  }

  async guardCanAddCompany(cabinetId: string) {
    const sub = await this.getSubscription(cabinetId);
    if (['CANCELED', 'PAST_DUE'].includes(sub.status))
      throw new ForbiddenException('Abonnement inactif.');
    if (sub.currentCompanies >= sub.maxCompanies) {
      throw new ForbiddenException({
        code: 'CABINET_COMPANY_LIMIT_REACHED',
        message: `Limite atteinte : plan ${sub.plan} = ${sub.maxCompanies} PME max.`,
        current: sub.currentCompanies,
        max: sub.maxCompanies,
      });
    }
  }

  async guardCanAddEmployee(cabinetId: string) {
    const sub = await this.getSubscription(cabinetId);
    if (sub.currentEmployees >= sub.maxEmployees) {
      throw new ForbiddenException({
        code: 'CABINET_EMPLOYEE_LIMIT_REACHED',
        message: `Limite atteinte : ${sub.maxEmployees} employés max.`,
        current: sub.currentEmployees,
        max: sub.maxEmployees,
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async _refreshCounts(cabinetId: string) {
    const [currentCompanies, currentEmployees] = await Promise.all([
      this.prisma.cabinetCompany.count({
        where: { cabinetId, isActive: true },
      }),
      this.prisma.employee.count({
        where: {
          status: 'ACTIVE',
          company: {
            cabinetCompanies: { some: { cabinetId, isActive: true } },
          },
        },
      }),
    ]);
    await this.prisma.cabinetSubscription.updateMany({
      where: { cabinetId },
      data: { currentCompanies, currentEmployees },
    });
    return { currentCompanies, currentEmployees };
  }

  async _activatePlan(cabinetId: string, intentId: string) {
    const payment = await this.prisma.cabinetPayment.findFirst({
      where: { yabetopayIntentId: intentId },
    });

    let plan: CabinetPlan = (payment?.plan as CabinetPlan) ?? 'STARTER';
    let months = payment?.months ?? 1;

    if (!payment?.plan) {
      outer: for (const [p, pc] of Object.entries(PLAN_CONFIG) as [
        CabinetPlan,
        any,
      ][]) {
        for (const [per, perc] of Object.entries(PERIOD_CONFIG) as [
          CabinetBillingPeriod,
          any,
        ][]) {
          const pricing = calcPrice(p, per);
          if (pricing.totalAmount === (payment?.amount ?? 0)) {
            plan = p;
            months = perc.months;
            break outer;
          }
        }
      }
    }

    const cfg = PLAN_CONFIG[plan];
    await this.prisma.cabinetSubscription.update({
      where: { cabinetId },
      data: {
        plan,
        status: 'ACTIVE',
        maxCompanies: cfg.maxCompanies,
        maxEmployees: cfg.maxEmployees,
        pricePerMonth: cfg.priceMonthly,
        trialEndsAt: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + months * 30 * 86_400_000),
      },
    });
    this.logger.log(
      `✅ Cabinet ${cabinetId} → Plan ${plan} activé (${months} mois)`,
    );
  }

  private _buildAvailablePlans() {
    const result: any = {};
    for (const [pk] of Object.entries(PLAN_CONFIG) as [CabinetPlan, any][]) {
      result[pk] = { ...PLAN_CONFIG[pk], pricing: {} };
      for (const [per] of Object.entries(PERIOD_CONFIG) as [
        CabinetBillingPeriod,
        any,
      ][]) {
        result[pk].pricing[per] = calcPrice(pk, per);
      }
    }
    return result;
  }
}
