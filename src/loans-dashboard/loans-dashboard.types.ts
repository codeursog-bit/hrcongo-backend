// ============================================================================
// 📁 src/loans-dashboard/loans-dashboard.types.ts
// Types partagés : calcul (écran + Excel) et réponse JSON du dashboard
// Prêts · Avances · Remboursements · Encours.
// ============================================================================

import { WfPeriod, WfScope } from '../workforce-dashboard/workforce-dashboard.types';

/** Un salarié concerné (au moins un prêt, une avance ou un remboursement). */
export interface LdEmployee {
  id: string;
  companyId: string;
  companyName: string;
  matricule: string;
  fullName: string; // "NOM Prénom"
  department: string;
}

export interface LdLoan {
  id: string;
  employeeId: string;
  nature: string; // SOCIAL | SCOLARITE | LOGEMENT | EXCEPTIONNEL | AUTRE | ''
  natureLabel: string; // "Non précisée" si absente
  type: string; // ARGENT | MARCHANDISE | AUTRE
  typeLabel: string;
  status: string; // PENDING | PENDING_DG | ACTIVE | PAID | REJECTED | CANCELLED
  statusLabel: string;
  granted: boolean; // ACTIVE ou PAID
  amount: number;
  monthlyRepayment: number;
  repaid: number; // montant déjà remboursé (même règle que le module Prêts)
  outstanding: number; // reste dû (uniquement si le prêt est en cours)
  start: Date;
  end: Date;
  monthKey: string; // mois de début du prêt
  reason: string;
}

export interface LdAdvance {
  id: string;
  employeeId: string;
  status: string; // PENDING | APPROVED | DEDUCTED | PAID | REJECTED | CANCELLED
  statusLabel: string;
  granted: boolean; // APPROVED, DEDUCTED ou PAID
  amount: number;
  repaid: number;
  outstanding: number; // reste dû (uniquement si l'avance est « à récupérer »)
  monthKey: string; // mois de la demande
  deductKey: string; // mois de déduction prévu
  viaPayroll: boolean;
  reason: string;
}

export interface LdRepayment {
  kind: 'LOAN' | 'ADVANCE';
  kindLabel: string; // Prêt | Avance
  employeeId: string;
  monthKey: string;
  method: string; // PAYROLL | CASH
  methodLabel: string;
  amount: number;
}

/** Dette en cours À CE JOUR (indépendante de la période choisie). */
export interface LdStockItem {
  kind: 'LOAN' | 'ADVANCE';
  employeeId: string;
  outstanding: number;
}

export interface LoansDashboardData {
  scope: WfScope;
  period: WfPeriod;
  employees: LdEmployee[];
  loans: LdLoan[];
  advances: LdAdvance[];
  repayments: LdRepayment[];
  stock: LdStockItem[];
  warnings: string[];
  generatedAt: Date;
}

// ─── Réponse JSON (écran) ───────────────────────────────────────────────────

export interface LdCount {
  label: string;
  count: number;
  amount: number;
}

export interface LdTotals {
  // Prêts de la période (rattachés au mois de début)
  loansRequested: number;
  loansGranted: number;
  loansGrantedAmount: number;
  loansPending: number;
  loansRejected: number;
  loanAcceptanceRate: number; // accordés / (accordés + refusés)
  // Avances de la période (rattachées au mois de la demande)
  advancesRequested: number;
  advancesGranted: number;
  advancesGrantedAmount: number;
  advancesPending: number;
  advancesRejected: number;
  advanceAcceptanceRate: number;
  // Ensemble
  grantedAmount: number;
  borrowers: number; // salariés ayant obtenu un prêt ou une avance sur la période
  avgGrantedAmount: number;
  recoveredAmount: number; // déjà remboursé, sur ce qui a été accordé sur la période
  recoveryRate: number; // recoveredAmount / grantedAmount
  // Remboursements encaissés pendant la période (journal des remboursements)
  repaidInPeriod: number;
  repaidPayroll: number;
  repaidCash: number;
  // Dettes en cours à ce jour
  outstandingLoans: number;
  outstandingAdvances: number;
  outstandingTotal: number;
  indebtedEmployees: number;
  loansInProgress: number;
  advancesToRecover: number;
}

export interface LdDepartmentRow {
  label: string;
  indebted: number;
  outstandingLoans: number;
  outstandingAdvances: number;
  outstandingTotal: number;
}

export interface LdTopEmployee {
  id: string;
  fullName: string;
  department: string;
  companyName: string;
  value: number; // encours total
  extra: number; // dont prêts
}

export interface LdMonthPoint {
  month: number;
  year: number;
  label: string;
  short: string;
  key: string;
  loansGrantedAmount: number;
  advancesGrantedAmount: number;
  repaidAmount: number;
  loansGranted: number;
  advancesGranted: number;
}

export interface LoansDashboardView {
  companyName: string;
  city: string;
  multi: boolean;
  companies: { id: string; name: string }[];
  warnings: string[];
  period: { mode: string; label: string; months: { month: number; year: number; label: string; short: string }[] };
  totals: LdTotals;
  loansByStatus: LdCount[];
  loansByNature: LdCount[]; // prêts accordés
  loansByType: LdCount[]; // prêts accordés
  advancesByStatus: LdCount[];
  repaymentsByMethod: LdCount[];
  departments: LdDepartmentRow[];
  topIndebted: LdTopEmployee[];
  evolution: LdMonthPoint[];
}