// ============================================================================
// 📁 src/attendance/cron/attendance-cron.service.ts
// ✅ v5.1 — Fix TS : randomMsg typed correctly (no mixed string | function)
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PushNotificationsService } from '../../notifications/push-notifications.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import {
  AttendanceUtilsService,
  WEEKLY_NORMAL_HOURS,
  WEEKLY_OT10_CAP,
} from '../services/attendance-utils.service';

// ─── Messages : rappel AVANT le début du shift ───────────────────────────────
// Rappel envoyé X min AVANT le début réel du shift (valeur fixe, pas de
// config par entreprise — cf. décision produit du 05/09/2026)
const PRE_SHIFT_REMINDER_MINUTES = 20;

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

const CHECK_IN_MESSAGES: Array<{ title: string; body: string }> = [
  {
    title: '☀️ Bonjour !',
    body: "Votre journée commence. N'oubliez pas de marquer votre arrivée.",
  },
  {
    title: "☕ C'est parti !",
    body: 'Café en main ? Pensez à pointer votre entrée sur Konza Suite.',
  },
  {
    title: '👋 Bonne journée !',
    body: 'Cliquez ici pour marquer votre présence.',
  },
  {
    title: '🌟 En forme ?',
    body: "Votre shift commence. N'oubliez pas de pointer.",
  },
];

// Messages retard : body est une fonction — tableau séparé et typé
const CHECK_IN_LATE_MESSAGES: Array<{
  title: string;
  body: (name: string) => string;
}> = [
  {
    title: '⏰ Vous êtes en retard',
    body: (n) =>
      `${n}, votre shift a commencé il y a plus de 20 min. Pensez à pointer dès que possible.`,
  },
  {
    title: '🕐 Retard noté',
    body: (n) =>
      `${n}, pas encore de pointage. Tout va bien ? Signalez-vous dès que vous pouvez.`,
  },
  {
    title: '📲 Pointage en attente',
    body: (n) =>
      `${n}, votre shift a démarré. Pensez à pointer à votre arrivée.`,
  },
];

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
export class AttendanceCronService {
  private readonly logger = new Logger(AttendanceCronService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationsService,
    private notificationsService: NotificationsService,
    private utils: AttendanceUtilsService,
  ) {}

  // ============================================================================
  // CRON 0 — Rappels AVANT le shift (toutes les 5 min)
  // But : si l'employé est "connecté" (abonné aux push sur son appareil),
  // on le prévient 20-30 min avant le début réel de son shift, avant même
  // l'heure de début (contrairement aux crons 1/2 ci-dessous qui gèrent
  // les rappels APRÈS le début — retard / oubli de sortie).
  // ============================================================================
  @Cron('*/5 * * * *', { timeZone: 'Africa/Brazzaville' })
  async handlePreShiftReminders(): Promise<void> {
    const now = new Date();
    const today = this.today();
    try {
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
        const officialStartHour = settings.officialStartHour ?? 8;
        const preShiftMinutes = PRE_SHIFT_REMINDER_MINUTES;
        const workDays = (settings.workDays as number[]) || [1, 2, 3, 4, 5];
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const TOTAL = 24 * 60;

        if (holidayCompanyIds.has(company.id)) continue;

        // Uniquement les employés "connectés" (abonnés aux notifications
        // push) et pas encore pointés aujourd'hui — inutile de les prévenir
        // s'ils ont déjà pointé.
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
            user: { pushNotifEnabled: true, pushToken: { not: null } },
          },
          include: {
            user: {
              select: { id: true, pushToken: true, pushNotifEnabled: true },
            },
          },
        });

        for (const emp of employees) {
          if (!emp.user?.id) continue;

          const sa = await this.prisma.employeeShiftAssignment.findFirst({
            where: {
              employeeId: emp.id,
              OR: [
                { specificDate: today },
                {
                  dayOfWeek: now.getDay(),
                  specificDate: null,
                  OR: [
                    { validFrom: null },
                    { validFrom: { lte: new Date(today) } },
                  ],
                  AND: [
                    {
                      OR: [
                        { validUntil: null },
                        { validUntil: { gte: new Date(today) } },
                      ],
                    },
                  ],
                },
              ],
            },
            include: { shift: true },
            orderBy: { specificDate: 'desc' },
          });

          const shift = sa?.shift;
          if (!shift && !workDays.includes(now.getDay())) continue;

          const startH = shift?.startHour ?? officialStartHour;
          const startMin = shift?.startMinute ?? 0;
          const shiftStartTotal = startH * 60 + startMin;
          const target = ((shiftStartTotal - preShiftMinutes) % TOTAL + TOTAL) % TOTAL;

          // Fenêtre de 5 min correspondant au pas du cron
          const withinTick =
            nowMin >= target && nowMin < target + 5;
          if (!withinTick) continue;

          // Idempotence : une seule notification "pré-shift" par employé/jour,
          // même si le cron tourne plusieurs fois dans la fenêtre ou sur
          // plusieurs instances backend en parallèle.
          const dedupKey = `pre-shift:${emp.id}:${today}`;
          const canNotify = await this.notificationsService.tryClaim(dedupKey);
          if (!canNotify) continue;

          const msg = randomItem(PRE_SHIFT_MESSAGES);
          const title = msg.title;
          const body = msg.body(preShiftMinutes);

          await this.notif({
            userId: emp.user.id,
            type: 'PRE_SHIFT_REMINDER' as NotificationType,
            title,
            message: body,
            link: '/presences/pointage',
            metadata: {
              employeeId: emp.id,
              companyId: company.id,
              date: today,
              shiftStart: `${startH}h${String(startMin).padStart(2, '0')}`,
              preShiftMinutes,
            },
          });

          await this.pushService.sendPushToUser(emp.user.id, {
            title,
            body,
            url: '/presences/pointage',
            tag: 'pre-shift-reminder',
          });

          this.logger.log(
            `📲 Pré-shift (${preShiftMinutes}min) → ${emp.firstName} ${emp.lastName} (shift ${startH}h${String(startMin).padStart(2, '0')})`,
          );
        }
      }
    } catch (err) {
      this.logger.error('❌ Cron pré-shift:', err);
    }
  }

  // ============================================================================
  // CRON 1 — Rappels check-in H24 (toutes les 10 min)
  // ============================================================================
  @Cron('*/10 * * * *', { timeZone: 'Africa/Brazzaville' })
  async handleCheckInReminders(): Promise<void> {
    const now = new Date();
    const today = this.today();
    try {
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
        const officialStartHour = settings.officialStartHour ?? 8;
        const lateToleranceMinutes = settings.lateToleranceMinutes ?? 15;
        const workDays = (settings.workDays as number[]) || [1, 2, 3, 4, 5];
        const nowMin = now.getHours() * 60 + now.getMinutes();

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
            user: {
              select: { id: true, pushToken: true, pushNotifEnabled: true },
            },
          },
        });

        for (const emp of employees) {
          if (!emp.user?.id) continue;

          const sa = await this.prisma.employeeShiftAssignment.findFirst({
            where: {
              employeeId: emp.id,
              OR: [
                { specificDate: today },
                {
                  dayOfWeek: now.getDay(),
                  specificDate: null,
                  OR: [
                    { validFrom: null },
                    { validFrom: { lte: new Date(today) } },
                  ],
                  AND: [
                    {
                      OR: [
                        { validUntil: null },
                        { validUntil: { gte: new Date(today) } },
                      ],
                    },
                  ],
                },
              ],
            },
            include: { shift: true },
            orderBy: { specificDate: 'desc' },
          });

          const shift = sa?.shift;
          if (!shift && !workDays.includes(now.getDay())) continue;
          if (!shift && holidayCompanyIds.has(company.id)) continue;

          const startH = shift?.startHour ?? officialStartHour;
          const startMin = shift?.startMinute ?? 0;
          const tol = shift ? 20 : lateToleranceMinutes;
          const TOTAL = 24 * 60;
          const threshold = (startH * 60 + startMin + tol) % TOTAL;
          const windowEnd = (threshold + 90) % TOTAL;
          const inWindow =
            threshold <= windowEnd
              ? nowMin >= threshold && nowMin <= windowEnd
              : nowMin >= threshold || nowMin <= windowEnd;
          if (!inWindow) continue;

          // ✅ Fix TS : tableaux séparés, body résolu ici
          const isLate = nowMin > (startH * 60 + startMin + 20) % TOTAL;
          let title: string;
          let body: string;

          if (isLate) {
            const msg = randomItem(CHECK_IN_LATE_MESSAGES);
            title = msg.title;
            body = msg.body(emp.firstName);
          } else {
            const msg = randomItem(CHECK_IN_MESSAGES);
            title = msg.title;
            body = msg.body;
          }

          await this.notif({
            userId: emp.user.id,
            type: 'CHECKIN_REMINDER',
            title,
            message: body,
            link: '/presences/pointage',
            metadata: {
              employeeId: emp.id,
              companyId: company.id,
              date: today,
              isLate,
            },
          });

          await this.pushService.sendPushToUser(emp.user.id, {
            title,
            body,
            url: '/presences/pointage',
            tag: isLate ? 'checkin-late' : 'checkin-reminder',
          });

          this.logger.log(
            `📲 Check-in${isLate ? ' RETARD' : ''} → ${emp.firstName} ${emp.lastName} (shift ${startH}h${String(startMin).padStart(2, '0')})`,
          );
        }
      }
    } catch (err) {
      this.logger.error('❌ Cron check-in:', err);
    }
  }

  // ============================================================================
  // CRON 2 — Rappels check-out H24 (toutes les 5 min)
  // ============================================================================
  @Cron('*/5 * * * *', { timeZone: 'Africa/Brazzaville' })
  async handleCheckOutReminders(): Promise<void> {
    const now = new Date();
    const today = this.today();
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
        const overtimeEnabled = (settings as any).overtimeEnabled ?? true;
        const workHoursPerDay = Number(settings.workHoursPerDay ?? 8);
        const officialStartH = settings.officialStartHour ?? 8;
        const officialEndH = officialStartH + workHoursPerDay;
        const nowMin = now.getHours() * 60 + now.getMinutes();

        const openAttendances = await this.prisma.attendance.findMany({
          where: {
            companyId: company.id,
            date: today,
            checkIn: { not: null },
            checkOut: null,
            overtimeStatus: { in: ['NONE'] },
          } as any,
          include: {
            employee: {
              include: {
                user: {
                  select: { id: true, pushToken: true, pushNotifEnabled: true },
                },
              },
            },
          },
        });

        for (const att of openAttendances) {
          if (!att.employee.user?.id) continue;

          const sa = await this.prisma.employeeShiftAssignment.findFirst({
            where: {
              employeeId: att.employeeId,
              OR: [
                { specificDate: today },
                {
                  dayOfWeek: now.getDay(),
                  specificDate: null,
                  OR: [
                    { validFrom: null },
                    { validFrom: { lte: new Date(today) } },
                  ],
                  AND: [
                    {
                      OR: [
                        { validUntil: null },
                        { validUntil: { gte: new Date(today) } },
                      ],
                    },
                  ],
                },
              ],
            },
            include: { shift: true },
            orderBy: { specificDate: 'desc' },
          });

          const shift = sa?.shift;
          let empEndH = officialEndH;
          if (shift?.endHour !== undefined) {
            empEndH = shift.crossesMidnight
              ? shift.endHour + 24
              : shift.endHour;
          }

          const empEndMin = (empEndH * 60 + 10) % (24 * 60);
          const isAfterEnd =
            empEndH >= 24
              ? now.getHours() * 60 + now.getMinutes() >= empEndMin
              : nowMin >= empEndMin;
          if (!isAfterEnd) continue;

          const hoursElapsed =
            (now.getTime() - new Date(att.checkIn!).getTime()) / 3_600_000;
          const shiftDuration = shift
            ? shift.crossesMidnight
              ? shift.endHour + 24 - shift.startHour
              : shift.endHour - shift.startHour
            : workHoursPerDay;
          const pendingOT = Math.max(0, hoursElapsed - shiftDuration);

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
            await this.notif({
              userId: att.employee.user.id,
              type: 'CHECKOUT_REMINDER',
              title: msg.title,
              message: `${msg.body} (${pendingOT.toFixed(1)}h de dépassement calculé)`,
              link: '/presences/pointage',
              metadata: {
                attendanceId: att.id,
                employeeId: att.employeeId,
                pendingOvertimeHours: pendingOT,
                action: 'FORGOT_OR_OVERTIME',
                companyId: company.id,
              },
            });
            await this.pushService.sendPushToUser(att.employee.user.id, {
              title: msg.title,
              body: `${msg.body} (${pendingOT.toFixed(1)}h de dépassement)`,
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
              metadata: {
                attendanceId: att.id,
                employeeId: att.employeeId,
                action: 'CHECKOUT_ONLY',
                companyId: company.id,
              },
            });
            await this.pushService.sendPushToUser(att.employee.user.id, {
              title: msg.title,
              body: msg.body,
              url: '/presences/pointage',
              tag: 'checkout-reminder',
            });
          }

          this.logger.log(
            `📲 Check-out → ${att.employee.firstName} ${att.employee.lastName} (fin ${empEndH % 24}h)`,
          );
        }
      }
    } catch (err) {
      this.logger.error('❌ Cron check-out:', err);
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
    } catch (err) {
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
    } catch (err) {
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
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  private yesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

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
    } catch (err) {
      this.logger.warn(`⚠️ Notif impossible ${data.userId}:`, err);
    }
  }
}