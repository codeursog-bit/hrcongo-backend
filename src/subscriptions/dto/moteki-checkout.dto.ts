// ============================================================================
// 📝 DTO CHECKOUT MOTEKI
// ============================================================================
// Contrairement à YabetooPay (2 étapes : créer l'intent, puis confirmer avec
// téléphone/opérateur), Moteki initie ET confirme en un seul appel — le
// frontend doit donc envoyer les infos client dès cet appel.
// ============================================================================

import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class MotekiCheckoutDto {
  @IsEnum(['BASIC', 'PRO', 'ENTERPRISE'], {
    message: 'Le plan doit être BASIC, PRO ou ENTERPRISE',
  })
  plan: 'BASIC' | 'PRO' | 'ENTERPRISE';

  @IsEnum(['monthly', 'yearly'], {
    message: 'La période de facturation doit être monthly ou yearly',
  })
  billingPeriod: 'monthly' | 'yearly';

  @IsString()
  @MinLength(1, { message: 'Le prénom du client est requis' })
  customerFirstName: string;

  @IsOptional()
  @IsString()
  customerLastName?: string;

  @IsEmail({}, { message: 'Email client invalide' })
  customerEmail: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsEnum(['mobile_money', 'card', 'aggregator'], {
    message: 'Moyen de paiement invalide',
  })
  paymentMethod: 'mobile_money' | 'card' | 'aggregator';

  @IsOptional()
  @IsString()
  paymentOperator?: string; // ex: "mtn-cg", "orange-cg", "visa", "cinetpay"...
}