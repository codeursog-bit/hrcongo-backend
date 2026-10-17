// ============================================================================
// 📁 src/attendance-dashboard/attendance-dashboard.calc.ts
// Règles de calcul PURES (aucun accès base) — une seule source pour l'écran
// et pour les valeurs en cache de l'Excel.
//
// Définitions (période = somme des mois choisis) :
//   jours travaillés   = présent + télétravail + retard   (un retard est un jour présent)
//   jours à travailler = jours travaillés + absences (payées + non payées)
//   absentéisme        = jours d'absence / jours à travailler
//   présence           = jours travaillés / jours à travailler
//   retards            = jours en retard / jours travaillés
// Congés, jours fériés et repos ne comptent ni comme présence ni comme absence.
//   part des congés    = jours de congé / (jours à travailler + jours de congé)
// ============================================================================

import {
  AdAbsenceBreakdown, AdAbsenceMotif, AdAbsence, AdAbsenceStats, AdCount, AdDepartmentRow, AdEmployee, AdLeave, AdLeaveStats, AdMonthPoint, AdPermission, AdPermissionStats,
  AdSummaryRow, AdTopEmployee, AdTotals, AttendanceDashboardData,
} from './attendance-dashboard.types';

export const ABSENCE_TYPE_LABEL: Record<string, string> = {
  MALADIE: 'Maladie', CONVENTIONNELLE: 'Conventionnelle', EXCEPTIONNELLE: 'Exceptionnelle',
};
export const ABSENCE_SUBTYPE_LABEL: Record<string, string> = {
  MALADIE: 'Maladie', MATERNITE: 'Maternité', PATERNITE: 'Paternité', MARIAGE: 'Mariage', DECES: 'Décès',
  NAISSANCE: 'Naissance', RETRAIT_DEUIL: 'Retrait de deuil', DEMENAGEMENT: 'Déménagement', AUTRE: 'Autre',
};
export const PERMISSION_TYPE_LABEL: Record<string, string> = { URGENCE: 'Urgence', MISSION: 'Mission', AUTRE: 'Autre' };
export const MISSION_LABEL: Record<string, string> = {
  PROSPECTION_CLIENT: 'Prospection client', RECOUVREMENT: 'Recouvrement', SAV: 'SAV',
  REPARATION_EXTERNE: 'Réparation externe', AUTRE: 'Autre',
};
export const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: 'Annuel', ANNUAL_ANTICIPATED: 'Annuel anticipé', COMPENSATORY: 'Compensatoire', SICK: 'Maladie',
  MATERNITY: 'Maternité', PATERNITY: 'Paternité', UNPAID: 'Sans solde',
};
export const LEAVE_TYPE_ORDER = ['Annuel', 'Annuel anticipé', 'Compensatoire', 'Maladie', 'Maternité', 'Paternité', 'Sans solde'];
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'En attente', APPROVED: 'Approuvée', REJECTED: 'Refusée', CANCELLED: 'Annulée',
};
export const RETURN_LABEL: Record<string, string> = {
  NOT_RETURNED: 'Pas revenu', PENDING_VALIDATION: 'Retour à valider', CONFIRMED: 'Retour validé',
};

const STATUS_ORDER = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
export const round2 = (n: number) => Math.round(n * 100) / 100;

const tally = (labels: string[], empty = 'Non renseigné'): AdCount[] => {
  const m = new Map<string, number>();
  for (const l of labels) m.set(l || empty, (m.get(l || empty) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

// ─────────────────────────────── Présences ────────────────────────────────────

/** Part justifiée / non justifiée d'une ligne (rétro-compatible : sans détail, tout est « non justifié »). */
export const splitAbs = (r: AdSummaryRow) => {
  const total = r.absPaid + r.absUnpaid;
  const j = Math.min(total, r.absJustified ?? 0);
  return { j, u: r.absUnjustified ?? total - j };
};

export function totalsOf(rows: AdSummaryRow[]): AdTotals {
  const t = { present: 0, remote: 0, late: 0, leave: 0, absPaid: 0, absUnpaid: 0, holiday: 0, offDay: 0, absJustified: 0, absUnjustified: 0 };
  const absentEmp = new Set<string>();
  const leaveEmp = new Set<string>();
  for (const r of rows) {
    t.present += r.present; t.remote += r.remote; t.late += r.late; t.leave += r.leave;
    t.absPaid += r.absPaid; t.absUnpaid += r.absUnpaid; t.holiday += r.holiday; t.offDay += r.offDay;
    const sp = splitAbs(r); t.absJustified += sp.j; t.absUnjustified += sp.u;
    if (r.absPaid + r.absUnpaid > 0) absentEmp.add(r.employeeId);
    if (r.leave > 0) leaveEmp.add(r.employeeId);
  }
  const workedDays = t.present + t.remote + t.late;
  const absenceDays = t.absPaid + t.absUnpaid;
  const theoreticalDays = workedDays + absenceDays;
  return {
    ...t, workedDays, absenceDays, theoreticalDays,
    absentEmployees: absentEmp.size,
    presenceRate: theoreticalDays > 0 ? workedDays / theoreticalDays : 0,
    absenteeismRate: theoreticalDays > 0 ? absenceDays / theoreticalDays : 0,
    lateRate: workedDays > 0 ? t.late / workedDays : 0,
    remoteRate: workedDays > 0 ? t.remote / workedDays : 0,
    avgAbsenceDuration: absentEmp.size > 0 ? absenceDays / absentEmp.size : 0,
    leaveRate: theoreticalDays + t.leave > 0 ? t.leave / (theoreticalDays + t.leave) : 0,
    leaveEmployees: leaveEmp.size,
  };
}

/** Libellé d'un motif d'absence justifiée à partir de « TYPE|SOUS-TYPE ». */
export function motifLabels(type: string, subType: string): { label: string; typeLabel: string } {
  if (type === 'MANUEL') return { label: 'Autorisée (saisie RH)', typeLabel: 'Sans demande' };
  const typeLabel = ABSENCE_TYPE_LABEL[type] ?? type;
  const label = subType ? ABSENCE_SUBTYPE_LABEL[subType] ?? subType : typeLabel;
  return { label, typeLabel };
}

/**
 * 🆕 Absences JUSTIFIÉES (couvertes par une demande d'absence validée : maladie, mariage, décès,
 * naissance, conventionnelle, exceptionnelle…) et NON justifiées, avec le détail par motif.
 */
export function absenceBreakdown(rows: AdSummaryRow[]): AdAbsenceBreakdown {
  let justified = 0, unjustified = 0;
  const jEmp = new Set<string>(), uEmp = new Set<string>();
  const acc = new Map<string, { type: string; sub: string; paid: number; unpaid: number; emps: Set<string> }>();
  for (const r of rows) {
    const sp = splitAbs(r);
    justified += sp.j; unjustified += sp.u;
    if (sp.j > 0) jEmp.add(r.employeeId);
    if (sp.u > 0) uEmp.add(r.employeeId);
    for (const [k, days] of Object.entries(r.justifiedDetail ?? {})) {
      const [type, sub = '', pay = 'U'] = k.split('|');
      const mk = `${type}|${sub}`;
      const m = acc.get(mk) ?? { type, sub, paid: 0, unpaid: 0, emps: new Set<string>() };
      if (pay === 'P') m.paid += days; else m.unpaid += days;
      m.emps.add(r.employeeId);
      acc.set(mk, m);
    }
  }
  const motifs: AdAbsenceMotif[] = [...acc.entries()]
    .map(([key, m]) => ({ key, ...motifLabels(m.type, m.sub), days: m.paid + m.unpaid, paidDays: m.paid, unpaidDays: m.unpaid, employees: m.emps.size }))
    .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label));
  return { total: justified + unjustified, justified, unjustified, justifiedEmployees: jEmp.size, unjustifiedEmployees: uEmp.size, motifs };
}

export function departmentRows(employees: AdEmployee[], rows: AdSummaryRow[]): AdDepartmentRow[] {
  const dep = new Map(employees.map((e) => [e.id, e.department]));
  const heads = new Map<string, Set<string>>();
  const acc = new Map<string, { worked: number; abs: number; late: number }>();
  for (const e of employees) {
    (heads.get(e.department) ?? heads.set(e.department, new Set()).get(e.department)!).add(e.id);
  }
  for (const r of rows) {
    const d = dep.get(r.employeeId);
    if (!d) continue;
    const a = acc.get(d) ?? { worked: 0, abs: 0, late: 0 };
    a.worked += r.present + r.remote + r.late;
    a.abs += r.absPaid + r.absUnpaid;
    a.late += r.late;
    acc.set(d, a);
  }
  return [...heads.entries()]
    .map(([label, set]) => {
      const a = acc.get(label) ?? { worked: 0, abs: 0, late: 0 };
      const theo = a.worked + a.abs;
      return {
        label, headcount: set.size, workedDays: a.worked, absenceDays: a.abs, lateDays: a.late,
        presenceRate: theo > 0 ? a.worked / theo : 0,
        absenteeismRate: theo > 0 ? a.abs / theo : 0,
      };
    })
    .sort((a, b) => b.absenteeismRate - a.absenteeismRate || b.headcount - a.headcount || a.label.localeCompare(b.label));
}

// ─────────────────────────────── Absences ─────────────────────────────────────

export function absenceStats(list: AdAbsence[]): AdAbsenceStats {
  const ok = list.filter((a) => a.status === 'APPROVED');
  const days = (xs: AdAbsence[]) => round2(xs.reduce((s, a) => s + a.workingDays, 0));
  const group = (xs: AdAbsence[], key: (a: AdAbsence) => string): AdCount[] => {
    const m = new Map<string, { count: number; days: number }>();
    for (const a of xs) {
      const k = key(a) || 'Non précisé';
      const v = m.get(k) ?? { count: 0, days: 0 };
      v.count++; v.days += a.workingDays;
      m.set(k, v);
    }
    return [...m.entries()].map(([label, v]) => ({ label, count: v.count, days: round2(v.days) })).sort((a, b) => b.count - a.count);
  };
  return {
    total: list.length,
    approved: ok.length,
    pending: list.filter((a) => a.status === 'PENDING').length,
    rejected: list.filter((a) => a.status === 'REJECTED').length,
    cancelled: list.filter((a) => a.status === 'CANCELLED').length,
    approvedDays: days(ok),
    paidDays: days(ok.filter((a) => a.paid)),
    unpaidDays: days(ok.filter((a) => !a.paid)),
    byType: group(ok, (a) => a.typeLabel),
    bySubType: group(ok.filter((a) => a.subTypeLabel), (a) => a.subTypeLabel),
    byStatus: STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], count: list.filter((a) => a.status === s).length })),
  };
}

// ────────────────────────────── Permissions ───────────────────────────────────

export function permissionStats(list: AdPermission[]): AdPermissionStats {
  const done = list.filter((p) => p.status === 'APPROVED' && p.durationHours !== null);
  const totalHours = done.reduce((s, p) => s + (p.durationHours as number), 0);
  const approved = list.filter((p) => p.status === 'APPROVED');
  return {
    total: list.length,
    approved: approved.length,
    pending: list.filter((p) => p.status === 'PENDING').length,
    rejected: list.filter((p) => p.status === 'REJECTED').length,
    cancelled: list.filter((p) => p.status === 'CANCELLED').length,
    totalHours: round2(totalHours),
    avgHours: done.length ? round2(totalHours / done.length) : 0,
    lateReturns: approved.filter((p) => p.lateMinutes > 0).length,
    notReturned: approved.filter((p) => p.returnStatus !== 'CONFIRMED').length,
    byType: tally(approved.map((p) => p.typeLabel)),
    byMission: tally(approved.filter((p) => p.type === 'MISSION').map((p) => p.missionLabel), 'Non précisée'),
    byStatus: STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], count: list.filter((p) => p.status === s).length })),
  };
}

// ───────────────────────────────── Congés ─────────────────────────────────────

export function leaveStats(list: AdLeave[]): AdLeaveStats {
  const ok = list.filter((l) => l.status === 'APPROVED');
  const byType = new Map<string, { count: number; days: number }>();
  for (const l of ok) {
    const v = byType.get(l.typeLabel) ?? { count: 0, days: 0 };
    v.count++; v.days += l.days;
    byType.set(l.typeLabel, v);
  }
  return {
    total: list.length,
    approved: ok.length,
    pending: list.filter((l) => l.status === 'PENDING').length,
    rejected: list.filter((l) => l.status === 'REJECTED').length,
    cancelled: list.filter((l) => l.status === 'CANCELLED').length,
    approvedDays: round2(ok.reduce((s, l) => s + l.days, 0)),
    byType: [...byType.entries()].map(([label, v]) => ({ label, count: v.count, days: round2(v.days) })).sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    byStatus: STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], count: list.filter((l) => l.status === s).length })),
  };
}

// ───────────────────────────── Évolution / tops ───────────────────────────────

export function evolution(data: AttendanceDashboardData): AdMonthPoint[] {
  return data.period.months.map((m) => {
    const rows = data.summaries.filter((r) => r.key === m.key);
    const t = totalsOf(rows);
    return {
      month: m.month, year: m.year, label: m.label, short: m.short, key: m.key,
      hasAttendance: rows.length > 0,
      workedDays: t.workedDays, absenceDays: t.absenceDays, lateDays: t.late,
      presenceRate: t.presenceRate, absenteeismRate: t.absenteeismRate,
      absenceRequests: data.absences.filter((a) => a.status === 'APPROVED' && a.monthKey === m.key).length,
      permissions: data.permissions.filter((p) => p.status === 'APPROVED' && p.monthKey === m.key).length,
      leaveDays: t.leave,
      leaveRequests: data.leaves.filter((l) => l.status === 'APPROVED' && l.monthKey === m.key).length,
    };
  });
}

export function topAbsent(data: AttendanceDashboardData, n = 10): AdTopEmployee[] {
  const byEmp = new Map<string, { abs: number; late: number }>();
  for (const r of data.summaries) {
    const v = byEmp.get(r.employeeId) ?? { abs: 0, late: 0 };
    v.abs += r.absPaid + r.absUnpaid; v.late += r.late;
    byEmp.set(r.employeeId, v);
  }
  const idx = new Map(data.employees.map((e) => [e.id, e]));
  return [...byEmp.entries()]
    .filter(([, v]) => v.abs > 0)
    .map(([id, v]) => ({ e: idx.get(id), v }))
    .filter((x): x is { e: AdEmployee; v: { abs: number; late: number } } => !!x.e)
    .sort((a, b) => b.v.abs - a.v.abs || a.e.fullName.localeCompare(b.e.fullName))
    .slice(0, n)
    .map(({ e, v }) => ({ id: e.id, fullName: e.fullName, department: e.department, companyName: e.companyName, value: v.abs, extra: v.late }));
}

/**
 * 🆕 Salariés les plus en retard (jours de retard sur la période).
 * value = nombre de jours en retard ; extra = taux de retard en % (retards / jours travaillés).
 * Un retard est un jour travaillé : un salarié très souvent en retard mais jamais absent y apparaît.
 */
export function topLate(data: AttendanceDashboardData, n = 10): AdTopEmployee[] {
  const byEmp = new Map<string, { late: number; worked: number }>();
  for (const r of data.summaries) {
    const v = byEmp.get(r.employeeId) ?? { late: 0, worked: 0 };
    v.late += r.late;
    v.worked += r.present + r.remote + r.late;
    byEmp.set(r.employeeId, v);
  }
  const idx = new Map(data.employees.map((e) => [e.id, e]));
  const rate = (v: { late: number; worked: number }) => (v.worked > 0 ? v.late / v.worked : 0);
  return [...byEmp.entries()]
    .filter(([, v]) => v.late > 0)
    .map(([id, v]) => ({ e: idx.get(id), v }))
    .filter((x): x is { e: AdEmployee; v: { late: number; worked: number } } => !!x.e)
    .sort((a, b) => b.v.late - a.v.late || rate(b.v) - rate(a.v) || a.e.fullName.localeCompare(b.e.fullName))
    .slice(0, n)
    .map(({ e, v }) => ({ id: e.id, fullName: e.fullName, department: e.department, companyName: e.companyName, value: v.late, extra: round2(rate(v) * 100) }));
}

export function topPermissions(data: AttendanceDashboardData, n = 10): AdTopEmployee[] {
  const byEmp = new Map<string, { count: number; hours: number }>();
  for (const p of data.permissions) {
    if (p.status !== 'APPROVED') continue;
    const v = byEmp.get(p.employeeId) ?? { count: 0, hours: 0 };
    v.count++; v.hours += p.durationHours ?? 0;
    byEmp.set(p.employeeId, v);
  }
  const idx = new Map(data.employees.map((e) => [e.id, e]));
  return [...byEmp.entries()]
    .map(([id, v]) => ({ e: idx.get(id), v }))
    .filter((x): x is { e: AdEmployee; v: { count: number; hours: number } } => !!x.e)
    .sort((a, b) => b.v.count - a.v.count || b.v.hours - a.v.hours)
    .slice(0, n)
    .map(({ e, v }) => ({ id: e.id, fullName: e.fullName, department: e.department, companyName: e.companyName, value: v.count, extra: round2(v.hours) }));
}

/** Salariés ayant le plus de jours de congé (synthèses de présence) ; extra = nombre de congés approuvés. */
export function topLeave(data: AttendanceDashboardData, n = 10): AdTopEmployee[] {
  const days = new Map<string, number>();
  for (const r of data.summaries) if (r.leave > 0) days.set(r.employeeId, (days.get(r.employeeId) ?? 0) + r.leave);
  const reqs = new Map<string, number>();
  for (const l of data.leaves) if (l.status === 'APPROVED') reqs.set(l.employeeId, (reqs.get(l.employeeId) ?? 0) + 1);
  const idx = new Map(data.employees.map((e) => [e.id, e]));
  return [...days.entries()]
    .map(([id, d]) => ({ e: idx.get(id), d }))
    .filter((x): x is { e: AdEmployee; d: number } => !!x.e)
    .sort((a, b) => b.d - a.d || a.e.fullName.localeCompare(b.e.fullName))
    .slice(0, n)
    .map(({ e, d }) => ({ id: e.id, fullName: e.fullName, department: e.department, companyName: e.companyName, value: d, extra: reqs.get(e.id) ?? 0 }));
}