// 📁 EMPLACEMENT (projet backend) : src/device-sync/device-sync.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CronLockModule } from '../cron-lock/cron-lock.module';
import { DeviceSyncController } from './device-sync.controller';
import { DeviceSyncAgentController } from './device-sync-agent.controller';
import { DeviceSyncService } from './device-sync.service';
import { DeviceSyncProcessor } from './device-sync-processor.service';
import { DeviceSyncCron } from './device-sync.cron';
import { SyncAgentKeyGuard } from './guards/sync-agent-key.guard';

@Module({
  imports: [PrismaModule, AttendanceModule, CronLockModule],
  controllers: [DeviceSyncController, DeviceSyncAgentController],
  providers: [DeviceSyncService, DeviceSyncProcessor, DeviceSyncCron, SyncAgentKeyGuard],
  exports: [DeviceSyncService],
})
export class DeviceSyncModule {}