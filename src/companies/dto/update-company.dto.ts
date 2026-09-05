import { PartialType } from '@nestjs/mapped-types';
import { CreateCompanyDto } from './create-company.dto';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankAccount?: string;

  @IsOptional()
  @IsString()
  bankRib?: string;

  // 🆕 CHAMPS FISCAUX (redéfinis explicitement pour Update)
  @IsBoolean()
  @IsOptional()
  appliesCnssEmployer?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(50)
  cnssEmployerRate?: number;

  @IsBoolean()
  @IsOptional()
  defaultAppliesIrpp?: boolean;

  @IsBoolean()
  @IsOptional()
  defaultAppliesCnss?: boolean;

  @IsString()
  @IsOptional()
  collectiveAgreement?: string;

  // 🆕 CALENDRIER DE PAIE
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(31)
  payrollPaymentDay?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(31)
  payrollCloseDay?: number;

  // 🆕 ANCIENNETÉ — formule linéaire générale (JSON, validation libre côté shape)
  // { enabled, startYear, startRate, ratePerYear, capPercent }
  @IsOptional()
  seniorityLinearConfig?: Record<string, any> | null;

  // 🆕 CONGÉS — méthode de calcul de l'indemnité : 'AVERAGE_12M' | 'CURRENT_SALARY'
  @IsOptional()
  @IsString()
  leaveIndemnityMethod?: 'AVERAGE_12M' | 'CURRENT_SALARY';

  // 🆕 CONGÉS — mode de cycle de départ : 'ROLLING' (glissant, défaut) |
  // 'ANNIVERSARY' (toujours calé sur le mois d'embauche). Distinct de
  // l'ancien `leaveReferenceCycle` (JANUARY/HIRE_DATE/JUNE) ci-dessous,
  // qui reste en base mais n'est plus lu par aucun service — dead field,
  // à retirer du schema dans une prochaine migration de nettoyage.
  @IsOptional()
  @IsString()
  leaveCycleMode?: 'ROLLING' | 'ANNIVERSARY';

  // 🆕 CONGÉS — cycle de référence
  @IsOptional()
  @IsString()
  leaveReferenceCycle?: 'JANUARY' | 'HIRE_DATE' | 'JUNE';
  @IsBoolean() @IsOptional() appliesSeniorityLeaveBonus?: boolean;
  @IsString() @IsOptional() leaveConventionKey?: string;

  // 🆕 DOCUMENTS PERSONNALISÉS (ex. modèles client Orca)
  @IsOptional()
  @IsString()
  cachetUrl?: string;

  @IsOptional()
  @IsString()
  documentTemplate?: string; // 'DEFAULT' | 'ORCA'

  @IsOptional()
  @IsString()
  documentFooterText?: string; // pied de page légal libre affiché sur les documents imprimables

  // 🆕 GÉNÉRATEUR DE CONTRATS
  @IsOptional()
  @IsString()
  contractRepresentativeName?: string;

  @IsOptional()
  @IsString()
  contractRepresentativeRole?: string;

  @IsOptional()
  @IsString()
  contractSignatureCity?: string;
  @IsBoolean() @IsOptional() echelonReminderEnabled?: boolean;

  @IsOptional()
  @IsString()
  legalForm?: string; // "SARL", "SA"... — utilisé dans les contrats de prestation générés
}