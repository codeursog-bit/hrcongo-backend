// ============================================================================
// 📁 src/contracts/dto/generate-contract.dto.ts
// ============================================================================

import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum GeneratedContractKindDto {
  CONTRAT_TRAVAIL = 'CONTRAT_TRAVAIL',
  PRESTATION_SERVICES = 'PRESTATION_SERVICES',
  CONSULTANT = 'CONSULTANT',
  STAGE = 'STAGE',
}

export class ContractLineItemDto {
  @IsString()
  label: string;

  @IsNumber()
  @Min(0)
  amount: number;
}

export class GenerateContractDto {
  @IsUUID()
  employeeId: string;

  @IsEnum(GeneratedContractKindDto)
  kind: GeneratedContractKindDto;

  // 'INDETERMINEE' | 'DETERMINEE' — texte contractuel utilisé tel quel dans le document
  @IsString()
  contractDuration: string;

  @IsOptional()
  @IsString()
  startDate?: string; // ISO date

  @IsOptional()
  @IsString()
  endDate?: string; // ISO date, requis si contractDuration === 'DETERMINEE'

  // Période d'essai en mois — 0/absent = pas d'essai (article omis du document)
  @IsOptional()
  @IsInt()
  @Min(0)
  trialPeriodMonths?: number;

  // ── Identité (pré-remplie depuis l'employé, modifiable) ──────────────────
  @IsOptional() @IsString() civilite?: string; // Monsieur | Madame | Mademoiselle
  @IsOptional() @IsString() nom?: string;
  @IsOptional() @IsString() prenom?: string;
  @IsOptional() @IsString() dateNaissance?: string;
  @IsOptional() @IsString() lieuNaissance?: string;
  @IsOptional() @IsString() nationalite?: string;

  // ── Filiation & famille ───────────────────────────────────────────────────
  @IsOptional() @IsString() situationMatrimoniale?: string;
  @IsOptional() @IsInt() @Min(0) nombreEnfants?: number;
  @IsOptional() @IsString() nomPere?: string;
  @IsOptional() @IsString() nomMere?: string;

  // ── Coordonnées ───────────────────────────────────────────────────────────
  @IsOptional() @IsString() adresseEmploye?: string;
  @IsOptional() @IsString() telephoneEmploye?: string; // Stage / Prestation / Consultant

  // ── Poste occupé ─────────────────────────────────────────────────────────
  @IsOptional() @IsString() poste?: string;
  @IsOptional() @IsString() categorie?: string;
  @IsOptional() @IsString() lieuTravail?: string;

  // ── Spécifique STAGE ─────────────────────────────────────────────────────
  @IsOptional() @IsNumber() @Min(0) montantForfaitaire?: number; // gratification mensuelle
  @IsOptional() @IsString() dureeStageTexte?: string; // ex. "de six mois"
  @IsOptional() @IsBoolean() renouvelable?: boolean;

  // ── Spécifique PRESTATION_SERVICES / CONSULTANT ─────────────────────────
  @IsOptional() @IsString() taches?: string; // description des tâches, une par ligne
  @IsOptional() @IsString() horaires?: string; // ex. "9h00 à 13h\n14h00 à 18h30"
  @IsOptional() @IsNumber() @Min(0) emoluments?: number; // montant mensuel sur facture
  @IsOptional() @IsNumber() @Min(0) tauxBnc?: number; // % — défaut 10

  // ── Salaire brut (CONTRAT_TRAVAIL uniquement) ──────────────────────────────
  @IsOptional() @IsNumber() @Min(0) salaireBase?: number;
  @IsOptional() @IsNumber() @Min(0) sursalaire?: number;
  @IsOptional() @IsNumber() @Min(0) heuresSupplementaires?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractLineItemDto)
  primes?: ContractLineItemDto[]; // entrent dans le brut

  // ── Primes & indemnités hors brut ───────────────────────────────────────
  @IsOptional() @IsNumber() @Min(0) transport?: number; // entre dans le brut (comme dans le doc existant)
  @IsOptional() @IsNumber() @Min(0) indemniteTransport?: number; // n'entre PAS dans le brut

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractLineItemDto)
  indemnites?: ContractLineItemDto[]; // n'entrent pas dans le brut

  // ── Société / représentant / signature — pré-rempli depuis les paramètres,
  // modifiable ponctuellement ──────────────────────────────────────────────
  @IsOptional() @IsString() nomEntreprise?: string;
  @IsOptional() @IsString() adresseEntreprise?: string;
  @IsOptional() @IsString() telephoneEntreprise?: string;
  @IsOptional() @IsString() formeJuridique?: string; // "SARL", "SA"... — Prestation / Consultant
  @IsOptional() @IsString() representantNom?: string;
  @IsOptional() @IsString() representantFonction?: string;
  @IsOptional() @IsString() villeSignature?: string;
  @IsOptional() @IsString() dateSignature?: string;

  // Permet de forcer un recalcul CNSS/ITS/TOL même si l'employé n'y est pas
  // soumis par défaut (cas rare, ex. simulation) — false par défaut.
  @IsOptional()
  @IsBoolean()
  forceApplyDeductions?: boolean;
}

export class PreviewBreakdownDto {
  @IsUUID()
  employeeId: string;

  @IsNumber() @Min(0) salaireBase: number;
  @IsOptional() @IsNumber() @Min(0) sursalaire?: number;
  @IsOptional() @IsNumber() @Min(0) heuresSupplementaires?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContractLineItemDto)
  primes?: ContractLineItemDto[];
  @IsOptional() @IsNumber() @Min(0) transport?: number;
  @IsOptional() @IsNumber() @Min(0) indemniteTransport?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContractLineItemDto)
  indemnites?: ContractLineItemDto[];
  @IsOptional() @IsString() situationMatrimoniale?: string;
  @IsOptional() @IsInt() @Min(0) nombreEnfants?: number;
}