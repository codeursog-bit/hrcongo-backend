// ============================================================================
// Fichier: backend/src/admin/dto/company-actions.dto.ts
// DTOs pour les actions d'écriture du SUPER_ADMIN sur entreprises/abonnements
// ============================================================================

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// ── Entreprises ─────────────────────────────────────────────────────────────

export class UpdateCompanyStatusDto {
  @IsBoolean()
  isActive: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ArchiveCompanyDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  tradeName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  website?: string;
}

// ── Abonnements ──────────────────────────────────────────────────────────────

export class UpdateSubscriptionPlanDto {
  @IsIn(['FREE', 'BASIC', 'PRO', 'ENTERPRISE'])
  plan: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pricePerMonth?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SuspendSubscriptionDto {
  // Défaut : PAUSED si non fourni
  @IsOptional()
  @IsIn(['PAUSED', 'CANCELED'])
  status?: 'PAUSED' | 'CANCELED';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ExtendSubscriptionDto {
  @IsInt()
  @Min(1)
  days: number;

  @IsOptional()
  @IsString()
  reason?: string;
}