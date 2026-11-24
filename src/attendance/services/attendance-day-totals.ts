// 📁 EMPLACEMENT (projet backend) : src/attendance/services/attendance-day-totals.ts
// ============================================================================
// ✅ Calcule, pour UNE journée corrigée à la main, exactement ce que le pointage
//    normal (checkOut) et createManual calculent : durée, heures normales /
//    supplémentaires, nuit, et retard (PRESENT ⇄ LATE).
//    Avant : correctAttendance ne recalculait que la durée → les heures sup
//    restaient celles de l'ancien pointage après une correction d'horaires.
//    Mêmes règles que checkOut : bridage d'arrivée anticipée, shift individuel,
//    jour férié, pause déduite des heures normales.
// ============================================================================

import { PrismaService } from '../../prisma/prisma.service';
import { atCongoTime, congoDayOfWeek } from '../../common/utils/congo-time';
import {
  AttendanceUtilsService,
  DEFAULT_WORK_DAYS,
  SHIFT_LATE_TOLERANCE_MINUTES,
} from './attendance-utils.service';

export interface DayTotals {
  totalHours: number;
  normalHours: number;
  overtime10: number;
  overtime25: number;
  overtime50: number;
  overtime100: number;
  isNightShift: boolean;
  /** Vrai si l'heure d'entrée dépasse début officiel + tolérance (ou début du shift + 20 min). */
  isLate: boolean;
}

export async function computeDayTotals(
  prisma: PrismaService,
  utils: AttendanceUtilsService,
  p: {
    companyId: string;
    employeeId: string;
    /** YYYY-MM-DD (jour Congo) */
    date: string;
    checkIn: Date;
    checkOut: Date;
    breakMinutes?: number;
  },
): Promise<DayTotals> {
  const date = String(p.date).slice(0, 10);
  const dateObj = new Date(date);

  const ps: any = await prisma.payrollSettings.findFirst({
    where: { companyId: p.companyId },
    orderBy: { effectiveDate: 'desc' },
    select: {
      workHoursPerDay: true,
      officialStartHour: true,
      officialStartMinute: true,
      officialEndHour: true,
      overtimeEnabled: true,
      workDays: true,
      lateToleranceMinutes: true,
    } as any,
  });

  const workHoursPerDay = Number(ps?.workHoursPerDay ?? 8);
  const officialStartHour = Number(ps?.officialStartHour ?? 8);
  const officialStartMinute = Number(ps?.officialStartMinute ?? 0);
  const overtimeEnabled = ps?.overtimeEnabled ?? true;
  const workDays = (ps?.workDays ?? DEFAULT_WORK_DAYS) as number[];
  const officialEndHour = Number(ps?.officialEndHour ?? officialStartHour + workHoursPerDay);

  const sa = await prisma.employeeShiftAssignment.findFirst({
    where: {
      employeeId: p.employeeId,
      OR: [
        { specificDate: date },
        {
          dayOfWeek: congoDayOfWeek(dateObj),
          specificDate: null,
          OR: [{ validFrom: null }, { validFrom: { lte: dateObj } }],
          AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: dateObj } }] }],
        },
      ],
    },
    include: { shift: true },
    orderBy: { specificDate: 'desc' },
  });
  const shift = sa?.shift ?? null;

  const holiday = await prisma.publicHoliday.findFirst({
    where: { companyId: p.companyId, date },
  });

  const ctx = utils.buildOvertimeContext({
    shift,
    officialEndH: officialEndHour,
    officialEndMin: 0,
    workHoursPerDay,
    workDays,
    isHoliday: !!holiday,
    attendanceDate: dateObj,
    overtimeEnabled,
  });

  // Bridage arrivée anticipée (comme checkOut)
  const startH = shift?.startHour ?? officialStartHour;
  const startMin = shift ? (shift.startMinute ?? 0) : officialStartMinute;
  const threshold = atCongoTime(p.checkIn, startH, startMin);
  const effectiveCheckIn =
    p.checkIn < threshold && !shift?.crossesMidnight ? threshold : p.checkIn;

  const ot = utils.calculateOvertimeV3(effectiveCheckIn, p.checkOut, ctx);

  // Pause : retirée des heures normales et de la durée (comme checkOut)
  const breakHours = Math.max(0, Number(p.breakMinutes ?? 0)) / 60;
  const normalHours =
    breakHours > 0 ? parseFloat(Math.max(0, ot.normalHours - breakHours).toFixed(2)) : ot.normalHours;
  const totalHours = parseFloat(
    Math.max(0, (p.checkOut.getTime() - effectiveCheckIn.getTime()) / 3_600_000 - breakHours).toFixed(2),
  );

  const tolerance = shift ? SHIFT_LATE_TOLERANCE_MINUTES : Number(ps?.lateToleranceMinutes ?? 60);
  const isLate = utils.isLateCheckIn(p.checkIn, startH, tolerance, startMin);

  return {
    totalHours,
    normalHours,
    overtime10: ot.overtime10,
    overtime25: ot.overtime25,
    overtime50: ot.overtime50,
    overtime100: ot.overtime100,
    isNightShift: ot.isNightShift,
    isLate,
  };
}