// ============================================================================
// 📁 src/accounting/accounting.module.ts
// @Global : le plan de comptes est lisible partout (journal, exports Sage,
// connecteur Konza Connect) sans modifier chaque module.
// ============================================================================
import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AccountingPlanService } from './accounting-plan.service';
import { AccountingPlanController } from './accounting-plan.controller';
import { AccountingPayrollService } from './accounting-payroll.service';
import { AccountingPayrollController } from './accounting-payroll.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Global()
@Module({
  imports: [SubscriptionsModule, DiscoveryModule],
  controllers: [AccountingPlanController, AccountingPayrollController],
  providers: [AccountingPlanService, AccountingPayrollService],
  exports: [AccountingPlanService],
})
export class AccountingModule {}