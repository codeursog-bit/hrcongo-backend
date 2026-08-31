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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeNotFoundException } from '../../exceptions/business.exceptions';
import {
  AttendanceUtilsService,
  DayStatus,
  DayStatusEnum,
  DEFAULT_WORK_DAYS,
} from './attendance-utils.service';

@Injectable()
export class AttendanceCalculationService {
  constructor(
    private prisma: PrismaService,
    private utils: AttendanceUtilsService,
  ) {}

  // ============================================================================
  // ✅ CALCUL DES STATUTS — version async (un employé à la fois)
  // ============================================================================
  async calculateDayStatuses(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<DayStatus[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const companyId = employee.companyId;
    const startDateStr = this.utils.formatDate(startDate);
    const endDateStr = this.utils.formatDate(endDate);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const payrollSettings = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
      orderBy: { effectiveDate: 'desc' },
      select: { workDays: true },
    });
    const workDays = (payrollSettings?.workDays ||
      DEFAULT_WORK_DAYS) as number[];

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
    const absenceDates = this.buildAbsenceDates(absenceRequests);

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
  ): DayStatus[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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
      );
      result.push(this.buildDayStatus(dateStr, status, att, leaveDates));

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

  // ✅ Map date → { type: MALADIE/CONVENTIONNELLE/EXCEPTIONNELLE, isPaid }
  private buildAbsenceDates(
    absenceRequests: any[],
  ): Map<string, { type: string; isPaid: boolean }> {
    const absenceDates = new Map<string, { type: string; isPaid: boolean }>();
    absenceRequests.forEach((ar) => {
      const current = new Date(ar.startDate);
      const end = new Date(ar.endDate);
      while (current <= end) {
        absenceDates.set(this.utils.formatDate(current), {
          type: ar.type,
          isPaid: ar.isPaid,
        });
        current.setDate(current.getDate() + 1);
      }
    });
    return absenceDates;
  }

  private resolveStatus(
    dateStr: string,
    att: any,
    leaveDates: Map<string, string>,
    holidayDates: Set<string>,
    workDays: number[],
    current: Date,
    isFuture: boolean,
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
    absenceDates?: Map<string, { type: string; isPaid: boolean }>,
  ): DayStatus {
    const absence = absenceDates?.get(dateStr);
    return {
      date: dateStr,
      status,
      leaveType: leaveDates.get(dateStr),
      absenceType: absence?.type,
      isPaid: absence?.isPaid,
      checkIn: att?.checkIn ?? undefined,
      checkOut: att?.checkOut ?? undefined,
      totalHours: att?.totalHours ? Number(att.totalHours) : undefined,
      overtime10: att ? Number(att.overtime10 || 0) : undefined,
      overtime25: att ? Number(att.overtime25 || 0) : undefined,
      overtime50: att ? Number(att.overtime50 || 0) : undefined,
      overtime100: att ? Number(att.overtime100 || 0) : undefined,
      isNightShift: att ? Boolean(att.isNightShift) : undefined,
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