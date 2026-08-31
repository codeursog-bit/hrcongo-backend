// ============================================================================
// 📁 src/absence-tracking/absence-tracking.service.ts
// ✅ Service dédié, LECTURE SEULE — n'écrit jamais dans Leave / AbsenceRequest.
//    Objectif : donner au front tout ce qu'il faut pour comprendre, d'un
//    coup d'œil, POURQUOI il y a eu des absences sur une période donnée —
//    par motif précis (maladie, maternité, paternité, mariage, décès,
//    naissance, non justifiée), par employé, par département — et POUR
//    QUAND (dates exactes) et PAYÉ OU NON, sans dupliquer la logique métier
//    déjà présente dans LeavesService / AbsenceRequestsService.
//
// 🔧 REFONTE — le congé annuel/anticipé (droit acquis après 12 mois) reste
//    affiché pour le contexte mais N'ENTRE PLUS dans le taux d'absentéisme
//    ni dans les alertes RH. Le suivi fin porte sur : Conventionnelle
//    (maladie/maternité/paternité), Exceptionnelle (mariage/décès/
//    naissance) et Non justifiée.
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { calculateWorkingDays } from '../common/working-days.util';
// ✅ Réutilise EXACTEMENT la même notion de "jour ouvré" que la page
//    Présences (DailyView / attendance-calculation.service), pour que les
//    deux modules soient toujours d'accord sur qui est absent aujourd'hui.
import {
  AttendanceUtilsService,
  DEFAULT_WORK_DAYS,
} from '../attendance/services/attendance-utils.service';
import {
  ABSENCE_CODES,
  ALERT_THRESHOLDS,
  FAMILY_LABELS,
  resolveLeaveEntry,
  resolveAbsenceRequestCode,
  ATTENDANCE_STATUS_TO_CODE,
  PRESENCE_STATUS_TO_CODE,
  getCodeDef,
  AbsenceScope,
  AbsenceFamily,
  sourceAllowedForScope,
} from './absence-tracking.constants';

interface UnifiedEntry {
  employeeId: string;
  code: string;
  family: AbsenceFamily;
  trackable: boolean;
  subLabel?: string; // détail du sous-motif — conservé pour compat front, désormais redondant avec code
  date: string; // yyyy-mm-dd
  source: 'LEAVE' | 'ABSENCE_REQUEST' | 'ATTENDANCE';
  sourceId: string; // identifiant de l'épisode (Leave.id / AbsenceRequest.id) — sert à compter des ÉPISODES, pas des jours
}

export interface YearResult {
  year: number;
  employeeCount: number;
  totalDays: number;
  trackableDays: number;
  avgDaysPerEmployee: number;
  byType: Record<string, number>;
  byFamily: Record<string, number>;
  byDepartment: Record<string, number>;
}

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

@Injectable()
export class AbsenceTrackingService {
  constructor(
    private prisma: PrismaService,
    private utils: AttendanceUtilsService,
  ) {}

  // --------------------------------------------------------------------
  // 🔒 Scope entreprise
  // --------------------------------------------------------------------
  private async getCompanyId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new Error('Entreprise introuvable pour cet utilisateur');
    return user.companyId;
  }

  private monthBounds(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0)); // dernier jour du mois
    return { start, end, daysInMonth: end.getUTCDate() };
  }

  private yearBounds(year: number) {
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) };
  }

  private addDays(d: Date, days: number): Date {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + days);
    return r;
  }

  /** Découpe un intervalle [startDate, endDate] en jours individuels, bornés à [rangeStart, rangeEnd]. */
  private expandToDays(startDate: Date, endDate: Date, rangeStart: Date, rangeEnd: Date): string[] {
    const from = startDate < rangeStart ? rangeStart : startDate;
    const to = endDate > rangeEnd ? rangeEnd : endDate;
    const days: string[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    while (cursor <= last) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  /**
   * Récupère et unifie Leave + AbsenceRequest (statut APPROVED) + Attendance
   * (statut ABSENT_UNPAID) sur une période donnée. `scope` restreint la
   * source (ex: 'leave' pour la page "congés uniquement").
   */
  private async getUnifiedEntries(
    companyId: string,
    rangeStart: Date,
    rangeEnd: Date,
    scope: AbsenceScope = 'all',
  ): Promise<UnifiedEntry[]> {
    const rangeStartStr = rangeStart.toISOString().slice(0, 10);
    const rangeEndStr = rangeEnd.toISOString().slice(0, 10);

    const wantLeave = sourceAllowedForScope('LEAVE', scope);
    const wantAbsenceRequest = sourceAllowedForScope('ABSENCE_REQUEST', scope);
    const wantAttendance = sourceAllowedForScope('ATTENDANCE', scope);
    // ABSENT_UNPAID n'est JAMAIS écrit en base (aucun cron ne le fait — la
    // page Présences le calcule à la volée, comme ici). On a donc besoin de
    // tous les pointages réels dès que wantAttendance (pour l'inférer) OU
    // wantLeave (pour détecter le "congé payé travaillé").
    const needAttendanceRows = wantAttendance || wantLeave;
    // ✅ Même si le scope n'affiche pas les congés (ex: scope="absence_request"),
    // il faut quand même savoir qui est en congé approuvé aujourd'hui pour NE
    // PAS le compter par erreur comme "absent non justifié" — sinon un
    // employé en congé annuel apparaîtrait comme absent injustifié dès que
    // le scope masque les congés.
    const needLeaveRows = wantLeave || wantAttendance;

    const years: number[] = [];
    for (let y = rangeStart.getFullYear(); y <= rangeEnd.getFullYear(); y++) years.push(y);

    const [leaves, absenceRequests, attendanceRows, activeEmployees, payrollSettings, publicHolidays] = await Promise.all([
      needLeaveRows ? this.prisma.leave.findMany({
        where: {
          status: 'APPROVED',
          employee: { companyId },
          startDate: { lte: rangeEnd },
          endDate: { gte: rangeStart },
        },
        select: { id: true, employeeId: true, type: true, startDate: true, endDate: true },
      }) : Promise.resolve([]),
      wantAbsenceRequest ? this.prisma.absenceRequest.findMany({
        where: {
          status: 'APPROVED',
          employee: { companyId },
          startDate: { lte: rangeEnd },
          endDate: { gte: rangeStart },
        },
        select: { id: true, employeeId: true, type: true, subType: true, isPaid: true, startDate: true, endDate: true },
      }) : Promise.resolve([]),
      // ✅ TOUS les statuts (pas seulement PRESENT/REMOTE/LATE) : dès qu'une
      // ligne existe pour un employé/jour donné, ce jour n'est PAS à
      // inférer comme absent — quel que soit son statut exact.
      needAttendanceRows ? this.prisma.attendance.findMany({
        where: {
          employee: { companyId },
          date: { gte: rangeStartStr, lte: rangeEndStr },
        },
        select: { employeeId: true, date: true, status: true },
      }) : Promise.resolve([] as { employeeId: string; date: string; status: string }[]),
      wantAttendance ? this.prisma.employee.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: { id: true },
      }) : Promise.resolve([]),
      wantAttendance ? this.prisma.payrollSettings.findFirst({
        where: { companyId },
        orderBy: { effectiveDate: 'desc' },
        select: { workDays: true },
      }) : Promise.resolve(null),
      wantAttendance ? this.prisma.publicHoliday.findMany({
        where: { companyId, year: { in: years } },
        select: { date: true },
      }) : Promise.resolve([]),
    ]);

    const workedDaySet = new Set(
      attendanceRows
        .filter((a) => ['PRESENT', 'REMOTE', 'LATE'].includes(a.status as string))
        .map((a) => `${a.employeeId}_${a.date}`),
    );
    const recordedDaySet = new Set(attendanceRows.map((a) => `${a.employeeId}_${a.date}`));
    const holidaySet = new Set(publicHolidays.map((h) => this.utils.formatDate(h.date)));
    const workDays = ((payrollSettings?.workDays as number[] | undefined) ?? DEFAULT_WORK_DAYS);

    const entries: UnifiedEntry[] = [];
    // Jours couverts par un congé approuvé — utilisé pour exclure ces jours
    // de l'inférence ABSENT_UNPAID plus bas, MÊME quand wantLeave est faux
    // (le congé ne doit jamais se traduire par une fausse absence injustifiée).
    const approvedLeaveDaySet = new Set<string>();

    for (const l of leaves) {
      const { code: baseCode } = resolveLeaveEntry(l.type);
      for (const date of this.expandToDays(l.startDate, l.endDate, rangeStart, rangeEnd)) {
        approvedLeaveDaySet.add(`${l.employeeId}_${date}`);
        if (!wantLeave) continue; // fetché uniquement pour l'exclusion ci-dessus, pas affiché dans ce scope
        // ✅ Congé payé travaillé : congé annuel/anticipé approuvé ce jour-là,
        // MAIS un pointage réel existe (le salarié est venu travailler au
        // lieu de se reposer) — on recode CP/CA en CPT pour ce jour précis
        // uniquement. Le reste de la période de congé garde son code normal.
        const isWorkedInstead = (baseCode === 'CP' || baseCode === 'CA') && workedDaySet.has(`${l.employeeId}_${date}`);
        const code = isWorkedInstead ? 'CPT' : baseCode;
        const def = getCodeDef(code);
        entries.push({ employeeId: l.employeeId, code, family: def.family, trackable: def.trackable, date, source: 'LEAVE', sourceId: l.id });
      }
    }
    for (const a of absenceRequests) {
      // ✅ isPaid est une info du MODULE PAIE (sera payé ou non pendant son
      // absence) — ça ne change JAMAIS le fait qu'il était absent.
      const { code } = resolveAbsenceRequestCode(a.type, a.subType);
      const def = getCodeDef(code);
      for (const date of this.expandToDays(a.startDate, a.endDate, rangeStart, rangeEnd)) {
        entries.push({ employeeId: a.employeeId, code, family: def.family, trackable: def.trackable, date, source: 'ABSENCE_REQUEST', sourceId: a.id });
      }
    }

    // ✅ ABSENT_UNPAID INFÉRÉ — même règle que AttendanceUtilsService /
    // DailyView : jour ouvré, pas férié, pas de pointage réel, pas déjà
    // couvert par un congé/une demande approuvée, pas dans le futur.
    // C'est ce qui manquait : sans ça, "absents aujourd'hui" reste
    // toujours à 0 puisqu'aucune ligne ABSENT_UNPAID n'est jamais écrite
    // en base par ailleurs dans l'application.
    if (wantAttendance) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const coveredByLeaveOrRequest = new Set([
        ...approvedLeaveDaySet,
        ...entries.map((e) => `${e.employeeId}_${e.date}`),
      ]);
      const allDays = this.expandToDays(rangeStart, rangeEnd, rangeStart, rangeEnd);

      for (const emp of activeEmployees) {
        for (const day of allDays) {
          const dayDate = this.utils.createLocalDate(day);
          if (dayDate > today) continue; // jour futur — pas encore "absent"
          if (holidaySet.has(day)) continue; // férié
          if (!this.utils.isWorkingDay(dayDate, workDays)) continue; // repos hebdo
          const key = `${emp.id}_${day}`;
          if (recordedDaySet.has(key)) continue; // pointage réel ce jour-là (présent/retard/télétravail/…)
          if (coveredByLeaveOrRequest.has(key)) continue; // déjà couvert par congé/demande

          const code = ATTENDANCE_STATUS_TO_CODE['ABSENT_UNPAID'];
          const def = getCodeDef(code);
          entries.push({
            employeeId: emp.id, code, family: def.family, trackable: def.trackable,
            date: day, source: 'ATTENDANCE', sourceId: `inferred_${emp.id}_${day}`,
          });
        }
      }
    }

    return entries;
  }

  private legendForScope(scope: AbsenceScope) {
    if (scope === 'all') return Object.values(ABSENCE_CODES).filter((c) => !['PRESENT', 'REMOTE', 'LATE'].includes(c.code));
    const relevantCodes = new Set<string>(
      scope === 'leave'
        ? ['CP', 'CA', 'CPT', 'CSS', 'MAL', 'MAT', 'PAT', 'CONV_AUTRE']
        : ['MAL', 'MAT', 'PAT', 'CONV_AUTRE', 'MAR', 'DEC', 'NAI', 'EXC_AUTRE', 'ABS'],
    );
    relevantCodes.add('JF');
    return Object.values(ABSENCE_CODES).filter((c) => relevantCodes.has(c.code));
  }

  private async getActiveEmployees(companyId: string, departmentId?: string) {
    return this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE', ...(departmentId ? { departmentId } : {}) },
      select: {
        id: true, employeeNumber: true, firstName: true, lastName: true,
        departmentId: true, department: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  /** Classement générique employé -> jours, filtrable par code précis ou par famille. */
  private rankEmployees(
    entries: UnifiedEntry[],
    employeeMap: Map<string, { lastName: string; firstName: string; department?: { name: string } | null }>,
    filter: (e: UnifiedEntry) => boolean,
    limit = 20,
  ) {
    const byEmployee: Record<string, number> = {};
    for (const e of entries) {
      if (!filter(e)) continue;
      byEmployee[e.employeeId] = (byEmployee[e.employeeId] ?? 0) + 1;
    }
    return Object.entries(byEmployee)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([employeeId, days]) => {
        const emp = employeeMap.get(employeeId);
        return {
          employeeId, days,
          name: emp ? `${emp.lastName} ${emp.firstName}` : 'Inconnu',
          departmentName: emp?.department?.name ?? null,
        };
      });
  }

  /** Classement générique département -> jours, filtrable par code précis ou par famille. */
  private rankDepartments(
    entries: UnifiedEntry[],
    employeeMap: Map<string, { departmentId: string | null; department?: { id: string; name: string } | null }>,
    filter: (e: UnifiedEntry) => boolean,
  ) {
    const byDept: Record<string, { name: string; days: number }> = {};
    for (const e of entries) {
      if (!filter(e)) continue;
      const emp = employeeMap.get(e.employeeId);
      const deptId = emp?.departmentId ?? 'none';
      const deptName = emp?.department?.name ?? 'Sans service';
      if (!byDept[deptId]) byDept[deptId] = { name: deptName, days: 0 };
      byDept[deptId].days += 1;
    }
    return Object.entries(byDept)
      .map(([departmentId, v]) => ({ departmentId, ...v }))
      .sort((a, b) => b.days - a.days);
  }

  // ========================================================================
  // 1) GRILLE MENSUELLE — employé × jour, façon calendrier
  // ========================================================================
  async getMonthlyGrid(userId: string, year: number, month: number, departmentId?: string, scope: AbsenceScope = 'all') {
    const companyId = await this.getCompanyId(userId);
    const { start, end, daysInMonth } = this.monthBounds(year, month);

    const [employees, entries, holidays, presenceRows] = await Promise.all([
      this.getActiveEmployees(companyId, departmentId),
      this.getUnifiedEntries(companyId, start, end, scope),
      this.prisma.publicHoliday.findMany({ where: { companyId, year }, select: { date: true, name: true } }),
      this.prisma.attendance.findMany({
        where: {
          status: { in: ['PRESENT', 'REMOTE', 'LATE'] },
          employee: { companyId },
          date: { gte: start.toISOString().slice(0, 10), lte: end.toISOString().slice(0, 10) },
        },
        select: { employeeId: true, date: true, status: true },
      }),
    ]);

    const employeeIds = new Set(employees.map((e) => e.id));
    const cellsByEmployee: Record<string, Record<string, { code: string; label: string; colorKey: string }>> = {};
    for (const e of employees) cellsByEmployee[e.id] = {};

    for (const p of presenceRows) {
      if (!employeeIds.has(p.employeeId)) continue;
      const day = p.date.slice(8, 10);
      const code = PRESENCE_STATUS_TO_CODE[p.status];
      if (!code) continue;
      const def = getCodeDef(code);
      cellsByEmployee[p.employeeId][day] = { code: def.code, label: def.label, colorKey: def.colorKey };
    }

    for (const entry of entries) {
      if (!employeeIds.has(entry.employeeId)) continue;
      const day = entry.date.slice(8, 10);
      const def = getCodeDef(entry.code);
      cellsByEmployee[entry.employeeId][day] = { code: def.code, label: def.label, colorKey: def.colorKey };
    }

    const holidayDays = holidays
      .filter((h) => h.date.startsWith(`${year}-${String(month).padStart(2, '0')}`))
      .map((h) => ({ day: h.date.slice(8, 10), name: h.name }));

    return {
      year, month, daysInMonth,
      legend: [...this.legendForScope(scope), getCodeDef('PRESENT'), getCodeDef('REMOTE'), getCodeDef('LATE')],
      holidays: holidayDays,
      employees: employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber,
        name: `${e.lastName} ${e.firstName}`,
        departmentId: e.departmentId,
        departmentName: e.department?.name ?? null,
        cells: cellsByEmployee[e.id],
      })),
    };
  }

  // ========================================================================
  // 2) TABLEAU DE BORD — mois sélectionné
  //    Répartition fine par motif + famille, taux d'absentéisme, classements
  //    ciblés (top maladie, top exceptionnelle...) et alertes RH.
  // ========================================================================
  async getMonthlyDashboard(userId: string, year: number, month: number, scope: AbsenceScope = 'all') {
    const companyId = await this.getCompanyId(userId);
    const { start, end } = this.monthBounds(year, month);

    const [employees, entries, workingDaysInMonth] = await Promise.all([
      this.getActiveEmployees(companyId),
      this.getUnifiedEntries(companyId, start, end, scope),
      calculateWorkingDays(this.prisma, companyId, start, end),
    ]);
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const byType: Record<string, number> = {};
    const byFamily: Record<string, number> = {};
    const byDepartment: Record<string, { name: string; days: number; byFamily: Record<string, number> }> = {};
    const byEmployee: Record<string, number> = {};
    let trackableDays = 0;

    for (const entry of entries) {
      const emp = employeeMap.get(entry.employeeId);
      if (!emp) continue;
      const def = getCodeDef(entry.code);
      if (!def.countsAsAbsenceDay) continue; // JF exclu des totaux

      byType[entry.code] = (byType[entry.code] ?? 0) + 1;
      byFamily[entry.family] = (byFamily[entry.family] ?? 0) + 1;
      byEmployee[entry.employeeId] = (byEmployee[entry.employeeId] ?? 0) + 1;
      if (entry.trackable) trackableDays += 1;

      const deptId = emp.departmentId ?? 'none';
      const deptName = emp.department?.name ?? 'Sans service';
      if (!byDepartment[deptId]) byDepartment[deptId] = { name: deptName, days: 0, byFamily: {} };
      byDepartment[deptId].days += 1;
      byDepartment[deptId].byFamily[entry.family] = (byDepartment[deptId].byFamily[entry.family] ?? 0) + 1;
    }

    // Absents aujourd'hui, par code — sur la date réelle du jour
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayInRequestedMonth = todayStr.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`;
    const absentToday: Record<string, number> = {};
    for (const def of this.legendForScope(scope)) {
      if (def.countsAsAbsenceDay) absentToday[def.code] = 0;
    }
    if (todayInRequestedMonth) {
      for (const e of entries.filter((en) => en.date === todayStr)) {
        if (getCodeDef(e.code).countsAsAbsenceDay) absentToday[e.code] = (absentToday[e.code] ?? 0) + 1;
      }
    }

    // Taux d'absentéisme du mois = jours "trackable" / (jours ouvrés × effectif actif)
    // Le congé statutaire (CP/CA) est volontairement exclu : c'est un droit, pas un signal RH.
    const theoreticalDays = workingDaysInMonth * employees.length;
    const absenteeismRatePercent = theoreticalDays > 0 ? Number(((trackableDays / theoreticalDays) * 100).toFixed(2)) : 0;

    const byDepartmentWithRate = Object.entries(byDepartment).map(([departmentId, v]) => {
      const deptEmployeeCount = employees.filter((e) => (e.departmentId ?? 'none') === departmentId).length;
      const deptTheoretical = workingDaysInMonth * deptEmployeeCount;
      const deptTrackableDays = Object.entries(v.byFamily)
        .filter(([fam]) => fam !== 'CONGE_STATUTAIRE')
        .reduce((s, [, d]) => s + d, 0);
      return {
        departmentId, name: v.name, days: v.days,
        byFamily: Object.entries(v.byFamily).map(([family, days]) => ({ family, label: FAMILY_LABELS[family as AbsenceFamily], days })),
        absenteeismRatePercent: deptTheoretical > 0 ? Number(((deptTrackableDays / deptTheoretical) * 100).toFixed(2)) : 0,
      };
    }).sort((a, b) => b.days - a.days);

    const top20Month = this.rankEmployees(entries, employeeMap, (e) => getCodeDef(e.code).countsAsAbsenceDay);

    // Classements ciblés — répondent directement à "qui a le plus de X ?"
    const leaderboards = {
      maladie: this.rankEmployees(entries, employeeMap, (e) => e.code === 'MAL'),
      conventionnelle: this.rankEmployees(entries, employeeMap, (e) => e.family === 'CONVENTIONNELLE'),
      exceptionnelle: this.rankEmployees(entries, employeeMap, (e) => e.family === 'EXCEPTIONNELLE'),
      injustifiee: this.rankEmployees(entries, employeeMap, (e) => e.family === 'INJUSTIFIEE'),
    };
    const departmentLeaderboards = {
      maladie: this.rankDepartments(entries, employeeMap, (e) => e.code === 'MAL'),
      conventionnelle: this.rankDepartments(entries, employeeMap, (e) => e.family === 'CONVENTIONNELLE'),
      exceptionnelle: this.rankDepartments(entries, employeeMap, (e) => e.family === 'EXCEPTIONNELLE'),
      injustifiee: this.rankDepartments(entries, employeeMap, (e) => e.family === 'INJUSTIFIEE'),
    };

    // Alertes RH — calculées sur une fenêtre glissante de 365 jours se
    // terminant à la fin du mois consulté (ou aujourd'hui si mois en cours).
    const asOf = end < new Date() ? end : new Date();
    const alerts = await this.computeAlerts(companyId, asOf, scope);

    return {
      year, month,
      employeeCount: employees.length,
      workingDaysInMonth,
      absentToday,
      byType: Object.entries(byType).map(([code, days]) => ({ ...getCodeDef(code), days })),
      byFamily: Object.entries(byFamily).map(([family, days]) => ({ family, label: FAMILY_LABELS[family as AbsenceFamily], days })),
      byDepartment: byDepartmentWithRate,
      absenteeismRatePercent,
      top20Month,
      leaderboards,
      departmentLeaderboards,
      alerts,
    };
  }

  // ========================================================================
  // 2bis) JOURNAL DU MOIS — une ligne par épisode d'absence (pas par jour)
  // ========================================================================
  async getMonthJournal(userId: string, year: number, month: number, scope: AbsenceScope = 'all') {
    const companyId = await this.getCompanyId(userId);
    const { start, end } = this.monthBounds(year, month);

    const wantLeave = sourceAllowedForScope('LEAVE', scope);
    const wantAbsenceRequest = sourceAllowedForScope('ABSENCE_REQUEST', scope);

    const [leaves, absenceRequests, employees] = await Promise.all([
      wantLeave ? this.prisma.leave.findMany({
        where: { status: 'APPROVED', employee: { companyId }, startDate: { lte: end }, endDate: { gte: start } },
        select: { id: true, employeeId: true, type: true, startDate: true, endDate: true, daysCount: true, reason: true },
      }) : Promise.resolve([]),
      wantAbsenceRequest ? this.prisma.absenceRequest.findMany({
        where: { status: 'APPROVED', employee: { companyId }, startDate: { lte: end }, endDate: { gte: start } },
        select: { id: true, employeeId: true, type: true, subType: true, isPaid: true, startDate: true, endDate: true, reason: true },
      }) : Promise.resolve([]),
      this.getActiveEmployees(companyId),
    ]);
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const journal: any[] = [];

    for (const l of leaves) {
      const { code } = resolveLeaveEntry(l.type);
      const def = getCodeDef(code);
      const emp = employeeMap.get(l.employeeId);
      journal.push({
        employeeId: l.employeeId,
        employeeName: emp ? `${emp.lastName} ${emp.firstName}` : 'Inconnu',
        departmentName: emp?.department?.name ?? null,
        code: def.code,
        label: def.label,
        family: def.family,
        familyLabel: FAMILY_LABELS[def.family],
        trackable: def.trackable,
        startDate: l.startDate.toISOString().slice(0, 10),
        endDate: l.endDate.toISOString().slice(0, 10),
        days: Number(l.daysCount),
        paid: def.isPaidByDefault,
        reason: l.reason ?? null,
      });
    }

    for (const a of absenceRequests) {
      const { code } = resolveAbsenceRequestCode(a.type, a.subType);
      const def = getCodeDef(code);
      const emp = employeeMap.get(a.employeeId);
      const days = this.expandToDays(a.startDate, a.endDate, start, end).length;
      journal.push({
        employeeId: a.employeeId,
        employeeName: emp ? `${emp.lastName} ${emp.firstName}` : 'Inconnu',
        departmentName: emp?.department?.name ?? null,
        code: def.code,
        label: def.label,
        family: def.family,
        familyLabel: FAMILY_LABELS[def.family],
        trackable: def.trackable,
        startDate: a.startDate.toISOString().slice(0, 10),
        endDate: a.endDate.toISOString().slice(0, 10),
        days,
        // ✅ Décision réelle de la RH (champ isPaid) — l'employé reste
        // ABSENT ce jour-là quoi qu'il arrive ; ceci indique juste s'il est
        // rémunéré pendant son absence.
        paid: a.isPaid,
        reason: a.reason ?? null,
      });
    }

    journal.sort((a, b) => a.startDate.localeCompare(b.startDate));

    const byCode: Record<string, { label: string; days: number; count: number }> = {};
    for (const j of journal) {
      if (!getCodeDef(j.code).countsAsAbsenceDay) continue;
      if (!byCode[j.code]) byCode[j.code] = { label: j.label, days: 0, count: 0 };
      byCode[j.code].days += j.days;
      byCode[j.code].count += 1;
    }
    const topReasons = Object.values(byCode).sort((a, b) => b.days - a.days).slice(0, 3);
    const totalDays = Object.values(byCode).reduce((s, r) => s + r.days, 0);
    const summary = totalDays === 0
      ? 'Aucune absence ce mois-ci.'
      : `${totalDays} jour(s) d'absence, principalement : ${topReasons.map((r) => `${r.label} (${r.days} j.)`).join(', ')}.`;

    return { year, month, summary, totalDays, journal };
  }

  // ========================================================================
  // 3) VUE ANNUELLE — 12 mois, pour graphique ligne + barres empilées/famille
  // ========================================================================
  async getYearlyOverview(userId: string, year: number, scope: AbsenceScope = 'all') {
    const companyId = await this.getCompanyId(userId);
    const { start, end } = this.yearBounds(year);

    const [employees, entries] = await Promise.all([
      this.getActiveEmployees(companyId),
      this.getUnifiedEntries(companyId, start, end, scope),
    ]);
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, totalDays: 0, trackableDays: 0,
      byType: {} as Record<string, number>,
      byFamily: {} as Record<string, number>,
      byDepartment: {} as Record<string, number>,
    }));

    for (const entry of entries) {
      const def = getCodeDef(entry.code);
      if (!def.countsAsAbsenceDay) continue;
      const emp = employeeMap.get(entry.employeeId);
      const monthIdx = Number(entry.date.slice(5, 7)) - 1;
      const bucket = months[monthIdx];
      bucket.totalDays += 1;
      if (entry.trackable) bucket.trackableDays += 1;
      bucket.byType[entry.code] = (bucket.byType[entry.code] ?? 0) + 1;
      bucket.byFamily[entry.family] = (bucket.byFamily[entry.family] ?? 0) + 1;
      const deptName = emp?.department?.name ?? 'Sans service';
      bucket.byDepartment[deptName] = (bucket.byDepartment[deptName] ?? 0) + 1;
    }

    const top20Year = this.rankEmployees(entries, employeeMap, (e) => getCodeDef(e.code).countsAsAbsenceDay);
    const leaderboardsYear = {
      maladie: this.rankEmployees(entries, employeeMap, (e) => e.code === 'MAL'),
      conventionnelle: this.rankEmployees(entries, employeeMap, (e) => e.family === 'CONVENTIONNELLE'),
      exceptionnelle: this.rankEmployees(entries, employeeMap, (e) => e.family === 'EXCEPTIONNELLE'),
      injustifiee: this.rankEmployees(entries, employeeMap, (e) => e.family === 'INJUSTIFIEE'),
    };

    const monthsWithExplanation = months.map((m) => {
      const topCodes = Object.entries(m.byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([code, days]) => `${getCodeDef(code).label} (${days} j.)`);
      const explanation = m.totalDays === 0 ? 'Aucune absence.' : `Principalement : ${topCodes.join(', ')}.`;
      return { ...m, explanation };
    });

    const peakMonth = [...monthsWithExplanation].sort((a, b) => b.totalDays - a.totalDays)[0];
    const peakSummary = peakMonth && peakMonth.totalDays > 0
      ? `Le pic de l'année est en ${MONTH_NAMES[peakMonth.month - 1]} avec ${peakMonth.totalDays} jour(s) d'absence — ${peakMonth.explanation}`
      : null;

    return { year, months: monthsWithExplanation, top20Year, leaderboardsYear, peakSummary };
  }

  // ========================================================================
  // 3bis) ZOOM ANNUEL SUR UN SERVICE — répartition par code, mois par mois
  // ========================================================================
  async getYearlyDepartmentFocus(userId: string, year: number, departmentId: string, scope: AbsenceScope = 'all') {
    const companyId = await this.getCompanyId(userId);
    const { start, end } = this.yearBounds(year);

    const [employees, entries] = await Promise.all([
      this.getActiveEmployees(companyId, departmentId),
      this.getUnifiedEntries(companyId, start, end, scope),
    ]);
    const employeeIds = new Set(employees.map((e) => e.id));

    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, byType: {} as Record<string, number>, byFamily: {} as Record<string, number> }));
    for (const entry of entries) {
      if (!employeeIds.has(entry.employeeId)) continue;
      const def = getCodeDef(entry.code);
      if (!def.countsAsAbsenceDay) continue;
      const monthIdx = Number(entry.date.slice(5, 7)) - 1;
      months[monthIdx].byType[entry.code] = (months[monthIdx].byType[entry.code] ?? 0) + 1;
      months[monthIdx].byFamily[entry.family] = (months[monthIdx].byFamily[entry.family] ?? 0) + 1;
    }

    return {
      year, departmentId,
      departmentName: employees[0]?.department?.name ?? null,
      employeeCount: employees.length,
      months,
    };
  }

  // ========================================================================
  // 4) COMPARAISON PLURIANNUELLE — 2 à 5 années
  // ========================================================================
  async compareYears(userId: string, years: number[], scope: AbsenceScope = 'all') {
    const companyId = await this.getCompanyId(userId);
    const results: YearResult[] = [];

    for (const year of years) {
      const { start, end } = this.yearBounds(year);
      const [employees, entries] = await Promise.all([
        this.getActiveEmployees(companyId),
        this.getUnifiedEntries(companyId, start, end, scope),
      ]);
      const employeeMap = new Map(employees.map((e) => [e.id, e]));

      const byType: Record<string, number> = {};
      const byFamily: Record<string, number> = {};
      const byDepartment: Record<string, number> = {};
      let totalDays = 0;
      let trackableDays = 0;

      for (const entry of entries) {
        const def = getCodeDef(entry.code);
        if (!def.countsAsAbsenceDay) continue;
        totalDays += 1;
        if (entry.trackable) trackableDays += 1;
        byType[entry.code] = (byType[entry.code] ?? 0) + 1;
        byFamily[entry.family] = (byFamily[entry.family] ?? 0) + 1;
        const emp = employeeMap.get(entry.employeeId);
        const deptName = emp?.department?.name ?? 'Sans service';
        byDepartment[deptName] = (byDepartment[deptName] ?? 0) + 1;
      }

      results.push({
        year,
        employeeCount: employees.length,
        totalDays,
        trackableDays,
        avgDaysPerEmployee: employees.length ? Number((totalDays / employees.length).toFixed(2)) : 0,
        byType, byFamily, byDepartment,
      });
    }

    const trend = results.map((r, i) => {
      if (i === 0) return { year: r.year, deltaDays: null, deltaPercent: null };
      const prev = results[i - 1];
      const deltaDays = r.totalDays - prev.totalDays;
      const deltaPercent = prev.totalDays ? Number(((deltaDays / prev.totalDays) * 100).toFixed(1)) : null;
      return { year: r.year, deltaDays, deltaPercent };
    });

    return { years: results, trend };
  }

  // ========================================================================
  // 5) DÉTAIL INDIVIDUEL — un employé : fiche du mois, vue annuelle, et
  //    récurrence (nombre d'épisodes de maladie sur 90 jours glissants)
  // ========================================================================
  async getEmployeeDetail(userId: string, employeeId: string, year: number, month: number, scope: AbsenceScope = 'all') {
    const companyId = await this.getCompanyId(userId);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } },
    });
    if (!employee) throw new Error('Employé introuvable');

    const { start: mStart, end: mEnd } = this.monthBounds(year, month);
    const { start: yStart, end: yEnd } = this.yearBounds(year);
    const asOf = mEnd < new Date() ? mEnd : new Date();
    const rolling90Start = this.addDays(asOf, -90);

    const [monthEntries, yearEntries, rolling90Entries] = await Promise.all([
      this.getUnifiedEntries(companyId, mStart, mEnd, scope),
      this.getUnifiedEntries(companyId, yStart, yEnd, scope),
      this.getUnifiedEntries(companyId, rolling90Start, asOf, scope),
    ]);

    const ownMonth = monthEntries.filter((e) => e.employeeId === employeeId);
    const ownYear = yearEntries.filter((e) => e.employeeId === employeeId);
    const ownRolling90 = rolling90Entries.filter((e) => e.employeeId === employeeId);

    const pieByType: Record<string, number> = {};
    for (const e of ownMonth) {
      const def = getCodeDef(e.code);
      if (!def.countsAsAbsenceDay) continue;
      pieByType[e.code] = (pieByType[e.code] ?? 0) + 1;
    }

    const monthsBreakdown = Array.from({ length: 12 }, (_, i) => {
      const days = ownYear.filter((e) => Number(e.date.slice(5, 7)) - 1 === i && getCodeDef(e.code).countsAsAbsenceDay);
      return { month: i + 1, totalDays: days.length, codes: days.map((d) => d.code) };
    });

    // Nombre d'épisodes de maladie distincts sur 90 jours glissants (pas de jours — d'épisodes)
    const sickEpisodeIds = new Set(ownRolling90.filter((e) => e.code === 'MAL').map((e) => e.sourceId));
    const sickDaysYear = ownYear.filter((e) => e.code === 'MAL').length;
    const trackableDaysYear = ownYear.filter((e) => getCodeDef(e.code).trackable && getCodeDef(e.code).countsAsAbsenceDay).length;

    return {
      employee: {
        id: employee.id,
        name: `${employee.lastName} ${employee.firstName}`,
        departmentName: employee.department?.name ?? null,
      },
      year, month,
      pieByType: Object.entries(pieByType).map(([code, days]) => ({ ...getCodeDef(code), days })),
      yearOverview: monthsBreakdown,
      recurrence: {
        sickEpisodesRolling90d: sickEpisodeIds.size,
        sickDaysYear,
        trackableDaysYear,
        alertSickRecurrence: sickEpisodeIds.size >= ALERT_THRESHOLDS.employeeSickEpisodesRolling90d,
        alertSickDays: sickDaysYear >= ALERT_THRESHOLDS.employeeSickDaysPerYear,
        alertTrackableDays: trackableDaysYear >= ALERT_THRESHOLDS.employeeTrackableDaysPerYear,
      },
    };
  }

  // ========================================================================
  // 🚨 ALERTES RH — calculées sur une fenêtre glissante de 365 jours se
  //    terminant à `asOf`. Ne regarde QUE les motifs "trackable" (jamais le
  //    congé statutaire, qui est un droit et non un signal).
  // ========================================================================
  private async computeAlerts(companyId: string, asOf: Date, scope: AbsenceScope) {
    const yearStart = this.addDays(asOf, -365);
    const rolling90Start = this.addDays(asOf, -90);

    const [employees, entries, workingDaysYear] = await Promise.all([
      this.getActiveEmployees(companyId),
      this.getUnifiedEntries(companyId, yearStart, asOf, scope),
      calculateWorkingDays(this.prisma, companyId, yearStart, asOf),
    ]);
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    // --- Alertes individuelles -------------------------------------------
    const sickDaysByEmployee: Record<string, number> = {};
    const trackableDaysByEmployee: Record<string, number> = {};
    const sickEpisodesByEmployee: Record<string, Set<string>> = {};

    for (const e of entries) {
      const def = getCodeDef(e.code);
      if (!def.countsAsAbsenceDay || !def.trackable) continue;
      trackableDaysByEmployee[e.employeeId] = (trackableDaysByEmployee[e.employeeId] ?? 0) + 1;
      if (e.code === 'MAL') {
        sickDaysByEmployee[e.employeeId] = (sickDaysByEmployee[e.employeeId] ?? 0) + 1;
        if (e.date >= rolling90Start.toISOString().slice(0, 10)) {
          if (!sickEpisodesByEmployee[e.employeeId]) sickEpisodesByEmployee[e.employeeId] = new Set();
          sickEpisodesByEmployee[e.employeeId].add(e.sourceId);
        }
      }
    }

    const employeeAlerts: any[] = [];
    for (const emp of employees) {
      const emit = (type: string, message: string, value: number) => {
        employeeAlerts.push({
          type, employeeId: emp.id,
          employeeName: `${emp.lastName} ${emp.firstName}`,
          departmentName: emp.department?.name ?? null,
          value, message,
        });
      };
      const sickDays = sickDaysByEmployee[emp.id] ?? 0;
      const trackableDays = trackableDaysByEmployee[emp.id] ?? 0;
      const episodes = sickEpisodesByEmployee[emp.id]?.size ?? 0;

      if (sickDays >= ALERT_THRESHOLDS.employeeSickDaysPerYear) {
        emit('EMPLOYEE_SICK_DAYS', `${sickDays} jours de maladie sur les 12 derniers mois`, sickDays);
      }
      if (episodes >= ALERT_THRESHOLDS.employeeSickEpisodesRolling90d) {
        emit('EMPLOYEE_SICK_RECURRENCE', `${episodes} épisodes de maladie distincts sur 90 jours`, episodes);
      }
      if (trackableDays >= ALERT_THRESHOLDS.employeeTrackableDaysPerYear) {
        emit('EMPLOYEE_TRACKABLE_DAYS', `${trackableDays} jours d'absence (hors congé statutaire) sur 12 mois`, trackableDays);
      }
    }

    // --- Alertes département (taux d'absentéisme) ------------------------
    const trackableDaysByDept: Record<string, { name: string; days: number; employeeCount: number }> = {};
    for (const emp of employees) {
      const deptId = emp.departmentId ?? 'none';
      const deptName = emp.department?.name ?? 'Sans service';
      if (!trackableDaysByDept[deptId]) trackableDaysByDept[deptId] = { name: deptName, days: 0, employeeCount: 0 };
      trackableDaysByDept[deptId].employeeCount += 1;
    }
    for (const e of entries) {
      const def = getCodeDef(e.code);
      if (!def.countsAsAbsenceDay || !def.trackable) continue;
      const emp = employeeMap.get(e.employeeId);
      const deptId = emp?.departmentId ?? 'none';
      if (!trackableDaysByDept[deptId]) continue;
      trackableDaysByDept[deptId].days += 1;
    }

    const departmentAlerts: any[] = [];
    for (const [departmentId, v] of Object.entries(trackableDaysByDept)) {
      const theoretical = workingDaysYear * v.employeeCount;
      const rate = theoretical > 0 ? Number(((v.days / theoretical) * 100).toFixed(2)) : 0;
      if (rate >= ALERT_THRESHOLDS.departmentAbsenteeismRatePercent) {
        departmentAlerts.push({
          type: 'DEPARTMENT_ABSENTEEISM_RATE',
          departmentId, departmentName: v.name,
          value: rate,
          message: `Taux d'absentéisme de ${rate}% sur 12 mois (seuil : ${ALERT_THRESHOLDS.departmentAbsenteeismRatePercent}%)`,
        });
      }
    }

    return {
      windowStart: yearStart.toISOString().slice(0, 10),
      windowEnd: asOf.toISOString().slice(0, 10),
      employeeAlerts: employeeAlerts.sort((a, b) => b.value - a.value),
      departmentAlerts: departmentAlerts.sort((a, b) => b.value - a.value),
    };
  }
}