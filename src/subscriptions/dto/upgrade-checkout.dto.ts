// src/subscriptions/dto/upgrade-checkout.dto.ts
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpgradeCheckoutDto {
  // Ignorés si useQuote = true (le plan vient alors du devis)
  @ValidateIf((o) => !o.useQuote)
  @IsEnum(['BASIC', 'PRO', 'ENTERPRISE'], {
    message: 'Le plan doit être BASIC, PRO ou ENTERPRISE',
  })
  plan: 'BASIC' | 'PRO' | 'ENTERPRISE';

  @ValidateIf((o) => !o.useQuote)
  @IsEnum(['monthly', 'yearly'], {
    message: 'La période de facturation doit être monthly ou yearly',
  })
  billingPeriod: 'monthly' | 'yearly';

  @IsOptional() @IsString() @MaxLength(50)
  discountCode?: string;

  // Payer au tarif négocié (devis actif de l'entreprise)
  @IsOptional() @IsBoolean()
  useQuote?: boolean;
}
