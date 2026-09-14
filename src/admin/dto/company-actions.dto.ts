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

export class ActivateSubscriptionDto {
  // Montant réellement encaissé hors plateforme. Si omis/0 => aucune ligne
  // de paiement n'est créée (geste gratuit / essai / commercial).
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsIn(['Virement bancaire', 'Espèces', 'Mobile Money', 'Autre'])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SetSubscriptionPeriodDto {
  @IsOptional()
  @IsString()
  startDate?: string; // ISO — si omis, garde la date de début actuelle

  @IsString()
  endDate: string; // ISO — date de fin exacte de la période

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle?: 'MONTHLY' | 'YEARLY';

  // Paiement manuel optionnel — même logique que ActivateSubscriptionDto
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsIn(['Virement bancaire', 'Espèces', 'Mobile Money', 'Autre'])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

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

  // Idem ActivateSubscriptionDto : optionnel, crée une ligne de paiement si fourni.
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsIn(['Virement bancaire', 'Espèces', 'Mobile Money', 'Autre'])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}