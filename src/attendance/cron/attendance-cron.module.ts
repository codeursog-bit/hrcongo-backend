import { Module, forwardRef } from '@nestjs/common'; // 👈 Ajoute aussi forwardRef ici
import { AttendanceCronService } from './attendance-cron.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AttendanceModule } from '../attendance.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    forwardRef(() => AttendanceModule), // ✅ Correct
  ],
  providers: [AttendanceCronService],
  exports: [AttendanceCronService],
})
export class AttendanceCronModule {}
