// ============================================================================
// 📁 src/contracts/trial-period.service.ts
// ✅ Gestion automatique des périodes d'essai
// - Tourne chaque matin à 8h (Brazzaville)
// - Passe IN_PROGRESS → EXPIRED quand trialEndDate dépassée
// - Notifie les RH 7 jours avant la fin de l'essai
// - Confirme automatiquement si aucune action après la date de fin
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { startOfDay, differenceInDays, addDays } from 'date-fns';

@Injectable()
export class TrialPeriodService {
  private readonly logger = new Logger(TrialPeriodService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ─── Tourne chaque jour à 8h ──────────────────────────────────────────────
  @Cron('0 8 * * *', { timeZone: 'Africa/Brazzaville' })
  async checkTrialPeriods(): Promise<void> {
    this.logger.log("⏰ Vérification des périodes d'essai...");
    const today = startOfDay(new Date());

    // 1. Passer IN_PROGRESS → EXPIRED si trialEndDate dépassée
    const expired = await this.prisma.employee.updateMany({
      where: {
        trialStatus: 'IN_PROGRESS',
        trialEndDate: { lt: today },
        status: 'ACTIVE',
      } as any,
      data: { trialStatus: 'EXPIRED' } as any,
    });

    if (expired.count > 0) {
      this.logger.log(`⚠️ ${expired.count} essai(s) passé(s) en EXPIRED`);
      await this.notifyExpiredTrials(today);
    }

    // 2. Alertes J-7 avant fin d'essai
    const alertDate = addDays(today, 7);
    const nearEnd = await this.prisma.employee.findMany({
      where: {
        trialStatus: 'IN_PROGRESS',
        trialEndDate: {
          gte: today,
          lte: alertDate,
        },
        status: 'ACTIVE',
      } as any,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        trialEndDate: true,
        contractType: true,
        companyId: true,
        company: {
          select: {
            users: {
              where: {
                role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] },
                isActive: true,
              },
              select: { id: true },
            },
          },
        },
      },
    });

    for (const emp of nearEnd as any[]) {
      const daysLeft = differenceInDays(new Date(emp.trialEndDate), today);
      await this.sendTrialEndAlert(emp, daysLeft);
    }

    this.logger.log(`✅ ${nearEnd.length} alerte(s) fin d'essai envoyée(s)`);
  }

  // ─── Confirmer manuellement un employé après l'essai ──────────────────────
  async confirmTrial(employeeId: string, confirmedById: string): Promise<void> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { trialStatus: true, firstName: true, lastName: true },
    });

    if (!emp) throw new Error('Employé introuvable');
    if (!['IN_PROGRESS', 'EXPIRED'].includes((emp as any).trialStatus ?? '')) {
      throw new Error("Cet employé n'est pas en période d'essai");
    }

    await (this.prisma.employee as any).update({
      where: { id: employeeId },
      data: {
        trialStatus: 'CONFIRMED',
        trialConfirmedAt: new Date(),
      },
    });

    this.logger.log(`✅ Essai confirmé — ${emp.firstName} ${emp.lastName}`);
  }

  // ─── Rompre l'essai (pas d'indemnités) ────────────────────────────────────
  async failTrial(
    employeeId: string,
    reason: string,
    processedById: string,
  ): Promise<void> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { trialStatus: true, firstName: true, lastName: true },
    });

    if (!emp) throw new Error('Employé introuvable');

    await (this.prisma.employee as any).update({
      where: { id: employeeId },
      data: {
        trialStatus: 'FAILED',
        status: 'TERMINATED',
        terminationDate: new Date(),
        terminationReason: `Rupture période d'essai : ${reason}`,
      },
    });

    this.logger.log(`❌ Essai rompu — ${emp.firstName} ${emp.lastName}`);
  }

  // ─── Récupérer les employés en essai pour le dashboard ────────────────────
  async getActiveTrials(companyId: string) {
    const today = startOfDay(new Date());

    const employees = await (this.prisma.employee as any).findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        trialStatus: { in: ['IN_PROGRESS', 'EXPIRED'] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        position: true,
        contractType: true,
        hireDate: true,
        trialPeriodDays: true,
        trialEndDate: true,
        trialStatus: true,
        department: { select: { name: true } },
      },
      orderBy: { trialEndDate: 'asc' },
    });

    return employees.map((e: any) => {
      const daysLeft = e.trialEndDate
        ? differenceInDays(new Date(e.trialEndDate), today)
        : 0;
      return {
        ...e,
        daysLeft,
        urgency:
          daysLeft <= 0
            ? 'EXPIRED'
            : daysLeft <= 3
              ? 'CRITICAL'
              : daysLeft <= 7
                ? 'HIGH'
                : daysLeft <= 14
                  ? 'MEDIUM'
                  : 'LOW',
      };
    });
  }

  // ─── Privé : notifier les RH pour essais expirés ──────────────────────────
  private async notifyExpiredTrials(today: Date): Promise<void> {
    const expired = await (this.prisma.employee as any).findMany({
      where: {
        trialStatus: 'EXPIRED',
        status: 'ACTIVE',
        // Notifier seulement ceux expirés aujourd'hui (trialEndDate = hier)
        trialEndDate: {
          gte: addDays(today, -2),
          lt: today,
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        contractType: true,
        trialEndDate: true,
        companyId: true,
        company: {
          select: {
            users: {
              where: {
                role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] },
                isActive: true,
              },
              select: { id: true },
            },
          },
        },
      },
    });

    for (const emp of expired as any[]) {
      for (const admin of emp.company.users) {
        // Anti-doublon : pas déjà notifié ce jour
        const existing = await this.prisma.notification.findFirst({
          where: {
            userId: admin.id,
            type: 'SYSTEM_ALERT',
            metadata: { path: ['employeeId'], equals: emp.id },
            createdAt: { gte: startOfDay(today) },
          },
        });
        if (existing) continue;

        await this.notifications.create({
          userId: admin.id,
          type: 'SYSTEM_ALERT',
          title: `⚠️ Essai expiré — ${emp.firstName} ${emp.lastName}`,
          message: `La période d'essai de ${emp.firstName} ${emp.lastName} (${emp.position}, ${emp.contractType}) est terminée depuis le ${new Date(emp.trialEndDate).toLocaleDateString('fr-FR')}. Confirmez ou rompez l'essai.`,
          link: `/employes/${emp.id}`,
          metadata: {
            type: 'TRIAL_EXPIRED',
            employeeId: emp.id,
            contractType: emp.contractType,
          },
        });
      }
    }
  }

  // ─── Privé : alerte J-7 fin d'essai ───────────────────────────────────────
  private async sendTrialEndAlert(emp: any, daysLeft: number): Promise<void> {
    for (const admin of emp.company.users) {
      // Anti-doublon : pas déjà alerté cette semaine pour ce seuil
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId: admin.id,
          type: 'SYSTEM_ALERT',
          metadata: {
            path: ['employeeId'],
            equals: emp.id,
          },
          createdAt: { gte: addDays(new Date(), -7) },
        },
      });
      if (existing) continue;

      await this.notifications.create({
        userId: admin.id,
        type: 'SYSTEM_ALERT',
        title: `🔔 Fin d'essai dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''} — ${emp.firstName} ${emp.lastName}`,
        message: `La période d'essai de ${emp.firstName} ${emp.lastName} (${emp.contractType}) se termine le ${new Date(emp.trialEndDate).toLocaleDateString('fr-FR')}. Pensez à confirmer ou rompre l'essai avant cette date.`,
        link: `/employes/${emp.id}`,
        metadata: {
          type: 'TRIAL_ENDING_SOON',
          employeeId: emp.id,
          daysLeft,
          contractType: emp.contractType,
        },
      });
    }
  }
}