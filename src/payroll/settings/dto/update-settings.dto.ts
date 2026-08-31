// ============================================================================
// 📁 src/payroll/settings/dto/update-settings.dto.ts
// ✅ Ajout fiscalMode + forfaitItsRate + champs nuit/overtime/plafonds CNSS
// ============================================================================
import {
  IsOptional,
  IsNumber,
  IsArray,
  IsString,
  IsEnum,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePayrollSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(6)
  @Max(20)
  officialStartHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(120)
  lateToleranceMinutes?: number;

  @IsOptional()
  @IsArray()
  workDays?: number[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cnssSalarialRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cnssEmployerRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cnssCeiling?: number;

  // ── ✅ Plafonds CNSS (Décret n°99-284 Congo) ──────────────────────────────
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cnssPensionCeiling?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cnssSocialCeiling?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeRate15?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeRate50?: number;

  // ── Heures sup (noms corrects Décret 78-360) ──────────────────────────────
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) overtimeRate10?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) overtimeRate25?: number;
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overtimeRate100?: number;

  // ── ✅ Toggle heures supplémentaires ─────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  overtimeEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(31)
  workDaysPerMonth?: number;

  @IsOptional()
  @IsNumber()
  @Min(6)
  @Max(12)
  workHoursPerDay?: number;

  @IsOptional()
  @IsNumber()
  apprenticeshipTax?: number;

  @IsOptional()
  @IsNumber()
  fonerTax?: number;

  @IsOptional()
  @IsString()
  cnssRounding?: string;

  @IsOptional()
  @IsString()
  itsRounding?: string;

  // ── ✅ Travail de nuit ────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  nightShiftEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  @Type(() => Number)
  nightShiftStartHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  @Type(() => Number)
  nightShiftEndHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  nightShiftPremiumRate?: number;

  // ── ✅ MODE FISCAL ────────────────────────────────────────────────────────
  @IsOptional()
  @IsEnum(['AUTO', 'ITS_2026', 'IRPP_LEGACY', 'FORFAIT'])
  fiscalMode?: 'AUTO' | 'ITS_2026' | 'IRPP_LEGACY' | 'FORFAIT';

  // ✅ TAUX FORFAITAIRE (0.06 = 6%, 0.08 = 8%, 0.10 = 10%)
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(0.4)
  @Type(() => Number)
  forfaitItsRate?: number;

  // ── Barèmes personnalisés (JSON) ──────────────────────────────────────────
  @IsOptional()
  taxBrackets?: any;
}
