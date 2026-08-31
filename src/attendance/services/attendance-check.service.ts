// ============================================================================
// 📁 src/attendance/services/attendance-check.service.ts
// ✅ v5.1 — Fix TS : AttendanceStatus cast + logique v5 complète
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppGateway } from '../../app.gateway';
import { AttendanceStatus, NotificationType } from '@prisma/client';
import { CreateAttendanceDto } from '../dto/create-attendance.dto';
import { SubscriptionGuard } from '../../subscriptions/guards/subscription.guard';
import { CompanySiteService } from '../../companies/company-site.service';
import {
  CompanyNotFoundException,
  EmployeeNotFoundException,
  AttendanceAlreadyExistsException,
  AttendanceCheckOutMissingException,
  AttendanceAlreadyCheckedOutException,
} from '../../exceptions/business.exceptions';
import {
  AttendanceUtilsService,
  DayStatusEnum,
  NotificationPayload,
  AuditChange,
  DEFAULT_START_HOUR,
  DEFAULT_TOLERANCE_MINUTES,
  DEFAULT_WORK_HOURS_PER_DAY,
  DEFAULT_WORK_DAYS,
  SHIFT_LATE_TOLERANCE_MINUTES,
} from './attendance-utils.service';

// ─── Messages ────────────────────────────────────────────────────────────────

const EARLY_MESSAGES: Array<{
  title: string;
  body: (n: string, h: number) => string;
}> = [
  {
    title: '☀️ Quelle motivation !',
    body: (n, h) =>
      `Bonjour ${n} ! Présence enregistrée 🚀 Votre compteur démarrera à ${h}h00, l'heure de votre shift.`,
  },
  {
    title: '🌅 Vous êtes déjà là !',
    body: (n, h) =>
      `Bonjour ${n} ! Merci pour votre engagement ! Compteur démarre à ${h}h00 selon votre planning.`,
  },
  {
    title: '💪 Arrivée anticipée notée !',
    body: (n, h) =>
      `Bonjour ${n} ! Temps effectif comptabilisé dès ${h}h00. Belle journée !`,
  },
  {
    title: '⭐ Lève-tôt du jour !',
    body: (n, h) =>
      `Bonjour ${n} ! Le compteur démarre à ${h}h00 selon votre shift. Belle journée 😊`,
  },
];

const LATE_MESSAGES: Array<{ title: string; body: (n: string) => string }> = [
  {
    title: '⏰ Vous arrivez un peu tard',
    body: (n) =>
      `Bonjour ${n} ! Présence enregistrée malgré le retard. Ça arrive à tout le monde 😊 Bonne journée !`,
  },
  {
    title: '🚦 Petit retard, mais présent',
    body: (n) =>
      `Bonjour ${n} ! Pointage enregistré. Votre manager est informé. Bonne journée !`,
  },
  {
    title: '📋 Arrivée tardive enregistrée',
    body: (n) =>
      `Bonjour ${n} ! On vous a bien noté. Prévenez votre responsable en cas d'imprévu. Allez, bonne journée ! 💪`,
  },
  {
    title: '🏙️ Les bouchons, ça arrive !',
    body: (n) =>
      `Bonjour ${n} ! Présence enregistrée avec retard. Votre ponctualité habituelle parle pour vous. Bonne journée !`,
  },
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Helper : charger le shift d'un employé pour une date ────────────────────
async function loadShift(
  prisma: PrismaService,
  employeeId: string,
  date: string,
  now: Date,
) {
  return prisma.employeeShiftAssignment.findFirst({
    where: {
      employeeId,
      OR: [
        { specificDate: date },
        {
          dayOfWeek: now.getDay(),
          specificDate: null,
          OR: [{ validFrom: null }, { validFrom: { lte: new Date(date) } }],
          AND: [
            {
              OR: [
                { validUntil: null },
                { validUntil: { gte: new Date(date) } },
              ],
            },
          ],
        },
      ],
    },
    include: { shift: true },
    orderBy: { specificDate: 'desc' },
  });
}

@Injectable()
export class AttendanceCheckService {
  constructor(
    private prisma: PrismaService,
    private gateway: AppGateway,
    private utils: AttendanceUtilsService,
    private subscriptionGuard: SubscriptionGuard,
    private companySiteService: CompanySiteService,
  ) {}

  // ============================================================================
  // ✅ CHECK-IN
  // ============================================================================
  async checkIn(dto: CreateAttendanceDto, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new CompanyNotFoundException();

    const { employeeId, notes, latitude, longitude } = dto;
    const confirmRestDay = (dto as any).confirmRestDay ?? false;
    const confirmWorkDuringLeave =
      (dto as any).confirmWorkDuringLeave ?? false;

    if (latitude && longitude) {
      await this.subscriptionGuard.checkFeatureAccess(
        user.companyId,
        'hasAttendanceGPS',
      );
    }

    const today = this.utils.getTodayString();
    const now = new Date();

    // ── Vérifications préliminaires ────────────────────────────────────────
    const [existing, employee] = await Promise.all([
      this.prisma.attendance.findFirst({ where: { employeeId, date: today } }),
      this.prisma.employee.findUnique({ where: { id: employeeId } }),
    ]);

    if (!employee) throw new EmployeeNotFoundException(employeeId);
    if (existing?.checkIn)
      throw new AttendanceAlreadyExistsException(
        `${employee.firstName} ${employee.lastName}`,
        today,
      );

    // ✅ CORRECTIF : un congé approuvé ne bloque plus le pointage — il
    // demande confirmation, comme pour un jour férié/repos (même pattern
    // plus bas dans cette méthode). Ça permet le cas "l'employé travaille
    // pendant son congé" : bulletin normal ce jour-là, sans indemnité
    // (déjà réglée en décembre) — voir getLeaveImpactForPayroll(). Avant ce
    // correctif, le pointage était bloqué net, donc ce cas ne pouvait
    // jamais se produire en pratique.
    const onLeave = await this.prisma.leave.findFirst({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: new Date(today) },
        endDate: { gte: new Date(today) },
      },
    });
    if (onLeave && !confirmWorkDuringLeave) {
      return {
        requiresConfirmation: true,
        reason: 'Congé en cours',
        message:
          `Vous êtes en congé jusqu'au ${new Date(onLeave.endDate).toLocaleDateString('fr-FR')}. ` +
          `Si vous travaillez quand même aujourd'hui, confirmez pour pointer normalement.`,
        isOnLeave: true,
      };
    }

    // ── Settings entreprise ────────────────────────────────────────────────
    const settings = await this.prisma.payrollSettings.findFirst({
      where: { companyId: user.companyId },
      orderBy: { effectiveDate: 'desc' },
      select: {
        workDays: true,
        officialStartHour: true,
        lateToleranceMinutes: true,
      },
    });

    const workDays = (settings?.workDays ?? DEFAULT_WORK_DAYS) as number[];
    const officialStartHour = settings?.officialStartHour ?? DEFAULT_START_HOUR;
    const lateToleranceMinutes =
      settings?.lateToleranceMinutes ?? DEFAULT_TOLERANCE_MINUTES;

    // ── Shift individuel ───────────────────────────────────────────────────
    const sa = await loadShift(this.prisma, employeeId, today, now);
    const shift = sa?.shift ?? null;

    // ── Jour férié ─────────────────────────────────────────────────────────
    const holidayRecord = await this.prisma.publicHoliday.findFirst({
      where: { companyId: user.companyId, date: today },
    });
    const isHoliday = !!holidayRecord;

    // ── Confirmation repos/férié ───────────────────────────────────────────
    // Shift planifié → pas de blocage (travail prévu)
    // Pas de shift ET (hors workDays OU férié) → confirmation requise
    const isOutsideWorkDays = !workDays.includes(now.getDay());
    const needsConfirmation = !shift && (isOutsideWorkDays || isHoliday);

    if (needsConfirmation && !confirmRestDay) {
      const reason = isHoliday
        ? `Jour férié : ${holidayRecord.name}`
        : 'Jour de repos (hors planning entreprise)';
      return {
        requiresConfirmation: true,
        reason,
        message:
          `C'est un ${isHoliday ? 'jour férié' : 'jour de repos'}. ` +
          `Si vous travaillez aujourd'hui, vos heures seront comptées en heures supplémentaires ` +
          `(+${isHoliday ? '50%/100%' : '50%'}). Confirmez-vous votre présence ?`,
        isHoliday,
        isRestDay: true,
      };
    }

    // ── Heure de début effective ───────────────────────────────────────────
    const startHour = shift?.startHour ?? officialStartHour;
    const startMinute = shift?.startMinute ?? 0;

    // ── GPS multi-sites ────────────────────────────────────────────────────
    let statusNote = notes;
    let isSuspicious = false;

    if (latitude && longitude) {
      const siteCheck = await this.companySiteService.checkPositionInAnySite(
        user.companyId,
        latitude,
        longitude,
        (la1, lo1, la2, lo2) =>
          this.utils.getDistanceFromLatLonInMeters(la1, lo1, la2, lo2),
      );
      if (!siteCheck.matched) {
        isSuspicious = true;
        statusNote = 'SUSPICIOUS_LOCATION';
      }
    }

    // ── Retard ─────────────────────────────────────────────────────────────
    const tolerance = shift
      ? SHIFT_LATE_TOLERANCE_MINUTES
      : lateToleranceMinutes;
    const isLate = this.utils.isLateCheckIn(
      now,
      startHour,
      tolerance,
      startMinute,
    );

    // ── Arrivée anticipée ──────────────────────────────────────────────────
    const shiftStartThreshold = new Date(now);
    shiftStartThreshold.setHours(startHour, startMinute, 0, 0);
    const isEarly = now < shiftStartThreshold && !shift?.crossesMidnight;

    // ── ✅ Fix TS : cast explicite en AttendanceStatus ─────────────────────
    const attendanceStatus: AttendanceStatus = isLate
      ? DayStatusEnum.LATE
      : DayStatusEnum.PRESENT;

    const attData = {
      checkIn: now,
      checkInLat: latitude ?? null,
      checkInLon: longitude ?? null,
      status: attendanceStatus,
      notes: statusNote ?? null,
    };

    // ── Créer ou mettre à jour ─────────────────────────────────────────────
    const attendance = existing
      ? await this.prisma.attendance.update({
          where: { id: existing.id },
          data: attData,
        })
      : await this.prisma.attendance.create({
          data: {
            employeeId,
            companyId: user.companyId,
            date: today,
            ...attData,
          },
        });

    // ── Notification admin ─────────────────────────────────────────────────
    this.gateway.sendAdminNotification({
      type: isSuspicious ? 'ALERT' : 'CHECK_IN',
      employeeId,
      title: isSuspicious
        ? '🚨 Alerte GPS'
        : isLate
          ? '⏰ Retard'
          : '✅ Pointage',
      message: `${employee.firstName} ${employee.lastName} — ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
      avatar: employee.photoUrl ?? undefined,
    });

    // ── Réponse enrichie ───────────────────────────────────────────────────
    if (isEarly) {
      const msg = randomItem(EARLY_MESSAGES);
      return {
        ...attendance,
        earlyArrival: true,
        earlyArrivalTitle: msg.title,
        earlyArrivalMessage: msg.body(employee.firstName, startHour),
        shiftStartHour: startHour,
      };
    }

    if (isLate) {
      const msg = randomItem(LATE_MESSAGES);
      return {
        ...attendance,
        slightLate: true,
        slightLateTitle: msg.title,
        slightLateMessage: msg.body(employee.firstName),
      };
    }

    if (confirmRestDay && needsConfirmation) {
      return {
        ...attendance,
        restDayConfirmed: true,
        message: `Présence enregistrée. Vos heures seront comptées en heures supplémentaires (${isHoliday ? 'jour férié : +50%/+100%' : 'jour de repos : +50%'}).`,
      };
    }

    return attendance;
  }

  // ============================================================================
  // ✅ CHECK-OUT
  // ============================================================================
  async checkOut(dto: CreateAttendanceDto, userId: string) {
    const { employeeId, latitude, longitude } = dto;
    const today = this.utils.getTodayString();
    const now = new Date();

    const record = await this.prisma.attendance.findFirst({
      where: { employeeId, date: today },
    });
    if (!record) throw new AttendanceCheckOutMissingException();
    if (record.checkOut) throw new AttendanceAlreadyCheckedOutException();
    if (!record.checkIn) throw new Error("Heure d'entrée manquante");

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new CompanyNotFoundException();

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, photoUrl: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    // ── Settings ───────────────────────────────────────────────────────────
    const ps = await this.prisma.payrollSettings.findFirst({
      where: { companyId: user.companyId },
      orderBy: { effectiveDate: 'desc' },
      select: {
        workHoursPerDay: true,
        officialStartHour: true,
        overtimeEnabled: true,
        workDays: true,
      } as any,
    });

    const workHoursPerDay = Number(
      ps?.workHoursPerDay ?? DEFAULT_WORK_HOURS_PER_DAY,
    );
    const officialStartHour = Number(
      (ps as any)?.officialStartHour ?? DEFAULT_START_HOUR,
    );
    const overtimeEnabled = (ps as any)?.overtimeEnabled ?? true;
    const workDays = ((ps as any)?.workDays ?? DEFAULT_WORK_DAYS) as number[];
    const officialEndHour = officialStartHour + workHoursPerDay;

    // ── Shift individuel ───────────────────────────────────────────────────
    const sa = await loadShift(this.prisma, employeeId, today, now);
    const shift = sa?.shift ?? null;

    // ── Jour férié ─────────────────────────────────────────────────────────
    const holiday = await this.prisma.publicHoliday.findFirst({
      where: { companyId: user.companyId, date: today },
    });
    const isHoliday = !!holiday;

    // ── Contexte HS ────────────────────────────────────────────────────────
    const ctx = this.utils.buildOvertimeContext({
      shift,
      officialEndH: officialEndHour,
      officialEndMin: 0,
      workHoursPerDay,
      workDays,
      isHoliday,
      attendanceDate: new Date(today),
      overtimeEnabled,
    });

    // ── Bridage arrivée anticipée ──────────────────────────────────────────
    const startH = shift?.startHour ?? officialStartHour;
    const startMin = shift?.startMinute ?? 0;
    const realCheckIn = new Date(record.checkIn);
    const shiftStartThreshold = new Date(realCheckIn);
    shiftStartThreshold.setHours(startH, startMin, 0, 0);
    const effectiveCheckIn =
      realCheckIn < shiftStartThreshold && !shift?.crossesMidnight
        ? shiftStartThreshold
        : realCheckIn;

    // ── Calcul HS ──────────────────────────────────────────────────────────
    const ot = this.utils.calculateOvertimeV3(effectiveCheckIn, now, ctx);

    const totalHours = parseFloat(
      Math.max(
        0,
        (now.getTime() - effectiveCheckIn.getTime()) / 3_600_000,
      ).toFixed(2),
    );

    // ── Avertissement limite 20h/semaine ───────────────────────────────────
    const weeklyOT = await this.getWeeklyOvertimeHours(
      employeeId,
      user.companyId,
      now,
    );
    const sessionOT =
      ot.overtime10 + ot.overtime25 + ot.overtime50 + ot.overtime100;
    const check = this.utils.validateWeeklyOvertimeLimit(weeklyOT + sessionOT);
    if (!check.isValid) {
      this.gateway.sendAdminNotification({
        type: 'ALERT',
        employeeId,
        title: '⚠️ Limite HS semaine',
        message: check.message!,
        avatar: employee.photoUrl ?? undefined,
      });
    }

    // ── ✅ Fix TS : statut final casté en AttendanceStatus ─────────────────
    const finalStatus: AttendanceStatus = [
      DayStatusEnum.LATE,
      DayStatusEnum.REMOTE,
    ].includes(record.status as DayStatusEnum)
      ? record.status
      : DayStatusEnum.PRESENT;

    // ── Sauvegarde ─────────────────────────────────────────────────────────
    // Note : overtime10 stocke les heures de jour brutes
    // La ventilation ot10/ot25 finale se fait dans attendance-summary
    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOut: now,
        checkOutLat: latitude ?? null,
        checkOutLon: longitude ?? null,
        totalHours,
        normalHours: ot.normalHours,
        overtime10: ot.overtime10,
        overtime25: ot.overtime25,
        overtime50: ot.overtime50,
        overtime100: ot.overtime100,
        isNightShift: ot.isNightShift,
        status: finalStatus,
      } as any,
    });

    // ── Notification admin ─────────────────────────────────────────────────
    this.gateway.sendAdminNotification({
      type: 'CHECK_OUT',
      employeeId,
      title: sessionOT > 0 ? '👋 Sortie + HS' : '👋 Sortie',
      message:
        `${employee.firstName} ${employee.lastName} — ${totalHours}h travaillées` +
        (sessionOT > 0 ? ` (dont ${sessionOT.toFixed(1)}h sup)` : ''),
      avatar: employee.photoUrl ?? undefined,
    });

    return updated;
  }

  // ============================================================================
  // ✅ CORRECTION — Inchangé
  // ============================================================================
  async correctAttendance(
    attendanceId: string,
    userId: string,
    updates: {
      status?: string;
      checkIn?: Date | string;
      checkOut?: Date | string;
      totalHours?: number;
      reason: string;
    },
    req?: any,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        companyId: true,
        role: true,
        canRecordAttendanceForAll: true, // 🆕 permission "secrétaire" pointage
      },
    });
    const hasStandardRole = user
      ? ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER'].includes(user.role)
      : false;
    // 🆕 EMPLOYEE avec la permission "secrétaire" a aussi le droit de corriger
    const hasSecretaryPermission = !!user?.canRecordAttendanceForAll;
    if (!user || !(hasStandardRole || hasSecretaryPermission)) {
      throw new Error('Accès refusé : droits insuffisants');
    }

    const current = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!current) throw new Error('Présence introuvable');

    const checkInDate = updates.checkIn ? new Date(updates.checkIn) : undefined;
    const checkOutDate = updates.checkOut
      ? new Date(updates.checkOut)
      : undefined;

    const changes: AuditChange[] = [];
    if (updates.status && updates.status !== current.status) {
      changes.push({
        field: 'status',
        oldValue: current.status,
        newValue: updates.status,
      });
    }
    if (checkInDate && checkInDate.getTime() !== current.checkIn?.getTime()) {
      changes.push({
        field: 'checkIn',
        oldValue: current.checkIn?.toISOString(),
        newValue: checkInDate.toISOString(),
      });
    }
    if (
      checkOutDate &&
      checkOutDate.getTime() !== current.checkOut?.getTime()
    ) {
      changes.push({
        field: 'checkOut',
        oldValue: current.checkOut?.toISOString(),
        newValue: checkOutDate.toISOString(),
      });
    }

    await this.prisma.attendanceLog.create({
      data: {
        attendanceId,
        modifiedBy: userId,
        field: changes.map((c) => c.field).join(','),
        oldValue: changes.map((c) => c.oldValue || '').join(','),
        newValue: changes.map((c) => c.newValue).join(','),
        reason: updates.reason,
        ipAddress: req?.ip,
        userAgent: req?.headers?.['user-agent'],
      },
    });

    const updated = await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        status: (updates.status || current.status) as AttendanceStatus,
        checkIn: updates.checkIn || current.checkIn,
        checkOut: updates.checkOut || current.checkOut,
        totalHours: updates.totalHours || current.totalHours,
        notes: `${current.notes || ''}\n[Modifié ${new Date().toLocaleString('fr-FR')} par ${user.firstName} ${user.lastName} — ${updates.reason}]`,
      },
    });

    const admins = await this.prisma.user.findMany({
      where: {
        companyId: user.companyId,
        role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] },
        isActive: true,
        id: { not: userId },
      },
      select: { id: true },
    });

    if (admins.length > 0) {
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: 'ATTENDANCE_CORRECTION',
          title: '✏️ Correction de pointage',
          message: `${user.firstName} ${user.lastName} a corrigé la présence de ${current.employee.firstName} ${current.employee.lastName} (${updates.reason})`,
          link: '/presences',
          metadata: {
            attendanceId,
            employeeId: current.employee.id,
            date: current.date,
            correctorName: `${user.firstName} ${user.lastName}`,
            reason: updates.reason,
            changedFields: changes.map((c) => c.field).join(', '),
          },
        })),
      });
    }

    this.gateway.sendAdminNotification({
      type: 'ATTENDANCE_CORRECTION',
      employeeId: current.employee.id,
      title: '✏️ Correction',
      message: `${user.firstName} ${user.lastName} — ${updates.reason}`,
    });

    return { success: true, attendance: updated, changes };
  }

  // ============================================================================
  // Helpers
  // ============================================================================
  private async getWeeklyOvertimeHours(
    employeeId: string,
    companyId: string,
    date: Date,
  ): Promise<number> {
    const monday = this.utils.getMondayOfWeek(date);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const records = await this.prisma.attendance.findMany({
      where: {
        employeeId,
        companyId,
        date: {
          gte: this.utils.formatDate(monday),
          lte: this.utils.formatDate(sunday),
        },
      },
    });

    return records.reduce(
      (sum, r) =>
        sum +
        Number((r as any).overtime10 || 0) +
        Number((r as any).overtime25 || 0) +
        Number((r as any).overtime50 || 0) +
        Number((r as any).overtime100 || 0),
      0,
    );
  }
}