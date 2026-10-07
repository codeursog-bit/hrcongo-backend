// ============================================================================
// 📁 src/attendance/cron/attendance-cron.service.ts
// ✅ v5.1 — Fix TS : randomMsg typed correctly (no mixed string | function)
// ============================================================================

import { atCongoTime, congoDayOfWeek } from '../../common/utils/congo-time';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PushNotificationsService } from '../../notifications/push-notifications.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import {
  SystemLogsService,
  SystemLogSkip,
} from '../../system-logs/system-logs.service';
import { CronLockService } from '../../cron-lock/cron-lock.service';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import {
  AttendanceUtilsService,
  WEEKLY_NORMAL_HOURS,
  WEEKLY_OT10_CAP,
} from '../services/attendance-utils.service';
import { buildPreShiftMessage } from './pre-shift-messages';

// ─── Messages : rappel AVANT le début du shift ───────────────────────────────
// Générés par ./pre-shift-messages.ts (prénom, entreprise, ton selon l'heure,
// rotation quotidienne sans répétition). Le délai X reste configurable via
// PlatformSettings.preShiftReminderMinutes (voir super admin).

// ─── Messages : tous typés string (pas de fonction) ──────────────────────────

const CHECK_OUT_MESSAGES: Array<{ title: string; body: string }> = [
  {
    title: '🌆 Fin de journée',
    body: 'Belle journée ! Pensez à valider votre sortie.',
  },
  { title: '👏 Beau boulot !', body: "N'oubliez pas de pointer votre départ." },
  {
    title: "🏠 C'est l'heure !",
    body: 'Il est temps de clôturer votre journée.',
  },
  {
    title: '✅ Presque fini !',
    body: 'Validez votre sortie pour que vos heures soient bien comptabilisées.',
  },
];

const OT_QUESTION_MESSAGES: Array<{ title: string; body: string }> = [
  {
    title: '⏰ Toujours au bureau ?',
    body: 'Heures sup ou oubli de pointer ?',
  },
  {
    title: '🕐 Pointage ouvert',
    body: "Votre sortie n'a pas été enregistrée. Heures sup ou oubli ?",
  },
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

@Injectable()
export class AttendanceCronService implements OnModuleDestroy {
  private readonly logger = new Logger(AttendanceCronService.name);
  // Suivi de ce que CE process détient vraiment — pour ne jamais libérer,
  // sur arrêt, le verrou d'une autre instance encore active (important le
  // jour où il y a plusieurs instances backend en parallèle).
  private heldLocks = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationsService,
    private notificationsService: NotificationsService,
    private utils: AttendanceUtilsService,
    private systemLogs: SystemLogsService,
    private cronLock: CronLockService,
    private platformSettings: PlatformSettingsService,
  ) {}

  /**
   * Arrêt propre (Ctrl+C, redémarrage nodemon/ts-node-dev, déploiement) :
   * on libère les verrous qu'on aurait pu laisser pris, pour ne pas faire
   * attendre le TTL au prochain démarrage. Sur un crash brutal (kill -9,
   * coupure serveur), ce hook ne s'exécute pas — le TTL reste le filet de
   * sécurité dans ce cas-là.
   */
  async onModuleDestroy() {
    await Promise.all(
      [...this.heldLocks].map((name) => this.cronLock.release(name)),
    );
  }

  // ============================================================================
  // CRON 0 — Rappel AVANT l'heure officielle de début (tourne h24)
  // ----------------------------------------------------------------------------
  // Base : PayrollSettings.officialStartHour de chaque entreprise (heure ronde).
  // Le rappel part dans la fenêtre [début − X min, début[, avec X =
  // PlatformSettings.preShiftReminderMinutes. Un tick par minute, MAIS :
  //  • officialStartHour étant une heure ronde, une entreprise ne peut être
  //    concernée que dans les X dernières minutes avant chaque heure pile : hors
  //    de cette fenêtre le tick sort tout de suite (ni verrou, ni requête).
  //    Ex. X = 20 → on travaille de H:40 à H:59, et seulement les entreprises
  //    qui démarrent à H+1 ; les autres entreprises ne sont même pas regardées.
  //  • le service peut tomber DEMAIN (entreprise qui démarre à 0h → rappel à
  //    23:40) : jour ouvré, férié, pointage et congé sont évalués sur la date du
  //    SERVICE, pas sur celle du tick.
  //  • un employé reçoit au plus UN rappel par service (dédoublonnage), et rien
  //    s'il a déjà pointé ou s'il est en congé approuvé.
  //  • texte du message : cf. pre-shift-messages.ts
  // ============================================================================
  @Cron('* * * * *', { timeZone: 'Africa/Brazzaville' })
  async handlePreOfficialStartReminder(): Promise<void> {
    const now = new Date();
    const { dateStr: todayStr, minutesOfDay: nowMin, dayOfWeek: todayDow } = this.brazzavilleParts(now);

    let preShiftMinutes: number;
    try {
      preShiftMinutes = (await this.platformSettings.get()).preShiftReminderMinutes;
    } catch (err: any) {
      this.logger.error('❌ Cron rappel pré-début : lecture des réglages impossible', err);
      return;
    }

    // Sortie rapide : prochaine heure pile trop loin → aucune entreprise concernée.
    const minutesToNextHour = 60 - (nowMin % 60); // 1 … 60
    if (minutesToNextHour > preShiftMinutes) return;

    const LOCK = 'attendance-cron:pre-start';
    if (!(await this.cronLock.acquire(LOCK, 270))) {
      this.logger.debug(`⏭️ ${LOCK} déjà en cours ailleurs, ce tick est sauté`);
      return;
    }
    this.heldLocks.add(LOCK);

    const startedAt = Date.now();
    const tomorrowStr = this.brazzavilleParts(new Date(now.getTime() + 24 * 60 * 60 * 1000)).dateStr;

    try {
      const holidays = await this.prisma.publicHoliday.findMany({
        where: { date: { in: [todayStr, tomorrowStr] } },
        select: { companyId: true, date: true },
      });
      const holidayKeys = new Set(holidays.map((h) => `${h.companyId}|${h.date}`));

      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          payrollSettings: {
            orderBy: { effectiveDate: 'desc' },
            take: 1,
            select: { workDays: true, officialStartHour: true },
          },
        },
      });

      for (const company of companies) {
        const settings = company.payrollSettings[0];
        if (!settings) continue;

        const officialStartHour = settings.officialStartHour ?? 8;
        const startMin = officialStartHour * 60;

        // Minutes avant le début, passage de minuit compris (0h : à 23:40, il reste 20 min).
        const minutesLeft = (((startMin - nowMin) % 1440) + 1440) % 1440;
        if (minutesLeft < 1 || minutesLeft > preShiftMinutes) continue;

        // Si le début « est déjà passé » dans la journée en cours, le service est demain.
        const startsTomorrow = startMin < nowMin;
        const shiftDate = startsTomorrow ? tomorrowStr : todayStr;
        const shiftDow = startsTomorrow ? (todayDow + 1) % 7 : todayDow;

        if (holidayKeys.has(`${company.id}|${shiftDate}`)) continue;

        const workDays = (settings.workDays as number[]) || [1, 2, 3, 4, 5];
        if (!workDays.includes(shiftDow)) continue;

        const companyLabel = company.tradeName?.trim() || company.legalName;

        // Tous les employés actifs pas encore pointés pour ce service, hors congé approuvé.
        const employees = await this.prisma.employee.findMany({
          where: {
            companyId: company.id,
            status: 'ACTIVE',
            attendances: { none: { date: shiftDate } },
            leaves: {
              none: {
                status: 'APPROVED',
                startDate: { lte: new Date(shiftDate) },
                endDate: { gte: new Date(shiftDate) },
              },
            },
          },
          include: {
            user: { select: { id: true, pushToken: true, pushNotifEnabled: true, pushSubscriptions: { select: { id: true } } } },
          },
        });

        if (employees.length === 0) continue;

        let notifiedCount = 0;
        const skipped: SystemLogSkip[] = [];

        // En parallèle plutôt qu'un `for` séquentiel : sur une entreprise à
        // beaucoup d'employés, l'envoi un par un pouvait prendre assez de
        // temps pour que les derniers reçoivent leur rappel plusieurs
        // dizaines de secondes, voire minutes, après les premiers.
        await Promise.all(employees.map(async (emp) => {
          const empName = `${emp.firstName} ${emp.lastName}`;

          if (!emp.user?.id) {
            skipped.push({ employeeId: emp.id, name: empName, reason: 'Aucun compte utilisateur lié' });
            return;
          }

          const dedupKey = `pre-start:${emp.id}:${shiftDate}`;
          const canNotify = await this.notificationsService.tryClaim(dedupKey);
          if (!canNotify) {
            skipped.push({ employeeId: emp.id, name: empName, reason: 'Déjà notifié pour ce service (dédoublonnage)' });
            return;
          }

          const { title, body } = buildPreShiftMessage({
            firstName: emp.firstName,
            companyName: companyLabel,
            minutesLeft,
            startHour: officialStartHour,
            nowMinuteOfDay: nowMin,
            dayOfWeek: shiftDow,
            date: shiftDate,
            employeeId: emp.id,
            gender: emp.gender,
          });

          await this.notif({
            userId: emp.user.id,
            type: 'PRE_SHIFT_REMINDER' as NotificationType,
            title,
            message: body,
            link: '/presences/pointage',
            metadata: { employeeId: emp.id, companyId: company.id, date: shiftDate, preShiftMinutes },
          });

          if (!emp.user.pushNotifEnabled) {
            skipped.push({ employeeId: emp.id, name: empName, reason: 'Notif in-app créée, mais push désactivé dans le profil' });
          } else if (emp.user.pushSubscriptions.length === 0 && !emp.user.pushToken) {
            skipped.push({ employeeId: emp.id, name: empName, reason: 'Notif in-app créée, mais aucun appareil enregistré pour le push' });
          }

          await this.pushService.sendPushToUser(emp.user.id, {
            title,
            body,
            url: '/presences/pointage',
            // Tag PAR JOUR : avec un tag fixe, le rappel d'hier resté dans la barre de notifs
            // serait remplacé EN SILENCE par celui d'aujourd'hui (pas de son, pas de vibration).
            tag: `pre-start-reminder:${shiftDate}`,
            // Inutile après l'heure de début : le service push le jette s'il n'a pas pu le livrer.
            ttlSeconds: Math.max(60, minutesLeft * 60),
            // Livraison immédiate même téléphone en veille.
            urgency: 'high',
          });

          notifiedCount++;
        }));

        this.logger.log(
          `📲 Rappel pré-début → ${company.legalName} (${officialStartHour}h, -${preShiftMinutes}min) : ${notifiedCount}/${employees.length} notifiés`,
        );

        await this.systemLogs.log({
          source: 'attendance-cron:pre-start',
          level: skipped.length > 0 ? 'WARNING' : 'INFO',
          message: `${company.legalName} — ${employees.length} employé(s), ${notifiedCount} notifié(s), ${skipped.length} sans push effectif`,
          details: { evaluated: employees.length, notified: notifiedCount, skipped },
          companyId: company.id,
        });
      }
    } catch (err: any) {
      this.logger.error('❌ Cron rappel pré-début:', err);
      await this.systemLogs.log({
        source: 'attendance-cron:pre-start',
        level: 'ERROR',
        message: `Le cron a échoué : ${err?.message ?? err}`,
        details: { errors: [String(err?.stack ?? err)] },
      });
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs > 10_000) {
        await this.systemLogs.log({
          source: 'attendance-cron:pre-start',
          level: 'WARNING',
          message: `Cron anormalement lent (${durationMs}ms)`,
          durationMs,
        });
      }
      this.heldLocks.delete(LOCK);
      await this.cronLock.release(LOCK);
    }
  }

  // ============================================================================
  // CRON 1 — Rappel APRÈS l'heure officielle de fin, +30 min (fenêtres 0h-10h / 16h-20h)
  // ----------------------------------------------------------------------------
  // Simple rappel "vous n'avez pas pointé votre sortie" — ne touche pas à la
  // logique heures supplémentaires (ça reste géré séparément). La fermeture
  // automatique définitive des pointages oubliés reste le job de minuit
  // (handleMidnightAutoClose, inchangé).
  // ============================================================================
  private static readonly POST_END_DELAY_MINUTES = 30;

  @Cron('*/5 * * * *', { timeZone: 'Africa/Brazzaville' })
  async handlePostOfficialEndReminder(): Promise<void> {
    const LOCK = 'attendance-cron:post-end';
    if (!(await this.cronLock.acquire(LOCK, 270))) {
      this.logger.debug(`⏭️ ${LOCK} déjà en cours ailleurs, ce tick est sauté`);
      return;
    }
    this.heldLocks.add(LOCK);

    const startedAt = Date.now();
    const now = new Date();
    const today = this.today();
    const { minutesOfDay: nowMin } = this.brazzavilleParts(now);

    try {
      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        include: {
          payrollSettings: { orderBy: { effectiveDate: 'desc' }, take: 1 },
        },
      });

      for (const company of companies) {
        const settings = company.payrollSettings[0];
        if (!settings) continue;

        const officialEndHour =
          (settings as any).officialEndHour ??
          (settings.officialStartHour ?? 8) + Number(settings.workHoursPerDay ?? 8);
        const target = officialEndHour * 60 + AttendanceCronService.POST_END_DELAY_MINUTES;
        // 🆕 Fenêtre de 90 min (avant : 5 min) : un tick raté n'annule plus le rappel
        const withinTick = nowMin >= target && nowMin < target + 90;
        if (!withinTick) continue;

        // Employés ayant pointé l'entrée mais pas encore la sortie.
        const openAttendances = await this.prisma.attendance.findMany({
          where: {
            companyId: company.id,
            date: today,
            checkIn: { not: null },
            checkOut: null,
          },
          include: {
            employee: {
              include: {
                user: { select: { id: true, pushToken: true, pushNotifEnabled: true, pushSubscriptions: { select: { id: true } } } },
              },
            },
          },
        });

        if (openAttendances.length === 0) continue;

        let notifiedCount = 0;
        const skipped: SystemLogSkip[] = [];

        const overtimeEnabled = (settings as any).overtimeEnabled ?? true;
        const workHoursPerDay = Number(settings.workHoursPerDay ?? 8);

        for (const att of openAttendances) {
          const empName = `${att.employee.firstName} ${att.employee.lastName}`;

          if (!att.employee.user?.id) {
            skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Aucun compte utilisateur lié' });
            continue;
          }

          const dedupKey = `post-end:${att.employeeId}:${today}`;
          const canNotify = await this.notificationsService.tryClaim(dedupKey);
          if (!canNotify) {
            skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Déjà notifié aujourd\'hui (dédoublonnage)' });
            continue;
          }

          // À ce stade (heure officielle de fin + 30 min et toujours pas de
          // sortie pointée), on distingue "oubli simple" de "vrai
          // dépassement d'heures" en comparant le temps déjà travaillé à la
          // durée officielle de la journée.
          const hoursElapsed = (now.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000;
          const pendingOT = Math.max(0, hoursElapsed - workHoursPerDay);

          if (overtimeEnabled && pendingOT > 0) {
            await this.prisma.attendance.update({
              where: { id: att.id },
              data: {
                pendingOvertimeHours: pendingOT,
                overtimeStatus: 'PENDING_EMPLOYEE',
                overtimeRequestedAt: now,
              } as any,
            });

            const msg = randomItem(OT_QUESTION_MESSAGES);
            const body = `${msg.body} (${pendingOT.toFixed(1)}h de dépassement calculé)`;

            await this.notif({
              userId: att.employee.user.id,
              type: 'CHECKOUT_REMINDER',
              title: msg.title,
              message: body,
              link: '/presences/pointage',
              metadata: {
                attendanceId: att.id,
                employeeId: att.employeeId,
                companyId: company.id,
                pendingOvertimeHours: pendingOT,
                action: 'FORGOT_OR_OVERTIME',
              },
            });

            if (!att.employee.user.pushNotifEnabled) {
              skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Notif in-app créée, mais push désactivé dans le profil' });
            } else if (att.employee.user.pushSubscriptions.length === 0 && !att.employee.user.pushToken) {
              skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Notif in-app créée, mais aucun appareil enregistré pour le push' });
            }

            await this.pushService.sendPushToUser(att.employee.user.id, {
              title: msg.title,
              body,
              url: '/presences/pointage',
              tag: 'checkout-overtime',
              requireInteraction: true,
              actions: [
                { action: 'forgot', title: "😅 C'était un oubli" },
                { action: 'overtime', title: '💼 Heures supplémentaires' },
              ],
              actionUrls: {
                forgot: `/presences/resolve-forgotten/${att.id}`,
                overtime: `/presences/declare-overtime/${att.id}`,
              },
            });
          } else {
            const msg = randomItem(CHECK_OUT_MESSAGES);
            await this.notif({
              userId: att.employee.user.id,
              type: 'CHECKOUT_REMINDER',
              title: msg.title,
              message: msg.body,
              link: '/presences/pointage',
              metadata: { attendanceId: att.id, employeeId: att.employeeId, companyId: company.id },
            });

            if (!att.employee.user.pushNotifEnabled) {
              skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Notif in-app créée, mais push désactivé dans le profil' });
            } else if (att.employee.user.pushSubscriptions.length === 0 && !att.employee.user.pushToken) {
              skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Notif in-app créée, mais aucun appareil enregistré pour le push' });
            }

            await this.pushService.sendPushToUser(att.employee.user.id, {
              title: msg.title,
              body: msg.body,
              url: '/presences/pointage',
              tag: 'post-end-reminder',
            });
          }

          notifiedCount++;
        }

        this.logger.log(
          `📲 Rappel post-fin → ${company.legalName} (${officialEndHour}h+${AttendanceCronService.POST_END_DELAY_MINUTES}min) : ${notifiedCount}/${openAttendances.length} notifiés`,
        );

        await this.systemLogs.log({
          source: 'attendance-cron:post-end',
          level: skipped.length > 0 ? 'WARNING' : 'INFO',
          message: `${company.legalName} — ${openAttendances.length} pointage(s) ouvert(s), ${notifiedCount} notifié(s), ${skipped.length} sans push effectif`,
          details: { evaluated: openAttendances.length, notified: notifiedCount, skipped },
          companyId: company.id,
        });
      }
    } catch (err: any) {
      this.logger.error('❌ Cron rappel post-fin:', err);
      await this.systemLogs.log({
        source: 'attendance-cron:post-end',
        level: 'ERROR',
        message: `Le cron a échoué : ${err?.message ?? err}`,
        details: { errors: [String(err?.stack ?? err)] },
      });
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs > 10_000) {
        await this.systemLogs.log({
          source: 'attendance-cron:post-end',
          level: 'WARNING',
          message: `Cron anormalement lent (${durationMs}ms)`,
          durationMs,
        });
      }
      this.heldLocks.delete(LOCK);
      await this.cronLock.release(LOCK);
    }
  }

  // ============================================================================
  // CRON 3 — Relance approbation HS (toutes les 15 min)
  // ============================================================================
  @Cron('*/15 * * * *', { timeZone: 'Africa/Brazzaville' })
  async handleOvertimePendingApproval(): Promise<void> {
    try {
      const pending = await this.prisma.attendance.findMany({
        where: {
          date: this.today(),
          overtimeStatus: 'PENDING_APPROVAL',
          overtimeRequestedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        } as any,
        include: { employee: { include: { company: true } } },
      });
      for (const att of pending) {
        const managers = await this.prisma.user.findMany({
          where: {
            companyId: att.employee.companyId,
            role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER'] },
            isActive: true,
          },
          select: { id: true },
        });
        for (const m of managers) {
          const exists = await this.prisma.notification.findFirst({
            where: {
              userId: m.id,
              type: 'OVERTIME_REQUEST',
              metadata: { path: ['attendanceId'], equals: att.id },
              read: false,
              createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            },
          });
          if (!exists) {
            const title = '🕐 Validation heures sup requise';
            const message = `${att.employee.firstName} ${att.employee.lastName} déclare ${Number((att as any).pendingOvertimeHours || 0).toFixed(1)}h supplémentaires. En attente de confirmation.`;
            await this.notif({
              userId: m.id,
              type: 'OVERTIME_REQUEST',
              title,
              message,
              link: '/presences',
              metadata: {
                attendanceId: att.id,
                employeeId: att.employeeId,
                pendingOvertimeHours: (att as any).pendingOvertimeHours,
                date: this.today(),
              },
            });
            await this.pushService.sendPushToUser(m.id, {
              title,
              body: message,
              url: '/presences',
              tag: `ot-approval-${att.id}`,
              requireInteraction: true,
            });
          }
        }
      }
    } catch (err: any) {
      this.logger.error('❌ Cron OT pending:', err);
    }
  }

  /** 🆕 Clôture une pause restée ouverte (reprise non pointée) et renvoie les minutes à déduire. */
  private async closeBreakAt(attendanceId: string, exitAt: Date): Promise<number> {
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
    return minutes;
  }

  // ============================================================================
  // 🆕 CRON — Pause trop longue : alerte l'employé + les admins (une seule fois par pause)
  // Seuil = heure de reprise prévue + tolérance de l'entreprise (défaut 35 min)
  // ============================================================================
  @Cron('*/5 * * * *', { timeZone: 'Africa/Brazzaville' })
  async handleLateBreaks(): Promise<void> {
    const LOCK = 'attendance-cron:late-breaks';
    if (!(await this.cronLock.acquire(LOCK, 270))) return;
    this.heldLocks.add(LOCK);
    try {
      const now = new Date();
      const open: any[] = await (this.prisma as any).attendanceBreak.findMany({
        where: { endedAt: null, lateNotifiedAt: null, expectedEndAt: { lt: now } },
        take: 500,
      });
      if (open.length === 0) return;

      const tolByCompany = new Map<string, number>();
      for (const b of open) {
        if (!tolByCompany.has(b.companyId)) {
          const s: any = await this.prisma.payrollSettings.findFirst({
            where: { companyId: b.companyId },
            orderBy: { effectiveDate: 'desc' },
            select: { breakLateToleranceMinutes: true } as any,
          });
          tolByCompany.set(b.companyId, Number(s?.breakLateToleranceMinutes ?? 35));
        }
        const tol = tolByCompany.get(b.companyId)!;
        const lateMinutes = Math.round((now.getTime() - new Date(b.expectedEndAt).getTime()) / 60_000);
        if (lateMinutes <= tol) continue;

        const emp = await this.prisma.employee.findUnique({
          where: { id: b.employeeId },
          select: { firstName: true, lastName: true, user: { select: { id: true } } },
        });
        if (!emp) continue;
        const at = new Date(new Date(b.expectedEndAt).getTime() + 3_600_000);
        const hhmm = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;

        if (emp.user?.id) {
          await this.notif({
            userId: emp.user.id,
            type: 'ATTENDANCE_ALERT',
            title: '⏰ Pause trop longue',
            message: `Votre reprise était prévue à ${hhmm} (${lateMinutes} min de retard). Reprenez le travail en scannant ou en pointant.`,
            link: '/presences/pointage',
          });
          await this.pushService.sendPushToUser(emp.user.id, {
            title: '⏰ Pause trop longue',
            body: `Reprise prévue à ${hhmm}. Pensez à pointer votre reprise.`,
            url: '/presences/pointage',
            tag: 'break-late',
          });
        }
        const admins = await this.prisma.user.findMany({
          where: { companyId: b.companyId, role: { in: ['ADMIN', 'HR_MANAGER'] }, isActive: true },
          select: { id: true },
        });
        for (const a of admins) {
          await this.notif({
            userId: a.id,
            type: 'ATTENDANCE_ALERT',
            title: '⏰ Pause dépassée',
            message: `${emp.firstName} ${emp.lastName} : reprise prévue à ${hhmm}, ${lateMinutes} min de retard.`,
            link: '/presences',
          });
        }
        await (this.prisma as any).attendanceBreak.update({ where: { id: b.id }, data: { lateNotifiedAt: new Date() } });
      }
    } catch (e: any) {
      this.logger.error(`❌ handleLateBreaks: ${e?.message ?? e}`);
    } finally {
      this.heldLocks.delete(LOCK);
      await this.cronLock.release(LOCK);
    }
  }

  /** 🆕 Vrai si l'employé a un shift/planning applicable à cette date (YYYY-MM-DD). */
  private async hasShiftOn(employeeId: string, date: string): Promise<boolean> {
    const d = new Date(date);
    const found = await this.prisma.employeeShiftAssignment.findFirst({
      where: {
        employeeId,
        OR: [
          { specificDate: date },
          {
            dayOfWeek: congoDayOfWeek(d),
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

  // ============================================================================
  // CRON 4 — Auto-close minuit
  // ============================================================================
  @Cron('1 0 * * *', { timeZone: 'Africa/Brazzaville' })
  async handleMidnightAutoClose(): Promise<void> {
    this.logger.log('⏰ Auto-close minuit...');
    try {
      const yesterday = this.yesterday();
      const midnight = atCongoTime(new Date(), 0, 1); // 🕐 00:01 heure du Congo

      const open = await this.prisma.attendance.findMany({
        where: { date: yesterday, checkIn: { not: null }, checkOut: null },
        include: {
          employee: {
            include: {
              company: {
                include: {
                  payrollSettings: {
                    orderBy: { effectiveDate: 'desc' },
                    take: 1,
                  },
                },
              },
              user: { select: { id: true } },
            },
          },
        },
      });

      this.logger.log(`🔒 ${open.length} pointage(s) à fermer`);

      let skippedShift = 0;
      for (const att of open) {
        // 🆕 Employé avec un planning/shift : il a ses propres horaires (ex. nuit qui traverse
        // minuit) → on ne le ferme JAMAIS avec l'horaire de l'entreprise.
        if (await this.hasShiftOn(att.employeeId, yesterday)) {
          skippedShift++;
          continue;
        }
        const s = att.employee.company.payrollSettings[0];
        const startH = s?.officialStartHour ?? 8;
        const wh = Number(s?.workHoursPerDay ?? 8);
        // 🆕 Fin officielle = officialEndHour (repli : début + durée si absent)
        const endH = Number((s as any)?.officialEndHour ?? startH + wh);
        const closure = atCongoTime(yesterday, endH, 0); // 🕐 fin officielle, heure du Congo
        // 🆕 Pause ouverte à la fermeture auto = « reprise non pointée » : clôturée à la durée prévue
        const breakMinutes = await this.closeBreakAt(att.id, closure);
        const total = Math.max(
          0,
          (closure.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000 - breakMinutes / 60,
        );

        await this.prisma.attendance.update({
          where: { id: att.id },
          data: {
            checkOut: closure,
            totalHours: parseFloat(total.toFixed(2)),
            normalHours: parseFloat(total.toFixed(2)), // 🆕 = totalHours (fermeture à la fin officielle : aucune HS)
            breakMinutes,
            overtimeStatus: 'AUTO_CLOSED',
            autoClosedAt: midnight,
            closureReason: 'AUTO_CLOSED',
            notes: `[AUTO_CLOSED ${midnight.toLocaleString('fr-FR')}]`,
          } as any,
        });

        if (att.employee.user?.id) {
          const title = '🔒 Pointage clôturé automatiquement';
          const message = `Votre pointage du ${new Date(yesterday).toLocaleDateString('fr-FR')} a été clôturé à ${endH}h00. Si c'est une erreur, contactez votre RH.`;
          await this.notif({
            userId: att.employee.user.id,
            type: 'AUTO_CLOSED_NOTICE',
            title,
            message,
            link: '/presences/pointage',
            metadata: { attendanceId: att.id, date: yesterday },
          });
          await this.pushService.sendPushToUser(att.employee.user.id, {
            title,
            body: message,
            url: '/presences/pointage',
            tag: 'auto-closed',
          });
        }

        await this.prisma.attendanceLog.create({
          data: {
            attendanceId: att.id,
            modifiedBy: att.employee.user?.id ?? att.employeeId,
            field: 'checkOut,overtimeStatus,closureReason',
            oldValue: 'null,NONE,null',
            newValue: `${closure.toISOString()},AUTO_CLOSED,AUTO_CLOSED`,
            reason: 'Fermeture automatique système (minuit)',
          },
        });
      }

      this.logger.log(`✅ Auto-close terminé — ${open.length - skippedShift} fermés, ${skippedShift} ignoré(s) (shift)`);
    } catch (err: any) {
      this.logger.error('❌ Cron auto-close:', err);
    }
  }

  // ============================================================================
  // ACTION : Employé répond "OUBLI"
  // ============================================================================
  async resolveAsForgotten(
    attendanceId: string,
    userId: string,
  ): Promise<void> {
    const att = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        employee: {
          include: {
            company: {
              include: {
                payrollSettings: {
                  orderBy: { effectiveDate: 'desc' },
                  take: 1,
                },
              },
            },
            user: { select: { id: true } },
          },
        },
      },
    });
    if (!att) throw new Error('Pointage introuvable');

    const s = att.employee.company.payrollSettings[0];
    const startH = s?.officialStartHour ?? 8;
    const wh = Number(s?.workHoursPerDay ?? 8);
    // 🆕 Fin officielle = officialEndHour (repli : début + durée), jamais avant l'entrée
    const endH = Number((s as any)?.officialEndHour ?? startH + wh);
    const closure = atCongoTime(att.date as any, endH, 0); // 🕐 fin officielle, heure du Congo
    if (closure.getTime() < new Date(att.checkIn!).getTime()) {
      closure.setTime(new Date(att.checkIn!).getTime());
    }
    // 🆕 La pause (si prise) n'est pas comptée
    const breakMinutes = await this.closeBreakAt(attendanceId, closure);
    const total = Math.max(
      0,
      (closure.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000 - breakMinutes / 60,
    );

    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOut: closure,
        totalHours: parseFloat(total.toFixed(2)),
        normalHours: parseFloat(total.toFixed(2)), // 🆕 = totalHours
        breakMinutes,
        overtime10: 0,
        overtime25: 0,
        overtime50: 0,
        overtime100: 0,
        pendingOvertimeHours: 0,
        overtimeStatus: 'NONE',
        closureReason: 'FORGOT',
      } as any,
    });
    await this.prisma.attendanceLog.create({
      data: {
        attendanceId,
        modifiedBy: userId,
        field: 'checkOut,closureReason',
        oldValue: 'null',
        newValue: `${closure.toISOString()},FORGOT`,
        reason: "Oubli confirmé — fermeture à l'heure officielle",
      },
    });
  }

  // ============================================================================
  // ACTION : Employé répond "HEURES SUP"
  // ============================================================================
  async resolveAsOvertime(attendanceId: string, userId: string): Promise<void> {
    const att = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: { employee: { include: { user: { select: { id: true } } } } },
    });
    if (!att) throw new Error('Pointage introuvable');

    // 🔒 HS désactivées pour l'entreprise : aucune demande d'heures sup possible (même par appel direct)
    const otSettings: any = await this.prisma.payrollSettings.findFirst({
      where: { companyId: att.employee.companyId },
      orderBy: { effectiveDate: 'desc' },
      select: { overtimeEnabled: true },
    });
    if (otSettings && otSettings.overtimeEnabled === false) {
      throw new Error("Les heures supplémentaires ne sont pas activées pour votre entreprise.");
    }

    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        overtimeStatus: 'PENDING_APPROVAL',
        overtimeRequestedAt: new Date(),
      } as any,
    });

    const managers = await this.prisma.user.findMany({
      where: {
        companyId: att.employee.companyId,
        role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER'] },
        isActive: true,
      },
      select: { id: true },
    });
    const title = '🕐 Demande heures supplémentaires';
    const message = `${att.employee.firstName} ${att.employee.lastName} déclare ${Number((att as any).pendingOvertimeHours || 0).toFixed(1)}h supplémentaires. Cliquez pour valider ou refuser.`;

    for (const m of managers) {
      await this.notif({
        userId: m.id,
        type: 'OVERTIME_REQUEST',
        title,
        message,
        link: '/presences',
        metadata: {
          attendanceId,
          employeeId: att.employeeId,
          pendingOvertimeHours: (att as any).pendingOvertimeHours,
          date: att.date,
        },
      });
      await this.pushService.sendPushToUser(m.id, {
        title,
        body: message,
        url: '/presences',
        tag: `ot-request-${attendanceId}`,
        requireInteraction: true,
      });
    }
  }

  // ============================================================================
  // ACTION : Patron approuve les HS
  // ============================================================================
  async approveOvertime(
    attendanceId: string,
    approvedById: string,
  ): Promise<void> {
    const att = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        employee: {
          include: {
            user: { select: { id: true } },
            company: {
              include: {
                payrollSettings: {
                  orderBy: { effectiveDate: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!att) throw new Error('Pointage introuvable');

    const s = att.employee.company.payrollSettings[0];
    const wh = Number(s?.workHoursPerDay ?? 8);
    const pending = Number((att as any).pendingOvertimeHours ?? 0);
    const workDays = (s?.workDays as number[]) || [1, 2, 3, 4, 5];
    const checkIn = new Date(att.checkIn!);
    const realCheckOut = new Date(
      checkIn.getTime() + (wh + pending) * 3_600_000,
    );

    const attDate = new Date(att.date);
    const isOutside = !workDays.includes(congoDayOfWeek(attDate));
    const holiday = await this.prisma.publicHoliday.findFirst({
      where: { companyId: att.employee.companyId, date: att.date },
    });
    const isHoliday = !!holiday;
    const isRestDay = isOutside || isHoliday;

    const overtimeStart = new Date(checkIn.getTime() + wh * 3_600_000);
    const { dayOvertimeHours, ot50, ot100 } =
      this.utils.ventilateOvertimeByContext(overtimeStart, pending, isRestDay);

    const weeklyOT = await this.getWeeklyDayOTHours(
      att.employeeId,
      att.employee.companyId,
      attDate,
    );
    const ot10Cap = WEEKLY_OT10_CAP - WEEKLY_NORMAL_HOURS;
    const ot10 = isRestDay
      ? 0
      : parseFloat(
          Math.min(dayOvertimeHours, Math.max(0, ot10Cap - weeklyOT)).toFixed(
            2,
          ),
        );
    const ot25 = isRestDay
      ? 0
      : parseFloat(
          Math.max(
            0,
            dayOvertimeHours - Math.max(0, ot10Cap - weeklyOT),
          ).toFixed(2),
        );

    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOut: realCheckOut,
        totalHours: wh + pending,
        normalHours: wh,
        overtime10: ot10,
        overtime25: ot25,
        overtime50: parseFloat(ot50.toFixed(2)),
        overtime100: parseFloat(ot100.toFixed(2)),
        overtimeStatus: 'APPROVED',
        overtimeApprovedBy: approvedById,
        overtimeApprovedAt: new Date(),
        closureReason: 'OVERTIME',
      } as any,
    });

    if (att.employee.user?.id) {
      const ctx = isHoliday ? ' (férié)' : isOutside ? ' (repos)' : '';
      const title = '✅ Heures supplémentaires validées !';
      const message = `Vos ${pending.toFixed(1)}h supplémentaires du ${attDate.toLocaleDateString('fr-FR')} ont été approuvées${ctx}. Elles seront comptabilisées sur votre bulletin.`;
      await this.notif({
        userId: att.employee.user.id,
        type: 'OVERTIME_APPROVED',
        title,
        message,
        link: '/ma-paie',
        metadata: {
          attendanceId,
          approvedHours: pending,
          isRestDay,
          isHoliday,
          ot10,
          ot25,
          ot50: parseFloat(ot50.toFixed(2)),
          ot100: parseFloat(ot100.toFixed(2)),
        },
      });
      await this.pushService.sendPushToUser(att.employee.user.id, {
        title,
        body: message,
        url: '/ma-paie',
        tag: `ot-approved-${attendanceId}`,
      });
    }

    await this.prisma.attendanceLog.create({
      data: {
        attendanceId,
        modifiedBy: approvedById,
        field:
          'overtimeStatus,checkOut,overtime10,overtime25,overtime50,overtime100',
        oldValue: 'PENDING_APPROVAL',
        newValue: `APPROVED,${realCheckOut.toISOString()},${ot10},${ot25},${ot50.toFixed(2)},${ot100.toFixed(2)}`,
        reason: `HS approuvées (${pending.toFixed(1)}h${isRestDay ? ', repos/férié' : ''})`,
      },
    });
  }

  // ============================================================================
  // ACTION : Patron refuse les HS
  // ============================================================================
  async rejectOvertime(
    attendanceId: string,
    rejectedById: string,
    reason: string,
  ): Promise<void> {
    const att = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        employee: {
          include: {
            user: { select: { id: true } },
            company: {
              include: {
                payrollSettings: {
                  orderBy: { effectiveDate: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!att) throw new Error('Pointage introuvable');

    const s = att.employee.company.payrollSettings[0];
    const startH = s?.officialStartHour ?? 8;
    const wh = Number(s?.workHoursPerDay ?? 8);
    // 🆕 Fin officielle = officialEndHour (repli : début + durée), jamais avant l'entrée
    const endH = Number((s as any)?.officialEndHour ?? startH + wh);
    const closure = atCongoTime(att.date as any, endH, 0); // 🕐 fin officielle, heure du Congo
    if (closure.getTime() < new Date(att.checkIn!).getTime()) {
      closure.setTime(new Date(att.checkIn!).getTime());
    }
    // 🆕 La pause (si prise) n'est pas comptée
    const breakMinutes = await this.closeBreakAt(attendanceId, closure);
    const total = Math.max(
      0,
      (closure.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000 - breakMinutes / 60,
    );

    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOut: closure,
        totalHours: parseFloat(total.toFixed(2)),
        normalHours: parseFloat(total.toFixed(2)), // 🆕 = totalHours
        breakMinutes,
        overtime10: 0,
        overtime25: 0,
        overtime50: 0,
        pendingOvertimeHours: 0,
        overtimeStatus: 'REJECTED',
        overtimeRejectedAt: new Date(),
        overtimeRejectedReason: reason,
        closureReason: 'FORGOT',
      } as any,
    });

    if (att.employee.user?.id) {
      const title = '❌ Heures supplémentaires non confirmées';
      const message = `Votre déclaration du ${new Date(att.date).toLocaleDateString('fr-FR')} n'a pas été confirmée. Journée clôturée à ${startH + wh}h00. Motif : ${reason}`;
      await this.notif({
        userId: att.employee.user.id,
        type: 'OVERTIME_REJECTED',
        title,
        message,
        link: '/presences/pointage',
        metadata: { attendanceId, reason },
      });
      await this.pushService.sendPushToUser(att.employee.user.id, {
        title,
        body: message,
        url: '/presences/pointage',
        tag: `ot-rejected-${attendanceId}`,
      });
    }

    await this.prisma.attendanceLog.create({
      data: {
        attendanceId,
        modifiedBy: rejectedById,
        field: 'overtimeStatus,checkOut',
        oldValue: 'PENDING_APPROVAL',
        newValue: `REJECTED,${closure.toISOString()}`,
        reason: `HS refusées : ${reason}`,
      },
    });
  }

  // ============================================================================
  // Helpers privés
  // ============================================================================
  private async getWeeklyDayOTHours(
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
        overtimeStatus: 'APPROVED',
      },
    });
    return records.reduce(
      (s, r) =>
        s +
        Number((r as any).overtime10 || 0) +
        Number((r as any).overtime25 || 0),
      0,
    );
  }

  private today(): string {
    return this.brazzavilleParts().dateStr;
  }

  private yesterday(): string {
    return this.brazzavilleParts(new Date(Date.now() - 24 * 60 * 60 * 1000)).dateStr;
  }

  /**
   * ⚠️ Correctif fuseau horaire (Sept 2026) : `new Date().getHours()` /
   * `.getMinutes()` / `.getDay()` renvoient l'heure LOCALE DU PROCESS NODE
   * (TZ du serveur/conteneur — souvent UTC par défaut sur Hetzner), PAS le
   * fuseau passé à `@Cron(..., { timeZone: 'Africa/Brazzaville' })`. Ce
   * timeZone ne sert qu'à déclencher le tick au bon instant réel — il ne
   * change rien à ce que `.getHours()` renvoie une fois dans le code. Si le
   * serveur tourne en UTC (WAT = UTC+1, pas d'heure d'été), `nowMin` était
   * décalé d'1h en permanence → les rappels "avant le début" arrivaient
   * jusqu'à 1h en retard (parfois après le début du shift). Ce helper relit
   * l'heure explicitement dans le fuseau du Congo, quel que soit le fuseau
   * du serveur.
   */
  private brazzavilleParts(date: Date = new Date()): { dateStr: string; minutesOfDay: number; dayOfWeek: number } {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Brazzaville',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      weekday: 'short',
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;

    // Certains moteurs JS renvoient "24" pour minuit en hour12:false — à normaliser.
    const hour = parts.hour === '24' ? 0 : Number(parts.hour);
    const minute = Number(parts.minute);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
      dateStr: `${parts.year}-${parts.month}-${parts.day}`,
      minutesOfDay: hour * 60 + minute,
      dayOfWeek: dayMap[parts.weekday],
    };
  }

  // Note : le helper de lookup groupé des affectations de shift a été retiré
  // ici — les rappels sont désormais basés uniquement sur l'heure officielle
  // de l'entreprise (shifts individuels mis de côté pour l'instant, à
  // réintégrer plus tard si besoin).

  private async notif(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: any;
  }): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          link: data.link ?? null,
          metadata: data.metadata ?? null,
          read: false,
        },
      });
    } catch (err: any) {
      this.logger.warn(`⚠️ Notif impossible ${data.userId}:`, err);
    }
  }
}