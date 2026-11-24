import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { CabinetController } from './controllers/cabinet.controller';
import { CabinetWalletController } from './controllers/cabinet-wallet.controller';
import { CabinetBatchClosureController } from './controllers/cabinet-batch-closure.controller';
import { CabinetImportController } from './controllers/cabinet-import.controller';
import { CabinetDeclarationsController } from './controllers/cabinet-declarations.controller';
import { CabinetSubscriptionController } from './controllers/cabinet-subscription.controller';

import { CabinetService } from './services/cabinet.service';
import { CabinetWalletService } from './services/cabinet-wallet.service';
import { CabinetBatchClosureService } from './services/cabinet-batch-closure.service';
import { CabinetImportService } from './services/cabinet-import.service';
import { CabinetDeclarationsService } from './services/cabinet-declarations.service';
import { CabinetMaintenanceService } from './cron/cabinet-maintenance.service';
import { CabinetSubscriptionService } from './services/cabinet-subscription.service';

import {
  CabinetMemberGuard,
  CabinetAdminGuard,
  CabinetCompanyIsolationGuard,
} from './guards/cabinet.guards';

import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { PaymentsModule } from '../payments/payments.module';
import { AffiliateModule } from '../affiliate/affiliate.module';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    PaymentsModule,
    AffiliateModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [
    CabinetController,
    CabinetWalletController,
    CabinetBatchClosureController,
    CabinetImportController,
    CabinetDeclarationsController,
    CabinetSubscriptionController,
    // NOTE: Pas de CabinetPaymentWebhookController ici
    // Le webhook YaBetooPay est unifié dans SubscriptionsModule/WebhooksController
  ],
  providers: [
    CabinetService,
    CabinetWalletService,
    CabinetBatchClosureService,
    CabinetImportService,
    CabinetDeclarationsService,
    CabinetMaintenanceService,
    CabinetSubscriptionService,
    CabinetMemberGuard,
    CabinetAdminGuard,
    CabinetCompanyIsolationGuard,
  ],
  exports: [
    CabinetService,
    CabinetWalletService,
    CabinetSubscriptionService, // exporté pour WebhooksController dans SubscriptionsModule
  ],
})
export class CabinetModule {}
