// src/subscriptions/dto/billing-admin.dto.ts
import {
  IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, Matches, ValidateIf,
} from 'class-validator';

export class UpdatePlanPriceDto {
  @IsInt() @Min(100) @Max(100_000_000)
  priceMonthly: number;

  @IsInt() @Min(100) @Max(1_000_000_000)
  priceYearly: number;
}

export class CreateDiscountCodeDto {
  @IsString() @MaxLength(50) @Matches(/^[A-Za-z0-9_-]{3,50}$/, { message: 'Code : 3 à 50 caractères (lettres, chiffres, - et _)' })
  code: string;

  @IsInt() @Min(1) @Max(99)
  percentOff: number;

  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsInt() @Min(1) maxUsesPerCompany?: number;
  @IsOptional() @IsISO8601() validFrom?: string;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateDiscountCodeDto {
  @IsOptional() @IsInt() @Min(1) @Max(99) percentOff?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) maxUsesPerCompany?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() validFrom?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() validUntil?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) note?: string | null;
}

export class CreateCustomQuoteDto {
  @IsUUID() companyId: string;

  @IsEnum(['BASIC', 'PRO', 'ENTERPRISE']) plan: 'BASIC' | 'PRO' | 'ENTERPRISE';

  @IsInt() @Min(100) @Max(1_000_000_000) amount: number;

  @IsOptional() @IsInt() @Min(1) @Max(36) months?: number;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;

  // Devis « portefeuille » : le paiement active TOUTES les entreprises liées au compte multi-entreprises
  @IsOptional() @IsBoolean() coversPortfolio?: boolean;

  // Obligatoire si coversPortfolio = true : l'utilisateur multi-entreprises dont le portefeuille est couvert
  @ValidateIf((o) => o.coversPortfolio === true)
  @IsUUID()
  portfolioOwnerId?: string;
}

export class SetPaymentProviderDto {
  @IsEnum(['YABETOOPAY', 'MOTEKI', 'CHARIOW']) provider: 'YABETOOPAY' | 'MOTEKI' | 'CHARIOW';
}

export class ValidateDiscountDto {
  @IsString() @MaxLength(50) code: string;
  @IsEnum(['BASIC', 'PRO', 'ENTERPRISE']) plan: 'BASIC' | 'PRO' | 'ENTERPRISE';
  @IsEnum(['monthly', 'yearly']) billingPeriod: 'monthly' | 'yearly';
}