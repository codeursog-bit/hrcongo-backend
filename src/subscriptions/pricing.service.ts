// ============================================================================
// src/subscriptions/pricing.service.ts
// Source de vérité des PRIX des plans : table plan_prices (modifiable par le
// super admin). Un prix payant absent reste non configuré.
// Les limites/fonctionnalités des plans restent dans plans.config.ts.
// ============================================================================

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, Plan } from './config/plans.config';

export type BillingPeriod = 'monthly' | 'yearly';
export const PAID_PLANS = ['BASIC', 'PRO', 'ENTERPRISE'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type CatalogPlan = Omit<Plan, 'priceMonthly' | 'priceYearly'> & {
  priceMonthly: number | null;
  priceYearly: number | null;
  isPriceConfigured: boolean;
};

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private prisma: PrismaService) {}

  /** Les tarifs payants proviennent exclusivement des prix enregistrés. */
  async getPlans(): Promise<Record<string, CatalogPlan>> {
    const rows = await (this.prisma as any).planPrice.findMany();
    const byPlan = new Map<string, any>(rows.map((r: any) => [r.plan, r]));

    const out: Record<string, CatalogPlan> = {};
    for (const [key, plan] of Object.entries(PLANS)) {
      const row = byPlan.get(key);
      out[key] = {
        ...plan,
        priceMonthly: key === 'FREE' ? 0 : row?.priceMonthly ?? null,
        priceYearly: key === 'FREE' ? 0 : row?.priceYearly ?? null,
        isPriceConfigured: key === 'FREE' || !!row,
      };
    }
    return out;
  }

  async getPlan(plan: string): Promise<Plan> {
    const p = (await this.getPlans())[plan];
    if (!p) throw new NotFoundException(`Plan inconnu : ${plan}`);
    if (p.priceMonthly === null || p.priceYearly === null) {
      throw new BadRequestException('Le tarif de ce plan n’est pas encore configuré. Contactez le support.');
    }
    return { ...p, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly };
  }

  async getPrice(plan: string, period: BillingPeriod): Promise<number> {
    const p = await this.getPlan(plan);
    return period === 'yearly' ? p.priceYearly : p.priceMonthly;
  }

  // ─── Super admin ──────────────────────────────────────────────────────────

  async listForAdmin() {
    const current = await this.getPlans();
    const rows = await (this.prisma as any).planPrice.findMany();
    const byPlan = new Map<string, any>(rows.map((r: any) => [r.plan, r]));

    return PAID_PLANS.map((plan) => ({
      plan,
      name: current[plan].name,
      priceMonthly: current[plan].priceMonthly,
      priceYearly: current[plan].priceYearly,
      isPriceConfigured: current[plan].isPriceConfigured,
      isCustomized: byPlan.has(plan),
      updatedAt: byPlan.get(plan)?.updatedAt ?? null,
    }));
  }

  async updatePrice(
    plan: string,
    dto: { priceMonthly: number; priceYearly: number },
    actorUserId: string,
  ) {
    if (!PAID_PLANS.includes(plan as PaidPlan)) {
      throw new BadRequestException('Seuls BASIC, PRO et ENTERPRISE ont un prix modifiable');
    }
    if (!Number.isInteger(dto.priceMonthly) || !Number.isInteger(dto.priceYearly) ||
        dto.priceMonthly < 100 || dto.priceYearly < 100) {
      throw new BadRequestException('Renseignez un tarif mensuel et un tarif annuel valides.');
    }
    const priceYearly = dto.priceYearly;

    const saved = await (this.prisma as any).planPrice.upsert({
      where: { plan },
      create: { plan, priceMonthly: dto.priceMonthly, priceYearly, updatedByUserId: actorUserId },
      update: { priceMonthly: dto.priceMonthly, priceYearly, updatedByUserId: actorUserId },
    });
    this.logger.log(
      `💰 Prix ${plan} modifiés par ${actorUserId} : ${dto.priceMonthly}/mois, ${priceYearly}/an`,
    );
    return saved;
  }

  /** Retire le tarif du catalogue, sans réintroduire un prix par défaut. */
  async resetPrice(plan: string) {
    await (this.prisma as any).planPrice.deleteMany({ where: { plan } });
    return { plan, reset: true };
  }
}
