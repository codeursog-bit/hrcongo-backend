// ============================================================================
// 📁 src/attendance/services/attendance-utils.service.ts
// ✅ v5 — Conforme Convention Collective Congo
//
// RÈGLES FINALES :
//   - HS calculées PAR SEMAINE (lundi→dimanche ISO)
//     • Semaine ≤ 40h → 0 HS
//     • 41h→45h       → ot10 (+10%)
//     • > 45h          → ot25 (+25%) pour les heures au-delà de 45h
//   - Nuit = après 20h (NIGHT_START=20, confirmé expert RH)
//     • Nuit jour ouvrable → ot50 (+50%)
//     • Nuit repos/férié   → ot100 (+100%)
//   - Repos/férié DE JOUR → ot50 (+50%)
//   - Taux horaire = baseSalary / 173.33h (base OHADA)
//
// MATRICE DÉCRET 78-360 + CONVENTION COLLECTIVE :
//  ┌─────────────────────────────────┬──────────────┬──────────────┐
//  │ Contexte                        │ Avant 20h    │ Après 20h    │
//  ├─────────────────────────────────┼──────────────┼──────────────┤
//  │ Jour ouvrable (dans workDays)   │ ot10 → ot25  │ ot50         │
//  │ Repos (hors workDays)           │ ot50         │ ot100        │
//  │ Férié (sans shift planifié)     │ ot50         │ ot100        │
//  │ Shift planifié (même férié)     │ normalHours  │ normalHours  │
//  └─────────────────────────────────┴──────────────┴──────────────┘
//
// NOTE : Le quota ot10/ot25 est hebdomadaire (40h/45h/+).
//        ot50/ot100 ne dépendent PAS du quota — ils s'appliquent dès
//        que l'heure est dans la plage concernée (nuit ou repos/férié).
//
// CAS SEMAINE INCOMPLÈTE (ex: mois commence mercredi) :
//   → Quota proportionnel = workHoursPerDay × jours_de_la_semaine_partielle
//   → TODO : à implémenter quand les retours RH confirment la règle exacte
// ============================================================================

import { Injectable } from '@nestjs/common';

// ─── Enums & interfaces ──────────────────────────────────────────────────────

export enum DayStatusEnum {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LEAVE = 'LEAVE',
  HOLIDAY = 'HOLIDAY',
  OFF_DAY = 'OFF_DAY',
  ABSENT_UNPAID = 'ABSENT_UNPAID',
  REMOTE = 'REMOTE',
  LATE = 'LATE',
  FUTURE = 'FUTURE',
}

export type NotificationPayload = {
  type: 'ALERT' | 'CHECK_IN' | 'CHECK_OUT' | 'ATTENDANCE_CORRECTION';
  employeeId?: string;
  title: string;
  message: string;
  avatar?: string;
};

export interface DayStatus {
  date: string;
  status: DayStatusEnum;
  leaveType?: string;
  absenceType?: string;
  isPaid?: boolean;
  checkIn?: Date;
  checkOut?: Date;
  totalHours?: number;
  overtime10?: number;
  overtime25?: number;
  overtime50?: number;
  overtime100?: number;
  isNightShift?: boolean;
}

export interface MonthlyReportItem {
  id: string;
  employeeId: string;
  name: string;
  matricule: string;
  avatar: string | null;
  department: string;
  daysPresent: number;
  daysLate: number;
  daysRemote: number;
  daysOnLeave: number;
  daysHoliday: number;
  daysOffDay: number;
  daysAbsentUnpaid: number;
  daysAbsentPaid: number;
  normalHours: number;
  totalHours: number;
  overtime10: number;
  overtime25: number;
  overtime50: number;
  overtime100: number;
  status: string;
  trend: string;
  details: Array<{
    date: string;
    status: string;
    in: string;
    out: string;
    total: string;
    type: string;
    leaveType?: string;
    absenceType?: string;
    isPaid?: boolean;
  }>;
}

export interface OvertimeCalculation {
  normalHours: number;
  overtime10: number;
  overtime25: number;
  overtime50: number;
  overtime100: number;
  isNightShift: boolean;
}

export interface OvertimeContext {
  overtimeEnabled: boolean;
  isRestDay: boolean;
  isHoliday: boolean;
  hasShift: boolean;
  shiftEndHour: number;
  shiftEndMinute: number;
  crossesMidnight: boolean;
  workHoursPerDay: number;
}

export interface AuditChange {
  field: string;
  oldValue?: string;
  newValue: string;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_TOLERANCE_MINUTES = 0;
export const DEFAULT_WORK_HOURS_PER_DAY = 8;
export const BATCH_SIZE = 100;
export const SHIFT_LATE_TOLERANCE_MINUTES = 20;

// ✅ Nuit = après 20h (confirmé expert RH + convention collective Congo)
export const NIGHT_START = 20;
export const NIGHT_END = 5;

// ✅ Seuils hebdomadaires HS (loi Congo / Gabon / OHADA)
export const WEEKLY_NORMAL_HOURS = 40; // heures normales par semaine
export const WEEKLY_OT10_CAP = 45; // jusqu'à 45h → ot10
// Au-delà de 45h → ot25

// ✅ Base légale OHADA pour le taux horaire
export function getHeuresLegalesMois(
  workDaysCount: number,
  workHoursPerDay: number,
): number {
  const heuresSemaine = workDaysCount * workHoursPerDay;
  return (52 * heuresSemaine) / 12;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AttendanceUtilsService {
  // ── Dates ─────────────────────────────────────────────────────────────────

  formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  createLocalDate(dateString: string): Date {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  getTodayString(): string {
    return this.formatDate(new Date());
  }

  // ── Numéro de semaine ISO (lundi = début) ──────────────────────────────────

  getISOWeekNumber(date: Date): number {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
  }

  // Lundi de la semaine contenant la date donnée
  getMondayOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0=dim
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ── Géolocalisation ────────────────────────────────────────────────────────

  getDistanceFromLatLonInMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  // ── Jours ouvrables ───────────────────────────────────────────────────────

  isWorkingDay(date: Date, companyWorkDays?: number[]): boolean {
    return (companyWorkDays ?? DEFAULT_WORK_DAYS).includes(date.getDay());
  }

  // ── Retard ────────────────────────────────────────────────────────────────

  isLateCheckIn(
    checkInTime: Date,
    startHour: number,
    toleranceMinutes: number,
    startMinute: number = 0,
  ): boolean {
    const threshold = startHour * 60 + startMinute + toleranceMinutes;
    const actual = checkInTime.getHours() * 60 + checkInTime.getMinutes();
    return actual > threshold;
  }

  // ── Nuit ──────────────────────────────────────────────────────────────────

  isNightHour(hour: number): boolean {
    return hour >= NIGHT_START || hour < NIGHT_END;
  }

  // ✅ Compte les heures de nuit dans un bloc HS (heure par heure)
  countNightHoursInOvertime(overtimeStart: Date, pendingHours: number): number {
    const floor = Math.floor(pendingHours);
    let night = 0;
    for (let i = 0; i < floor; i++) {
      if (this.isNightHour((overtimeStart.getHours() + i) % 24)) night++;
    }
    const frac = pendingHours - floor;
    if (frac > 0 && this.isNightHour((overtimeStart.getHours() + floor) % 24))
      night += frac;
    return night;
  }

  // ── Ventilation HS heure par heure ───────────────────────────────────────
  //
  // ✅ ot50/ot100 : ne dépendent PAS du quota hebdo — s'appliquent dès
  //    que l'heure est dans la plage nuit ou que c'est un jour de repos.
  //
  // ✅ ot10/ot25 : gérés dans attendance-summary via le quota hebdomadaire.
  //    Ici on retourne juste les heures de jour ouvrable pour que le summary
  //    les buckette correctement dans la ventilation hebdo.
  //
  // @param overtimeStart - Heure de début des HS
  // @param pendingHours  - Nombre d'heures sup
  // @param isRestDay     - Repos/férié sans shift planifié
  // @returns { dayOvertimeHours, ot50, ot100 }
  //          dayOvertimeHours → buckette en ot10/ot25 dans le summary hebdo
  // ──────────────────────────────────────────────────────────────────────────
  ventilateOvertimeByContext(
    overtimeStart: Date,
    pendingHours: number,
    isRestDay: boolean,
  ): { dayOvertimeHours: number; ot50: number; ot100: number } {
    const nightHours = this.countNightHoursInOvertime(
      overtimeStart,
      pendingHours,
    );
    const dayHours = pendingHours - nightHours;

    if (isRestDay) {
      // Repos ou férié : tout passe en ot50/ot100 — pas de quota ot10/ot25
      return { dayOvertimeHours: 0, ot50: dayHours, ot100: nightHours };
    }

    // Jour ouvrable : les heures de nuit → ot50
    //                 les heures de jour → seront buckettées en ot10/ot25
    //                 via le quota hebdomadaire dans le summary
    return {
      dayOvertimeHours: dayHours,
      ot50: nightHours,
      ot100: 0,
    };
  }

  // ── Calcul HS pour un checkout individuel (v5) ────────────────────────────
  //
  // Au checkout on stocke les heures brutes (totalHours, normalHours, ot50, ot100).
  // La ventilation ot10/ot25 se fait dans le summary mensuel qui a
  // la vision hebdomadaire complète.
  // ──────────────────────────────────────────────────────────────────────────
  calculateOvertimeV3(
    checkInTime: Date,
    checkOutTime: Date,
    ctx: OvertimeContext,
  ): OvertimeCalculation {
    const totalMs = checkOutTime.getTime() - checkInTime.getTime();
    const totalHours = Math.max(0, totalMs / 3_600_000);

    // Règle 0 : HS désactivées
    if (!ctx.overtimeEnabled) {
      return {
        normalHours: parseFloat(totalHours.toFixed(2)),
        overtime10: 0,
        overtime25: 0,
        overtime50: 0,
        overtime100: 0,
        isNightShift: this.isNightHour(checkInTime.getHours()),
      };
    }

    // Heure de fin contractuelle
    const shiftEnd = new Date(checkInTime);
    shiftEnd.setHours(ctx.shiftEndHour, ctx.shiftEndMinute, 0, 0);
    if (ctx.crossesMidnight && shiftEnd <= checkInTime) {
      shiftEnd.setDate(shiftEnd.getDate() + 1);
    }

    const contractHours = Math.max(
      0,
      (shiftEnd.getTime() - checkInTime.getTime()) / 3_600_000,
    );
    const normalHours = parseFloat(
      Math.min(totalHours, contractHours).toFixed(2),
    );

    if (totalHours <= contractHours) {
      return {
        normalHours,
        overtime10: 0,
        overtime25: 0,
        overtime50: 0,
        overtime100: 0,
        isNightShift: this.isNightHour(checkInTime.getHours()),
      };
    }

    const pendingHours = totalHours - contractHours;
    const overtimeStart = new Date(shiftEnd);

    // ot50/ot100 calculés immédiatement (indépendants du quota hebdo)
    // dayOvertimeHours stocké brut → ventilé en ot10/ot25 par le summary
    const { dayOvertimeHours, ot50, ot100 } = this.ventilateOvertimeByContext(
      overtimeStart,
      pendingHours,
      ctx.isRestDay,
    );

    // Au checkout on stocke dayOvertimeHours dans overtime10 temporairement.
    // Le summary recalcule la vraie ventilation ot10/ot25 via la semaine.
    return {
      normalHours,
      overtime10: parseFloat(dayOvertimeHours.toFixed(2)), // brut jour, recalculé par summary
      overtime25: 0,
      overtime50: parseFloat(ot50.toFixed(2)),
      overtime100: parseFloat(ot100.toFixed(2)),
      isNightShift: this.isNightHour(checkInTime.getHours()),
    };
  }

  // ── Builder contexte ──────────────────────────────────────────────────────

  buildOvertimeContext(params: {
    shift: any | null;
    officialEndH: number;
    officialEndMin: number;
    workHoursPerDay: number;
    workDays: number[];
    isHoliday: boolean;
    attendanceDate: Date;
    overtimeEnabled: boolean;
  }): OvertimeContext {
    const {
      shift,
      officialEndH,
      officialEndMin,
      workHoursPerDay,
      workDays,
      isHoliday,
      attendanceDate,
      overtimeEnabled,
    } = params;
    const isWorkDay = workDays.includes(attendanceDate.getDay());
    const isRestDay = !shift && (!isWorkDay || isHoliday);
    return {
      overtimeEnabled,
      isRestDay,
      isHoliday,
      hasShift: !!shift,
      shiftEndHour: shift?.endHour ?? officialEndH,
      shiftEndMinute: shift?.endMinute ?? officialEndMin,
      crossesMidnight: shift?.crossesMidnight ?? false,
      workHoursPerDay,
    };
  }

  // ── Taux horaire légal OHADA ──────────────────────────────────────────────

  getTauxHoraire(
    baseSalary: number,
    workDays: number[],
    workHoursPerDay: number,
  ): number {
    const heuresLegales = getHeuresLegalesMois(
      workDays.length,
      workHoursPerDay,
    );
    return baseSalary / heuresLegales;
  }

  // ── @deprecated — rétrocompat ─────────────────────────────────────────────

  calculateOvertime(
    totalHours: number,
    normalDaily: number,
    checkInTime?: Date,
    _checkOut?: Date,
    isWeekend?: boolean,
    isHoliday?: boolean,
  ): OvertimeCalculation {
    if (totalHours <= normalDaily) {
      return {
        normalHours: parseFloat(totalHours.toFixed(2)),
        overtime10: 0,
        overtime25: 0,
        overtime50: 0,
        overtime100: 0,
        isNightShift: false,
      };
    }
    const pendingHours = totalHours - normalDaily;
    const isRestDay = isWeekend || isHoliday || false;
    const overtimeStart = checkInTime
      ? new Date(checkInTime.getTime() + normalDaily * 3_600_000)
      : new Date();
    const { dayOvertimeHours, ot50, ot100 } = this.ventilateOvertimeByContext(
      overtimeStart,
      pendingHours,
      isRestDay,
    );
    return {
      normalHours: parseFloat(normalDaily.toFixed(2)),
      overtime10: parseFloat(dayOvertimeHours.toFixed(2)),
      overtime25: 0,
      overtime50: parseFloat(ot50.toFixed(2)),
      overtime100: parseFloat(ot100.toFixed(2)),
      isNightShift: checkInTime
        ? this.isNightHour(checkInTime.getHours())
        : false,
    };
  }

  getNormalizedDayOfWeek(date: Date): number {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  isNightShift(checkIn: Date, checkOut: Date): boolean {
    return (
      this.isNightHour(checkIn.getHours()) ||
      this.isNightHour(checkOut.getHours())
    );
  }

  validateWeeklyOvertimeLimit(weeklyOvertimeHours: number): {
    isValid: boolean;
    message?: string;
  } {
    const LIMIT = 20;
    if (weeklyOvertimeHours >= LIMIT) {
      return {
        isValid: false,
        message: `Limite légale atteinte : ${weeklyOvertimeHours.toFixed(1)}h sup cette semaine. Le Décret 78-360 limite les heures supplémentaires à ${LIMIT}h/semaine.`,
      };
    }
    return { isValid: true };
  }
}
