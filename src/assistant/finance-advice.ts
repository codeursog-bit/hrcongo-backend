/**
 * Lecture des données (lecture seule) pour le conseil sur les prêts et les avances.
 *
 * Reçoit un client Prisma déjà protégé (transaction READ ONLY + readOnlyClient). Le verdict vient
 * de `adviseFinance` (règles pures), jamais du modèle d'IA. Deux usages :
 *  - une demande EN ATTENTE (identifiant fourni, ou dernière demande en attente de l'employé) ;
 *  - une SIMULATION (montant saisi dans le formulaire de création), sans rien enregistrer.
 */
import { Prisma } from '@prisma/client';
import {
  adviseFinance,
  financeFindingText,
  FINANCE_VERDICT_TEXT,
  type FinanceInput,
} from './finance-advisor';
import type { AdviceCard } from './request-advice';
import { loadOpinionFindings, opinionFindingText, withOpinions } from './opinion-context';

type Tx = Prisma.TransactionClient;
const MONTH_MS = 30.4375 * 86400000;
const n = (v: unknown) => Number(v ?? 0);
const monthsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / MONTH_MS;

export interface FinanceTarget {
  kind: 'LOAN' | 'ADVANCE';
  employeeId: string;
  /** Sans identifiant ni simulation : dernière demande en attente de l'employé. */
  requestId?: string;
  /** Simulation : aucune demande n'existe encore. */
  simulation?: {
    amount: number;
    monthlyRepayment?: number;
    durationMonths?: number;
    deductMonthsAhead?: number;
  };
}

export async function buildFinanceAdvice(
  tx: Tx,
  companyId: string,
  t: FinanceTarget,
  now = new Date(),
) {
  const employee = await tx.employee.findFirst({
    where: { id: t.employeeId, companyId },
    select: {
      id: true,
      baseSalary: true,
      hireDate: true,
      contractEndDate: true,
      terminationDate: true,
      trialStatus: true,
    },
  });
  if (!employee) return null;

  // ---- La demande (ou la simulation) ---------------------------------------------------------
  let amount: number;
  let monthlyRepayment: number | undefined;
  let durationMonths: number | undefined;
  let deductMonthsAhead: number | undefined;
  let requestId: string | undefined;
  let period: string;
  const ym = now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (t.simulation) {
    amount = t.simulation.amount;
    monthlyRepayment = t.simulation.monthlyRepayment;
    durationMonths = t.simulation.durationMonths;
    deductMonthsAhead = t.simulation.deductMonthsAhead;
    period = 'Simulation avant enregistrement';
  } else if (t.kind === 'LOAN') {
    const l = await tx.loan.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'PENDING_DG'] },
        employee: { companyId },
        ...(t.requestId ? { id: t.requestId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, amount: true, monthlyRepayment: true, startDate: true, endDate: true },
    });
    if (!l) return null;
    requestId = l.id;
    amount = n(l.amount);
    monthlyRepayment = n(l.monthlyRepayment);
    durationMonths = Math.max(1, Math.round(monthsBetween(l.startDate, l.endDate)));
    period = 'Demande de prêt en attente';
  } else {
    const a = await tx.advance.findFirst({
      where: {
        employeeId: employee.id,
        status: 'PENDING',
        employee: { companyId },
        ...(t.requestId ? { id: t.requestId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, amount: true, deductMonth: true, deductYear: true },
    });
    if (!a) return null;
    requestId = a.id;
    amount = n(a.amount);
    deductMonthsAhead = Math.max(0, a.deductYear * 12 + (a.deductMonth - 1) - ym);
    period = 'Demande d’avance en attente';
  }
  if (!(amount > 0)) return null;

  // ---- Situation financière de l'employé -------------------------------------------------------
  const exclude = requestId ? { id: { not: requestId } } : {};
  const since12 = new Date(now.getTime() - 365 * 86400000);
  const since6 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const [activeLoans, borrowed, advances] = await Promise.all([
    tx.loan.findMany({
      where: { employeeId: employee.id, status: 'ACTIVE', ...(t.kind === 'LOAN' ? exclude : {}) },
      select: {
        amount: true,
        monthlyRepayment: true,
        remainingBalance: true,
        startDate: true,
        endDate: true,
      },
      take: 50,
    }),
    tx.loan.aggregate({
      where: {
        employeeId: employee.id,
        status: { in: ['ACTIVE', 'PAID'] },
        createdAt: { gte: since12 },
        ...(t.kind === 'LOAN' ? exclude : {}),
      },
      _sum: { amount: true },
    }),
    tx.advance.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ['APPROVED', 'PAID', 'DEDUCTED'] },
        createdAt: { gte: since6 },
        ...(t.kind === 'ADVANCE' ? exclude : {}),
      },
      select: { status: true, deducted: true, remainingBalance: true, month: true, year: true },
      take: 100,
    }),
  ]);

  let neverRepaid = 0;
  let arrears = 0;
  for (const l of activeLoans) {
    const elapsed = Math.max(0, Math.floor(monthsBetween(l.startDate, now)));
    const total = Math.max(1, Math.round(monthsBetween(l.startDate, l.endDate)));
    const monthly = n(l.monthlyRepayment);
    if (elapsed >= 1 && n(l.remainingBalance) >= n(l.amount)) neverRepaid++;
    if (monthly > 0) {
      const paid = (n(l.amount) - n(l.remainingBalance)) / monthly;
      arrears += Math.max(0, Math.floor(Math.min(elapsed, total) - paid));
    }
  }
  const open = advances.filter((a) => a.status === 'APPROVED' && !a.deducted && n(a.remainingBalance) > 0);
  const hasAdvanceIn = (offset: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return advances.some((a) => a.year === d.getUTCFullYear() && a.month === d.getUTCMonth() + 1);
  };

  const end = [employee.contractEndDate, employee.terminationDate]
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

  const input: FinanceInput = {
    kind: t.kind,
    amount,
    monthlyRepayment,
    durationMonths,
    deductMonthsAhead,
    monthElapsedShare: now.getUTCDate() / daysInMonth,
    baseSalary: n(employee.baseSalary) || null,
    tenureMonths: monthsBetween(employee.hireDate, now),
    trialInProgress: employee.trialStatus === 'IN_PROGRESS',
    monthsToContractEnd: end ? monthsBetween(now, end) : null,
    loans: {
      activeCount: activeLoans.length,
      remainingFcfa: activeLoans.reduce((s, l) => s + n(l.remainingBalance), 0),
      monthlyFcfa: activeLoans.reduce((s, l) => s + n(l.monthlyRepayment), 0),
      neverRepaidCount: neverRepaid,
      arrearsMonths: arrears,
      borrowed12mFcfa: n(borrowed._sum.amount),
    },
    advances: {
      openCount: open.length,
      openFcfa: open.reduce((s, a) => s + n(a.remainingBalance), 0),
      last6mCount: advances.length,
      threeMonthsInARow: hasAdvanceIn(0) && hasAdvanceIn(1) && hasAdvanceIn(2),
    },
  };

  const result = adviseFinance(input);
  // Avis du circuit de validation (comptable, RH, DG…) quand il est activé pour ce type de demande.
  const opinions = await loadOpinionFindings(tx, companyId, t.kind, requestId);
  const merged = withOpinions(result.verdict, result.findings, opinions, 'CLEAR_FINANCE');
  const advice: AdviceCard = {
    kind: t.kind,
    verdict: merged.verdict,
    findings: merged.findings,
    alternative: null,
  };
  const notes = [
    FINANCE_VERDICT_TEXT[merged.verdict] + '.',
    ...merged.findings
      .map((f) => (f.code.startsWith('OPINIONS_') ? opinionFindingText(f) : financeFindingText(f)))
      .filter((x): x is string => !!x),
    'Avis indicatif calculé à partir des prêts, avances et du contrat déjà enregistrés. La décision reste à l’administrateur.',
  ];

  return {
    title: t.kind === 'LOAN' ? 'Conseil sur la demande de prêt' : 'Conseil sur la demande d’avance',
    period,
    source: 'requestAdvice.' + t.kind.toLowerCase(),
    path: '/loans',
    notes,
    advice,
    metrics: [
      { label: 'Prêts en cours', value: activeLoans.length, unit: 'prêt(s)' },
      { label: 'Avances non retenues', value: open.length, unit: 'avance(s)' },
    ],
    rows: [{ employeeId: employee.id, label: 'Employé 1', path: '/employes/' + employee.id }],
    requestId,
  };
}