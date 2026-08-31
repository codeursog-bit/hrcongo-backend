// ============================================================================
// 📁 src/contracts/contracts.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ContractExpiryService } from './contract-expiry.service';
import { ContractExpiryScheduler } from './contract-expiry.scheduler';
import { TrialPeriodService } from './trial-period.service';
import { ContractsController } from './contracts.controller';
import { ContractGenerationService } from './contract-generation.service';
import { ContractGenerationController } from './contract-generation.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FiscalModule } from '../payroll/fiscal/fiscal.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    NotificationsModule,
    FiscalModule,
  ],
  controllers: [ContractsController, ContractGenerationController],
  providers: [
    ContractExpiryService,
    ContractExpiryScheduler,
    TrialPeriodService,
    ContractGenerationService,
  ],
  exports: [ContractExpiryService, TrialPeriodService, ContractGenerationService],
})
export class ContractsModule {}