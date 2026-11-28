// ============================================================================
// 📁 src/accounting/accounting-plan.service.ts
// Plan de comptes de la paie, modifiable par le SUPER ADMIN, versionné par pays
// et par date d'effet (même principe que legal-parameters : une publication
// n'écrase rien). Lecture synchrone depuis un cache rafraîchi chaque minute ;
// si la table n'existe pas encore, le plan par défaut du code est utilisé :
// la paie et les exports ne tombent jamais.
// ============================================================================
import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPlan, bindAccountingPlanResolver, DEFAULT_PLAN, RUBRICS, RUBRIC_LABELS } from './syscohada';
import { diffFromDefaults, mergePlan, normalizeCountry, pickPlanVersion, StoredPlanVersion, validatePlanAccounts } from './accounting-plan.core';

const REFRESH_MS = 60_000;

@Injectable()
export class AccountingPlanService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountingPlanService.name);
  private versions: StoredPlanVersion[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
    bindAccountingPlanResolver((country, dateKey) => this.getPlanAt(country, dateKey));
    this.timer = setInterval(() => void this.reload(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    bindAccountingPlanResolver(null);
    if (this.timer) clearInterval(this.timer);
  }

  private async reload() {
    try {
      const rows = await (this.prisma as any).accountingPlanVersion.findMany({ orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }] });
      this.versions = rows.map((r: any) => ({
        id: r.id,
        countryCode: r.countryCode,
        effectiveFrom: new Date(r.effectiveFrom).toISOString().slice(0, 10),
        createdAt: new Date(r.createdAt).toISOString(),
        accounts: (r.accounts ?? {}) as AccountPlan,
        note: r.note ?? null,
      }));
    } catch (e) {
      this.logger.warn(`Plan de comptes non relu (cache/défaut conservé) : ${(e as Error).message}`);
    }
  }

  /** Plan applicable à une date (AAAA-MM-JJ) pour un pays. Synchrone. */
  getPlanAt(country: string, dateKey: string): AccountPlan {
    const v = pickPlanVersion(this.versions, normalizeCountry(country), dateKey);
    return mergePlan(v?.accounts);
  }

  // ── Administration (super admin) ──────────────────────────────────────────
  async getOverview(country?: string) {
    const cc = normalizeCountry(country);
    const today = new Date().toISOString().slice(0, 10);
    const current = pickPlanVersion(this.versions, cc, today);
    const versions = this.versions
      .filter((v) => v.countryCode === cc)
      .sort((a, b) => (b.effectiveFrom + b.createdAt).localeCompare(a.effectiveFrom + a.createdAt));
    const rows = await (this.prisma as any).accountingPlanVersion.findMany({ where: { countryCode: cc }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }).catch(() => []);
    const meta = new Map<string, { createdByName: string | null }>(rows.map((r: any) => [r.id, { createdByName: r.createdByName ?? null }]));
    return {
      country: cc,
      countries: Array.from(new Set(['CG', ...this.versions.map((v) => v.countryCode)])).sort(),
      catalogue: RUBRICS.map((r) => ({ ...r, label: RUBRIC_LABELS[r.key] ?? r.key })),
      defaults: DEFAULT_PLAN,
      effectiveToday: mergePlan(current?.accounts),
      currentVersionId: current?.id ?? null,
      versions: versions.map((v) => ({ id: v.id, effectiveFrom: v.effectiveFrom, note: v.note ?? null, createdAt: v.createdAt, createdByName: meta.get(v.id)?.createdByName ?? null, overrides: v.accounts })),
    };
  }

  /**
   * Publie une version. `accounts` peut être partiel : fusionné avec le plan
   * applicable à cette date, validé, puis seules les différences avec le défaut
   * du code sont stockées (une valeur remise au défaut disparaît des surcharges).
   */
  async createVersion(
    dto: { country?: string; effectiveFrom: string; accounts: unknown; note?: string },
    actor: { id?: string | null; name?: string | null },
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto?.effectiveFrom ?? '')) throw new BadRequestException("Date d'application invalide (format AAAA-MM-JJ).");
    const asDate = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
    if (Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== dto.effectiveFrom) throw new BadRequestException("Date d'application invalide.");
    const cc = normalizeCountry(dto.country);
    const { accounts, errors } = validatePlanAccounts(dto.accounts);
    if (errors.length) throw new BadRequestException({ message: 'Plan de comptes invalide', errors });
    const merged = mergePlan(accounts, this.getPlanAt(cc, dto.effectiveFrom));
    const overrides = diffFromDefaults(merged);
    const row = await (this.prisma as any).accountingPlanVersion.create({
      data: { countryCode: cc, effectiveFrom: asDate, accounts: overrides as any, note: dto.note?.trim() || null, createdById: actor.id ?? null, createdByName: actor.name ?? null },
    });
    await this.reload();
    this.logger.log(`📒 Nouveau plan de comptes ${cc} (effet ${dto.effectiveFrom}) par ${actor.name ?? actor.id ?? '?'}`);
    return { id: row.id, country: cc, effectiveFrom: dto.effectiveFrom, overrides: Object.keys(overrides).length };
  }
}