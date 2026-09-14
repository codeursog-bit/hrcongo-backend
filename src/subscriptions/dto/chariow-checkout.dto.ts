// ============================================================================
// 📝 DTO CHECKOUT CHARIOW
// ============================================================================
// Chariow initie ET affiche directement l'écran de paiement (mobile money /
// carte au choix du client sur sa page de checkout hébergée) — un seul appel
// suffit, comme pour Moteki.
// ============================================================================

import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class ChariowCheckoutDto {
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

  @IsString()
  @MinLength(1, { message: 'Le nom du client est requis' })
  customerLastName: string;

  @IsEmail({}, { message: 'Email client invalide' })
  customerEmail: string;

  @IsString()
  @MinLength(1, { message: 'Le numéro de téléphone est requis' })
  customerPhoneNumber: string;

  @IsOptional()
  @IsString()
  customerPhoneCountryCode?: string; // défaut "CG" appliqué côté service si absent

  @IsOptional()
  @IsString()
  discountCode?: string; // code de réduction Chariow, optionnel
}