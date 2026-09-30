// ============================================================================
// 📁 src/holidays/holidays.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CronLockModule } from '../cron-lock/cron-lock.module';
import { HolidaysCronService } from './holidays-cron.service';

@Module({
  imports: [PrismaModule, CronLockModule],
  providers: [HolidaysCronService],
})
export class HolidaysModule {}