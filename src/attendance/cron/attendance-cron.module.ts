import { Module, forwardRef } from '@nestjs/common'; // 👈 Ajoute aussi forwardRef ici
import { AttendanceCronService } from './attendance-cron.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AttendanceModule } from '../attendance.module';
import { SystemLogsModule } from '../../system-logs/system-logs.module';
import { CronLockModule } from '../../cron-lock/cron-lock.module';
import { PlatformSettingsModule } from '../../platform-settings/platform-settings.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    SystemLogsModule,
    CronLockModule,
    PlatformSettingsModule,
    forwardRef(() => AttendanceModule), // ✅ Correct
  ],
  providers: [AttendanceCronService],
  exports: [AttendanceCronService],
})
export class AttendanceCronModule {}