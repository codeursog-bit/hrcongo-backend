import { legalNow } from '../legal-parameters/legal-parameters.core';
// ============================================================================
// 📁 src/leaves/leaves.constants.ts
// 🇨🇬 CONSTANTES LÉGALES — CONGO BRAZZAVILLE
// Code du travail Loi n°45-75 du 15 mars 1975
// ✅ Extrait de l'ancien leaves.service.ts monolithique (découpage Phase 7)
//    pour être partagé par LeavesService, LeavesBalanceService,
//    LeavesIndemnityService et LeavesDocumentsService sans duplication.
// ============================================================================

// ✅ Les règles LÉGALES de congé (jours/an, cumul max, ancienneté minimale) sont
// pilotées par le super administrateur (référentiel légal, valeurs par défaut =
// Code du travail : 26 j, 3 ans, 12 mois). Ce sont des accesseurs : tous les
// appels existants (CONGO_LEAVE.ANNUAL_DAYS…) lisent donc la valeur en vigueur
// aujourd'hui, sans changer le code appelant.
// Les congés supplémentaires d'ancienneté des conventions collectives restent
// gérés par la convention (non concernés).
export const CONGO_LEAVE = {
  get ANNUAL_DAYS(): number {
    return legalNow().leave.annualDays;
  },
  get MONTHLY_RATE(): number {
    return legalNow().leave.annualDays / 12;
  },
  get MIN_MONTHS_BEFORE_LEAVE(): number {
    return legalNow().leave.minMonthsBeforeLeave;
  },
  get MAX_CUMUL_YEARS(): number {
    return legalNow().leave.maxCumulYears;
  },
  get MAX_CUMUL_DAYS(): number {
    const l = legalNow().leave;
    return l.annualDays * l.maxCumulYears;
  },
  MATERNITY_MIN_WEEKS: 15,
  MATERNITY_MIN_DAYS: 15 * 7,
  PATERNITY_DAYS: 3,
  // Convention de paie (jours ouvrables du mois pour le taux journalier) : inchangé.
  WORK_DAYS_PER_MONTH: 26,
  ALERT_THRESHOLD_WARNING: 0.75,
  ALERT_THRESHOLD_CRITICAL: 0.9,
};

export interface LeaveImpactForPayroll {
  employeeId: string;
  month: number;
  year: number;
  leaveDays: number;
  leaveType: string;
  isPaid: boolean;
  leaveIndemnity: number;
  leaveIndemnityBase?: number;
  leaveIndemnitySeniority?: number;
  absenceDeduction: number;
  transportProrata: number | null;
  shouldClearOpeningCumulative?: boolean;
  indemnifiedDays?: number;
  indemnifiedSeniorityDays?: number;
  // 🆕 Mode ANNIVERSARY — id du Leave ANNUAL dont CE bulletin paie
  // l'indemnité (= payrollAnchoredLeave.id), pour que le générateur de
  // paie puisse y écrire paidIndemnityAmount une fois le montant final
  // connu (voir payroll-generator.service.ts). undefined si aucun congé
  // ANNUAL n'est payé sur ce bulletin.
  leaveId?: string;
}

export interface LeaveProvisionResult {
  totalProvision: number;
  currency: string;
  details: Array<{
    employeeId: string;
    employeeName: string;
    remainingDays: number;
    dailyRate: number;
    provision: number;
    alertLevel: 'OK' | 'WARNING' | 'CRITICAL';
    // ✅ Nouvelle base de l'alerte : depuis combien de temps (années) cet
    // employé n'est parti sur AUCUN congé annuel, comparé au plafond légal
    // de cumul (CONGO_LEAVE.MAX_CUMUL_YEARS, 3 ans) — pas le plafond d'un
    // seul cycle (26j + ancienneté), qui n'a pas de sens ici.
    yearsWithoutLeave: number;
    maxCumulYears: number;
  }>;
}