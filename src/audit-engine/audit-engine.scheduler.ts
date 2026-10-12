// ============================================================================
// 📁 src/audit-engine/audit-engine.scheduler.ts
// Contrôle nocturne du mois en cours pour toute entreprise qui a des bulletins.
// Verrou en base (CronLockService) : un seul exécutant même en multi-instances.
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../cron-lock/cron-lock.service';
import { AuditEngineService } from './audit-engine.service';

@Injectable()
export class AuditEngineScheduler {
  private readonly logger = new Logger(AuditEngineScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AuditEngineService,
    private readonly lock: CronLockService,
  ) {}

  // Chaque nuit à 2h30, heure de Brazzaville.
  @Cron('30 2 * * *', { timeZone: 'Africa/Brazzaville' })
  async nightlyAudit() {
    const LOCK = 'audit-engine-nightly';
    if (!(await this.lock.acquire(LOCK, 55 * 60))) return;
    try {
      const local = new Date(Date.now() + 3_600_000); // UTC+1 : pas de changement d'heure au Congo
      const month = local.getUTCMonth() + 1;
      const year = local.getUTCFullYear();
      const companies = await this.prisma.payroll.groupBy({
        by: ['companyId'], where: { month, year, status: { not: 'CANCELLED' } },
      });
      for (const { companyId } of companies) {
        try {
          await this.engine.run(companyId, { month, year, trigger: 'CRON', actor: null });
        } catch (err) {
          this.logger.error(`Contrôle automatique échoué (entreprise ${companyId}) : ${(err as Error).message}`);
        }
      }
      this.logger.log(`Contrôle nocturne terminé : ${companies.length} entreprise(s)`);
    } finally {
      await this.lock.release(LOCK);
    }
  }
}