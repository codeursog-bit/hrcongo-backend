import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { LoansCommonService } from './loans-common.service';
import { LoansRequestsService } from './loans-requests.service';
import { LoansDecisionService } from './loans-decision.service';
import { LoansRepaymentService } from './loans-repayment.service';
import { LoansDocumentsService } from './loans-documents.service';
import { LoansOrcaExportService } from './loans-orca-export.service';
import { LoansGenericExportService } from './loans-generic-export.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
// ✅ LOT B — noyau des circuits d'avis (sans dépendance vers ce module : pas de cycle)
import { ApprovalsCoreModule } from '../approvals/core/approvals-core.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule, NotificationsModule, ApprovalsCoreModule],
  controllers: [LoansController],
  providers: [
    LoansService,
    LoansCommonService,
    LoansRequestsService,
    LoansDecisionService,
    LoansRepaymentService,
    LoansDocumentsService,
    LoansOrcaExportService,
    LoansGenericExportService,
  ],
  exports: [LoansService],
})
export class LoansModule {}
