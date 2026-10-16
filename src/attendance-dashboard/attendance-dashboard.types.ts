// ============================================================================
// 📁 src/attendance-dashboard/attendance-dashboard.types.ts
// Types partagés : calcul (écran + Excel) et réponse JSON du dashboard
// Présences · Absences · Permissions.
// ============================================================================

import { WfPeriod, WfScope } from '../workforce-dashboard/workforce-dashboard.types';

/** Un employé concerné par la période (ligne "à plat"). */
export interface AdEmployee {
  id: string;
  companyId: string;
  companyName: string;
  matricule: string;
  fullName: string; // "NOM Prénom"
  department: string;
  position: string;
}

/** Synthèse mensuelle de présence d'un employé (table attendance_summaries). */
export interface AdSummaryRow {
  employeeId: string;
  month: number;
  year: number;
  key: string; // "2026-10"
  present: number;
  remote: number;
  leave: number;
  absPaid: number;
  absUnpaid: number;
  holiday: number;
  offDay: number;
  late: number;
}

export interface AdAbsence {
  id: string;
  employeeId: string;
  type: string; // MALADIE | CONVENTIONNELLE | EXCEPTIONNELLE
  typeLabel: string;
  subTypeLabel: string; // "" si aucun
  paid: boolean;
  reason: string;
  start: Date;
  end: Date;
  workingDays: number;
  status: string; // PENDING | APPROVED | REJECTED | CANCELLED
  statusLabel: string;
  monthKey: string; // mois de début
}

export interface AdPermission {
  id: string;
  employeeId: string;
  type: string; // URGENCE | MISSION | AUTRE
  typeLabel: string;
  missionLabel: string; // "" si pas une mission
  destination: string;
  reason: string;
  departure: Date; // sortie effective si corrigée, sinon autorisée
  expectedReturn: Date;
  actualReturn: Date | null; // retour VALIDÉ uniquement
  status: string; // PENDING | APPROVED | REJECTED | CANCELLED
  statusLabel: string;
  returnStatus: string; // NOT_RETURNED | PENDING_VALIDATION | CONFIRMED
  returnLabel: string;
  durationHours: number | null; // null tant que le retour n'est pas validé
  lateMinutes: number; // retard de retour (0 si à l'heure ou pas validé)
  monthKey: string; // mois de la sortie
}

export interface AttendanceDashboardData {
  scope: WfScope;
  period: WfPeriod;
  employees: AdEmployee[];
  summaries: AdSummaryRow[];
  absences: AdAbsence[];
  permissions: AdPermission[];
  warnings: string[];
  generatedAt: Date;
}

// ─── Réponse JSON (écran) ───────────────────────────────────────────────────

export interface AdCount {
  label: string;
  count: number;
  days?: number;
}

export interface AdTotals {
  present: number;
  remote: number;
  late: number;
  leave: number;
  absPaid: number;
  absUnpaid: number;
  holiday: number;
  offDay: number;
  workedDays: number; // present + remote + late
  absenceDays: number; // payée + non payée
  theoreticalDays: number; // workedDays + absenceDays
  absentEmployees: number; // salariés avec ≥ 1 jour d'absence sur la période
  presenceRate: number; // 0..1
  absenteeismRate: number; // 0..1
  lateRate: number; // retards / jours travaillés
  remoteRate: number; // télétravail / jours travaillés
  avgAbsenceDuration: number; // jours par salarié absent
}

export interface AdDepartmentRow {
  label: string;
  headcount: number;
  workedDays: number;
  absenceDays: number;
  lateDays: number;
  presenceRate: number;
  absenteeismRate: number;
}

export interface AdTopEmployee {
  id: string;
  fullName: string;
  department: string;
  companyName: string;
  value: number; // jours d'absence | nombre de permissions
  extra: number; // retards | heures de permission
}

export interface AdMonthPoint {
  month: number;
  year: number;
  label: string;
  short: string;
  key: string;
  hasAttendance: boolean;
  workedDays: number;
  absenceDays: number;
  lateDays: number;
  presenceRate: number;
  absenteeismRate: number;
  absenceRequests: number;
  permissions: number;
}

export interface AdAbsenceStats {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  cancelled: number;
  approvedDays: number;
  paidDays: number;
  unpaidDays: number;
  byType: AdCount[]; // demandes approuvées
  bySubType: AdCount[];
  byStatus: AdCount[];
}

export interface AdPermissionStats {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  cancelled: number;
  totalHours: number; // retours validés
  avgHours: number;
  lateReturns: number;
  notReturned: number; // approuvées dont le retour n'est pas validé
  byType: AdCount[];
  byMission: AdCount[];
  byStatus: AdCount[];
}

export interface AttendanceDashboardView {
  companyName: string;
  city: string;
  multi: boolean;
  companies: { id: string; name: string }[];
  warnings: string[];
  period: { mode: string; label: string; months: { month: number; year: number; label: string; short: string }[] };
  headcount: number;
  totals: AdTotals;
  absences: AdAbsenceStats;
  permissions: AdPermissionStats;
  departments: AdDepartmentRow[];
  topAbsent: AdTopEmployee[];
  topPermissions: AdTopEmployee[];
  evolution: AdMonthPoint[];
}
