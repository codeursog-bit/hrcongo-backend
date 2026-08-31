// import { Module } from '@nestjs/common';
// import { LeavesController } from './leaves.controller';
// import { LeavesService } from './leaves.service';
// import { PrismaModule } from '../prisma/prisma.module';
// import { NotificationsModule } from '../notifications/notifications.module'; // ✅ IMPORT
// import { MailModule } from '../mail/mail.module'; // ✅ IMPORT
// import { SubscriptionsModule } from '../subscriptions/subscriptions.module'; // en haut

// @Module({
//   imports: [
//     PrismaModule,
//     SubscriptionsModule,
//     NotificationsModule, // ✅ AJOUT
//     MailModule // ✅ AJOUT
//   ],
//   controllers: [LeavesController],
//   providers: [LeavesService],
//   exports: [LeavesService]
// })
// export class LeavesModule {}

// ============================================================================
// 📁 src/leaves/leaves.module.ts
// ✅ Inclut le cron d'acquisition mensuelle
// ============================================================================

import { Module } from '@nestjs/common';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';
import { LeavesBalanceService } from './leaves-balance.service';
import { LeavesIndemnityService } from './leaves-indemnity.service';
import { LeaveAccrualCron } from './cron/leave-accrual.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule, NotificationsModule, MailModule],
  controllers: [LeavesController],
  providers: [
    LeavesService,
    LeavesBalanceService, // ✅ Phase 7 — solde/cycle, extrait de leaves.service.ts
    LeavesIndemnityService, // ✅ Phase 7 — indemnité congé/paie, extrait de leaves.service.ts
    LeaveAccrualCron, // ✅ Cron d'acquisition mensuelle + alertes + rappels de retour
  ],
  exports: [LeavesService], // ✅ Exporté pour PayrollGeneratorService — LeavesService reste la
  //    façade publique, les sous-services restent internes au module
})
export class LeavesModule {}
