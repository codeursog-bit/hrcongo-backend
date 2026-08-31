// ============================================================================
// 1️⃣ PAYMENTS MODULE
// ============================================================================
// Fichier: src/payments/payments.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { YabetooPayService } from './yabetoopay.service';

@Module({
  imports: [ConfigModule],
  providers: [YabetooPayService],
  exports: [YabetooPayService],
})
export class PaymentsModule {}
