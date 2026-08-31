// ============================================================================
// 📄 src/documents/cron/documents-cron.service.ts — CORRIGÉ
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentStatus } from '@prisma/client';

@Injectable()
export class DocumentsCronService {
  private readonly logger = new Logger(DocumentsCronService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 7 * * *', { timeZone: 'Africa/Brazzaville' })
  async handleDocumentExpiryCheck() {
    this.logger.log('📋 Cron documents — vérification expirations');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const in7 = new Date(today);
    in7.setDate(today.getDate() + 7);
    const in30 = new Date(today);
    in30.setDate(today.getDate() + 30);
    const in60 = new Date(today);
    in60.setDate(today.getDate() + 60);

    try {
      await this.markExpired(today);
      await this.sendAlerts(today, in7, in30, in60);
    } catch (err) {
      this.logger.error('Erreur cron documents', err);
    }
  }

  private async markExpired(today: Date) {
    const result = await this.prisma.document.updateMany({
      where: {
        status: DocumentStatus.VERIFIED,
        isArchived: false,
        expiresAt: { not: null, lt: today },
      },
      data: { status: DocumentStatus.EXPIRED },
    });
    if (result.count > 0) {
      this.logger.log(`🔴 ${result.count} document(s) basculé(s) en EXPIRED`);
    }
  }

  private async sendAlerts(today: Date, in7: Date, in30: Date, in60: Date) {
    // Company.legalName est le bon champ (pas "name")
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, legalName: true }, // ← legalName pas name
    });

    for (const company of companies) {
      const [exp60, exp30, exp7] = await Promise.all([
        this.prisma.document.findMany({
          where: {
            companyId: company.id,
            status: DocumentStatus.VERIFIED,
            isArchived: false,
            expiresAt: { not: null, lte: in60, gt: in30 },
          },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
        }),
        this.prisma.document.findMany({
          where: {
            companyId: company.id,
            status: DocumentStatus.VERIFIED,
            isArchived: false,
            expiresAt: { not: null, lte: in30, gt: in7 },
          },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
        }),
        this.prisma.document.findMany({
          where: {
            companyId: company.id,
            status: DocumentStatus.VERIFIED,
            isArchived: false,
            expiresAt: { not: null, lte: in7, gte: today },
          },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
        }),
      ]);

      if (!exp60.length && !exp30.length && !exp7.length) continue;

      const managers = await this.prisma.user.findMany({
        where: {
          companyId: company.id,
          role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] },
          isActive: true,
        },
        select: { id: true },
      });

      for (const manager of managers) {
        if (exp60.length) {
          await this.notify(
            manager.id,
            '📋 Documents arrivant à expiration',
            `${exp60.length} document(s) expirent dans moins de 60 jours.`,
          );
        }
        if (exp30.length) {
          const names = exp30
            .slice(0, 3)
            .map(
              (d) =>
                `${d.employee?.firstName} ${d.employee?.lastName} — ${d.name}`,
            )
            .join(', ');
          await this.notify(
            manager.id,
            '⚠️ Documents expirent dans 30 jours',
            `${exp30.length} document(s) à renouveler : ${names}${exp30.length > 3 ? '...' : ''}`,
          );
        }
        if (exp7.length) {
          const names = exp7
            .map(
              (d) =>
                `${d.employee?.firstName} ${d.employee?.lastName} — ${d.name}`,
            )
            .join(', ');
          await this.notify(
            manager.id,
            '🔴 URGENT — Documents expirent dans 7 jours',
            `Action immédiate requise : ${names}`,
          );
        }
      }

      this.logger.log(
        `✅ ${company.legalName} — J-60:${exp60.length} J-30:${exp30.length} J-7:${exp7.length}`,
      );
    }
  }

  private async notify(userId: string, title: string, message: string) {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type: 'DOCUMENT_UPLOADED',
          title,
          message,
          read: false, // ← "read" pas "isRead"
        },
      });
    } catch (err) {
      this.logger.warn(`Notif échouée pour ${userId}`, err);
    }
  }
}
