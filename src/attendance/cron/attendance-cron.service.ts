// ============================================================================
// 📁 src/attendance/cron/attendance-cron.service.ts
// ✅ v5.1 — Fix TS : randomMsg typed correctly (no mixed string | function)
// ============================================================================

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

// ─── Messages : rappel AVANT le début du shift ───────────────────────────────
// Rappel envoyé X min AVANT le début réel du shift (valeur fixe, pas de
// config par entreprise — cf. décision produit du 05/09/2026)
// Le délai est maintenant configurable via PlatformSettings (voir super admin)
// au lieu d'être figé ici.

const PRE_SHIFT_MESSAGES: Array<{ title: string; body: (mins: number) => string }> = [
  {
    title: '⏳ Votre shift approche',
    body: (m) => `Votre shift commence dans ${m} min. Préparez-vous à pointer votre arrivée.`,
  },
  {
    title: '🔔 Rappel de shift',
    body: (m) => `Encore ${m} min avant le début de votre shift. À tout de suite sur Konza RH !`,
  },
  {
    title: '📅 Bientôt l’heure',
    body: (m) => `Votre shift débute dans ${m} min. N'oubliez pas de pointer à l'heure.`,
  },
];

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
  // Version simplifiée (11/2026) : on met de côté les shifts individuels par
  // employé pour l'instant — on se base uniquement sur l'heure officielle de
  // l'entreprise (PayrollSettings.officialStartHour). Tous les employés d'une
  // même entreprise sont donc prévenus au même moment.
  // Tourne toutes les 5 min, 24h/24 (plus de fenêtres 0-10h/16-20h) : chaque
  // entreprise a son propre officialStartHour, calculé dynamiquement plus bas
  // (target = officialStartHour*60 - preShiftMinutes), donc une entreprise qui
  // démarre à 13h ou 22h doit pouvoir être notifiée aussi, pas seulement celles
  // qui démarrent le matin ou en fin d'après-midi.
  // ============================================================================
  @Cron('* * * * *', { timeZone: 'Africa/Brazzaville' })
  async handlePreOfficialStartReminder(): Promise<void> {
    const LOCK = 'attendance-cron:pre-start';
    if (!(await this.cronLock.acquire(LOCK, 270))) {
      this.logger.debug(`⏭️ ${LOCK} déjà en cours ailleurs, ce tick est sauté`);
      return;
    }
    this.heldLocks.add(LOCK);

    const startedAt = Date.now();
    const now = new Date();
    const today = this.today();
    const { minutesOfDay: nowMin, dayOfWeek } = this.brazzavilleParts(now);

    try {
      const platformSettings = await this.platformSettings.get();
      const preShiftMinutes = platformSettings.preShiftReminderMinutes;

      const holidays = await this.prisma.publicHoliday.findMany({
        where: { date: today },
        select: { companyId: true },
      });
      const holidayCompanyIds = new Set(holidays.map((h) => h.companyId));

      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        include: {
          payrollSettings: { orderBy: { effectiveDate: 'desc' }, take: 1 },
        },
      });

      for (const company of companies) {
        const settings = company.payrollSettings[0];
        if (!settings) continue;
        if (holidayCompanyIds.has(company.id)) continue;

        const workDays = (settings.workDays as number[]) || [1, 2, 3, 4, 5];
        if (!workDays.includes(dayOfWeek)) continue;

        const officialStartHour = settings.officialStartHour ?? 8;
        const target = officialStartHour * 60 - preShiftMinutes;
        // Fenêtre resserrée à 2 min (au lieu de 5) maintenant que le cron
        // tourne toutes les minutes : ça absorbe un tick raté (lock déjà pris
        // par un run précédent trop lent) sans laisser traîner le rappel.
        const withinTick = nowMin >= target && nowMin < target + 2;
        if (!withinTick) continue;

        // Tous les employés actifs pas encore pointés aujourd'hui, prévenus
        // en même temps — plus de logique de shift individuel.
        const employees = await this.prisma.employee.findMany({
          where: {
            companyId: company.id,
            status: 'ACTIVE',
            attendances: { none: { date: today } },
            leaves: {
              none: {
                status: 'APPROVED',
                startDate: { lte: new Date(today) },
                endDate: { gte: new Date(today) },
              },
            },
          },
          include: {
            user: { select: { id: true, pushToken: true, pushNotifEnabled: true } },
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

          const dedupKey = `pre-start:${emp.id}:${today}`;
          const canNotify = await this.notificationsService.tryClaim(dedupKey);
          if (!canNotify) {
            skipped.push({ employeeId: emp.id, name: empName, reason: 'Déjà notifié aujourd\'hui (dédoublonnage)' });
            return;
          }

          const msg = randomItem(PRE_SHIFT_MESSAGES);
          const title = msg.title;
          const body = msg.body(preShiftMinutes);

          await this.notif({
            userId: emp.user.id,
            type: 'PRE_SHIFT_REMINDER' as NotificationType,
            title,
            message: body,
            link: '/presences/pointage',
            metadata: { employeeId: emp.id, companyId: company.id, date: today, preShiftMinutes },
          });

          if (!emp.user.pushNotifEnabled) {
            skipped.push({ employeeId: emp.id, name: empName, reason: 'Notif in-app créée, mais push désactivé dans le profil' });
          } else if (!emp.user.pushToken) {
            skipped.push({ employeeId: emp.id, name: empName, reason: 'Notif in-app créée, mais aucun token push enregistré' });
          }

          await this.pushService.sendPushToUser(emp.user.id, {
            title,
            body,
            url: '/presences/pointage',
            tag: 'pre-start-reminder',
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

  @Cron('*/5 0-10,16-20 * * *', { timeZone: 'Africa/Brazzaville' })
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
        const withinTick = nowMin >= target && nowMin < target + 5;
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
                user: { select: { id: true, pushToken: true, pushNotifEnabled: true } },
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
            } else if (!att.employee.user.pushToken) {
              skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Notif in-app créée, mais aucun token push enregistré' });
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
            } else if (!att.employee.user.pushToken) {
              skipped.push({ employeeId: att.employeeId, name: empName, reason: 'Notif in-app créée, mais aucun token push enregistré' });
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

  // ============================================================================
  // CRON 4 — Auto-close minuit
  // ============================================================================
  @Cron('1 0 * * *', { timeZone: 'Africa/Brazzaville' })
  async handleMidnightAutoClose(): Promise<void> {
    this.logger.log('⏰ Auto-close minuit...');
    try {
      const yesterday = this.yesterday();
      const midnight = new Date();
      midnight.setHours(0, 1, 0, 0);

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

      for (const att of open) {
        const s = att.employee.company.payrollSettings[0];
        const startH = s?.officialStartHour ?? 8;
        const wh = Number(s?.workHoursPerDay ?? 8);
        const endH = startH + wh;
        const closure = new Date(yesterday);
        closure.setHours(endH, 0, 0, 0);
        const total = Math.max(
          0,
          (closure.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000,
        );

        await this.prisma.attendance.update({
          where: { id: att.id },
          data: {
            checkOut: closure,
            totalHours: parseFloat(total.toFixed(2)),
            normalHours: parseFloat(Math.min(total, wh).toFixed(2)),
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

      this.logger.log(`✅ Auto-close terminé — ${open.length} fermés`);
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
    const closure = new Date(att.date);
    closure.setHours(startH + wh, 0, 0, 0);
    const total =
      (closure.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000;

    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOut: closure,
        totalHours: parseFloat(total.toFixed(2)),
        normalHours: parseFloat(Math.min(total, wh).toFixed(2)),
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
    const isOutside = !workDays.includes(attDate.getDay());
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
    const closure = new Date(att.date);
    closure.setHours(startH + wh, 0, 0, 0);
    const total =
      (closure.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000;

    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOut: closure,
        totalHours: parseFloat(total.toFixed(2)),
        normalHours: parseFloat(Math.min(total, wh).toFixed(2)),
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