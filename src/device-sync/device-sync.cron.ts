// 📁 EMPLACEMENT (projet backend) : src/device-sync/device-sync.cron.ts
// ============================================================================
// ⏰ - 23h30 (Brazzaville) : un job de synchronisation nocturne par connecteur actif.
//    - toutes les 5 min : débloque les jobs coincés (agent éteint…).
//    Verrou CronLockService : sûr même avec plusieurs instances du serveur.
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronLockService } from '../cron-lock/cron-lock.service';
import { DeviceSyncService } from './device-sync.service';

@Injectable()
export class DeviceSyncCron {
  private readonly logger = new Logger(DeviceSyncCron.name);
  constructor(private readonly service: DeviceSyncService, private readonly lock: CronLockService) {}

  @Cron('30 23 * * *', { timeZone: 'Africa/Brazzaville' })
  async nightly() {
    const LOCK = 'device-sync-nightly';
    if (!(await this.lock.acquire(LOCK, 600))) return;
    try {
      const n = await this.service.createScheduledJobs();
      if (n) this.logger.log(`🌙 Synchronisation nocturne : ${n} pointeuse(s) planifiée(s)`);
    } catch (e: any) {
      this.logger.error(`Synchronisation nocturne : ${e?.message}`);
    } finally {
      await this.lock.release(LOCK);
    }
  }

  @Cron('*/5 * * * *', { timeZone: 'Africa/Brazzaville' })
  async cleanup() {
    try { await this.service.expireStale(); } catch (e: any) { this.logger.warn(`expireStale : ${e?.message}`); }
  }
}