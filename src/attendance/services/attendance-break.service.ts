// ============================================================================
// 📁 src/attendance/services/attendance-break.service.ts
// 🆕 PAUSE DE LA JOURNÉE (une seule par jour)
//   • Prendre la pause : bouton, sans scan, à partir de l'heure de début configurée
//     (pas de blocage après : l'employé peut la repousser).
//   • Reprise : scan QR / code secret / badge (tablette) ou GPS — jamais un simple clic.
//   • Le temps de pause n'est PAS compté dans les heures travaillées.
//   • Reprise non pointée + sortie → la pause est clôturée à la durée prévue et
//     marquée « reprise non pointée » ; l'admin peut corriger avec justification.
// ============================================================================
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceUtilsService } from './attendance-utils.service';
import { CompanySiteService } from '../../companies/company-site.service';
import {
  LocationRequiredException,
  OutOfGeofenceException,
} from '../../exceptions/business.exceptions';

const BRAZZAVILLE_OFFSET_MIN = 60; // UTC+1, pas d'heure d'été

export type BreakEndMethod = 'GPS' | 'KIOSK' | 'QR_SCAN' | 'SECRET_CODE';

const err = (code: string, message: string) =>
  new BadRequestException({ statusCode: 400, error: code, message });

@Injectable()
export class AttendanceBreakService {
  constructor(
    private prisma: PrismaService,
    private utils: AttendanceUtilsService,
    private sites: CompanySiteService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────
  private minutesOfDay(d = new Date()): number {
    const t = new Date(d.getTime() + BRAZZAVILLE_OFFSET_MIN * 60_000);
    return t.getUTCHours() * 60 + t.getUTCMinutes();
  }

  private hhmm(d: Date): string {
    const t = new Date(d.getTime() + BRAZZAVILLE_OFFSET_MIN * 60_000);
    return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  }

  async getSettings(companyId: string) {
    const s: any = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
      orderBy: { effectiveDate: 'desc' },
      select: {
        breakEnabled: true,
        breakStartHour: true,
        breakStartMinute: true,
        breakDurationMinutes: true,
        breakLateToleranceMinutes: true,
      } as any,
    });
    return {
      enabled: !!s?.breakEnabled,
      startHour: Number(s?.breakStartHour ?? 12),
      startMinute: Number(s?.breakStartMinute ?? 0),
      duration: Number(s?.breakDurationMinutes ?? 60),
      tolerance: Number(s?.breakLateToleranceMinutes ?? 35),
    };
  }

  /** Employé avec un planning/shift applicable : la pause d'entreprise ne s'applique pas. */
  async hasShiftOn(employeeId: string, date: string): Promise<boolean> {
    const d = new Date(date);
    const found = await this.prisma.employeeShiftAssignment.findFirst({
      where: {
        employeeId,
        OR: [
          { specificDate: date },
          {
            dayOfWeek: d.getDay(),
            specificDate: null,
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: d } }] },
              { OR: [{ validUntil: null }, { validUntil: { gte: d } }] },
            ],
          },
        ],
      },
      select: { id: true },
    });
    return !!found;
  }

  private async me(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true, companyId: true },
    });
    if (!u?.employeeId || !u.companyId) {
      throw new ForbiddenException('Aucune fiche employé liée à ce compte.');
    }
    return { employeeId: u.employeeId, companyId: u.companyId };
  }

  private async todayAttendance(employeeId: string) {
    return (this.prisma.attendance as any).findUnique({
      where: {
        employeeId_date: { employeeId, date: this.utils.getTodayString() },
      },
      include: { pause: true },
    });
  }

  private view(p: any) {
    if (!p) return null;
    return {
      startedAt: p.startedAt,
      expectedEndAt: p.expectedEndAt,
      endedAt: p.endedAt,
      minutes: p.minutes,
      lateMinutes: p.lateMinutes,
      resumedAuto: p.resumedAuto,
    };
  }

  // ── État pour la page « Ma pointeuse » ───────────────────────────────────
  async getStatus(userId: string) {
    const { employeeId, companyId } = await this.me(userId);
    const cfg = await this.getSettings(companyId);
    if (!cfg.enabled) return { enabled: false };

    const today = this.utils.getTodayString();
    const att = await this.todayAttendance(employeeId);
    const pause = att?.pause ?? null;
    const startsAt = `${String(cfg.startHour).padStart(2, '0')}:${String(cfg.startMinute).padStart(2, '0')}`;

    let state:
      | 'UNAVAILABLE' | 'NOT_WORKING' | 'TOO_EARLY' | 'AVAILABLE' | 'ON_BREAK' | 'DONE';
    if (await this.hasShiftOn(employeeId, today)) state = 'UNAVAILABLE';
    else if (!att?.checkIn || att.checkOut) state = 'NOT_WORKING';
    else if (pause && !pause.endedAt) state = 'ON_BREAK';
    else if (pause) state = 'DONE';
    else if (this.minutesOfDay() < cfg.startHour * 60 + cfg.startMinute) state = 'TOO_EARLY';
    else state = 'AVAILABLE';

    return {
      enabled: true,
      state,
      startsAt,
      durationMinutes: cfg.duration,
      toleranceMinutes: cfg.tolerance,
      pause: this.view(pause),
    };
  }

  // ── Prendre la pause (aucun scan) ────────────────────────────────────────
  async start(userId: string) {
    const { employeeId, companyId } = await this.me(userId);
    const cfg = await this.getSettings(companyId);
    if (!cfg.enabled) throw err('BREAK_DISABLED', "La pause n'est pas activée pour votre entreprise.");

    const today = this.utils.getTodayString();
    if (await this.hasShiftOn(employeeId, today)) {
      throw err('BREAK_UNAVAILABLE_SHIFT', 'La pause d’entreprise ne s’applique pas à votre planning.');
    }
    const att = await this.todayAttendance(employeeId);
    if (!att?.checkIn || att.checkOut) {
      throw err('BREAK_NOT_WORKING', 'Vous devez être pointé(e) en entrée pour prendre une pause.');
    }
    if (att.pause) {
      throw err('BREAK_ALREADY_TAKEN', att.pause.endedAt
        ? "Vous avez déjà pris votre pause aujourd'hui."
        : 'Vous êtes déjà en pause.');
    }
    const startsAtMin = cfg.startHour * 60 + cfg.startMinute;
    if (this.minutesOfDay() < startsAtMin) {
      const h = `${String(cfg.startHour).padStart(2, '0')}h${String(cfg.startMinute).padStart(2, '0')}`;
      throw err('BREAK_TOO_EARLY', `La pause commence à ${h}. Il est encore trop tôt.`);
    }

    const now = new Date();
    await (this.prisma as any).attendanceBreak.create({
      data: {
        attendanceId: att.id,
        companyId,
        employeeId,
        startedAt: now,
        expectedEndAt: new Date(now.getTime() + cfg.duration * 60_000),
      },
    });
    return this.getStatus(userId);
  }

  // ── Reprise par GPS (le bouton de la page Ma pointeuse) ─────────────────
  async endByGps(userId: string, latitude?: number, longitude?: number) {
    const { employeeId, companyId } = await this.me(userId);
    const att = await this.todayAttendance(employeeId);
    const p = att?.pause;
    if (!att?.checkIn || att.checkOut || !p || p.endedAt) {
      throw err('BREAK_NOT_ACTIVE', "Vous n'êtes pas en pause.");
    }
    if (await this.sites.isGeofencingConfigured(companyId)) {
      if (latitude == null || longitude == null) throw new LocationRequiredException();
      const check = await this.sites.checkPositionInAnySite(
        companyId, latitude, longitude,
        (la1, lo1, la2, lo2) => this.utils.getDistanceFromLatLonInMeters(la1, lo1, la2, lo2),
      );
      if (!check.matched) throw new OutOfGeofenceException(check.distance ?? 0, check.siteName);
    }
    const r = await this.finalize(att, p, new Date(), 'GPS', null, latitude, longitude);
    return { success: true, ...r };
  }

  // ── Reprise par scan QR / code secret / badge : appelé AVANT entrée/sortie ─
  async resumeIfOnBreak(params: {
    employeeId: string;
    companyId: string;
    method: BreakEndMethod;
    source?: string | null;
  }): Promise<{ message: string; lateMinutes: number } | null> {
    const att = await this.todayAttendance(params.employeeId);
    const p = att?.pause;
    if (!att?.checkIn || att.checkOut || !p || p.endedAt) return null;
    return this.finalize(att, p, new Date(), params.method, params.source ?? null);
  }

  private async finalize(
    att: any,
    p: any,
    endedAt: Date,
    method: BreakEndMethod,
    source: string | null,
    lat?: number,
    lon?: number,
  ) {
    const minutes = Math.max(0, Math.round((endedAt.getTime() - new Date(p.startedAt).getTime()) / 60_000));
    const lateMinutes = Math.max(0, Math.round((endedAt.getTime() - new Date(p.expectedEndAt).getTime()) / 60_000));

    await (this.prisma as any).attendanceBreak.update({
      where: { id: p.id },
      data: {
        endedAt,
        minutes,
        lateMinutes,
        resumedAuto: false,
        endMethod: method,
        endSource: source?.slice(0, 100) ?? null,
        endLat: lat ?? null,
        endLon: lon ?? null,
      },
    });
    await (this.prisma.attendance as any).update({
      where: { id: att.id },
      data: { breakMinutes: minutes },
    });

    const cfg = await this.getSettings(att.companyId);
    let message = `Reprise enregistrée (pause de ${minutes} min).`;
    if (lateMinutes > cfg.tolerance) {
      message += ` ⚠️ Retard de ${lateMinutes} min sur l'heure de reprise prévue (${this.hhmm(new Date(p.expectedEndAt))}).`;
      if (!p.lateNotifiedAt) {
        await this.notifyLate(att.employeeId, att.companyId, lateMinutes, new Date(p.expectedEndAt)).catch(() => undefined);
        await (this.prisma as any).attendanceBreak.update({ where: { id: p.id }, data: { lateNotifiedAt: new Date() } });
      }
    }
    return { message, lateMinutes };
  }

  /** Notifie l'employé + les admins/RH d'une pause trop longue. */
  async notifyLate(employeeId: string, companyId: string, lateMinutes: number, expectedEndAt: Date) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, user: { select: { id: true } } },
    });
    if (!emp) return;
    const at = this.hhmm(expectedEndAt);
    const rows: any[] = [];
    if (emp.user?.id) {
      rows.push({
        userId: emp.user.id,
        type: 'ATTENDANCE_ALERT',
        title: '⏰ Pause trop longue',
        message: `Votre reprise était prévue à ${at} : ${lateMinutes} min de retard. Reprenez le travail en scannant ou en pointant.`,
        link: '/presences/pointage',
      });
    }
    const admins = await this.prisma.user.findMany({
      where: { companyId, role: { in: ['ADMIN', 'HR_MANAGER'] }, isActive: true },
      select: { id: true },
    });
    for (const a of admins) {
      rows.push({
        userId: a.id,
        type: 'ATTENDANCE_ALERT',
        title: '⏰ Pause dépassée',
        message: `${emp.firstName} ${emp.lastName} : reprise prévue à ${at}, ${lateMinutes} min de retard.`,
        link: '/presences',
      });
    }
    if (rows.length) {
      await this.prisma.notification.createMany({ data: rows.map((r) => ({ ...r, read: false })) });
    }
  }

  // ── Sortie avec pause encore ouverte (ou pause déjà fermée) ──────────────
  // Retourne les minutes de pause à déduire. Pause ouverte = « reprise non pointée » :
  // clôturée à la durée prévue (au plus tard à l'heure de sortie), signalée à l'admin.
  async closeOpenBreakAtExit(attendanceId: string, exitAt: Date): Promise<number> {
    const p: any = await (this.prisma as any).attendanceBreak.findUnique({ where: { attendanceId } });
    if (!p) return 0;
    if (p.endedAt) return Number(p.minutes ?? 0);

    const endMs = Math.max(
      new Date(p.startedAt).getTime(),
      Math.min(new Date(p.expectedEndAt).getTime(), exitAt.getTime()),
    );
    const minutes = Math.round((endMs - new Date(p.startedAt).getTime()) / 60_000);
    await (this.prisma as any).attendanceBreak.update({
      where: { id: p.id },
      data: { endedAt: new Date(endMs), minutes, lateMinutes: 0, resumedAuto: true },
    });
    await (this.prisma.attendance as any).update({ where: { id: attendanceId }, data: { breakMinutes: minutes } });
    return minutes;
  }

  // ── Correction admin (avec justification) ────────────────────────────────
  async adminCorrect(
    admin: { userId: string; companyId: string | null },
    attendanceId: string,
    body: { endedAt?: string; reason?: string },
  ) {
    const reason = (body.reason ?? '').trim();
    if (reason.length < 3) throw err('BREAK_REASON_REQUIRED', 'Une justification est obligatoire.');
    const endedAt = new Date(body.endedAt ?? '');
    if (Number.isNaN(endedAt.getTime())) throw err('BREAK_BAD_TIME', "Heure de reprise invalide.");

    const att: any = await (this.prisma.attendance as any).findUnique({
      where: { id: attendanceId },
      include: { pause: true },
    });
    if (!att || !att.pause) throw new NotFoundException('Aucune pause enregistrée pour ce pointage.');

    if (att.companyId !== admin.companyId) {
      const link = await this.prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: admin.userId, companyId: att.companyId } },
        select: { id: true },
      });
      if (!link) throw new ForbiddenException('Accès refusé.');
    }

    const p = att.pause;
    const upper = att.checkOut ? new Date(att.checkOut) : new Date();
    if (endedAt < new Date(p.startedAt) || endedAt > upper) {
      throw err('BREAK_BAD_TIME', 'La reprise doit être comprise entre le début de la pause et la sortie (ou maintenant).');
    }

    const oldMinutes = Number(p.minutes ?? 0);
    const minutes = Math.round((endedAt.getTime() - new Date(p.startedAt).getTime()) / 60_000);
    const lateMinutes = Math.max(0, Math.round((endedAt.getTime() - new Date(p.expectedEndAt).getTime()) / 60_000));

    await (this.prisma as any).attendanceBreak.update({
      where: { id: p.id },
      data: {
        endedAt, minutes, lateMinutes,
        resumedAuto: false,
        endMethod: 'MANUAL',
        editedBy: admin.userId,
        editReason: reason,
        editedAt: new Date(),
      },
    });

    const data: any = { breakMinutes: minutes };
    if (att.checkOut) {
      const delta = (minutes - oldMinutes) / 60;
      data.totalHours = Math.max(0, parseFloat((Number(att.totalHours ?? 0) - delta).toFixed(2)));
      data.normalHours = Math.max(0, parseFloat((Number(att.normalHours ?? 0) - delta).toFixed(2)));
    }
    await (this.prisma.attendance as any).update({ where: { id: att.id }, data });

    await this.prisma.attendanceLog.create({
      data: {
        attendanceId: att.id,
        modifiedBy: admin.userId,
        field: 'pauseEnd',
        oldValue: p.endedAt ? new Date(p.endedAt).toISOString() : 'null',
        newValue: endedAt.toISOString(),
        reason,
      },
    });
    return { success: true, minutes, lateMinutes };
  }
}