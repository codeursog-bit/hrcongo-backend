// ============================================================================
// 📁 src/loans-dashboard/loans-dashboard.service.ts
// Charge les données réelles (prêts, avances, journaux de remboursement) et alimente :
//   • l'écran (JSON : getView)
//   • l'Excel (generateExport)
// Une seule source de calcul : l'écran et le fichier ne peuvent pas diverger.
// Mêmes règles d'accès que le module Prêts & avances (FINANCE_ROLES, pas de MANAGER)
// et mêmes règles de périmètre que le dashboard présences (entreprise vérifiée /
// appartenance au portefeuille).
// ============================================================================

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PortfolioMembershipService } from '../portfolio/portfolio-membership.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import { FINANCE_ROLES } from '../loans/loans.constants';
import { PeriodInput, buildPeriod, cleanText } from '../workforce-dashboard/workforce-calc';
import { WfScope } from '../workforce-dashboard/workforce-dashboard.types';
import { exportFileName } from '../workforce-dashboard/workforce-excel-common';
import {
  ADVANCE_STATUS_LABEL, GRANTED_ADVANCE, GRANTED_LOAN, LOAN_STATUS_LABEL, METHOD_LABEL, NATURE_LABEL, TYPE_LABEL,
  advancesByStatus, departmentRows, evolution, keyOf, loansByNature, loansByStatus, loansByType, monthKeyOf,
  repaidOf, repaymentsByMethod, round2, topIndebted, totalsOf,
} from './loans-dashboard.calc';
import {
  LdAdvance, LdEmployee, LdLoan, LdRepayment, LdStockItem, LoansDashboardData, LoansDashboardView,
} from './loans-dashboard.types';
import { buildLoansWorkbook } from './loans-dashboard.excel';

const DAY_MS = 86_400_000;
const num = (v: unknown) => Number(v ?? 0);

interface CompanyLite {
  id: string;
  legalName: string;
  tradeName: string | null;
  city: string | null;
}

export interface LoansQuery extends PeriodInput {
  companyId?: string; // mode entreprise
  companies?: string; // mode portefeuille : "ALL" ou ids séparés par des virgules
}

@Injectable()
export class LoansDashboardService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
  ) {}

  // ───────────────────────── Périmètre (qui voit quoi) ─────────────────────────

  private async resolveCompanyScope(userId: string, companyId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, manageMultipleCompanies: true },
    });
    if (!user) throw new ForbiddenException('Utilisateur introuvable.');
    // Montants dus par les salariés : mêmes rôles que le module Prêts & avances (pas de MANAGER).
    if (!FINANCE_ROLES.includes(user.role as string)) {
      throw new ForbiddenException('Accès réservé aux administrateurs et aux RH.');
    }
    const id = await resolveVerifiedCompanyId(this.prisma, user, companyId);
    if (!id) throw new NotFoundException('Entreprise introuvable.');
    return { companyIds: [id], available: [] as string[] };
  }

  private async resolvePortfolioScope(userId: string, companies?: string) {
    await this.membership.assertCanUsePortfolio(userId);
    const linked = await this.membership.getLinkedCompanyIds(userId);
    const raw = (companies ?? 'ALL').trim();
    let ids: string[];
    if (!raw || raw.toUpperCase() === 'ALL') {
      ids = linked;
    } else {
      ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
      for (const id of ids) await this.membership.assertCompanyMembership(userId, id);
    }
    if (ids.length === 0) throw new NotFoundException('Aucune entreprise dans le portefeuille.');
    return { companyIds: ids, available: linked };
  }

  // ───────────────────────────── Chargement ────────────────────────────────────

  async load(
    userId: string,
    mode: 'COMPANY' | 'PORTFOLIO',
    q: LoansQuery,
  ): Promise<{ data: LoansDashboardData; companies: { id: string; name: string }[] }> {
    let period;
    try {
      period = buildPeriod(q);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }

    const scopeRes = mode === 'PORTFOLIO'
      ? await this.resolvePortfolioScope(userId, q.companies)
      : await this.resolveCompanyScope(userId, q.companyId);
    const { companyIds } = scopeRes;

    const companyRows: CompanyLite[] = await this.prisma.company.findMany({
      where: { id: { in: [...new Set([...companyIds, ...scopeRes.available])] } },
      select: { id: true, legalName: true, tradeName: true, city: true },
    });
    const nameOf = (c: { tradeName: string | null; legalName: string }) => (c.tradeName || c.legalName).trim();
    const byId = new Map(companyRows.map((c) => [c.id, c]));

    const monthKeys = new Set(period.months.map((m) => m.key));
    const monthOr = period.months.map((m) => ({ month: m.month, year: m.year }));
    const winStart = period.first.bom;
    const winEnd = new Date(period.last.eom.getTime() + DAY_MS); // exclusif
    const ofCompanies = { employee: { companyId: { in: companyIds } } };

    // ── Prêts de la période (rattachés au mois de début du prêt) ──
    const loanRows = await this.prisma.loan.findMany({
      where: { ...ofCompanies, startDate: { gte: winStart, lt: winEnd } },
      select: {
        id: true, employeeId: true, amount: true, monthlyRepayment: true, remainingBalance: true,
        nature: true, type: true, status: true, reason: true, startDate: true, endDate: true,
        repaymentLogs: { select: { amount: true } },
      },
      orderBy: { startDate: 'asc' },
    });
    const loans: LdLoan[] = [];
    for (const l of loanRows) {
      const mk = monthKeyOf(l.startDate);
      if (!monthKeys.has(mk)) continue;
      const amount = num(l.amount);
      const repaid = repaidOf(l.status, amount, num(l.remainingBalance), round2(l.repaymentLogs.reduce((s, x) => s + num(x.amount), 0)));
      loans.push({
        id: l.id, employeeId: l.employeeId,
        nature: l.nature ?? '', natureLabel: l.nature ? NATURE_LABEL[l.nature] ?? l.nature : 'Non précisée',
        type: l.type, typeLabel: TYPE_LABEL[l.type] ?? l.type,
        status: l.status, statusLabel: LOAN_STATUS_LABEL[l.status] ?? l.status,
        granted: GRANTED_LOAN.includes(l.status),
        amount, monthlyRepayment: num(l.monthlyRepayment), repaid,
        outstanding: l.status === 'ACTIVE' ? round2(Math.max(0, amount - repaid)) : 0,
        start: l.startDate, end: l.endDate, monthKey: mk, reason: cleanText(l.reason),
      });
    }

    // ── Avances de la période (rattachées au mois de la demande) ──
    const advRows = await this.prisma.advance.findMany({
      where: { ...ofCompanies, OR: monthOr },
      select: {
        id: true, employeeId: true, amount: true, month: true, year: true, deductMonth: true, deductYear: true,
        status: true, remainingBalance: true, recoverViaPayroll: true, reason: true,
        repaymentLogs: { select: { amount: true } },
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const advances: LdAdvance[] = [];
    for (const a of advRows) {
      const mk = keyOf(a.year, a.month);
      if (!monthKeys.has(mk)) continue;
      const amount = num(a.amount);
      const repaid = repaidOf(a.status, amount, num(a.remainingBalance), round2(a.repaymentLogs.reduce((s, x) => s + num(x.amount), 0)));
      advances.push({
        id: a.id, employeeId: a.employeeId,
        status: a.status, statusLabel: ADVANCE_STATUS_LABEL[a.status] ?? a.status,
        granted: GRANTED_ADVANCE.includes(a.status),
        amount, repaid,
        outstanding: a.status === 'APPROVED' ? round2(Math.max(0, amount - repaid)) : 0,
        monthKey: mk, deductKey: keyOf(a.deductYear, a.deductMonth),
        viaPayroll: a.recoverViaPayroll, reason: cleanText(a.reason),
      });
    }

    // ── Remboursements encaissés pendant la période (journaux) ──
    const [loanLogs, advLogs] = await Promise.all([
      this.prisma.loanRepaymentLog.findMany({
        where: { loan: ofCompanies, OR: monthOr },
        select: { month: true, year: true, amount: true, method: true, loan: { select: { employeeId: true } } },
      }),
      this.prisma.advanceRepaymentLog.findMany({
        where: { advance: ofCompanies, OR: monthOr },
        select: { month: true, year: true, amount: true, method: true, advance: { select: { employeeId: true } } },
      }),
    ]);
    const repayments: LdRepayment[] = [];
    for (const r of loanLogs) {
      const mk = keyOf(r.year, r.month);
      if (!monthKeys.has(mk)) continue;
      repayments.push({ kind: 'LOAN', kindLabel: 'Prêt', employeeId: r.loan.employeeId, monthKey: mk, method: r.method, methodLabel: METHOD_LABEL[r.method] ?? r.method, amount: num(r.amount) });
    }
    for (const r of advLogs) {
      const mk = keyOf(r.year, r.month);
      if (!monthKeys.has(mk)) continue;
      repayments.push({ kind: 'ADVANCE', kindLabel: 'Avance', employeeId: r.advance.employeeId, monthKey: mk, method: r.method, methodLabel: METHOD_LABEL[r.method] ?? r.method, amount: num(r.amount) });
    }

    // ── Dettes en cours À CE JOUR (indépendantes de la période) ──
    const [stockLoans, stockAdvs] = await Promise.all([
      this.prisma.loan.findMany({
        where: { ...ofCompanies, status: 'ACTIVE' },
        select: { employeeId: true, amount: true, remainingBalance: true, status: true, repaymentLogs: { select: { amount: true } } },
      }),
      this.prisma.advance.findMany({
        where: { ...ofCompanies, status: 'APPROVED' },
        select: { employeeId: true, amount: true, remainingBalance: true, status: true, repaymentLogs: { select: { amount: true } } },
      }),
    ]);
    const stock: LdStockItem[] = [];
    for (const [kind, rows] of [['LOAN', stockLoans], ['ADVANCE', stockAdvs]] as const) {
      for (const s of rows) {
        const amount = num(s.amount);
        const repaid = repaidOf(s.status, amount, num(s.remainingBalance), round2(s.repaymentLogs.reduce((x, y) => x + num(y.amount), 0)));
        const outstanding = round2(Math.max(0, amount - repaid));
        if (outstanding > 0) stock.push({ kind, employeeId: s.employeeId, outstanding });
      }
    }

    // ── Salariés concernés ──
    const empIds = [...new Set([
      ...loans.map((l) => l.employeeId), ...advances.map((a) => a.employeeId),
      ...repayments.map((r) => r.employeeId), ...stock.map((s) => s.employeeId),
    ])];
    const empRows = empIds.length === 0 ? [] : await this.prisma.employee.findMany({
      where: { id: { in: empIds } },
      select: {
        id: true, companyId: true, employeeNumber: true, firstName: true, lastName: true,
        department: { select: { name: true } },
      },
    });
    const employees: LdEmployee[] = empRows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      companyName: byId.get(r.companyId) ? nameOf(byId.get(r.companyId)!) : '',
      matricule: cleanText(r.employeeNumber),
      fullName: `${cleanText(r.lastName).toUpperCase()} ${cleanText(r.firstName)}`.trim(),
      department: cleanText(r.department?.name) || 'Sans département',
    }));
    employees.sort((a, b) => a.fullName.localeCompare(b.fullName));

    const warnings: string[] = [];
    const chosen = companyIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
    const multi = chosen.length > 1;
    const scope: WfScope = {
      companyIds,
      companyName: multi ? `Portefeuille — ${chosen.length} entreprises` : chosen[0] ? nameOf(chosen[0]) : 'Entreprise',
      city: multi ? '' : cleanText(chosen[0]?.city),
      multi,
    };

    return {
      data: { scope, period, employees, loans, advances, repayments, stock, warnings, generatedAt: new Date() },
      companies: scopeRes.available.length
        ? scopeRes.available.map((id) => ({ id, name: byId.get(id) ? nameOf(byId.get(id)!) : id }))
        : chosen.map((c) => ({ id: c.id, name: nameOf(c) })),
    };
  }

  // ───────────────────────────── Sorties ───────────────────────────────────────

  async getView(userId: string, mode: 'COMPANY' | 'PORTFOLIO', q: LoansQuery): Promise<LoansDashboardView> {
    const { data, companies } = await this.load(userId, mode, q);
    const slim = (m: { month: number; year: number; label: string; short: string }) => ({ month: m.month, year: m.year, label: m.label, short: m.short });
    return {
      companyName: data.scope.companyName,
      city: data.scope.city,
      multi: data.scope.multi,
      companies,
      warnings: data.warnings,
      period: { mode: data.period.mode, label: data.period.label, months: data.period.months.map(slim) },
      totals: totalsOf(data),
      loansByStatus: loansByStatus(data),
      loansByNature: loansByNature(data),
      loansByType: loansByType(data),
      advancesByStatus: advancesByStatus(data),
      repaymentsByMethod: repaymentsByMethod(data),
      departments: departmentRows(data),
      topIndebted: topIndebted(data),
      evolution: evolution(data),
    };
  }

  async generateExport(userId: string, mode: 'COMPANY' | 'PORTFOLIO', q: LoansQuery) {
    const { data } = await this.load(userId, mode, q);
    const buffer = await buildLoansWorkbook(data);
    const filename = exportFileName('Prets_Avances', data as any);
    return { buffer, filename };
  }
}