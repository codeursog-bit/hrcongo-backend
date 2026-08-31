// ============================================================================
// 📁 src/attendance/attendance-summary.service.ts
// ✅ v5.1 — Fix weekMap + semaine incomplète
//
// RÈGLE FONDAMENTALE :
//   Base hebdomadaire = normalHours réelles de la semaine
//   (pas un quota fixe de 40h)
//
//   Exemples :
//     Semaine complète L-V   = 5j × 8h = 40h de base
//     Semaine incomplète     = 3j × 8h = 24h de base (mois commence mercredi)
//     Semaine avec 1 absence = 4j × 8h = 32h de base
//
//   Dans TOUS les cas : tout ce qui dépasse normalHours = HS
//     → 5 premières HS de jour → ot10
//     → HS de jour suivantes   → ot25
//     → ot50/ot100 indépendants (nuit ou repos/férié)
//
// SEMAINE INCOMPLÈTE :
//   Le 1er mai tombe un mercredi → semaine ISO partielle
//   L'employé travaille mer+jeu+ven = 3j
//   week.normalHours = 24h
//   Si il fait 26h cette semaine → 2h HS → ot10=2h ✅
//   Pas de comparaison à 40h — la base est ce qu'il devait faire
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DayStatusEnum } from './attendance.service';
import {
  AttendanceUtilsService,
  DEFAULT_WORK_DAYS,
  DEFAULT_WORK_HOURS_PER_DAY,
} from './services/attendance-utils.service';

export interface MonthlySummary {
  employeeId: string;
  month: number;
  year: number;
  daysPresent: number;
  daysRemote: number;
  daysOnLeave: number;
  daysAbsentPaid: number;
  daysAbsentUnpaid: number;
  daysHoliday: number;
  daysOffDay: number;
  daysLate: number;
  daysToPay: number;
  daysToDeduct: number;
  normalHours: number;
  overtime10Hours: number; // +10% — 5 premières HS de jour de la semaine
  overtime25Hours: number; // +25% — HS de jour au-delà des 5h
  overtime50Hours: number; // +50% — nuit ouvrable OU repos de jour
  overtime100Hours: number; // +100% — nuit repos/férié
  generatedAt: Date;
}

@Injectable()
export class AttendanceSummaryService {
  constructor(
    private prisma: PrismaService,
    private utils: AttendanceUtilsService,
  ) {}

  // ============================================================================
  // ✅ RÉSUMÉ MENSUEL
  // ============================================================================
  async getMonthlyAttendanceSummary(
    employeeId: string,
    month: number,
    year: number,
  ): Promise<MonthlySummary> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // ── Settings ──────────────────────────────────────────────────────────────
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });

    const ps = employee
      ? await this.prisma.payrollSettings.findFirst({
          where: { companyId: employee.companyId },
          orderBy: { effectiveDate: 'desc' },
          select: {
            officialStartHour: true,
            workHoursPerDay: true,
            workDays: true,
            overtimeEnabled: true,
          } as any,
        })
      : null;

    const officialStartH = Number((ps as any)?.officialStartHour ?? 8);
    const workHoursPerDay = Number(
      ps?.workHoursPerDay ?? DEFAULT_WORK_HOURS_PER_DAY,
    );
    const workDays = ((ps as any)?.workDays ?? DEFAULT_WORK_DAYS) as number[];
    const overtimeEnabled = (ps as any)?.overtimeEnabled ?? true;
    const officialEndH = officialStartH + workHoursPerDay;

    // ── Records du mois ────────────────────────────────────────────────────────
    const records = await this.prisma.attendance.findMany({
      where: { employeeId, date: { gte: startDate, lte: endDate } },
    });

    const holidays = await this.prisma.publicHoliday.findMany({
      where: {
        companyId: employee!.companyId,
        date: { gte: startDate, lte: endDate },
      },
    });
    const holidaySet = new Set(holidays.map((h) => h.date));

    const shiftAssignments = await this.prisma.employeeShiftAssignment.findMany(
      {
        where: {
          employeeId,
          OR: [
            { specificDate: { gte: startDate, lte: endDate } },
            {
              specificDate: null,
              OR: [
                { validFrom: null },
                { validFrom: { lte: new Date(endDate) } },
              ],
              AND: [
                {
                  OR: [
                    { validUntil: null },
                    { validUntil: { gte: new Date(startDate) } },
                  ],
                },
              ],
            },
          ],
        },
        include: { shift: true },
      },
    );

    const getShift = (date: string): any | null => {
      const d = new Date(date);
      const specific = shiftAssignments.find((s) => s.specificDate === date);
      if (specific) return specific.shift;
      const recurring = shiftAssignments.find(
        (s) =>
          !s.specificDate &&
          s.dayOfWeek === d.getDay() &&
          (!s.validFrom || new Date(s.validFrom) <= d) &&
          (!s.validUntil || new Date(s.validUntil) >= d),
      );
      return recurring?.shift ?? null;
    };

    // ── Décompte statuts ──────────────────────────────────────────────────────
    const daysPresent = records.filter(
      (r) => r.status === DayStatusEnum.PRESENT,
    ).length;
    const daysRemote = records.filter(
      (r) => r.status === DayStatusEnum.REMOTE,
    ).length;
    const daysOnLeave = records.filter(
      (r) => r.status === DayStatusEnum.LEAVE,
    ).length;

    // ✅ Règle métier : un congé ANNUAL (le grand départ annuel) est déjà
    // intégralement réglé via l'indemnité versée le mois précédent (voir
    // LeavesIndemnityService.getLeaveImpactForPayroll) — ses jours ne
    // doivent donc PAS compter une deuxième fois dans daysToPay, sinon
    // l'employé toucherait à la fois son salaire plein du mois ET
    // l'indemnité de décembre pour les mêmes jours. Un congé
    // ANNUAL_ANTICIPATED (ou tout autre type payé : maladie, maternité...)
    // continue lui de compter normalement — "l'employé prend juste un
    // repos", payé au fil de l'eau comme avant, pas dans le lot de déc.
    const leaveDayIds = records
      .filter((r) => r.status === DayStatusEnum.LEAVE && r.leaveId)
      .map((r) => r.leaveId as string);
    const leaveTypeById = new Map<string, string>();
    if (leaveDayIds.length > 0) {
      const relatedLeaves = await this.prisma.leave.findMany({
        where: { id: { in: leaveDayIds } },
        select: { id: true, type: true },
      });
      relatedLeaves.forEach((l) => leaveTypeById.set(l.id, l.type));
    }
    const daysOnLeaveAnnual = records.filter(
      (r) =>
        r.status === DayStatusEnum.LEAVE &&
        r.leaveId &&
        leaveTypeById.get(r.leaveId) === 'ANNUAL',
    ).length;
    const daysOnLeavePayableNow = daysOnLeave - daysOnLeaveAnnual;

    const daysAbsentPaid = records.filter(
      (r) => r.status === 'ABSENT_PAID',
    ).length;
    const daysAbsentUnpaid = records.filter(
      (r) => r.status === DayStatusEnum.ABSENT_UNPAID,
    ).length;
    const daysHoliday = records.filter(
      (r) => r.status === DayStatusEnum.HOLIDAY,
    ).length;
    const daysOffDay = records.filter(
      (r) => r.status === DayStatusEnum.OFF_DAY,
    ).length;
    const daysLate = records.filter(
      (r) => r.status === DayStatusEnum.LATE,
    ).length;
    const daysToPay =
      daysPresent +
      daysRemote +
      daysOnLeavePayableNow +
      daysAbsentPaid +
      daysHoliday +
      daysLate;
    const daysToDeduct = daysAbsentUnpaid;

    // ── Grouper par semaine ISO ───────────────────────────────────────────────
    //
    // weekMap[weekNum] = {
    //   normalHours : heures contractuelles réelles (shift ou quota du jour)
    //   dayOTHours  : heures sup de JOUR (avant 20h, hors repos/férié)
    //   ot50        : heures de nuit ouvrable OU repos de jour
    //   ot100       : heures de nuit repos/férié
    // }
    //
    // normalHours reflète exactement ce que l'employé devait faire :
    //   - Semaine incomplète (3 jours) → normalHours ≈ 24h
    //   - Semaine avec absence         → normalHours ≈ 32h (4j présents)
    //   - Semaine complète             → normalHours ≈ 40h
    //
    const weekMap = new Map<
      number,
      {
        normalHours: number;
        dayOTHours: number;
        ot50: number;
        ot100: number;
      }
    >();

    for (const record of records) {
      const shift = getShift(record.date);
      const dateObj = new Date(record.date);
      const isHoliday = holidaySet.has(record.date);
      const isWorkDay = workDays.includes(dateObj.getDay());
      const isRestDay = !shift && (!isWorkDay || isHoliday);
      const weekNum = this.utils.getISOWeekNumber(dateObj);

      if (!weekMap.has(weekNum)) {
        weekMap.set(weekNum, {
          normalHours: 0,
          dayOTHours: 0,
          ot50: 0,
          ot100: 0,
        });
      }
      const week = weekMap.get(weekNum)!;

      if (record.checkIn && record.checkOut) {
        // ── Recalcul depuis les timestamps (source de vérité) ────────────────
        const shiftStartH = shift?.startHour ?? officialStartH;
        const shiftStartMin = shift?.startMinute ?? 0;
        const shiftEndH = shift?.endHour ?? officialEndH;
        const shiftEndMin = shift?.endMinute ?? 0;
        const crossesMid = shift?.crossesMidnight ?? false;

        const checkIn = new Date(record.checkIn);
        const checkOut = new Date(record.checkOut);

        // Bridage arrivée anticipée
        const shiftStart = new Date(checkIn);
        shiftStart.setHours(shiftStartH, shiftStartMin, 0, 0);
        const effectiveStart =
          checkIn < shiftStart && !crossesMid ? shiftStart : checkIn;

        // Fin du shift
        const shiftEnd = new Date(effectiveStart);
        shiftEnd.setHours(shiftEndH, shiftEndMin, 0, 0);
        if (crossesMid && shiftEnd <= effectiveStart) {
          shiftEnd.setDate(shiftEnd.getDate() + 1);
        }

        const totalH = Math.max(
          0,
          (checkOut.getTime() - effectiveStart.getTime()) / 3_600_000,
        );
        const contractH = Math.max(
          0,
          (shiftEnd.getTime() - effectiveStart.getTime()) / 3_600_000,
        );
        const normalH = Math.min(totalH, contractH);

        week.normalHours += normalH;

        if (!overtimeEnabled || totalH <= contractH) continue;

        // Ventilation HS heure par heure
        const pendingH = totalH - contractH;
        const overtimeStart = new Date(shiftEnd);
        const { dayOvertimeHours, ot50, ot100 } =
          this.utils.ventilateOvertimeByContext(
            overtimeStart,
            pendingH,
            isRestDay,
          );

        week.dayOTHours += dayOvertimeHours;
        week.ot50 += ot50;
        week.ot100 += ot100;
      } else {
        // ── Lire depuis DB si pas de pointage complet ────────────────────────
        week.normalHours += Number(record.normalHours || 0);
        if (overtimeEnabled) {
          // overtime10 stocke les heures de jour brutes au checkout
          week.dayOTHours += Number((record as any).overtime10 || 0);
          week.ot50 += Number((record as any).overtime50 || 0);
          week.ot100 += Number((record as any).overtime100 || 0);
        }
      }
    }

    // ── Ventilation hebdomadaire ot10/ot25 ────────────────────────────────────
    //
    // ✅ FIX v5.1 — La base hebdomadaire = week.normalHours (dynamique)
    //
    // AVANT (bug) :
    //   quota fixe de 40h → semaine incomplète (3j=24h) ou absence (4j=32h)
    //   → les heures sup étaient calculées sur 40h même si la base était moindre
    //
    // APRÈS (correct) :
    //   Base = normalHours réelles de la semaine
    //   Tout ce qui dépasse normalHours = HS
    //   5 premières HS de jour → ot10
    //   HS de jour suivantes   → ot25
    //
    // Exemples :
    //   Semaine incomplète : normalHours=24h, dayOTHours=3h
    //     → 3h HS → ot10=3h ✅ (pas besoin d'atteindre 40h)
    //
    //   Semaine complète : normalHours=40h, dayOTHours=6h
    //     → 6h HS → ot10=5h, ot25=1h ✅
    //
    //   Semaine avec absence : normalHours=32h (4j), dayOTHours=8h
    //     → 8h HS → ot10=5h, ot25=3h ✅
    //     + déduction absence traitée séparément dans le bulletin
    //
    let totalNormalHours = 0;
    let totalOT50 = 0;
    let totalOT100 = 0;
    let finalOT10 = 0;
    let finalOT25 = 0;

    weekMap.forEach((week) => {
      totalNormalHours += week.normalHours;
      totalOT50 += week.ot50;
      totalOT100 += week.ot100;

      if (!overtimeEnabled || week.dayOTHours === 0) return;

      // ✅ Base dynamique — pas de quota fixe à 40h
      // dayOTHours = heures AU-DELÀ du shift → toutes considérées comme HS
      // que la semaine soit complète (40h), incomplète (24h) ou avec absence (32h)
      const heuresSup = week.dayOTHours;

      // 5 premières HS de jour → ot10 (+10%)
      finalOT10 += Math.min(heuresSup, 5);
      // Au-delà de 5h → ot25 (+25%)
      finalOT25 += Math.max(0, heuresSup - 5);
    });

    return {
      employeeId,
      month,
      year,
      daysPresent,
      daysRemote,
      daysOnLeave,
      daysAbsentPaid,
      daysAbsentUnpaid,
      daysHoliday,
      daysOffDay,
      daysLate,
      daysToPay,
      daysToDeduct,
      normalHours: parseFloat(totalNormalHours.toFixed(2)),
      overtime10Hours: parseFloat(finalOT10.toFixed(2)),
      overtime25Hours: parseFloat(finalOT25.toFixed(2)),
      overtime50Hours: parseFloat(totalOT50.toFixed(2)),
      overtime100Hours: parseFloat(totalOT100.toFixed(2)),
      generatedAt: new Date(),
    };
  }

  // ============================================================================
  // ✅ GÉNÉRER ET STOCKER — Tous les employés actifs
  // ============================================================================
  async generateAndStoreAllMonthlySummaries(
    companyId: string,
    month: number,
    year: number,
  ) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true },
    });

    const summaries: MonthlySummary[] = [];
    const stored = { created: 0, updated: 0 };

    for (let i = 0; i < employees.length; i += 50) {
      for (const emp of employees.slice(i, i + 50)) {
        const summary = await this.getMonthlyAttendanceSummary(
          emp.id,
          month,
          year,
        );
        summaries.push(summary);

        const data = {
          daysPresent: summary.daysPresent,
          daysRemote: summary.daysRemote,
          daysOnLeave: summary.daysOnLeave,
          daysAbsentPaid: summary.daysAbsentPaid,
          daysAbsentUnpaid: summary.daysAbsentUnpaid,
          daysHoliday: summary.daysHoliday,
          daysOffDay: summary.daysOffDay,
          daysLate: summary.daysLate,
          daysToPay: summary.daysToPay,
          daysToDeduct: summary.daysToDeduct,
          normalHours: summary.normalHours,
          overtime10Hours: summary.overtime10Hours,
          overtime25Hours: summary.overtime25Hours,
          overtime50Hours: summary.overtime50Hours,
          overtime100Hours: summary.overtime100Hours,
          generatedAt: new Date(),
        };

        const existing = await this.prisma.attendanceSummary.findUnique({
          where: { employeeId_month_year: { employeeId: emp.id, month, year } },
        });

        if (existing) {
          await this.prisma.attendanceSummary.update({
            where: { id: existing.id },
            data,
          });
          stored.updated++;
        } else {
          await this.prisma.attendanceSummary.create({
            data: { employeeId: emp.id, month, year, ...data },
          });
          stored.created++;
        }
      }
    }

    return {
      success: true,
      count: summaries.length,
      created: stored.created,
      updated: stored.updated,
      summaries,
      message: `${summaries.length} résumés générés (${stored.created} créés, ${stored.updated} mis à jour)`,
    };
  }

  // ── CRUD helpers ──────────────────────────────────────────────────────────────

  async getStoredSummaries(
    companyId: string,
    month: number,
    year: number,
    employeeIds?: string[],
  ) {
    const where: any = { month, year };
    if (employeeIds?.length) where.employeeId = { in: employeeIds };
    const list = await this.prisma.attendanceSummary.findMany({
      where,
      include: {
        employee: {
          select: {
            companyId: true,
            firstName: true,
            lastName: true,
            baseSalary: true,
          },
        },
      },
    });
    return list.filter((s) => s.employee.companyId === companyId);
  }

  async summariesExist(
    companyId: string,
    month: number,
    year: number,
  ): Promise<boolean> {
    const count = await this.prisma.attendanceSummary.count({
      where: { month, year, employee: { companyId } },
    });
    return count > 0;
  }

  async deleteSummaries(companyId: string, month: number, year: number) {
    const del = await this.prisma.attendanceSummary.deleteMany({
      where: { month, year, employee: { companyId } },
    });
    return {
      success: true,
      deleted: del.count,
      message: `${del.count} résumés supprimés`,
    };
  }

  async getMonthlyStats(companyId: string, month: number, year: number) {
    const s = await this.getStoredSummaries(companyId, month, year);
    const totalOT = s.reduce(
      (sum, r) =>
        sum +
        Number((r as any).overtime10Hours || 0) +
        Number((r as any).overtime25Hours || 0) +
        Number(r.overtime50Hours || 0) +
        Number((r as any).overtime100Hours || 0),
      0,
    );
    const present = s.reduce(
      (sum, r) => sum + r.daysPresent + r.daysLate + r.daysRemote,
      0,
    );
    const workDays = s.reduce(
      (sum, r) => sum + r.daysToPay + r.daysToDeduct,
      0,
    );

    return {
      totalEmployees: s.length,
      totalDaysPresent: s.reduce((sum, r) => sum + r.daysPresent, 0),
      totalDaysLate: s.reduce((sum, r) => sum + r.daysLate, 0),
      totalDaysRemote: s.reduce((sum, r) => sum + r.daysRemote, 0),
      totalDaysAbsent: s.reduce((sum, r) => sum + r.daysAbsentUnpaid, 0),
      totalNormalHours: s.reduce((sum, r) => sum + Number(r.normalHours), 0),
      totalOvertimeHours: totalOT,
      averagePresenceRate:
        workDays > 0 ? parseFloat(((present / workDays) * 100).toFixed(2)) : 0,
    };
  }
}