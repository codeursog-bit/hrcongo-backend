import { Prisma } from '@prisma/client';
import { LeavesBalanceService } from '../leaves/leaves-balance.service';
import { LeavesIndemnityService } from '../leaves/leaves-indemnity.service';
import {
  nextWorkingDay,
  getCompanyWorkDays,
} from '../common/working-days.util';
import { congoDateString } from '../common/utils/congo-time';
import { planLeaves } from './leave-planner';
export const ANALYSIS_TOOLS = [
  'headcount_summary',
  'explain_payroll_variation',
  'top_paid_employees',
  'explain_employee_pay',
  'permissions_ranking',
  'leave_departures',
  'leave_returns',
  'leave_allowance',
  'leave_balance',
  'attendance_summary',
  'absences_ranking',
  'lateness_ranking',
  'leave_planning',
] as const;
export type AnalysisTool = (typeof ANALYSIS_TOOLS)[number];
export interface ToolIntent {
  tool: AnalysisTool;
  month: number;
  year: number;
  employeeId?: string;
  days?: number;
}
export interface ToolCard {
  title: string;
  period: string;
  source: string;
  path?: string;
  notes?: string[];
  departments?: {
    name: string;
    initial: number;
    hires: number;
    departures: number;
    final: number;
  }[];
  metrics: { label: string; value: number; unit?: string }[];
  rows?: {
    employeeId: string;
    label: string;
    detail?: string;
    value?: number;
    unit?: string;
    path?: string;
  }[];
}
const money = (v: unknown) => new Prisma.Decimal(String(v ?? 0));
const val = (v: unknown) => Number(v ?? 0);
const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
export async function runAnalysisTool(
  tx: Prisma.TransactionClient,
  companyId: string,
  i: ToolIntent,
): Promise<ToolCard | null> {
  const start = new Date(Date.UTC(i.year, i.month - 1, 1)),
    end = new Date(Date.UTC(i.year, i.month, 1));
  const period = start.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    base = { period, metrics: [] as ToolCard['metrics'] };
  if (
    i.employeeId &&
    !(await tx.employee.findFirst({
      where: { id: i.employeeId, companyId },
      select: { id: true },
    }))
  )
    return null;
  const row = (
    id: string,
    n: number,
    detail?: string,
    value?: number,
    unit?: string,
  ) => ({
    employeeId: id,
    label: 'Employé ' + (n + 1),
    detail,
    value,
    unit,
    path: '/employes/' + id,
  });
  if (i.tool === 'explain_payroll_variation') {
    const previous = {
      month: i.month === 1 ? 12 : i.month - 1,
      year: i.month === 1 ? i.year - 1 : i.year,
    };
    const aggregate = (month: number, year: number) =>
      tx.payroll.aggregate({
        where: { companyId, month, year },
        _count: true,
        _sum: {
          grossSalary: true,
          netSalary: true,
          totalEmployerCost: true,
          totalBonuses: true,
          totalOvertimeAmount: true,
          baseSalary: true,
          adjustedBaseSalary: true,
          absenceDeduction: true,
        },
      });
    const [current, prior] = await Promise.all([
      aggregate(i.month, i.year),
      aggregate(previous.month, previous.year),
    ]);
    if (!current._count || !prior._count) return null;
    const delta = (k: keyof typeof current._sum) =>
      money(current._sum[k]).minus(money(prior._sum[k]));
    const bonuses = delta('totalBonuses'),
      overtime = delta('totalOvertimeAmount'),
      gross = delta('grossSalary');
    return {
      ...base,
      title: 'Évolution de la masse salariale',
      source: 'payroll.aggregate',
      path: '/rapports/analyse-paie',
      notes: [
        'Comparaison avec le mois précédent. Tous les statuts de bulletin sont inclus, comme dans le rapport comparatif.',
        'Les écarts de primes et d’heures supplémentaires sont des composantes observées ; le reste peut inclure bases, absences, entrées, sorties et autres éléments. Aucune cause individuelle n’est déduite.',
      ],
      metrics: [
        {
          label: 'Brut de la période',
          value: val(current._sum.grossSalary),
          unit: 'FCFA',
        },
        {
          label: 'Brut du mois précédent',
          value: val(prior._sum.grossSalary),
          unit: 'FCFA',
        },
        { label: 'Écart brut', value: gross.toNumber(), unit: 'FCFA' },
        { label: 'Écart des primes', value: bonuses.toNumber(), unit: 'FCFA' },
        {
          label: 'Écart des heures supplémentaires',
          value: overtime.toNumber(),
          unit: 'FCFA',
        },
        {
          label: 'Autres composantes de l’écart brut',
          value: gross.minus(bonuses).minus(overtime).toNumber(),
          unit: 'FCFA',
        },
        {
          label: 'Net de la période',
          value: val(current._sum.netSalary),
          unit: 'FCFA',
        },
        {
          label: 'Coût employeur enregistré',
          value: val(current._sum.totalEmployerCost),
          unit: 'FCFA',
        },
      ],
    };
  }
  if (i.tool === 'top_paid_employees' || i.tool === 'explain_employee_pay') {
    if (i.tool === 'explain_employee_pay' && !i.employeeId) return null;
    const where = {
      companyId,
      employee: { companyId },
      month: i.month,
      year: i.year,
      status: { in: ['VALIDATED', 'TO_PAY', 'PAID'] as any },
      ...(i.employeeId ? { employeeId: i.employeeId } : {}),
    };
    const ps = await tx.payroll.findMany({
      where,
      orderBy: [{ netSalary: 'desc' }, { employeeId: 'asc' }, { id: 'asc' }],
      take: i.tool === 'top_paid_employees' ? 5 : 2,
      select: {
        id: true,
        employeeId: true,
        grossSalary: true,
        netSalary: true,
        baseSalary: true,
        totalBonuses: true,
        totalOvertimeAmount: true,
        totalDeductions: true,
        totalEmployerCost: true,
      },
    });
    if (!ps.length || (i.tool === 'explain_employee_pay' && ps.length !== 1))
      return null;
    if (i.tool === 'top_paid_employees')
      return {
        ...base,
        title: 'Rémunérations nettes les plus élevées',
        source: 'payroll.validated',
        path: '/paie',
        notes: [
          'Cinq bulletins au maximum, validés, à payer ou payés. Classement par net enregistré, hors brouillons.',
        ],
        rows: ps.map((p, n) => ({
          ...row(
            p.employeeId,
            n,
            `Brut ${val(p.grossSalary).toLocaleString('fr-FR')} FCFA ; primes ${val(p.totalBonuses).toLocaleString('fr-FR')} FCFA ; heures supplémentaires ${val(p.totalOvertimeAmount).toLocaleString('fr-FR')} FCFA`,
            val(p.netSalary),
            'FCFA',
          ),
          path: '/paie/' + p.id,
        })),
      };
    const p = ps[0],
      prevMonth = i.month === 1 ? 12 : i.month - 1,
      prevYear = i.month === 1 ? i.year - 1 : i.year;
    const before = await tx.payroll.findFirst({
      where: {
        companyId,
        employeeId: i.employeeId,
        month: prevMonth,
        year: prevYear,
        status: { in: ['VALIDATED', 'TO_PAY', 'PAID'] },
      },
      select: { netSalary: true },
    });
    return {
      ...base,
      title: 'Paie de l’employé sélectionné',
      source: 'payroll.validated',
      path: '/paie/' + p.id,
      notes: [
        'Montants enregistrés sur le bulletin validé, à payer ou payé. Les retenues et coûts comprennent les taxes enregistrées sur ce bulletin.',
      ],
      rows: [row(p.employeeId, 0)],
      metrics: [
        { label: 'Salaire de base', value: val(p.baseSalary), unit: 'FCFA' },
        { label: 'Primes', value: val(p.totalBonuses), unit: 'FCFA' },
        {
          label: 'Heures supplémentaires',
          value: val(p.totalOvertimeAmount),
          unit: 'FCFA',
        },
        { label: 'Brut', value: val(p.grossSalary), unit: 'FCFA' },
        {
          label: 'Total des retenues',
          value: val(p.totalDeductions),
          unit: 'FCFA',
        },
        { label: 'Net', value: val(p.netSalary), unit: 'FCFA' },
        {
          label: 'Coût employeur',
          value: val(p.totalEmployerCost),
          unit: 'FCFA',
        },
        ...(before
          ? [
              {
                label: 'Écart net avec le mois précédent',
                value: money(p.netSalary)
                  .minus(money(before.netSalary))
                  .toNumber(),
                unit: 'FCFA',
              },
            ]
          : []),
      ],
    };
  }
  if (
    i.tool === 'attendance_summary' ||
    i.tool === 'absences_ranking' ||
    i.tool === 'lateness_ranking'
  ) {
    // Résumés mensuels de présence déjà calculés par l'application (jamais recalculés ici).
    const where = {
      month: i.month,
      year: i.year,
      employee: { companyId },
    };
    if (i.tool === 'attendance_summary') {
      const [sum, count] = await Promise.all([
        tx.attendanceSummary.aggregate({
          where,
          _sum: {
            daysPresent: true,
            daysRemote: true,
            daysOnLeave: true,
            daysAbsentPaid: true,
            daysAbsentUnpaid: true,
            daysLate: true,
            normalHours: true,
            overtime10Hours: true,
            overtime25Hours: true,
            overtime50Hours: true,
            overtime100Hours: true,
          },
        }),
        tx.attendanceSummary.count({ where }),
      ]);
      const s = sum._sum;
      const overtime =
        val(s.overtime10Hours) +
        val(s.overtime25Hours) +
        val(s.overtime50Hours) +
        val(s.overtime100Hours);
      return {
        ...base,
        title: 'Résumé des présences',
        source: 'attendanceSummary.monthly',
        path: '/presences/resume',
        notes: count
          ? [
              'Totaux des résumés mensuels de présence de l’entreprise pour la période ; un jour de retard est aussi compté dans les jours de présence selon le suivi de l’application.',
            ]
          : [
              'Aucun résumé de présence n’a été généré pour cette période : ouvrez la page des résumés de présence pour le générer.',
            ],
        metrics: [
          { label: 'Employés avec résumé', value: count },
          { label: 'Jours de présence', value: val(s.daysPresent), unit: 'jours' },
          { label: 'Jours en télétravail', value: val(s.daysRemote), unit: 'jours' },
          { label: 'Jours en congé', value: val(s.daysOnLeave), unit: 'jours' },
          { label: 'Absences justifiées', value: val(s.daysAbsentPaid), unit: 'jours' },
          { label: 'Absences non justifiées', value: val(s.daysAbsentUnpaid), unit: 'jours' },
          { label: 'Jours de retard', value: val(s.daysLate), unit: 'jours' },
          { label: 'Heures normales', value: val(s.normalHours), unit: 'h' },
          { label: 'Heures supplémentaires', value: overtime, unit: 'h' },
        ],
      };
    }
    const grouped = await tx.attendanceSummary.groupBy({
      by: ['employeeId'],
      where,
      _sum: { daysAbsentPaid: true, daysAbsentUnpaid: true, daysLate: true },
    });
    if (i.tool === 'lateness_ranking') {
      const rows = grouped
        .map((g) => ({ id: g.employeeId, n: val(g._sum.daysLate) }))
        .filter((g) => g.n > 0)
        .sort((x, y) => y.n - x.n || x.id.localeCompare(y.id))
        .slice(0, 5);
      return {
        ...base,
        title: 'Retards',
        source: 'attendanceSummary.lateness',
        path: '/presences/resume',
        notes: [
          'Classement limité aux cinq premiers employés ; nombre de jours de retard du résumé mensuel de présence.',
        ],
        rows: rows.map((r, n) => row(r.id, n, undefined, r.n, 'jours de retard')),
      };
    }
    const rows = grouped
      .map((g) => ({
        id: g.employeeId,
        paid: val(g._sum.daysAbsentPaid),
        unpaid: val(g._sum.daysAbsentUnpaid),
      }))
      .filter((g) => g.paid + g.unpaid > 0)
      .sort(
        (x, y) =>
          y.paid + y.unpaid - (x.paid + x.unpaid) ||
          y.unpaid - x.unpaid ||
          x.id.localeCompare(y.id),
      )
      .slice(0, 5);
    return {
      ...base,
      title: 'Absences',
      source: 'attendanceSummary.absences',
      path: '/presences/absences/rapport',
      notes: [
        'Classement limité aux cinq premiers employés ; jours d’absence justifiées et non justifiées du résumé mensuel de présence. Les congés ne sont pas comptés comme absences.',
      ],
      rows: rows.map((r, n) =>
        row(
          r.id,
          n,
          r.unpaid + ' jour(s) non justifié(s)',
          r.paid + r.unpaid,
          'jours d’absence',
        ),
      ),
    };
  }
  if (i.tool === 'permissions_ranking') {
    const rows = await tx.permissionTicket.groupBy({
      by: ['employeeId'],
      where: {
        companyId,
        employee: { companyId },
        status: 'APPROVED',
        departureTime: {
          gte: new Date(start.getTime() - 3600000),
          lt: new Date(end.getTime() - 3600000),
        },
      },
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' } }, { employeeId: 'asc' }],
      take: 5,
    });
    return {
      ...base,
      title: 'Permissions approuvées',
      source: 'permissionTicket.approved',
      path: '/presences/permissions',
      notes: [
        'Classement limité aux cinq premiers employés ; nombre de permissions approuvées dont le départ est dans le mois sélectionné, heure du Congo. Ce nombre n’est pas une durée d’absence.',
      ],
      rows: rows.map((r, n) =>
        row(r.employeeId, n, undefined, r._count.id, 'permissions'),
      ),
    };
  }
  if (i.tool === 'leave_departures' || i.tool === 'leave_returns') {
    const leaves = await tx.leave.findMany({
      where: {
        companyId,
        employee: { companyId },
        status: 'APPROVED',
        ...(i.tool === 'leave_departures'
          ? { startDate: { gte: start, lt: end } }
          : {
              OR: [
                { actualReturnDate: { gte: start, lt: end } },
                {
                  returnConfirmed: false,
                  endDate: {
                    gte: new Date(start.getTime() - 60 * 86400000),
                    lt: end,
                  },
                },
              ],
            }),
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 101,
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        daysCount: true,
        actualReturnDate: true,
        returnConfirmed: true,
      },
    });
    if (leaves.length > 100) return null;
    const rows: NonNullable<ToolCard['rows']> = [];
    const workDays = await getCompanyWorkDays(tx as any, companyId),
      holidays = await tx.publicHoliday.findMany({
        where: { companyId, year: { in: [i.year - 1, i.year, i.year + 1] } },
        select: { date: true },
      }),
      holidaySet = new Set(holidays.map((h) => h.date));
    for (const l of leaves) {
      let d = l.startDate,
        kind = 'Départ approuvé';
      if (i.tool === 'leave_returns') {
        if (l.returnConfirmed && l.actualReturnDate) {
          d = l.actualReturnDate;
          kind = 'Retour confirmé';
        } else {
          d = new Date(
            nextWorkingDay(l.endDate, workDays, holidaySet) + 'T00:00:00Z',
          );
          kind = 'Retour prévu';
        }
      }
      if (d >= start && d < end)
        rows.push({
          ...row(
            l.employeeId,
            rows.length,
            kind + ' · ' + d.toISOString().slice(0, 10),
          ),
          path: '/conges/' + l.id,
        });
    }
    return {
      ...base,
      title:
        i.tool === 'leave_departures' ? 'Départs en congé' : 'Retours de congé',
      source: 'leave.approved+workingDays.nextWorkingDay',
      path: '/conges',
      notes: [
        'Congés approuvés uniquement. Un retour prévu n’est pas une présence confirmée.',
      ],
      rows,
    };
  }
  if (i.tool === 'leave_planning') {
    // Suggestion de planning calculée par des règles simples (voir leave-planner.ts) : le modèle
    // d'IA ne voit ni soldes ni dates, seulement des repères ; aucune demande de congé n'est créée.
    const LIMIT = 60;
    const all = await tx.employee.findMany({
      where: { companyId, status: 'ACTIVE', hireDate: { lt: end } },
      orderBy: [{ hireDate: 'asc' }, { id: 'asc' }],
      take: 301,
      select: { id: true, departmentId: true, hireDate: true },
    });
    if (all.length > 300) return null;
    const considered = all.slice(0, LIMIT);
    const indemnity = new LeavesIndemnityService(tx as any);
    Object.defineProperty(indemnity, 'logger', { value: quiet });
    const balance = new LeavesBalanceService(
      tx as any,
      new Proxy(
        {},
        {
          get: () => () => {
            throw Error('Side effect forbidden');
          },
        },
      ) as any,
      indemnity,
    );
    Object.defineProperty(balance, 'logger', { value: quiet });
    const remainingBy = new Map<string, number>();
    let unavailable = 0;
    for (const e of considered) {
      try {
        if (!(await balance.getLeaveEligibility(e.id)).eligible) continue;
        const r = await balance.getTotalLeaveBalanceSummary(e.id);
        const rem = Number(r.annualRemaining);
        if (Number.isFinite(rem)) remainingBy.set(e.id, rem);
        else unavailable++;
      } catch {
        unavailable++;
      }
    }
    const horizon = new Date(end.getTime() + 45 * 86400000),
      back60 = new Date(start.getTime() - 60 * 86400000);
    const [leaves, workDays, holidays, deptCounts] = await Promise.all([
      tx.leave.findMany({
        where: {
          companyId,
          employee: { companyId },
          status: 'APPROVED',
          startDate: { lt: horizon },
          endDate: { gte: back60 },
        },
        select: {
          employeeId: true,
          startDate: true,
          endDate: true,
          employee: { select: { departmentId: true } },
        },
      }),
      getCompanyWorkDays(tx as any, companyId),
      tx.publicHoliday.findMany({
        where: { companyId, year: { in: [i.year - 1, i.year, i.year + 1] } },
        select: { date: true },
      }),
      tx.employee.groupBy({
        by: ['departmentId'],
        where: { companyId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    const lastReturn = new Map<string, Date>();
    for (const l of leaves) {
      if (l.endDate < start) {
        const back = new Date(l.endDate.getTime() + 86400000),
          prev = lastReturn.get(l.employeeId);
        if (!prev || back > prev) lastReturn.set(l.employeeId, back);
      }
    }
    const plan = planLeaves({
      periodStart: start,
      periodEnd: end,
      employees: considered
        .filter((e) => remainingBy.has(e.id))
        .map((e) => ({
          id: e.id,
          departmentId: e.departmentId,
          hireDate: e.hireDate,
          remaining: remainingBy.get(e.id)!,
          lastReturn: lastReturn.get(e.id) ?? null,
        })),
      leaves: leaves.map((l) => ({
        employeeId: l.employeeId,
        departmentId: l.employee.departmentId,
        start: l.startDate,
        end: l.endDate,
      })),
      workDays,
      holidays: new Set(holidays.map((h) => String(h.date))),
      deptSize: new Map(deptCounts.map((d) => [d.departmentId, d._count._all])),
    });
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const notes = [
      'Suggestion indicative, calculée par des règles simples : priorité aux soldes les plus élevés puis à l’ancienneté, au plus 25 % d’un même département absent en même temps, jamais plus de 10 jours ouvrés d’affilée, hors jours fériés. Aucune demande de congé n’est créée : la décision reste à la direction selon l’activité.',
    ];
    if (all.length > LIMIT)
      notes.push('Analyse limitée aux ' + LIMIT + ' employés les plus anciens.');
    if (unavailable)
      notes.push(
        unavailable +
          ' employé(s) ignoré(s) : solde indisponible, ouvrez leur dossier de congé pour l’actualiser.',
      );
    return {
      ...base,
      title: 'Planning de congés proposé',
      source: 'leave.approved+leavesBalance.summary',
      path: '/conges/planning',
      notes,
      metrics: [
        { label: 'Employés actifs', value: all.length },
        { label: 'Éligibles à un congé', value: plan.eligible },
        { label: 'Déjà en congé sur la période', value: plan.alreadyOnLeave },
        { label: 'Revenus récemment', value: plan.recentlyBack },
        { label: 'Solde insuffisant', value: plan.lowBalance },
        { label: 'Propositions de congé', value: plan.proposals.length },
      ],
      rows: plan.proposals.map((p, n) => ({
        ...row(
          p.employeeId,
          n,
          'Du ' +
            iso(p.start) +
            ' au ' +
            iso(p.end) +
            ' · solde ' +
            p.remaining +
            ' j · ancienneté ' +
            p.seniorityYears +
            ' an(s)',
          p.workingDays,
          'jours ouvrés',
        ),
        path: '/conges/planning',
      })),
    };
  }
  if (i.tool === 'leave_balance' || i.tool === 'leave_allowance') {
    if (!i.employeeId) return null;
    const indemnity = new LeavesIndemnityService(tx as any);
    Object.defineProperty(indemnity, 'logger', { value: quiet });
    const balance = new LeavesBalanceService(
      tx as any,
      new Proxy(
        {},
        {
          get: () => () => {
            throw Error('Side effect forbidden');
          },
        },
      ) as any,
      indemnity,
    );
    Object.defineProperty(balance, 'logger', { value: quiet });
    if (!(await balance.getLeaveEligibility(i.employeeId)).eligible)
      return null;
    if (i.tool === 'leave_balance') {
      const result = await balance.getTotalLeaveBalanceSummary(i.employeeId);
      return {
        ...base,
        period: congoDateString(),
        title: 'Solde de congé actuel',
        source: 'leavesBalance.getTotalLeaveBalanceSummary',
        path: '/conges',
        notes: [
          'Lecture du moteur de solde courant. Si une mise à jour de cycle ou un débit est nécessaire, cette analyse est refusée ; ouvrez le dossier de congé pour l’actualiser.',
        ],
        rows: [row(i.employeeId, 0)],
        metrics: [
          {
            label: 'Jours acquis',
            value: result.annualEntitled,
            unit: 'jours',
          },
          { label: 'Jours pris', value: result.annualTaken, unit: 'jours' },
          {
            label: 'Jours restants',
            value: result.annualRemaining,
            unit: 'jours',
          },
        ],
      };
    }
    if (!i.days || i.days < 0.5 || i.days > 366) return null;
    const result = await indemnity.calculateLeaveIndemnity(
      i.employeeId,
      i.days,
      companyId,
      i.month,
      i.year,
      undefined,
      { estimateCurrentMonth: false },
    );
    if (
      !Number.isFinite(result.indemnity) ||
      !Number.isFinite(result.basedOnAverage)
    )
      return null;
    return {
      ...base,
      title: 'Allocation de congé — aperçu du moteur',
      source: 'leavesIndemnity.calculateLeaveIndemnity',
      path: '/conges',
      rows: [row(i.employeeId, 0)],
      notes: [
        'Aperçu du moteur existant pour le nombre de jours saisi ; aucun paiement ni bulletin n’est créé. À confirmer dans le dossier de congé. Méthode : ' +
          result.method +
          '.',
      ],
      metrics: [
        { label: 'Jours demandés', value: i.days, unit: 'jours' },
        { label: 'Allocation calculée', value: result.indemnity, unit: 'FCFA' },
        {
          label: 'Base de référence du moteur',
          value: result.basedOnAverage,
          unit: 'FCFA',
        },
        { label: 'Mois utilisés', value: result.monthsUsed },
      ],
    };
  }
  return null;
}