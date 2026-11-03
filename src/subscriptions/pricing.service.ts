// ============================================================================
// src/subscriptions/pricing.service.ts
// Source de vérité des PRIX des plans : table plan_prices (modifiable par le
// super admin) avec repli sur plans.config.ts quand aucune ligne n'existe.
// Les limites/fonctionnalités des plans restent dans plans.config.ts.
// ============================================================================

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, Plan } from './config/plans.config';

export type BillingPeriod = 'monthly' | 'yearly';
export const PAID_PLANS = ['BASIC', 'PRO', 'ENTERPRISE'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private prisma: PrismaService) {}

  /** Tous les plans, prix surchargés par la BDD quand une ligne existe. */
  async getPlans(): Promise<Record<string, Plan>> {
    const rows = await (this.prisma as any).planPrice.findMany();
    const byPlan = new Map<string, any>(rows.map((r: any) => [r.plan, r]));

    const out: Record<string, Plan> = {};
    for (const [key, plan] of Object.entries(PLANS)) {
      const row = byPlan.get(key);
      out[key] = row
        ? { ...plan, priceMonthly: row.priceMonthly, priceYearly: row.priceYearly }
        : plan;
    }
    return out;
  }

  async getPlan(plan: string): Promise<Plan> {
    const p = (await this.getPlans())[plan];
    if (!p) throw new NotFoundException(`Plan inconnu : ${plan}`);
    return p;
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
      defaultMonthly: PLANS[plan].priceMonthly,
      defaultYearly: PLANS[plan].priceYearly,
      isCustomized: byPlan.has(plan),
      updatedAt: byPlan.get(plan)?.updatedAt ?? null,
    }));
  }

  async updatePrice(
    plan: string,
    dto: { priceMonthly: number; priceYearly?: number },
    actorUserId: string,
  ) {
    if (!PAID_PLANS.includes(plan as PaidPlan)) {
      throw new BadRequestException('Seuls BASIC, PRO et ENTERPRISE ont un prix modifiable');
    }
    // Convention actuelle du catalogue : annuel = 10 × mensuel
    const priceYearly = dto.priceYearly ?? dto.priceMonthly * 10;

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

  /** Revient au prix de plans.config.ts */
  async resetPrice(plan: string) {
    await (this.prisma as any).planPrice.deleteMany({ where: { plan } });
    return { plan, reset: true };
  }
}