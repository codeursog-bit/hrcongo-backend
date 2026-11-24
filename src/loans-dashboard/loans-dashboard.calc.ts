// ============================================================================
// 📁 src/loans-dashboard/loans-dashboard.calc.ts
// Calculs purs (aucun accès base) : UNE seule source pour l'écran et l'Excel.
// ============================================================================

import {
  LdCount, LdDepartmentRow, LdEmployee, LdMonthPoint, LdTopEmployee, LdTotals, LoansDashboardData,
} from './loans-dashboard.types';

export const LOAN_STATUS_LABEL: Record<string, string> = {
  PENDING: 'En attente DRH', PENDING_DG: 'En attente DG', ACTIVE: 'En cours', PAID: 'Soldé', REJECTED: 'Refusé', CANCELLED: 'Annulé',
};
export const ADVANCE_STATUS_LABEL: Record<string, string> = {
  PENDING: 'En attente', APPROVED: 'À récupérer', DEDUCTED: 'Déduite', PAID: 'Soldée', REJECTED: 'Refusée', CANCELLED: 'Annulée',
};
export const LOAN_STATUS_ORDER = ['PENDING', 'PENDING_DG', 'ACTIVE', 'PAID', 'REJECTED', 'CANCELLED'];
export const ADVANCE_STATUS_ORDER = ['PENDING', 'APPROVED', 'DEDUCTED', 'PAID', 'REJECTED', 'CANCELLED'];
export const NATURE_LABEL: Record<string, string> = {
  SOCIAL: 'Social', SCOLARITE: 'Scolarité', LOGEMENT: 'Logement', EXCEPTIONNEL: 'Exceptionnel', AUTRE: 'Autre',
};
export const NATURE_ORDER = ['Social', 'Scolarité', 'Logement', 'Exceptionnel', 'Autre', 'Non précisée'];
export const TYPE_LABEL: Record<string, string> = { ARGENT: 'Argent', MARCHANDISE: 'Marchandise', AUTRE: 'Autre' };
export const TYPE_ORDER = ['Argent', 'Marchandise', 'Autre'];
export const METHOD_LABEL: Record<string, string> = { PAYROLL: 'Retenue sur paie', CASH: 'Espèces' };
export const METHOD_ORDER = ['Retenue sur paie', 'Espèces'];

export const GRANTED_LOAN = ['ACTIVE', 'PAID'];
export const GRANTED_ADVANCE = ['APPROVED', 'DEDUCTED', 'PAID'];

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
export const keyOf = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/**
 * Montant déjà remboursé — MÊME règle que le module Prêts & avances
 * (loans-requests.service › getAlreadyRepaid) pour que l'écran, l'Excel et le module
 * ne divergent jamais. Un solde stocké à 0 sur une avance « à récupérer » est une ancienne
 * ligne (colonne ajoutée avec défaut 0) : on ne s'y fie pas, on prend le journal.
 */
export function repaidOf(status: string, amount: number, storedRemaining: number, logsSum: number): number {
  if (['PENDING', 'PENDING_DG', 'REJECTED', 'CANCELLED'].includes(status)) return 0;
  const fromBalance = storedRemaining > 0 || ['PAID', 'DEDUCTED'].includes(status) ? Math.max(0, amount - storedRemaining) : 0;
  return round2(Math.min(amount, Math.max(logsSum, fromBalance)));
}

const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
const rate = (num: number, den: number) => (den > 0 ? num / den : 0);

function group<T>(xs: T[], label: (x: T) => string, amount: (x: T) => number, order: string[]): LdCount[] {
  const m = new Map<string, { count: number; amount: number }>();
  for (const o of order) m.set(o, { count: 0, amount: 0 });
  for (const x of xs) {
    const k = label(x);
    const v = m.get(k) ?? { count: 0, amount: 0 };
    v.count++; v.amount += amount(x);
    m.set(k, v);
  }
  return [...m.entries()].map(([l, v]) => ({ label: l, count: v.count, amount: round2(v.amount) }));
}

export function totalsOf(data: LoansDashboardData): LdTotals {
  const { loans, advances, repayments, stock } = data;
  const gl = loans.filter((l) => l.granted);
  const ga = advances.filter((a) => a.granted);
  const loansGrantedAmount = sum(gl.map((l) => l.amount));
  const advancesGrantedAmount = sum(ga.map((a) => a.amount));
  const grantedAmount = round2(loansGrantedAmount + advancesGrantedAmount);
  const recoveredAmount = round2(sum(gl.map((l) => l.repaid)) + sum(ga.map((a) => a.repaid)));
  const borrowers = new Set([...gl.map((l) => l.employeeId), ...ga.map((a) => a.employeeId)]).size;
  const nGranted = gl.length + ga.length;

  const lRejected = loans.filter((l) => l.status === 'REJECTED').length;
  const aRejected = advances.filter((a) => a.status === 'REJECTED').length;

  const outLoans = sum(stock.filter((s) => s.kind === 'LOAN').map((s) => s.outstanding));
  const outAdv = sum(stock.filter((s) => s.kind === 'ADVANCE').map((s) => s.outstanding));

  return {
    loansRequested: loans.length,
    loansGranted: gl.length,
    loansGrantedAmount,
    loansPending: loans.filter((l) => l.status === 'PENDING' || l.status === 'PENDING_DG').length,
    loansRejected: lRejected,
    loanAcceptanceRate: rate(gl.length, gl.length + lRejected),
    advancesRequested: advances.length,
    advancesGranted: ga.length,
    advancesGrantedAmount,
    advancesPending: advances.filter((a) => a.status === 'PENDING').length,
    advancesRejected: aRejected,
    advanceAcceptanceRate: rate(ga.length, ga.length + aRejected),
    grantedAmount,
    borrowers,
    avgGrantedAmount: nGranted > 0 ? round2(grantedAmount / nGranted) : 0,
    recoveredAmount,
    recoveryRate: rate(recoveredAmount, grantedAmount),
    repaidInPeriod: sum(repayments.map((r) => r.amount)),
    repaidPayroll: sum(repayments.filter((r) => r.method === 'PAYROLL').map((r) => r.amount)),
    repaidCash: sum(repayments.filter((r) => r.method === 'CASH').map((r) => r.amount)),
    outstandingLoans: outLoans,
    outstandingAdvances: outAdv,
    outstandingTotal: round2(outLoans + outAdv),
    indebtedEmployees: new Set(stock.filter((s) => s.outstanding > 0).map((s) => s.employeeId)).size,
    loansInProgress: stock.filter((s) => s.kind === 'LOAN' && s.outstanding > 0).length,
    advancesToRecover: stock.filter((s) => s.kind === 'ADVANCE' && s.outstanding > 0).length,
  };
}

export const loansByStatus = (d: LoansDashboardData) =>
  group(d.loans, (l) => l.statusLabel, (l) => l.amount, LOAN_STATUS_ORDER.map((s) => LOAN_STATUS_LABEL[s]));
export const advancesByStatus = (d: LoansDashboardData) =>
  group(d.advances, (a) => a.statusLabel, (a) => a.amount, ADVANCE_STATUS_ORDER.map((s) => ADVANCE_STATUS_LABEL[s]));
export const loansByNature = (d: LoansDashboardData) =>
  group(d.loans.filter((l) => l.granted), (l) => l.natureLabel, (l) => l.amount, NATURE_ORDER);
export const loansByType = (d: LoansDashboardData) =>
  group(d.loans.filter((l) => l.granted), (l) => l.typeLabel, (l) => l.amount, TYPE_ORDER);
export const repaymentsByMethod = (d: LoansDashboardData) =>
  group(d.repayments, (r) => r.methodLabel, (r) => r.amount, METHOD_ORDER);

/** Encours par employé (prêts + avances), à ce jour. */
function stockByEmployee(d: LoansDashboardData) {
  const m = new Map<string, { loans: number; advances: number }>();
  for (const s of d.stock) {
    if (s.outstanding <= 0) continue;
    const v = m.get(s.employeeId) ?? { loans: 0, advances: 0 };
    if (s.kind === 'LOAN') v.loans += s.outstanding; else v.advances += s.outstanding;
    m.set(s.employeeId, v);
  }
  return m;
}

export function stockRows(d: LoansDashboardData): { emp: LdEmployee; loans: number; advances: number }[] {
  const idx = new Map(d.employees.map((e) => [e.id, e]));
  return [...stockByEmployee(d).entries()]
    .map(([id, v]) => ({ emp: idx.get(id), loans: round2(v.loans), advances: round2(v.advances) }))
    .filter((x): x is { emp: LdEmployee; loans: number; advances: number } => !!x.emp)
    .sort((a, b) => b.loans + b.advances - (a.loans + a.advances) || a.emp.fullName.localeCompare(b.emp.fullName));
}

export function departmentRows(d: LoansDashboardData): LdDepartmentRow[] {
  const acc = new Map<string, LdDepartmentRow>();
  for (const r of stockRows(d)) {
    const k = r.emp.department;
    const v = acc.get(k) ?? { label: k, indebted: 0, outstandingLoans: 0, outstandingAdvances: 0, outstandingTotal: 0 };
    v.indebted++; v.outstandingLoans += r.loans; v.outstandingAdvances += r.advances;
    acc.set(k, v);
  }
  return [...acc.values()]
    .map((v) => ({ ...v, outstandingLoans: round2(v.outstandingLoans), outstandingAdvances: round2(v.outstandingAdvances), outstandingTotal: round2(v.outstandingLoans + v.outstandingAdvances) }))
    .sort((a, b) => b.outstandingTotal - a.outstandingTotal || a.label.localeCompare(b.label));
}

export function topIndebted(d: LoansDashboardData, n = 10): LdTopEmployee[] {
  return stockRows(d).slice(0, n).map((r) => ({
    id: r.emp.id, fullName: r.emp.fullName, department: r.emp.department, companyName: r.emp.companyName,
    value: round2(r.loans + r.advances), extra: r.loans,
  }));
}

export function evolution(d: LoansDashboardData): LdMonthPoint[] {
  return d.period.months.map((m) => {
    const l = d.loans.filter((x) => x.granted && x.monthKey === m.key);
    const a = d.advances.filter((x) => x.granted && x.monthKey === m.key);
    return {
      month: m.month, year: m.year, label: m.label, short: m.short, key: m.key,
      loansGrantedAmount: sum(l.map((x) => x.amount)),
      advancesGrantedAmount: sum(a.map((x) => x.amount)),
      repaidAmount: sum(d.repayments.filter((r) => r.monthKey === m.key).map((r) => r.amount)),
      loansGranted: l.length,
      advancesGranted: a.length,
    };
  });
}