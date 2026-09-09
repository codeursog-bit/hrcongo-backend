// ============================================================================
// 1️⃣ PAYMENTS MODULE
// ============================================================================
// Fichier: src/payments/payments.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { YabetooPayService } from './yabetoopay.service';
import { MotekiService } from './moteki.service';

@Module({
  imports: [ConfigModule],
  // YabetooPayService reste actif UNIQUEMENT pour les versements affiliés
  // (createDisbursement) — la doc Moteki fournie ne couvre pas les
  // versements sortants. MotekiService gère désormais toute la collecte
  // (checkout des abonnements).
  providers: [YabetooPayService, MotekiService],
  exports: [YabetooPayService, MotekiService],
})
export class PaymentsModule {}