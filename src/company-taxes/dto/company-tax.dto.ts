// ============================================================================
// 📁 src/company-taxes/dto/company-tax.dto.ts
// ============================================================================

import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum CompanyTaxThreshold {
  ELIGIBILITY = 'ELIGIBILITY', // Filtre binaire — taxe ignorée si brut < seuil
  EXCESS_ONLY = 'EXCESS_ONLY', // Taxe sur l'excédent : base = max(0, base − seuil)
}

export enum CompanyTaxBase {
  GROSS = 'GROSS', // Brut total
  TAXABLE = 'TAXABLE', // SBT (brut − CNSS)
  NET_IMPOSABLE = 'NET_IMPOSABLE', // RNI (après abattement)
  FIXED = 'FIXED', // Montant fixe (ex: TOL = 1 000 F)
}

export class CreateCompanyTaxDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string; // "TOL", "CAMU", "Taxe apprentissage"

  @IsString()
  @MinLength(2)
  @MaxLength(20)
  code: string; // "TOL", "CAMU", "TAX_APP"

  @IsOptional()
  @IsString()
  description?: string;

  // Taux salarié (% ou montant fixe)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  employeeRate?: number; // ex: 0.005 = 0,5%

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  fixedEmployee?: number; // ex: 1000 = TOL fixe salarié

  // Taux employeur
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  employerRate?: number; // ex: 0.01 = 1%

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  fixedEmployer?: number;

  // Base de calcul
  @IsOptional()
  @IsEnum(CompanyTaxBase)
  baseType?: CompanyTaxBase;

  @IsOptional()
  @IsBoolean()
  hasCeiling?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  ceiling?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Seuil minimum de salaire brut pour appliquer la taxe (ex: CAMU = 500 000)
  // Si null → s'applique toujours peu importe le salaire
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minSalaryThreshold?: number;

  // ELIGIBILITY (défaut) : taxe ignorée si brut < minSalaryThreshold
  // EXCESS_ONLY          : base = max(0, base − minSalaryThreshold) → CAMU solidarité
  @IsOptional()
  @IsEnum(CompanyTaxThreshold)
  thresholdType?: CompanyTaxThreshold;
}

export class UpdateCompanyTaxDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  employeeRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  fixedEmployee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  employerRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  fixedEmployer?: number;

  @IsOptional()
  @IsEnum(CompanyTaxBase)
  baseType?: CompanyTaxBase;

  @IsOptional()
  @IsBoolean()
  hasCeiling?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  ceiling?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Seuil minimum de salaire brut pour appliquer la taxe (ex: CAMU = 500 000)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minSalaryThreshold?: number;

  @IsOptional()
  @IsEnum(CompanyTaxThreshold)
  thresholdType?: CompanyTaxThreshold;
}
