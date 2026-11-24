import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { DisplayScreensService } from './display-screens.service';
import {
  DisplayAdminController,
  DisplayDeviceController,
  EmployeeQrController,
} from './display-screens.controller';
import { DisplayDeviceGuard } from './guards/display-device.guard';

@Module({
  imports: [
    PrismaModule,
    AttendanceModule, // ✅ réutilise AttendanceService.checkIn/checkOut (toute la logique métier)
  ],
  controllers: [DisplayDeviceController, DisplayAdminController, EmployeeQrController],
  providers: [DisplayScreensService, DisplayDeviceGuard],
  exports: [DisplayScreensService],
})
export class DisplayScreensModule {}