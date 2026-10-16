// ============================================================================
// 📁 src/attendance-dashboard/attendance-dashboard.module.ts
// À ajouter dans app.module.ts → imports: [ …, AttendanceDashboardModule ]
// ============================================================================
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { AttendanceDashboardController, PortfolioAttendanceDashboardController } from './attendance-dashboard.controller';

@Module({
  imports: [PrismaModule, PortfolioModule], // PortfolioModule exporte PortfolioMembershipService
  controllers: [AttendanceDashboardController, PortfolioAttendanceDashboardController],
  providers: [AttendanceDashboardService],
  exports: [AttendanceDashboardService],
})
export class AttendanceDashboardModule {}
