// src/recruitment/job-expiration.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobExpirationService {
  private readonly logger = new Logger(JobExpirationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * ⏰ CRON - Vérifier les expirations toutes les heures
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredJobs() {
    this.logger.log('🔍 Vérification des offres expirées...');

    const now = new Date();

    try {
      // Marquer comme expirées
      const result = await this.prisma.jobOffer.updateMany({
        where: {
          expirationDate: {
            lte: now,
          },
          status: 'PUBLISHED',
          isExpired: false,
        },
        data: {
          isExpired: true,
          status: 'CLOSED',
        },
      });

      if (result.count > 0) {
        this.logger.warn(`⚠️  ${result.count} offre(s) expirée(s) fermée(s)`);
      } else {
        this.logger.log('✅ Aucune offre expirée');
      }

      // Vérifier aussi les offres premium expirées
      const premiumExpired = await this.prisma.jobOffer.updateMany({
        where: {
          isPremium: true,
          premiumExpiresAt: {
            lte: now,
          },
        },
        data: {
          isPremium: false,
        },
      });

      if (premiumExpired.count > 0) {
        this.logger.log(
          `💎 ${premiumExpired.count} offre(s) premium expirée(s)`,
        );
      }
    } catch (error) {
      this.logger.error('❌ Erreur vérification expirations:', error);
    }
  }

  /**
   * 🔄 PROLONGER UNE OFFRE
   */
  async extendJobExpiration(jobId: string, newExpirationDate: Date) {
    const updated = await this.prisma.jobOffer.update({
      where: { id: jobId },
      data: {
        expirationDate: newExpirationDate,
        isExpired: false,
        status: 'PUBLISHED',
      },
    });

    this.logger.log(
      `🔄 Offre ${jobId} prolongée jusqu'au ${newExpirationDate.toLocaleDateString()}`,
    );

    return updated;
  }

  /**
   * ✅ VÉRIFIER SI UNE OFFRE EST EXPIRÉE
   */
  async isJobExpired(jobId: string): Promise<boolean> {
    const job = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      select: { expirationDate: true, isExpired: true, status: true },
    });

    if (!job) return true;
    if (job.status === 'CLOSED' || job.status === 'ARCHIVED') return true;
    if (!job.expirationDate) return false;

    const now = new Date();
    return job.expirationDate <= now || job.isExpired;
  }
}
