// ============================================================================
// 📁 src/absence-requests/absence-requests.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { AbsenceRequestsController } from './absence-requests.controller';
import { AbsenceRequestsService } from './absence-requests.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
// ✅ LOT C — noyau des circuits d'avis (sans dépendance vers ce module : pas de cycle)
import { ApprovalsCoreModule } from '../approvals/core/approvals-core.module';

@Module({
  imports: [PrismaModule, NotificationsModule, SubscriptionsModule, ApprovalsCoreModule],
  controllers: [AbsenceRequestsController],
  providers: [AbsenceRequestsService],
  exports: [AbsenceRequestsService],
})
export class AbsenceRequestsModule {}