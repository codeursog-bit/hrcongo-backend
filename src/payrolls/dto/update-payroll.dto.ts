// 📁 src/payrolls/dto/update-payroll.dto.ts
// ✅ VERSION COMPLÈTE — accepte tous les champs modifiables
//    depuis edit-payroll-page (baseSalary, workedDays, overtimeHours)
//    ET les champs workflow existants (status, paymentReference)

import {
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePayrollDto {
  // ── Champs modifiables depuis edit-payroll-page ──────────────────────────

  @IsOptional()
  @IsNumber()
  @Min(70400) // SMIG Congo
  @Type(() => Number)
  baseSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  workedDays?: number;

  // ✅ Heures supplémentaires — 4 catégories (Décret 78-360)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overtimeHours10?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overtimeHours25?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overtimeHours50?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overtimeHours100?: number;

  // ── Primes et retenues — pour recalcul depuis la page modifier ──────────

  @IsOptional()
  @IsArray()
  manualBonuses?: Array<{
    bonusType: string;
    amount: number;
    base?: number;
    rate?: number;
    isTaxable?: boolean;
    isCnss?: boolean;
    fiscalType?: 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE';
  }>;

  @IsOptional()
  @IsArray()
  manualDeductions?: Array<{
    label: string;
    amount: number;
  }>;

  // ── Congés ───────────────────────────────────────────────────────────────

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  congesDroits?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  congesPris?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  congesSolde?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  joursCongesPris?: number;

  // ── Mois/année — pour recalcul (lecture seule, pas modifiables en DB) ───

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  month?: number;

  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2100)
  @Type(() => Number)
  year?: number;


    // ── Override manuel du cumul brut YTD (correction ponctuelle) ───────────
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cumulBrutOverride?: number;

  // ── Champs workflow (existants — conservés) ──────────────────────────────

  @IsOptional()
  @IsEnum(['DRAFT', 'VALIDATED', 'PAID', 'CANCELLED'])
  status?: 'DRAFT' | 'VALIDATED' | 'PAID' | 'CANCELLED';

  @IsOptional()
  @IsBoolean()
  validated?: boolean;

  @IsOptional()
  @IsString()
  validatedBy?: string;

  @IsOptional()
  validatedAt?: Date;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  paidAt?: Date;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
