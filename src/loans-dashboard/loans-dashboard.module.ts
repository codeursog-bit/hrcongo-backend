// ============================================================================
// 📁 src/loans-dashboard/loans-dashboard.module.ts
// À ajouter dans app.module.ts → imports: [ …, LoansDashboardModule ]
// ============================================================================
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { LoansDashboardService } from './loans-dashboard.service';
import { LoansDashboardController, PortfolioLoansDashboardController } from './loans-dashboard.controller';

@Module({
  imports: [PrismaModule, PortfolioModule], // PortfolioModule exporte PortfolioMembershipService
  controllers: [LoansDashboardController, PortfolioLoansDashboardController],
  providers: [LoansDashboardService],
  exports: [LoansDashboardService],
})
export class LoansDashboardModule {}