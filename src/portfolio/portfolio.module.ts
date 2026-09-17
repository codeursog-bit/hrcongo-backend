import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeesModule } from '../employees/employees.module';
import { LoansModule } from '../loans/loans.module';
import { PayrollsModule } from '../payrolls/payrolls.module';
import { LeavesModule } from '../leaves/leaves.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AbsenceRequestsModule } from '../absence-requests/absence-requests.module';
import { AbsenceTrackingModule } from '../absence-tracking/absence-tracking.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PortfolioMembershipService } from './portfolio-membership.service';
import { PortfolioEmployeesService } from './employees/portfolio-employees.service';
import { PortfolioEmployeesController } from './employees/portfolio-employees.controller';
import { PortfolioLoansService } from './loans/portfolio-loans.service';
import { PortfolioLoansController } from './loans/portfolio-loans.controller';
import { PortfolioPayrollService } from './payroll/portfolio-payroll.service';
import { PortfolioPayrollController } from './payroll/portfolio-payroll.controller';
import { PortfolioLeavesService } from './leaves/portfolio-leaves.service';
import { PortfolioLeavesController } from './leaves/portfolio-leaves.controller';
import { PortfolioAttendanceService } from './attendance/portfolio-attendance.service';
import { PortfolioAttendanceController } from './attendance/portfolio-attendance.controller';
import { PortfolioAbsenceRequestsService } from './absences/portfolio-absence-requests.service';
import { PortfolioAbsenceTrackingService } from './absences/portfolio-absence-tracking.service';
import { PortfolioAbsencesController } from './absences/portfolio-absences.controller';
import { PortfolioCompaniesService } from './companies/portfolio-companies.service';
import { PortfolioCompaniesController } from './companies/portfolio-companies.controller';
import { PortfolioStatsService } from './portfolio-stats.service';
import { PortfolioController } from './portfolio.controller';
import { PortfolioReportsService } from './reports/portfolio-reports.service';
import { PortfolioReportsController } from './reports/portfolio-reports.controller';
import { PortfolioTeamService } from './team/portfolio-team.service';
import { PortfolioTeamController } from './team/portfolio-team.controller';

// 🆕 Module "portefeuille d'entreprises" — vue transverse pour l'admin
// multi-entreprises. Tous les modules essentiels (employés, prêts/avances,
// paie, congés, présences, absences) délèguent vers leur service
// d'origine après vérification via PortfolioMembershipService — jamais de
// logique métier dupliquée.
@Module({
  imports: [
    PrismaModule,
    EmployeesModule,
    LoansModule,
    PayrollsModule,
    LeavesModule,
    AttendanceModule,
    AbsenceRequestsModule,
    AbsenceTrackingModule,
    SubscriptionsModule,
  ],
  controllers: [
    PortfolioController,
    PortfolioEmployeesController,
    PortfolioLoansController,
    PortfolioPayrollController,
    PortfolioLeavesController,
    PortfolioAttendanceController,
    PortfolioAbsencesController,
    PortfolioCompaniesController,
    PortfolioReportsController,
    PortfolioTeamController,
  ],
  providers: [
    PortfolioMembershipService,
    PortfolioEmployeesService,
    PortfolioLoansService,
    PortfolioPayrollService,
    PortfolioLeavesService,
    PortfolioAttendanceService,
    PortfolioAbsenceRequestsService,
    PortfolioAbsenceTrackingService,
    PortfolioCompaniesService,
    PortfolioStatsService,
    PortfolioReportsService,
    PortfolioTeamService,
  ],
  exports: [PortfolioMembershipService],
})
export class PortfolioModule {}