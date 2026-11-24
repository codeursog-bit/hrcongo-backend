import { Module } from '@nestjs/common';
import { CheckinDevicesController } from './checkin-devices.controller';
import { CheckinDevicesService } from './checkin-devices.service';
import { KioskApiKeyGuard } from './guards/kiosk-api-key.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [
    PrismaModule,
    AttendanceModule, // ✅ pour réutiliser AttendanceService.checkIn/checkOut
  ],
  controllers: [CheckinDevicesController],
  providers: [CheckinDevicesService, KioskApiKeyGuard],
  exports: [CheckinDevicesService],
})
export class CheckinDevicesModule {}