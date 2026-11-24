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
  // 🆕 absences justifiées (demande validée) / non justifiées + détail par motif
  absJustified?: number;
  absUnjustified?: number;
  justifiedDetail?: Record<string, number>; // « TYPE|SOUS-TYPE|P|U » → jours
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

/** Demande de congé (table leaves) — rattachée au mois de début. */
export interface AdLeave {
  id: string;
  employeeId: string;
  type: string; // ANNUAL | ANNUAL_ANTICIPATED | COMPENSATORY | SICK | MATERNITY | PATERNITY | UNPAID
  typeLabel: string;
  status: string; // PENDING | APPROVED | REJECTED | CANCELLED
  statusLabel: string;
  start: Date;
  end: Date;
  days: number; // jours de congé de la demande (daysCount)
  reason: string;
  monthKey: string; // mois de début
}

export interface AttendanceDashboardData {
  scope: WfScope;
  period: WfPeriod;
  employees: AdEmployee[];
  summaries: AdSummaryRow[];
  absences: AdAbsence[];
  permissions: AdPermission[];
  leaves: AdLeave[];
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
  absJustified: number; // 🆕 dont justifiées (demande d'absence validée)
  absUnjustified: number; // 🆕 dont non justifiées
  theoreticalDays: number; // workedDays + absenceDays
  absentEmployees: number; // salariés avec ≥ 1 jour d'absence sur la période
  presenceRate: number; // 0..1
  absenteeismRate: number; // 0..1
  lateRate: number; // retards / jours travaillés
  remoteRate: number; // télétravail / jours travaillés
  avgAbsenceDuration: number; // jours par salarié absent
  leaveRate: number; // jours de congé / (jours à travailler + jours de congé)
  leaveEmployees: number; // salariés avec ≥ 1 jour de congé sur la période
}

/** 🆕 Un motif d'absence justifiée (ex. Mariage — Exceptionnelle). */
export interface AdAbsenceMotif {
  key: string;
  label: string; // Mariage, Décès, Maladie…
  typeLabel: string; // Exceptionnelle, Conventionnelle, Maladie, Sans demande
  days: number;
  paidDays: number;
  unpaidDays: number;
  employees: number;
}

/** 🆕 Absences justifiées / non justifiées sur la période. */
export interface AdAbsenceBreakdown {
  total: number;
  justified: number;
  unjustified: number;
  justifiedEmployees: number;
  unjustifiedEmployees: number;
  motifs: AdAbsenceMotif[]; // triés par nombre de jours décroissant
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
  leaveDays: number; // jours de congé du mois (synthèses de présence)
  leaveRequests: number; // congés approuvés commençant ce mois
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

export interface AdLeaveStats {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  cancelled: number;
  approvedDays: number; // jours des congés approuvés
  byType: AdCount[]; // congés approuvés (count = demandes, days = jours)
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
  leaves: AdLeaveStats;
  departments: AdDepartmentRow[];
  topAbsent: AdTopEmployee[];
  topLate: AdTopEmployee[]; // 🆕 salariés les plus en retard
  absenceBreakdown: AdAbsenceBreakdown; // 🆕 absences justifiées / non justifiées, par motif
  topPermissions: AdTopEmployee[];
  topLeave: AdTopEmployee[];
  evolution: AdMonthPoint[];
}