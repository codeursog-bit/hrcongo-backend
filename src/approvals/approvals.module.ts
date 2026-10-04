import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LoansModule } from '../loans/loans.module';
import { AbsenceRequestsModule } from '../absence-requests/absence-requests.module';
import { LeavesModule } from '../leaves/leaves.module';
import { ApprovalsCoreModule } from './core/approvals-core.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalFunctionsService } from './approval-functions.service';
import { ApprovalDecisionsService } from './approval-decisions.service';
import { ApprovalOpinionsService } from './approval-opinions.service';

// ✅ LOT A + LOT B + LOT C + LOT E.
// Dépendances à sens unique (pas de cycle) :
//   ApprovalsModule → LoansModule → ApprovalsCoreModule
//   ApprovalsModule → AbsenceRequestsModule → ApprovalsCoreModule
//   ApprovalsModule → LeavesModule → ApprovalsCoreModule
//   ApprovalsModule → ApprovalsCoreModule
@Module({
  imports: [
    PrismaModule,
    CloudinaryModule,
    NotificationsModule,
    ApprovalsCoreModule,
    LoansModule, // exporte LoansService (decideLoan / decideAdvance existants)
    AbsenceRequestsModule, // ✅ LOT C — exporte AbsenceRequestsService (updateStatus existant)
    LeavesModule, // ✅ LOT E — exporte LeavesService (updateStatus existant)
  ],
  controllers: [ApprovalsController],
  providers: [
    ApprovalFunctionsService,
    ApprovalDecisionsService,
    ApprovalOpinionsService,
  ],
  exports: [ApprovalFunctionsService, ApprovalDecisionsService],
})
export class ApprovalsModule {}
