// ============================================================================
// 📁 src/attendance/services/attendance-calculation.service.ts
// ✅ v5.1 — Cohérent avec attendance-utils.service.ts v5
//
// Ce service calcule les statuts journaliers (PRESENT, LATE, ABSENT_UNPAID…)
// et lit les heures depuis la DB (déjà calculées au checkout par v5).
//
// IMPORTANT : il ne recalcule PAS les HS — il lit overtime10/25/50/100
// tels qu'ils ont été stockés au checkout. La ventilation ot10/ot25
// hebdomadaire finale est faite par attendance-summary.service.ts.
// ============================================================================

import { normalizeWorkDays } from '../../common/utils/work-days';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeNotFoundException } from '../../exceptions/business.exceptions';
import * as WorkingDays from '../../common/working-days.util';
import { loadTodayAbsenceCutoffs, nowCongoMinutes } from '../../common/absence-rules.util';
import {
  AttendanceUtilsService,
  DayStatus,
  DayStatusEnum,
  DEFAULT_WORK_DAYS,
} from './attendance-utils.service';

/**
 * 🆕 Règles d'inférence d'une absence (jour ouvré passé SANS pointage) — optionnelles.
 *  - hireDateStr / exitDateStr : pas d'absence avant l'embauche ni après la sortie (statut FUTURE = case vide)
 *  - todayCutoffMin : AUJOURD'HUI, pas d'absence avant cette minute du jour (heure officielle / début du shift)
 */
export interface AbsenceRuleOpts {
  hireDateStr?: string | null;
  exitDateStr?: string | null;
  todayCutoffMin?: number;
}

@Injectable()
export class AttendanceCalculationService {
  constructor(
    private prisma: PrismaService,
    private utils: AttendanceUtilsService,
  ) {}

  // ============================================================================
  // ✅ CALCUL DES STATUTS — version async (un employé à la fois)
  // ============================================================================
  /** 🆕 Heure (minute du jour, Congo) à partir de laquelle l'absence compte AUJOURD'HUI, par salarié. */
  async getTodayCutoffs(companyId: string, employeeIds: string[]): Promise<Map<string, number>> {
    return loadTodayAbsenceCutoffs(this.prisma, companyId, employeeIds);
  }

  async calculateDayStatuses(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<DayStatus[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true, hireDate: true, terminationDate: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const companyId = employee.companyId;
    const startDateStr = this.utils.formatDate(startDate);
    const endDateStr = this.utils.formatDate(endDate);

    const now = new Date();
    const todayStr = this.utils.getTodayString();
    const today = this.utils.createLocalDate(todayStr); // 🕐 jour du Congo

    // 🆕 Règles d'absence : embauche / sortie / heure officielle du jour
    const ruleOpts: AbsenceRuleOpts = {
      hireDateStr: employee.hireDate ? this.utils.formatDate(employee.hireDate) : null,
      exitDateStr: employee.terminationDate ? this.utils.formatDate(employee.terminationDate) : null,
    };
    if (startDateStr <= todayStr && endDateStr >= todayStr) {
      ruleOpts.todayCutoffMin = (await this.getTodayCutoffs(companyId, [employeeId])).get(employeeId);
    }

    const payrollSettings = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
      orderBy: { effectiveDate: 'desc' },
      select: { workDays: true },
    });
    const workDays = normalizeWorkDays(payrollSettings?.workDays || DEFAULT_WORK_DAYS);

    const [attendances, leaves, publicHolidays, absenceRequests] =
      await Promise.all([
        this.prisma.attendance.findMany({
          where: { employeeId, date: { gte: startDateStr, lte: endDateStr } },
        }),
        this.prisma.leave.findMany({
          where: {
            employeeId,
            status: 'APPROVED',
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        }),
        this.prisma.publicHoliday.findMany({
          where: { companyId, year: startDate.getFullYear() },
        }),
        this.prisma.absenceRequest.findMany({
          where: {
            employeeId,
            status: 'APPROVED',
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        }),
      ]);

    const leaveDates = this.buildLeaveDates(leaves);
    const holidayDates = new Set(publicHolidays.map((h) => h.date));
    const attendanceMap = new Map(attendances.map((a) => [a.date, a]));
    // 🆕 Seuls les jours JUSTIFIÉS (droit conventionnel) sont couverts ; les
    // jours demandés au-delà suivent le pointage (absent si pas de pointage).
    const coveredMap = await WorkingDays.loadCoveredDatesMap(
      this.prisma,
      companyId,
      absenceRequests,
    );
    const absenceDates = this.buildAbsenceDates(absenceRequests, coveredMap);

    const result: DayStatus[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dateStr = this.utils.formatDate(current);
      const att = attendanceMap.get(dateStr);
      const checkDate = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate(),
      );
      const isFuture = checkDate.getTime() > today.getTime();

      try {
        const status = this.resolveStatus(
          dateStr,
          att,
          leaveDates,
          holidayDates,
          workDays,
          current,
          isFuture,
          absenceDates,
          ruleOpts,
        );
        result.push(
          this.buildDayStatus(dateStr, status, att, leaveDates, absenceDates),
        );
      } catch (err) {
        console.error(`❌ Erreur pour ${dateStr}:`, err);
        result.push(this.buildEmptyDayStatus(dateStr));
      }

      current.setDate(current.getDate() + 1);
    }

    return result;
  }

  // ============================================================================
  // ✅ CALCUL OPTIMISÉ — version sync (données déjà chargées, multi-employés)
  // Utilisé par attendance.service.ts (findAll) pour éviter N+1
  // ============================================================================
  calculateDayStatusesOptimized(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    employeeAttendances: any[],
    employeeLeaves: any[],
    holidayDates: Set<string>,
    workDays: number[],
    // 🆕 optionnel — jours justifiés de cet employé (voir buildAbsenceDatesByEmployee)
    absenceDates?: Map<string, { type: string; isPaid: boolean; subType?: string | null }>,
    // 🆕 optionnel — embauche / sortie / heure officielle du jour (voir AbsenceRuleOpts)
    ruleOpts?: AbsenceRuleOpts,
  ): DayStatus[] {
    const now = new Date();
    const today = this.utils.createLocalDate(this.utils.getTodayString()); // 🕐 jour du Congo

    const attendanceMap = new Map(employeeAttendances.map((a) => [a.date, a]));
    const leaveDates = this.buildLeaveDates(employeeLeaves);

    const result: DayStatus[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dateStr = this.utils.formatDate(current);
      const att = attendanceMap.get(dateStr);
      const checkDate = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate(),
      );
      const isFuture = checkDate.getTime() > today.getTime();

      const status = this.resolveStatus(
        dateStr,
        att,
        leaveDates,
        holidayDates,
        workDays,
        current,
        isFuture,
        absenceDates,
        ruleOpts,
      );
      result.push(this.buildDayStatus(dateStr, status, att, leaveDates, absenceDates));

      current.setDate(current.getDate() + 1);
    }

    return result;
  }

  // ============================================================================
  // 🔧 Helpers privés
  // ============================================================================

  private buildLeaveDates(leaves: any[]): Map<string, string> {
    const leaveDates = new Map<string, string>();
    leaves.forEach((leave) => {
      const current = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      while (current <= end) {
        leaveDates.set(this.utils.formatDate(current), leave.type);
        current.setDate(current.getDate() + 1);
      }
    });
    return leaveDates;
  }

  // ✅ Map date → { type, isPaid } — UNIQUEMENT les jours justifiés.
  // coveredMap.get(id) === null  → toute la période est couverte (absence hors
  // catalogue / anciennes demandes). Sinon : seuls les jours du Set.
  private buildAbsenceDates(
    absenceRequests: any[],
    coveredMap: Map<string, Set<string> | null>,
  ): Map<string, { type: string; isPaid: boolean; subType?: string | null }> {
    const absenceDates = new Map<string, { type: string; isPaid: boolean; subType?: string | null }>();
    absenceRequests.forEach((ar) => {
      const covered = coveredMap.get(ar.id) ?? null;
      const current = new Date(ar.startDate);
      const end = new Date(ar.endDate);
      while (current <= end) {
        const ds = this.utils.formatDate(current);
        if (!covered || covered.has(ds)) {
          absenceDates.set(ds, { type: ar.type, isPaid: ar.isPaid, subType: ar.subType ?? null });
        }
        current.setDate(current.getDate() + 1);
      }
    });
    return absenceDates;
  }

  /**
   * 🆕 Pour les vues multi-employés (liste des présences) : Map employeeId →
   * (date → { type, isPaid }) des jours justifiés, en une seule lecture fériés.
   */
  async buildAbsenceDatesByEmployee(
    companyId: string,
    absenceRequests: any[],
  ): Promise<Map<string, Map<string, { type: string; isPaid: boolean; subType?: string | null }>>> {
    const coveredMap = await WorkingDays.loadCoveredDatesMap(
      this.prisma,
      companyId,
      absenceRequests,
    );
    const grouped = new Map<string, any[]>();
    absenceRequests.forEach((ar) => {
      if (!grouped.has(ar.employeeId)) grouped.set(ar.employeeId, []);
      grouped.get(ar.employeeId)!.push(ar);
    });
    const byEmployee = new Map<string, Map<string, { type: string; isPaid: boolean; subType?: string | null }>>();
    grouped.forEach((list, employeeId) => {
      byEmployee.set(employeeId, this.buildAbsenceDates(list, coveredMap));
    });
    return byEmployee;
  }

  private resolveStatus(
    dateStr: string,
    att: any,
    leaveDates: Map<string, string>,
    holidayDates: Set<string>,
    workDays: number[],
    current: Date,
    isFuture: boolean,
    absenceDates?: Map<string, { type: string; isPaid: boolean; subType?: string | null }>,
    ruleOpts?: AbsenceRuleOpts,
  ): DayStatusEnum {
    if (holidayDates.has(dateStr)) return DayStatusEnum.HOLIDAY;
    if (!this.utils.isWorkingDay(current, workDays))
      return DayStatusEnum.OFF_DAY;
    // ✅ CORRECTIF : un pointage réel (présent/retard) prime sur un congé
    // nominal ce jour-là — un employé qui travaille pendant sa période de
    // congé doit être compté présent, pas en congé (pas de double paiement,
    // pas de "congé fantôme" sur un jour effectivement travaillé).
    if (
      att &&
      (att.status === DayStatusEnum.PRESENT ||
        att.status === DayStatusEnum.LATE ||
        att.status === DayStatusEnum.REMOTE)
    ) {
      return att.status as DayStatusEnum;
    }
    if (leaveDates.has(dateStr)) return DayStatusEnum.LEAVE;

    // 🆕 Absence approuvée, jour JUSTIFIÉ (dans le droit conventionnel), sans
    // pointage → absence justifiée : payée (ABSENT_PAID) ou, si la RH a
    // tranché "non payé", déduite (ABSENT_UNPAID) — jamais "non justifiée" par
    // défaut. Les jours demandés AU-DELÀ du droit ne passent pas ici : ils
    // tombent plus bas (pointage sinon ABSENT_UNPAID). Le jour de reprise
    // prévu non pointé est donc bien une absence non justifiée.
    const coveredAbsence = absenceDates?.get(dateStr);
    if (coveredAbsence) {
      return (coveredAbsence.isPaid ? 'ABSENT_PAID' : DayStatusEnum.ABSENT_UNPAID) as DayStatusEnum;
    }

    if (att) {
      const valid = [
        'PRESENT',
        'ABSENT',
        'LEAVE',
        'HOLIDAY',
        'OFF_DAY',
        'ABSENT_UNPAID',
        'REMOTE',
        'LATE',
        'FUTURE',
        'ABSENT_PAID',
      ];
      if (valid.includes(att.status)) return att.status as DayStatusEnum;
      console.warn(`⚠️ Statut invalide ${dateStr}:`, att.status);
      return DayStatusEnum.ABSENT_UNPAID;
    }

    if (isFuture) return DayStatusEnum.FUTURE;

    // 🆕 Aucun pointage ce jour ouvré → absent, SAUF :
    //   • avant la date d'embauche / après la date de sortie (le salarié n'était pas dans l'entreprise)
    //   • AUJOURD'HUI avant l'heure officielle de début (journée pas encore « due »)
    if (ruleOpts) {
      if (ruleOpts.hireDateStr && dateStr < ruleOpts.hireDateStr) return DayStatusEnum.FUTURE;
      if (ruleOpts.exitDateStr && dateStr > ruleOpts.exitDateStr) return DayStatusEnum.FUTURE;
      if (
        ruleOpts.todayCutoffMin !== undefined &&
        dateStr === this.utils.getTodayString() &&
        nowCongoMinutes() < ruleOpts.todayCutoffMin
      ) {
        return DayStatusEnum.FUTURE;
      }
    }
    return DayStatusEnum.ABSENT_UNPAID;
  }

  // ✅ v5.1 : lit overtime10/25/50/100 depuis la DB (stockés au checkout)
  // overtime10 contient les heures de jour brutes au checkout
  // La ventilation finale ot10/ot25 est faite par attendance-summary
  private buildDayStatus(
    dateStr: string,
    status: DayStatusEnum,
    att: any,
    leaveDates: Map<string, string>,
    absenceDates?: Map<string, { type: string; isPaid: boolean; subType?: string | null }>,
  ): DayStatus {
    const absence = absenceDates?.get(dateStr);
    return {
      date: dateStr,
      status,
      leaveType: leaveDates.get(dateStr),
      absenceType: absence?.type,
      absenceSubType: absence?.subType ?? undefined,
      isPaid: absence?.isPaid,
      checkIn: att?.checkIn ?? undefined,
      checkOut: att?.checkOut ?? undefined,
      totalHours: att?.totalHours ? Number(att.totalHours) : undefined,
      overtime10: att ? Number(att.overtime10 || 0) : undefined,
      overtime25: att ? Number(att.overtime25 || 0) : undefined,
      overtime50: att ? Number(att.overtime50 || 0) : undefined,
      overtime100: att ? Number(att.overtime100 || 0) : undefined,
      isNightShift: att ? Boolean(att.isNightShift) : undefined,
      // 🆕 Pointage réel un jour de repos / férié : le statut ne change pas (la paie en dépend),
      // mais le jour est marqué « travaillé » pour que les écrans l'affichent et le comptent.
      workedOnRest:
        att?.checkIn && (status === DayStatusEnum.OFF_DAY || status === DayStatusEnum.HOLIDAY)
          ? (status as 'OFF_DAY' | 'HOLIDAY')
          : undefined,
    };
  }

  private buildEmptyDayStatus(dateStr: string): DayStatus {
    return {
      date: dateStr,
      status: DayStatusEnum.FUTURE,
      leaveType: undefined,
      checkIn: undefined,
      checkOut: undefined,
      totalHours: undefined,
      overtime10: undefined,
      overtime25: undefined,
      overtime50: undefined,
      overtime100: undefined,
      isNightShift: undefined,
    };
  }
}