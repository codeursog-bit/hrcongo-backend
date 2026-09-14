// ============================================================================
// Fichier: backend/src/cron-lock/cron-lock.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { CronLockService } from './cron-lock.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CronLockService],
  exports: [CronLockService],
})
export class CronLockModule {}