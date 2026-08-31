// ============================================================================
// 📝 DTO UPGRADE CHECKOUT - VALIDATION
// ============================================================================
// Fichier: src/subscriptions/dto/upgrade-checkout.dto.ts

import { IsEnum } from 'class-validator';

export class UpgradeCheckoutDto {
  @IsEnum(['BASIC', 'PRO', 'ENTERPRISE'], {
    message: 'Le plan doit être BASIC, PRO ou ENTERPRISE',
  })
  plan: 'BASIC' | 'PRO' | 'ENTERPRISE';

  @IsEnum(['monthly', 'yearly'], {
    message: 'La période de facturation doit être monthly ou yearly',
  })
  billingPeriod: 'monthly' | 'yearly';
}
