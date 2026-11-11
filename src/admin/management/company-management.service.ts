// ============================================================================
// src/admin/management/company-management.service.ts
// GESTION D'ENTREPRISE (super admin) — vue détail, tendances, bilans, contrôles
//
// Principes :
//   • TOUT est recalculé en base à chaque appel : aucun compteur stocké. Si un
//     employé ou un bulletin est supprimé, les chiffres suivent immédiatement.
//   • Aucune donnée ultra-sensible : jamais de net à payer ni de salaire
//     individuel. Les contrôles remontent des ÉCARTS (règle + écart en FCFA),
//     les montants agrégés ne portent que sur l'entreprise entière.
//   • Les bulletins ANNULÉS sont exclus des masses et des contrôles.
// ============================================================================

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MaritalStatus } from '../../payroll/fiscal/fiscal-parts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IrppCalculatorService } from '../../payroll/fiscal/irpp-calculator.service';
import { FISCAL_MODE } from '../../payroll/fiscal/tax-brackets.constant';
import {
  DEFAULT_CNSS_EMPLOYER_ACCIDENT_RATE,
  DEFAULT_CNSS_EMPLOYER_FAMILY_RATE,
  DEFAULT_CNSS_EMPLOYER_PENSION_RATE,
  DEFAULT_CNSS_PENSION_CEILING,
  DEFAULT_CNSS_SALARIAL_RATE,
  DEFAULT_CNSS_SOCIAL_CEILING,
  TUS_RATE_CNSS,
  TUS_RATE_DGI,
} from '../../payroll/settings/constants/settings.constants';
import { ReportPeriod } from './company-management.dto';

const SALARIED_CONTRACTS = ['CDI', 'CDD', 'STAGE'];
const MAX_ISSUES = 200;

type YM = { year: number; month: number };
const ymKey = (p: YM) => `${p.year}-${String(p.month).padStart(2, '0')}`;
const monthLabel = (p: YM) => `${String(p.month).padStart(2, '0')}/${p.year}`;
const startOfMonth = (p: YM) => new Date(Date.UTC(p.year, p.month - 1, 1));
const endOfMonth = (p: YM) => new Date(Date.UTC(p.year, p.month, 0, 23, 59, 59, 999));
const addMonths = (p: YM, n: number): YM => {
  const idx = p.year * 12 + (p.month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};
const monthsBetween = (from: YM, to: YM): YM[] => {
  const out: YM[] = [];
  for (let c = from; c.year * 12 + c.month <= to.year * 12 + to.month; c = addMonths(c, 1)) out.push(c);
  return out;
};
const num = (v: any) => (v == null ? 0 : Number(v));
const pct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export type Severity = 'ERROR' | 'WARN';

@Injectable()
export class CompanyManagementService {
  private readonly logger = new Logger(CompanyManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly irpp: IrppCalculatorService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getCompany(companyId: string) {
    const c = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, legalName: true, tradeName: true, isActive: true, archivedAt: true, createdAt: true,
        appliesCnssEmployer: true, isSubjectToTus: true,
      },
    });
    if (!c) throw new NotFoundException('Entreprise introuvable');
    return c;
  }

  private now(): YM {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  /** Employés (champs minimaux) — base du calcul d'effectifs, toujours lue en direct. */
  private async loadEmployees(companyId: string) {
    return this.prisma.employee.findMany({
      where: { companyId },
      select: { id: true, hireDate: true, terminationDate: true, status: true, createdAt: true },
    });
  }

  /** Effectif à la fin d'un mois : embauché avant la fin du mois et non parti à cette date. */
  private headcountAt(employees: { hireDate: Date; terminationDate: Date | null }[], p: YM) {
    const end = endOfMonth(p);
    return employees.filter((e) => e.hireDate <= end && (!e.terminationDate || e.terminationDate > end)).length;
  }

  /** Cumuls mensuels des bulletins (hors annulés) — sans aucun net à payer. */
  private async monthlyAggregates(companyId: string, months: YM[]) {
    if (!months.length) return new Map<string, any>();
    const or = months.map((m) => ({ year: m.year, month: m.month }));

    const [sums, byStatus, cancelled] = await Promise.all([
      this.prisma.payroll.groupBy({
        by: ['year', 'month'],
        where: { companyId, status: { not: 'CANCELLED' }, OR: or },
        _count: { _all: true },
        _sum: {
          grossSalary: true, cnssSalarial: true, cnssEmployer: true, its: true, tusTotal: true,
          totalEmployerCost: true, employeeCustomTaxTotal: true, employerCustomTaxTotal: true,
          totalBonuses: true, totalOvertimeAmount: true,
        },
      }),
      this.prisma.payroll.groupBy({
        by: ['year', 'month', 'status'],
        where: { companyId, OR: or },
        _count: { _all: true },
      }),
      this.prisma.payroll.groupBy({
        by: ['year', 'month'],
        where: { companyId, status: 'CANCELLED', OR: or },
        _count: { _all: true },
      }),
    ]);

    const map = new Map<string, any>();
    for (const m of months) {
      map.set(ymKey(m), {
        payrolls: 0, byStatus: {}, cancelled: 0,
        grossTotal: 0, cnssSalarial: 0, cnssEmployer: 0, its: 0, tus: 0,
        customTaxes: 0, employerCost: 0, bonuses: 0, overtime: 0,
      });
    }
    for (const s of sums) {
      const row = map.get(ymKey({ year: s.year, month: s.month }));
      if (!row) continue;
      row.payrolls = s._count._all;
      row.grossTotal = num(s._sum.grossSalary);
      row.cnssSalarial = num(s._sum.cnssSalarial);
      row.cnssEmployer = num(s._sum.cnssEmployer);
      row.its = num(s._sum.its);
      row.tus = num(s._sum.tusTotal);
      row.customTaxes = num(s._sum.employeeCustomTaxTotal) + num(s._sum.employerCustomTaxTotal);
      row.employerCost = num(s._sum.totalEmployerCost);
      row.bonuses = num(s._sum.totalBonuses);
      row.overtime = num(s._sum.totalOvertimeAmount);
    }
    for (const s of byStatus) {
      const row = map.get(ymKey({ year: s.year, month: s.month }));
      if (row) row.byStatus[s.status] = s._count._all;
    }
    for (const s of cancelled) {
      const row = map.get(ymKey({ year: s.year, month: s.month }));
      if (row) row.cancelled = s._count._all;
    }
    return map;
  }

  /** Suppressions d'employés tracées par l'audit (best effort : l'audit peut être absent). */
  private async deletedEmployeesCount(companyId: string, from: Date, to: Date): Promise<number | null> {
    try {
      return await this.prisma.auditEvent.count({
        where: {
          companyId, entity: 'EMPLOYEE',
          action: { contains: 'DELET', mode: 'insensitive' },
          occurredAt: { gte: from, lte: to },
        },
      });
    } catch {
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1) VUE D'ENSEMBLE — chiffres en direct
  // ══════════════════════════════════════════════════════════════════════════

  async overview(companyId: string) {
    const company = await this.getCompany(companyId);
    const cur = this.now();
    const prev = addMonths(cur, -1);

    const [employees, users, subscription, payrollTotal, curAgg, ownerLinks, lastActions] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
      this.prisma.user.findMany({
        where: { companyId },
        select: { role: true, isActive: true, lockedUntil: true, twoFactorEnabled: true, lastLoginAt: true },
      }),
      this.prisma.subscription.findUnique({ where: { companyId } }),
      this.prisma.payroll.count({ where: { companyId } }),
      this.monthlyAggregates(companyId, [cur, prev]),
      this.prisma.userCompany.count({ where: { companyId } }),
      this.prisma.auditEvent.findMany({
        where: { companyId, action: { startsWith: 'ADMIN_' } },
        orderBy: { occurredAt: 'desc' },
        take: 5,
        select: { id: true, occurredAt: true, action: true, severity: true, summary: true, actorLabel: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    let employeesTotal = 0;
    for (const e of employees) { byStatus[e.status] = e._count._all; employeesTotal += e._count._all; }
    const payingEmployees = (byStatus.ACTIVE ?? 0) + (byStatus.ON_LEAVE ?? 0) + (byStatus.SUSPENDED ?? 0);

    // Employés actifs sans bulletin ce mois-ci → bulletins à générer
    const withPayroll = await this.prisma.payroll.findMany({
      where: { companyId, year: cur.year, month: cur.month, status: { not: 'CANCELLED' } },
      select: { employeeId: true },
    });
    const activeNoPayroll = await this.prisma.employee.count({
      where: {
        companyId, status: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
        id: { notIn: withPayroll.map((p) => p.employeeId) },
      },
    });

    const now = Date.now();
    const lastLogin = users.reduce<Date | null>(
      (acc, u) => (u.lastLoginAt && (!acc || u.lastLoginAt > acc) ? u.lastLoginAt : acc), null);

    const sub: any = subscription;
    const daysLeft = sub?.currentPeriodEnd
      ? Math.ceil((new Date(sub.currentPeriodEnd).getTime() - now) / 86_400_000) : null;

    return {
      company: {
        id: company.id, name: company.tradeName || company.legalName, legalName: company.legalName,
        isActive: company.isActive, archived: !!company.archivedAt, createdAt: company.createdAt,
      },
      employees: { total: employeesTotal, paying: payingEmployees, byStatus },
      payrolls: {
        total: payrollTotal,
        currentMonth: { period: monthLabel(cur), ...curAgg.get(ymKey(cur)) },
        previousMonth: { period: monthLabel(prev), ...curAgg.get(ymKey(prev)) },
        activeEmployeesWithoutPayroll: activeNoPayroll,
      },
      users: {
        total: users.length,
        active: users.filter((u) => u.isActive).length,
        locked: users.filter((u) => u.lockedUntil && u.lockedUntil.getTime() > now).length,
        withTwoFactor: users.filter((u) => u.twoFactorEnabled).length,
        byRole: users.reduce<Record<string, number>>((a, u) => ({ ...a, [u.role]: (a[u.role] ?? 0) + 1 }), {}),
        lastLoginAt: lastLogin,
      },
      subscription: sub
        ? {
            plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd,
            daysLeft, trialEndsAt: sub.trialEndsAt ?? null, pricePerMonth: sub.pricePerMonth ?? null,
          }
        : null,
      portfolio: { linkedAccounts: ownerLinks },
      recentAdminActions: lastActions.map((a) => ({ ...a })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2) TENDANCES — mois par mois, variations incluses
  // ══════════════════════════════════════════════════════════════════════════

  async trends(companyId: string, monthsCount = 12) {
    await this.getCompany(companyId);
    const last = this.now();
    const months = monthsBetween(addMonths(last, -(monthsCount - 1) - 1), last); // +1 mois d'avance pour les variations
    const [employees, agg] = await Promise.all([this.loadEmployees(companyId), this.monthlyAggregates(companyId, months)]);

    const series = months.map((m, i) => {
      const start = startOfMonth(m), end = endOfMonth(m);
      const a = agg.get(ymKey(m));
      const headcount = this.headcountAt(employees, m);
      const prevHeadcount = i > 0 ? this.headcountAt(employees, months[i - 1]) : null;
      const prevAgg = i > 0 ? agg.get(ymKey(months[i - 1])) : null;
      return {
        period: monthLabel(m), year: m.year, month: m.month,
        headcount,
        headcountChange: prevHeadcount == null ? null : headcount - prevHeadcount,
        hired: employees.filter((e) => e.hireDate >= start && e.hireDate <= end).length,
        departed: employees.filter((e) => e.terminationDate && e.terminationDate >= start && e.terminationDate <= end).length,
        payrolls: a.payrolls, cancelled: a.cancelled, byStatus: a.byStatus,
        grossTotal: a.grossTotal, cnssSalarial: a.cnssSalarial, cnssEmployer: a.cnssEmployer,
        its: a.its, tus: a.tus, customTaxes: a.customTaxes, employerCost: a.employerCost,
        grossVariationPct: prevAgg ? pct(a.grossTotal, prevAgg.grossTotal) : null,
      };
    });

    // On retire le mois d'avance
    return { company: (await this.getCompany(companyId)).tradeName, months: series.slice(1) };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3) BILAN — mensuel / trimestriel / annuel, comparé à la période précédente
  // ══════════════════════════════════════════════════════════════════════════

  private periodMonths(period: ReportPeriod, year: number, index?: number): { months: YM[]; label: string } {
    if (period === 'month') {
      if (!index) throw new BadRequestException('Mois requis (1-12)');
      return { months: [{ year, month: index }], label: monthLabel({ year, month: index }) };
    }
    if (period === 'quarter') {
      if (!index || index < 1 || index > 4) throw new BadRequestException('Trimestre requis (1-4)');
      const first = (index - 1) * 3 + 1;
      return { months: monthsBetween({ year, month: first }, { year, month: first + 2 }), label: `T${index} ${year}` };
    }
    return { months: monthsBetween({ year, month: 1 }, { year, month: 12 }), label: String(year) };
  }

  async report(companyId: string, period: ReportPeriod, year: number, index?: number) {
    const company = await this.getCompany(companyId);
    const cur = this.periodMonths(period, year, index);
    const span = cur.months.length;
    const prevMonths = cur.months.map((m) => addMonths(m, -span));

    const [employees, agg] = await Promise.all([
      this.loadEmployees(companyId),
      this.monthlyAggregates(companyId, [...prevMonths, ...cur.months]),
    ]);

    const total = (months: YM[]) => {
      const t = { payrolls: 0, cancelled: 0, grossTotal: 0, cnssSalarial: 0, cnssEmployer: 0, its: 0, tus: 0, customTaxes: 0, employerCost: 0 };
      for (const m of months) {
        const a = agg.get(ymKey(m));
        for (const k of Object.keys(t)) (t as any)[k] += a[k];
      }
      return t;
    };

    const curTotals = total(cur.months);
    const prevTotals = total(prevMonths);
    const first = cur.months[0], last = cur.months[cur.months.length - 1];
    const from = startOfMonth(first), to = endOfMonth(last);

    const hired = employees.filter((e) => e.hireDate >= from && e.hireDate <= to).length;
    const departed = employees.filter((e) => e.terminationDate && e.terminationDate >= from && e.terminationDate <= to).length;
    const headcountStart = this.headcountAt(employees, addMonths(first, -1));
    const headcountEnd = this.headcountAt(employees, last);
    const deleted = await this.deletedEmployeesCount(companyId, from, to);

    const variation: Record<string, number | null> = {};
    for (const k of ['grossTotal', 'cnssSalarial', 'cnssEmployer', 'its', 'tus', 'employerCost', 'payrolls']) {
      variation[k] = pct((curTotals as any)[k], (prevTotals as any)[k]);
    }

    return {
      company: company.tradeName || company.legalName,
      period, label: cur.label,
      previousLabel: this.periodMonths(period, prevMonths[0].year, period === 'year' ? undefined : period === 'quarter' ? Math.floor((prevMonths[0].month - 1) / 3) + 1 : prevMonths[0].month).label,
      headcount: { start: headcountStart, end: headcountEnd, hired, departed, deletedFromSystem: deleted },
      totals: curTotals,
      previousTotals: prevTotals,
      variationPct: variation,
      byMonth: cur.months.map((m) => ({ period: monthLabel(m), ...agg.get(ymKey(m)), headcount: this.headcountAt(employees, m) })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4) CONTRÔLES DE COHÉRENCE — masse salariale, CNSS, TUS, ITS
  // ══════════════════════════════════════════════════════════════════════════

  private resolveFiscalMode(settings: any, year: number): string {
    const forced = settings?.fiscalMode as string | undefined;
    if (forced === 'FORFAIT') return 'FORFAIT';
    if (forced === 'IRPP_LEGACY') return FISCAL_MODE.IRPP_LEGACY as string;
    if (forced === 'ITS_2026') return FISCAL_MODE.ITS_2026 as string;
    return year < 2026 ? (FISCAL_MODE.IRPP_LEGACY as string) : (FISCAL_MODE.ITS_2026 as string);
  }

  async consistency(companyId: string, month?: number, year?: number) {
    const company = await this.getCompany(companyId);
    const target: YM = month && year ? { year, month } : addMonths(this.now(), -1);
    const prev = addMonths(target, -1);

    const [settings, payrolls, agg, employees] = await Promise.all([
      // PayrollSettings n'est pas unique par entreprise : on prend la configuration la plus récente
      this.prisma.payrollSettings.findFirst({ where: { companyId }, orderBy: { effectiveDate: 'desc' } }).catch(() => null),
      this.prisma.payroll.findMany({
        where: { companyId, year: target.year, month: target.month, status: { not: 'CANCELLED' } },
        select: {
          id: true, grossSalary: true, cnssSalarial: true, cnssEmployer: true,
          cnssEmployerPension: true, cnssEmployerFamily: true, cnssEmployerAccident: true,
          tusDgiAmount: true, tusCnssAmount: true, tusTotal: true, its: true,
          employee: {
            select: {
              id: true, firstName: true, lastName: true, contractType: true, maritalStatus: true,
              numberOfChildren: true, isSubjectToCnss: true, isSubjectToTus: true, isSubjectToIrpp: true,
            },
          },
        },
      }),
      this.monthlyAggregates(companyId, [target, prev]),
      this.loadEmployees(companyId),
    ]);

    const s: any = settings ?? {};
    const rate = (v: any, d: number) => (v == null ? d : Number(v)) / 100;
    const salRate = rate(s.cnssSalarialRate, DEFAULT_CNSS_SALARIAL_RATE);
    const pensionCeil = Number(s.cnssPensionCeiling ?? DEFAULT_CNSS_PENSION_CEILING);
    const socialCeil = Number(s.cnssSocialCeiling ?? DEFAULT_CNSS_SOCIAL_CEILING);
    const fiscalMode = this.resolveFiscalMode(s, target.year);

    const issues: any[] = [];
    const push = (code: string, severity: Severity, label: string, p: any, gap?: number) => {
      if (issues.length >= MAX_ISSUES) return;
      issues.push({
        code, severity, label, payrollId: p.id,
        employee: `${p.employee.firstName} ${p.employee.lastName}`,
        gap: gap == null ? null : Math.round(gap),
      });
    };

    for (const p of payrolls) {
      const e = p.employee;
      const gross = num(p.grossSalary);
      const cnssSal = num(p.cnssSalarial);
      const salaried = SALARIED_CONTRACTS.includes(e.contractType as string);
      const isStage = e.contractType === 'STAGE';

      if (gross <= 0) { push('GROSS_ZERO', 'WARN', 'Brut nul ou négatif', p); continue; }

      // ── CNSS salariale ────────────────────────────────────────────────────
      const cnssSalMax = Math.round(Math.min(gross, pensionCeil) * salRate);
      if (cnssSal > cnssSalMax + 1) {
        push('CNSS_SAL_OVER_MAX', 'ERROR', 'CNSS salariale supérieure au maximum légal (taux × min(brut, plafond))', p, cnssSal - cnssSalMax);
      }
      if (cnssSal > 0 && (!salaried || isStage || e.isSubjectToCnss === false)) {
        push('CNSS_SAL_NOT_DUE', 'ERROR', 'CNSS salariale retenue alors que le salarié n’y est pas soumis', p, cnssSal);
      }
      if (cnssSal === 0 && salaried && !isStage && e.isSubjectToCnss !== false) {
        push('CNSS_SAL_MISSING', 'WARN', 'Aucune CNSS salariale pour un salarié soumis', p);
      }

      // ── CNSS patronale ────────────────────────────────────────────────────
      const pen = num(p.cnssEmployerPension), fam = num(p.cnssEmployerFamily), acc = num(p.cnssEmployerAccident);
      const emp = num(p.cnssEmployer);
      if (Math.abs(emp - (pen + fam + acc)) > 1) {
        push('CNSS_EMP_SUM', 'ERROR', 'CNSS patronale ≠ somme des 3 branches', p, emp - (pen + fam + acc));
      }
      const penMax = Math.round(Math.min(gross, pensionCeil) * (DEFAULT_CNSS_EMPLOYER_PENSION_RATE / 100));
      const famMax = Math.round(Math.min(gross, socialCeil) * (DEFAULT_CNSS_EMPLOYER_FAMILY_RATE / 100));
      const accMax = Math.round(Math.min(gross, socialCeil) * (DEFAULT_CNSS_EMPLOYER_ACCIDENT_RATE / 100));
      if (pen > penMax + 1) push('CNSS_EMP_PENSION_OVER', 'ERROR', 'Branche retraite au-dessus du maximum légal', p, pen - penMax);
      if (fam > famMax + 1) push('CNSS_EMP_FAMILY_OVER', 'ERROR', 'Branche famille au-dessus du maximum légal', p, fam - famMax);
      if (acc > accMax + 1) push('CNSS_EMP_ACCIDENT_OVER', 'ERROR', 'Branche accidents du travail au-dessus du maximum légal', p, acc - accMax);

      // ── TUS ───────────────────────────────────────────────────────────────
      const dgi = num(p.tusDgiAmount), tusCnss = num(p.tusCnssAmount), tus = num(p.tusTotal);
      const tusDue = salaried && !isStage && company.isSubjectToTus !== false && e.isSubjectToTus !== false;
      if (tus > 0) {
        const expDgi = Math.round(gross * TUS_RATE_DGI), expCnss = Math.round(gross * TUS_RATE_CNSS);
        if (Math.abs(dgi - expDgi) > 1 || Math.abs(tusCnss - expCnss) > 1) {
          push('TUS_MISMATCH', 'ERROR', 'TUS différente de brut × 7,5 % (2,025 % DGI + 5,475 % CNSS)', p, tus - (expDgi + expCnss));
        }
        if (Math.abs(tus - (dgi + tusCnss)) > 1) push('TUS_SUM', 'ERROR', 'TUS totale ≠ DGI + CNSS', p, tus - (dgi + tusCnss));
        if (!tusDue) push('TUS_NOT_DUE', 'ERROR', 'TUS appliquée alors que le salarié ou l’entreprise n’y est pas soumis', p, tus);
      } else if (tusDue) {
        push('TUS_MISSING', 'WARN', 'Aucune TUS pour un salarié soumis', p);
      }

      // ── ITS ───────────────────────────────────────────────────────────────
      const its = num(p.its);
      if (isStage && its > 0) push('ITS_NOT_DUE', 'ERROR', 'ITS retenu sur un stagiaire', p, its);
      if (salaried && !isStage && e.isSubjectToIrpp !== false) {
        try {
          let expected: number;
          if (fiscalMode === 'FORFAIT') {
            expected = Math.ceil(gross * Number(s.forfaitItsRate ?? 0.08));
          } else {
            expected = this.irpp.calculateIRPP(
              gross, cnssSal, (e.maritalStatus as unknown as MaritalStatus) ?? MaritalStatus.SINGLE,
              e.numberOfChildren ?? 0, fiscalMode as any,
            ).irppTotal;
          }
          const tolerance = Math.max(2, Math.round(expected * 0.005));
          if (Math.abs(its - expected) > tolerance) {
            // WARN : la situation familiale a pu changer depuis la génération du bulletin
            push('ITS_MISMATCH', 'WARN', 'ITS différent du recalcul (vérifier mode fiscal / situation familiale)', p, its - expected);
          }
        } catch (err) {
          this.logger.warn(`Recalcul ITS impossible (bulletin ${p.id}) : ${(err as Error).message}`);
        }
      }
    }

    // ── Masse salariale : comparaison avec le mois précédent ────────────────
    const a = agg.get(ymKey(target)), b = agg.get(ymKey(prev));
    const headcountNow = this.headcountAt(employees, target);
    const headcountPrev = this.headcountAt(employees, prev);
    const grossVar = b.grossTotal ? pct(a.grossTotal, b.grossTotal) : null;
    const headVar = headcountPrev ? pct(headcountNow, headcountPrev) : null;
    const ratio = (x: number, base: number) => (base ? Math.round((x / base) * 10000) / 100 : null);

    const checks: { code: string; severity: Severity; label: string }[] = [];
    if (grossVar != null && Math.abs(grossVar) > 25 && (headVar == null || Math.abs(headVar) < 10)) {
      checks.push({
        code: 'MASS_VARIATION', severity: 'WARN',
        label: `Masse salariale ${grossVar > 0 ? '+' : ''}${grossVar} % alors que l’effectif varie de ${headVar ?? 0} %`,
      });
    }
    const missing = Math.max(0, headcountNow - a.payrolls);
    if (a.payrolls === 0 && headcountNow > 0) {
      checks.push({ code: 'NO_PAYROLL', severity: 'WARN', label: 'Aucun bulletin généré pour cette période' });
    } else if (missing > 0) {
      checks.push({ code: 'MISSING_PAYROLLS', severity: 'WARN', label: `${missing} salarié(s) en poste sans bulletin sur la période` });
    }

    // Paramètres CNSS de l'entreprise non conformes aux valeurs légales
    if (settings) {
      if (Number(s.cnssSalarialRate) !== DEFAULT_CNSS_SALARIAL_RATE)
        checks.push({ code: 'SETTINGS_RATE', severity: 'WARN', label: `Taux CNSS salarial paramétré à ${s.cnssSalarialRate} % (légal : ${DEFAULT_CNSS_SALARIAL_RATE} %)` });
      if (Number(s.cnssPensionCeiling) !== DEFAULT_CNSS_PENSION_CEILING || Number(s.cnssSocialCeiling) !== DEFAULT_CNSS_SOCIAL_CEILING)
        checks.push({ code: 'SETTINGS_CEILING', severity: 'WARN', label: 'Plafonds CNSS paramétrés différemment des plafonds légaux' });
    }

    const errors = issues.filter((i) => i.severity === 'ERROR').length + checks.filter((c) => c.severity === 'ERROR').length;
    const warnings = issues.filter((i) => i.severity === 'WARN').length + checks.filter((c) => c.severity === 'WARN').length;
    const flaggedPayrolls = new Set(issues.map((i) => i.payrollId)).size;

    return {
      company: company.tradeName || company.legalName,
      period: monthLabel(target),
      fiscalMode,
      payrollsChecked: payrolls.length,
      summary: {
        errors, warnings,
        payrollsFlagged: flaggedPayrolls,
        payrollsOk: Math.max(0, payrolls.length - flaggedPayrolls),
        truncated: issues.length >= MAX_ISSUES,
      },
      totals: {
        current: { period: monthLabel(target), headcount: headcountNow, ...a },
        previous: { period: monthLabel(prev), headcount: headcountPrev, ...b },
        variationPct: {
          grossTotal: grossVar, headcount: headVar,
          cnssSalarial: pct(a.cnssSalarial, b.cnssSalarial), cnssEmployer: pct(a.cnssEmployer, b.cnssEmployer),
          its: pct(a.its, b.its), tus: pct(a.tus, b.tus),
        },
        // Poids de chaque prélèvement dans la masse salariale (comparable d'un mois à l'autre)
        ratiosPct: {
          cnssSalarial: ratio(a.cnssSalarial, a.grossTotal), cnssEmployer: ratio(a.cnssEmployer, a.grossTotal),
          its: ratio(a.its, a.grossTotal), tus: ratio(a.tus, a.grossTotal),
        },
        previousRatiosPct: {
          cnssSalarial: ratio(b.cnssSalarial, b.grossTotal), cnssEmployer: ratio(b.cnssEmployer, b.grossTotal),
          its: ratio(b.its, b.grossTotal), tus: ratio(b.tus, b.grossTotal),
        },
      },
      checks,
      issues,
    };
  }
}