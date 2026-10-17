// ============================================================================
// 📁 src/workforce-dashboard/workforce-dashboard.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { AttendanceModule } from '../attendance/attendance.module'; // 🆕 LiveAttendanceSummaryService
import { WorkforceDashboardService } from './workforce-dashboard.service';
import { PortfolioWorkforceDashboardController, WorkforceDashboardController } from './workforce-dashboard.controller';

@Module({
  imports: [PrismaModule, PortfolioModule, AttendanceModule], // PortfolioModule exporte PortfolioMembershipService ; AttendanceModule exporte LiveAttendanceSummaryService
  controllers: [WorkforceDashboardController, PortfolioWorkforceDashboardController],
  providers: [WorkforceDashboardService],
  exports: [WorkforceDashboardService],
})
export class WorkforceDashboardModule {}