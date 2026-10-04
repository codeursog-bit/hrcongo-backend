import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ApprovalContextService } from './approval-context.service';
import { ApprovalRequestsService } from './approval-requests.service';
import { ApprovalCircuitsService } from './approval-circuits.service';
import { ApprovalNotifierService } from './approval-notifier.service';

// ✅ LOT B — noyau SANS dépendance vers le module des prêts : il peut donc être
// importé par LoansModule (pour notifier les titulaires à la création d'une
// demande) sans créer de dépendance circulaire avec ApprovalsModule.
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [
    ApprovalContextService,
    ApprovalRequestsService,
    ApprovalCircuitsService,
    ApprovalNotifierService,
  ],
  exports: [
    ApprovalContextService,
    ApprovalRequestsService,
    ApprovalCircuitsService,
    ApprovalNotifierService,
  ],
})
export class ApprovalsCoreModule {}
