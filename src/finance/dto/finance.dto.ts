// ============================================================================
// 📁 src/finance/dto/finance.dto.ts
// DTOs du module Finances (caisse, dépenses, entrées, budgets)
// ValidationPipe global : whitelist + forbidNonWhitelisted → tout champ
// accepté doit être décoré ici.
// ============================================================================

import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FinanceFlow } from '@prisma/client';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MSG = 'Format de date attendu : AAAA-MM-JJ';

// ── Activation (SUPER_ADMIN) ────────────────────────────────────────────────
export class ActivateFinanceDto {
  @IsBoolean()
  enabled: boolean;
}

// ── Paramètres (solde de départ) ────────────────────────────────────────────
export class UpdateFinanceSettingsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-9_999_999_999_999)
  @Max(9_999_999_999_999)
  openingBalance?: number;

  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  openingDate?: string;
}

// ── Catégories ──────────────────────────────────────────────────────────────
export class CreateFinanceCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEnum(FinanceFlow)
  type: FinanceFlow;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Couleur attendue : #RRGGBB' })
  color?: string;
}

export class UpdateFinanceCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Couleur attendue : #RRGGBB' })
  color?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListFinanceCategoriesDto {
  @IsOptional()
  @IsEnum(FinanceFlow)
  type?: FinanceFlow;

  // "true" en query string
  @IsOptional()
  @IsString()
  includeInactive?: string;
}

// ── Transactions ────────────────────────────────────────────────────────────
export class CreateFinanceTransactionDto {
  @IsEnum(FinanceFlow)
  type: FinanceFlow;

  @IsUUID()
  categoryId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999)
  quantity?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999)
  unitPrice: number;

  @Matches(DATE_REGEX, { message: DATE_MSG })
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  counterparty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

// Le type (sortie/entrée) n'est pas modifiable après création.
export class UpdateFinanceTransactionDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999)
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999)
  unitPrice?: number;

  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  counterparty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ListFinanceTransactionsDto {
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  to?: string;

  @IsOptional()
  @IsEnum(FinanceFlow)
  type?: FinanceFlow;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// Export : mêmes filtres, sans pagination
export class ExportFinanceTransactionsDto {
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  to?: string;

  @IsOptional()
  @IsEnum(FinanceFlow)
  type?: FinanceFlow;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export class FinanceDashboardQueryDto {
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MSG })
  to?: string;
}

// ── Budgets ─────────────────────────────────────────────────────────────────
export class FinanceBudgetsQueryDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}

export class UpsertFinanceBudgetDto {
  @IsUUID()
  categoryId: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  // 0 = supprimer le budget de cette catégorie pour ce mois
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999_999)
  amount: number;
}