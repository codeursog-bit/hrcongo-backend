// ============================================================================
// 📁 src/leaves/leaves.constants.ts
// 🇨🇬 CONSTANTES LÉGALES — CONGO BRAZZAVILLE
// Code du travail Loi n°45-75 du 15 mars 1975
// ✅ Extrait de l'ancien leaves.service.ts monolithique (découpage Phase 7)
//    pour être partagé par LeavesService, LeavesBalanceService,
//    LeavesIndemnityService et LeavesDocumentsService sans duplication.
// ============================================================================

export const CONGO_LEAVE = {
  ANNUAL_DAYS: 26,
  MONTHLY_RATE: 26 / 12,
  MIN_MONTHS_BEFORE_LEAVE: 12,
  MAX_CUMUL_YEARS: 3,
  MAX_CUMUL_DAYS: 26 * 3,
  MATERNITY_MIN_WEEKS: 15,
  MATERNITY_MIN_DAYS: 15 * 7,
  PATERNITY_DAYS: 3,
  WORK_DAYS_PER_MONTH: 26,
  ALERT_THRESHOLD_WARNING: 0.75,
  ALERT_THRESHOLD_CRITICAL: 0.9,
} as const;

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