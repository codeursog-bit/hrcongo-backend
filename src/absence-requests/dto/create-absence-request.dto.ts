// ============================================================================
// 📁 src/absence-requests/dto/create-absence-request.dto.ts
// ✅ Conforme au schéma Prisma (AbsenceType / AbsenceSubType enums)
// ✅ Restructuration : MALADIE n'est plus un type de premier niveau, c'est
//    désormais un sous-motif de CONVENTIONNELLE (avec MATERNITE/PATERNITE).
//    L'ancienne valeur AbsenceType.MALADIE reste dans le schéma Prisma pour
//    ne pas casser l'historique, mais n'est plus acceptée à la création.
// ============================================================================

import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsBoolean,
} from 'class-validator';

// ✅ Types encore acceptés à la création d'une absence
export enum CreatableAbsenceType {
  CONVENTIONNELLE = 'CONVENTIONNELLE',
  EXCEPTIONNELLE = 'EXCEPTIONNELLE',
}

export enum AbsenceSubType {
  // Sous-motifs de CONVENTIONNELLE
  MALADIE = 'MALADIE',
  MATERNITE = 'MATERNITE',
  PATERNITE = 'PATERNITE',
  // Sous-motifs de EXCEPTIONNELLE
  MARIAGE = 'MARIAGE',
  DECES = 'DECES',
  NAISSANCE = 'NAISSANCE',
  // ✅ Nouveaux — vus sur les modèles clients (catalogue "Modèle 2")
  RETRAIT_DEUIL = 'RETRAIT_DEUIL',
  DEMENAGEMENT = 'DEMENAGEMENT',
  // Commun aux deux types
  AUTRE = 'AUTRE',
}

// Sous-motifs valides pour chaque type — utilisé pour la validation croisée
export const SUBTYPES_BY_ABSENCE_TYPE: Record<
  CreatableAbsenceType,
  AbsenceSubType[]
> = {
  [CreatableAbsenceType.CONVENTIONNELLE]: [
    AbsenceSubType.MALADIE,
    AbsenceSubType.MATERNITE,
    AbsenceSubType.PATERNITE,
    AbsenceSubType.AUTRE,
  ],
  [CreatableAbsenceType.EXCEPTIONNELLE]: [
    AbsenceSubType.MARIAGE,
    AbsenceSubType.DECES,
    AbsenceSubType.NAISSANCE,
    AbsenceSubType.RETRAIT_DEUIL,
    AbsenceSubType.DEMENAGEMENT,
    AbsenceSubType.AUTRE,
  ],
};

export class CreateAbsenceRequestDto {
  // ✅ Catalogue calculé "Modèle 2" — clé d'une ligne de la table de
  //    référence de la convention collective de l'entreprise (voir
  //    absence-motifs-grille.ts). Quand fourni, type/subType/reason/endDate
  //    sont dérivés automatiquement. Sinon, comportement DEFAULT inchangé :
  //    tout est obligatoire ci-dessous.
  @IsString()
  @IsOptional()
  motifKey?: string;

  @IsEnum(CreatableAbsenceType)
  @IsOptional()
  type?: CreatableAbsenceType;

  @IsEnum(AbsenceSubType)
  @IsOptional()
  subType?: AbsenceSubType;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  reason?: string; // Motif de l'absence — obligatoire seulement hors catalogue (voir service)

  @IsBoolean()
  @IsOptional()
  isPaid?: boolean; // Statut souhaité — Payé / Non-payé (proposé par l'employé, tranché par le RH à la validation)

  @IsString()
  @IsOptional()
  attachmentUrl?: string; // Justificatif joint (certificat médical, etc.)

  // ✅ RH/Admin uniquement : créer la demande pour un autre employé
  //    (vérifié côté service — un employé standard ne peut pas définir ce champ
  //    pour quelqu'un d'autre que lui-même).
  @IsString()
  @IsOptional()
  employeeId?: string;
}