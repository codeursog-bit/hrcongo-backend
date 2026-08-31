// // ============================================================================
// // 📦 SUBSCRIPTIONS MODULE
// // ============================================================================
// // Fichier: src/subscriptions/subscriptions.module.ts

// import { Module } from '@nestjs/common';
// import { ConfigModule } from '@nestjs/config';
// import { ScheduleModule } from '@nestjs/schedule';
// import { SubscriptionsService } from './subscriptions.service';
// import { SubscriptionsController } from './subscriptions.controller';
// import { WebhooksController } from './webhooks.controller';
// import { SubscriptionGuard } from './guards/subscription.guard';
// import { AdminGuard } from '../auth/guards/admin.guard';
// import { SubscriptionCronService } from './cron/subscription.cron';
// import { PrismaModule } from '../prisma/prisma.module';
// import { PaymentsModule } from '../payments/payments.module';
// import { AffiliateModule } from '../affiliate/affiliate.module'; // ← AJOUT

// @Module({
//   imports: [
//     ConfigModule,         // ✅ Pour accéder aux variables d'environnement
//     PrismaModule,         // ✅ Pour accéder à la base de données
//     PaymentsModule,       // ✅ Fournit YabetooPayService
//     AffiliateModule,      // ✅ Fournit AffiliateService pour les commissions
//     ScheduleModule.forRoot(), // ✅ Active les CRON jobs
//   ],
//   controllers: [
//     SubscriptionsController, // ✅ Routes /subscriptions
//     WebhooksController,      // ✅ Route /webhooks/yabetoopay
//   ],
//   providers: [
//     SubscriptionsService,    // ✅ Logique métier des abonnements
//     SubscriptionGuard,       // ✅ Guard pour vérifier les limites du plan
//     AdminGuard,              // ✅ Guard pour les routes admin
//     SubscriptionCronService, // ✅ CRON pour downgrade automatique des trials expirés
//   ],
//   exports: [
//     SubscriptionsService, // ✅ Export pour utilisation dans d'autres modules
//     SubscriptionGuard,    // ✅ Export pour utilisation dans EmployeesModule, etc.
//   ],
// })
// export class SubscriptionsModule {}

// ============================================================================
// src/subscriptions/subscriptions.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { WebhooksController } from './webhooks.controller';
import { SubscriptionGuard } from './guards/subscription.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SubscriptionCronService } from './cron/subscription.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { CabinetModule } from '../cabinet/cabinet.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    PaymentsModule,
    AffiliateModule,
    CabinetModule, // ← pour injecter CabinetSubscriptionService dans WebhooksController
    ScheduleModule.forRoot(),
  ],
  controllers: [
    SubscriptionsController,
    WebhooksController, // ← webhook unifié entreprise + cabinet
  ],
  providers: [
    SubscriptionsService,
    SubscriptionGuard,
    AdminGuard,
    SubscriptionCronService,
  ],
  exports: [SubscriptionsService, SubscriptionGuard],
})
export class SubscriptionsModule {}
