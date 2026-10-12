import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CronLockModule } from '../cron-lock/cron-lock.module';
import { AuditEngineService } from './audit-engine.service';
import { AuditGateService } from './audit-gate.service';
import { AuditFindingsService } from './audit-findings.service';
import { AuditEngineController } from './audit-engine.controller';
import { AuditEngineScheduler } from './audit-engine.scheduler';

// AuditTrailService vient du AuditTrailModule (@Global).
@Module({
  imports: [PrismaModule, CronLockModule],
  providers: [AuditEngineService, AuditGateService, AuditFindingsService, AuditEngineScheduler],
  controllers: [AuditEngineController],
  exports: [AuditEngineService, AuditGateService],
})
export class AuditEngineModule {}