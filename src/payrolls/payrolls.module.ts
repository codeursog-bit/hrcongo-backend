// ============================================================================
// src/payrolls/payrolls.module.ts
// ✅ PayrollSeniorityService + BonusQuantityService ajoutés
// ============================================================================

import { Module } from '@nestjs/common';
import { PayrollsController } from './payrolls.controller';
import { PayrollsService } from './payrolls.service';
import { ExportController } from './export.controller';

import { PayrollCalculatorService } from './services/payroll-calculator.service';
import { PayrollItemsService } from './services/payroll-items.service';
import { PayrollSmicProtectionService } from './services/payroll-smic-protection.service';
import { PayrollDeductionsService } from './services/payroll-deductions.service';
import { PayrollGeneratorService } from './services/payroll-generator.service';
import { PayrollBonusesService } from './services/payroll-bonuses.service';
import { PayrollSeniorityService } from './services/payroll-seniority.service'; // 🆕
import { CompanyDeductionsModule } from '../company-deductions/company-deductions.module';
import { PrismaService } from '../prisma/prisma.service';
import { LoansModule } from '../loans/loans.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { PayrollSettingsService } from '../payroll/settings/settings.service';
import { IrppCalculatorService } from '../payroll/fiscal/irpp-calculator.service';
import { FiscalPartsService } from '../payroll/fiscal/fiscal-parts.service';
import { ExportService } from './export.service';
import { ReportsModule } from '../reports/reports.module';
import { CompanyTaxModule } from '../company-taxes/company-tax.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { LeavesModule } from '../leaves/leaves.module';
import { NotificationsModule } from '../notifications/notifications.module';

// 🆕 BonusQuantityService (saisie quantités mensuelles primes FREE)
import { BonusQuantityService } from '../employees/bonuses/bonus-quantity.service';
import { BonusQuantityController } from '../employees/bonuses/bonus-quantity.controller';
import { YtdCheckpointService } from './services/ytd-checkpoint.service';

import { ManualPayrollService } from './services/manual-payroll.service';

@Module({
  imports: [
    ReportsModule,
    SubscriptionsModule,
    CompanyTaxModule,
    LeavesModule,
    AttendanceModule,
    CompanyDeductionsModule,
    NotificationsModule,
    LoansModule,
  ],
  controllers: [
    PayrollsController,
    ExportController,
    BonusQuantityController, // 🆕
  ],
  providers: [
    PayrollsService,
    PayrollCalculatorService,
    PayrollItemsService,
    PayrollSmicProtectionService,
    PayrollDeductionsService,
    PayrollGeneratorService,
    PayrollBonusesService,
    PayrollSeniorityService, // 🆕
    BonusQuantityService, // 🆕
    ExportService,
    PrismaService,
    PayrollSettingsService,
    IrppCalculatorService,
    FiscalPartsService,
    ManualPayrollService,
    YtdCheckpointService,
  ],
  exports: [
    PayrollsService,
    PayrollCalculatorService,
    PayrollDeductionsService,
    PayrollBonusesService,
    PayrollSeniorityService, // 🆕
    BonusQuantityService, // 🆕
    ExportService,
  ],
})
export class PayrollsModule {}
