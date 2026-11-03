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

  // 🆕 Marge GPS maximale (mètres) ajoutée au rayon selon la précision de l'appareil. 0 = stricte.
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(200)
  gpsToleranceMeters?: number;

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
  // 🆕 CONGÉS — l'entreprise accorde-t-elle des congés (et l'indemnité) à ses
  // prestataires/consultants ? Défaut : non. Les stagiaires n'en ont jamais.
  @IsBoolean() @IsOptional() leaveAppliesToContractors?: boolean;
  // Prime d'ancienneté proratisée selon les jours travaillés (défaut : non)
  @IsBoolean() @IsOptional() seniorityProrata?: boolean;
  // Bulletin : présentation du salaire de base proratisé (jours payés) au lieu de
  // « salaire plein + ligne Déduction absences ». Présentation SEULEMENT — les
  // données en base (SAL_BASE, ABS_DEDUCT, journal) ne changent pas. Défaut : non.
  @IsBoolean() @IsOptional() salaryProrataDisplay?: boolean;
  // Paie sur le NET : le net du bulletin est recalé sur « net plein × jours ÷ jours
  // théoriques » en ajustant UNIQUEMENT le sursalaire (calcul à l'envers). Option de
  // flexibilité — le calcul légal par défaut n'est pas modifié. Défaut : non.
  @IsBoolean() @IsOptional() netBasedProrata?: boolean;
  @IsString() @IsOptional() leaveConventionKey?: string;

  // 🆕 DOCUMENTS PERSONNALISÉS (ex. modèles client Orca)
  @IsOptional()
  @IsString()
  cachetUrl?: string;

  @IsOptional()
  @IsString()
  documentTemplate?: string; // 'DEFAULT' | 'ORCA' | 'STANDARD' | 'MODERN'

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