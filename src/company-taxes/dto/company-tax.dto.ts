// ============================================================================
// 📁 src/company-taxes/dto/company-tax.dto.ts
// ============================================================================

import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  IsArray,
  ArrayMinSize,
  ArrayUnique,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContractType } from '@prisma/client';

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

  // Types de contrat auxquels la taxe s'applique (défaut : CDI + CDD)
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Sélectionnez au moins un type de contrat' })
  @ArrayUnique()
  @IsEnum(ContractType, { each: true })
  applicableContractTypes?: ContractType[];

  // true = chaque mois ; false = uniquement le mois/année indiqués
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  applicableMonth?: number | null;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  applicableYear?: number | null;
}

export class UpdateCompanyTaxDto {
  // Le code est immuable : accepté ici pour ne pas déclencher
  // « property code should not exist » (forbidNonWhitelisted), mais ignoré
  // par le service.
  @IsOptional()
  @IsString()
  code?: string;

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
  ceiling?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Seuil minimum de salaire brut pour appliquer la taxe (ex: CAMU = 500 000)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minSalaryThreshold?: number | null;

  @IsOptional()
  @IsEnum(CompanyTaxThreshold)
  thresholdType?: CompanyTaxThreshold;

  // Types de contrat auxquels la taxe s'applique (défaut : CDI + CDD)
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Sélectionnez au moins un type de contrat' })
  @ArrayUnique()
  @IsEnum(ContractType, { each: true })
  applicableContractTypes?: ContractType[];

  // true = chaque mois ; false = uniquement le mois/année indiqués
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  applicableMonth?: number | null;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  applicableYear?: number | null;
}