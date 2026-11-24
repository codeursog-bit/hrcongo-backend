// ============================================================================
// 📁 src/contracts/contracts.module.ts
//
// Suivi du cycle de vie des contrats : période d'essai, alertes d'expiration,
// confirmation/échec d'essai. La GÉNÉRATION de documents de contrat vit
// désormais uniquement dans src/contract-templates (ContractTemplatesModule).
// ============================================================================
import { Module } from '@nestjs/common';
import { ContractExpiryService } from './contract-expiry.service';
import { ContractExpiryScheduler } from './contract-expiry.scheduler';
import { TrialPeriodService } from './trial-period.service';
import { ContractsController } from './contracts.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ContractsController],
  providers: [ContractExpiryService, ContractExpiryScheduler, TrialPeriodService],
  exports: [ContractExpiryService, TrialPeriodService],
})
export class ContractsModule {}