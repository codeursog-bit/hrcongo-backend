// ============================================================================
// 1️⃣ PAYMENTS MODULE
// ============================================================================
// Fichier: src/payments/payments.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { YabetooPayService } from './yabetoopay.service';
import { MotekiService } from './moteki.service';
import { ChariowService } from './chariow.service';

@Module({
  imports: [ConfigModule],
  // YabetooPayService reste actif UNIQUEMENT pour les versements affiliés
  // (createDisbursement) — la doc Moteki fournie ne couvre pas les
  // versements sortants. MotekiService et ChariowService gèrent la collecte
  // (checkout des abonnements) en redondance l'un de l'autre — voir
  // SubscriptionsController.getActivePaymentProvider pour l'ordre de bascule.
  providers: [YabetooPayService, MotekiService, ChariowService],
  exports: [YabetooPayService, MotekiService, ChariowService],
})
export class PaymentsModule {}