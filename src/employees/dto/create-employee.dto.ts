// import {
//   IsNotEmpty,
//   IsString,
//   IsEmail,
//   IsOptional,
//   IsEnum,
//   IsNumber,
//   IsDateString,
//   IsInt,
//   Min,
//   IsBoolean,
//   MaxLength
// } from 'class-validator';

// export enum Gender {
//   MALE = 'MALE',
//   FEMALE = 'FEMALE'
// }

// export enum MaritalStatus {
//   SINGLE = 'SINGLE',
//   MARRIED = 'MARRIED',
//   DIVORCED = 'DIVORCED',
//   WIDOWED = 'WIDOWED'
// }

// export enum ContractType {
//   CDI = 'CDI',
//   CDD = 'CDD',
//   STAGE = 'STAGE',
//   INTERIM = 'INTERIM',         // 🆕 ajouté
//   CONSULTANT = 'CONSULTANT'
// }

// export enum PaymentMethod {
//   BANK_TRANSFER = 'BANK_TRANSFER',
//   MOBILE_MONEY = 'MOBILE_MONEY',
//   CASH = 'CASH'
// }

// export class CreateEmployeeDto {
//   // ============================================================================
//   // 1️⃣ IDENTITÉ (Obligatoire)
//   // ============================================================================

//   @IsString()
//   @IsNotEmpty({ message: 'Le prénom est requis' })
//   firstName: string;

//   @IsString()
//   @IsNotEmpty({ message: 'Le nom est requis' })
//   lastName: string;

//   @IsDateString()
//   @IsNotEmpty({ message: 'La date de naissance est requise' })
//   dateOfBirth: string;

//   @IsString()
//   @IsNotEmpty({ message: 'Le lieu de naissance est requis' })
//   placeOfBirth: string;

//   @IsEnum(Gender)
//   @IsNotEmpty({ message: 'Le genre est requis' })
//   gender: Gender;

//   // ============================================================================
//   // 2️⃣ SITUATION FAMILIALE (Pour calcul fiscal IRPP/ITS)
//   // ============================================================================

//   @IsEnum(MaritalStatus)
//   @IsNotEmpty({ message: 'La situation familiale est requise' })
//   maritalStatus: MaritalStatus;

//   @IsInt()
//   @Min(0)
//   @IsNotEmpty({ message: 'Le nombre d\'enfants est requis (indiquer 0 si aucun)' })
//   numberOfChildren: number;

//   // ============================================================================
//   // 3️⃣ COORDONNÉES (Obligatoire)
//   // ============================================================================

//   @IsString()
//   @IsNotEmpty({ message: 'Le téléphone est requis' })
//   phone: string;

//   @IsEmail({}, { message: "L'email doit être valide" })
//   @IsNotEmpty({ message: "L'email est requis" })
//   email: string;

//   @IsString()
//   @IsNotEmpty({ message: "L'adresse est requise" })
//   address: string;

//   @IsString()
//   @IsOptional()
//   city?: string;

//   // ============================================================================
//   // 4️⃣ DOCUMENTS OFFICIELS (CNI optionnelle, CNSS optionnelle)
//   // ============================================================================

//   @IsString()
//   @IsOptional()
//   nationalIdNumber?: string;

//   @IsString()
//   @IsOptional()
//   cnssNumber?: string;

//   // ============================================================================
//   // 5️⃣ EMPLOI (Obligatoire)
//   // ============================================================================

//   @IsDateString()
//   @IsNotEmpty({ message: "La date d'embauche est requise" })
//   hireDate: string;

//   @IsEnum(ContractType)
//   @IsNotEmpty({ message: 'Le type de contrat est requis' })
//   contractType: ContractType;

//   // 🆕 Date de fin — obligatoire pour CDD/STAGE/INTERIM/CONSULTANT, vide pour CDI
//   @IsDateString()
//   @IsOptional()
//   contractEndDate?: string | null;

//   @IsString()
//   @IsNotEmpty({ message: "Le poste est requis" })
//   position: string;

//   @IsString()
//   @IsNotEmpty({ message: "Le département est requis" })
//   departmentId: string;

//   @IsNumber()
//   @IsNotEmpty({ message: "Le salaire de base est requis" })
//   baseSalary: number;

//   // ============================================================================
//   // 6️⃣ PAIEMENT (Optionnel)
//   // ============================================================================

//   @IsEnum(PaymentMethod)
//   @IsOptional()
//   paymentMethod?: PaymentMethod;

//   @IsString()
//   @IsOptional()
//   bankName?: string;

//   @IsString()
//   @IsOptional()
//   bankAccountNumber?: string;

//   @IsString()
//   @IsOptional()
//   mobileMoneyOperator?: string;

//   @IsString()
//   @IsOptional()
//   mobileMoneyNumber?: string;

//   // ============================================================================
//   // 7️⃣ PHOTO
//   // ============================================================================

//   @IsString()
//   @IsOptional()
//   photoUrl?: string;

//   // ============================================================================
//   // 8️⃣ CONVENTION COLLECTIVE (Optionnel)
//   // ============================================================================

//   @IsString()
//   @IsOptional()
//   @MaxLength(10)
//   professionalCategory?: string;

//   @IsString()
//   @IsOptional()
//   @MaxLength(10)
//   echelon?: string;

//   // ============================================================================
//   // 9️⃣ FISCAL
//   // ============================================================================

//   @IsOptional()
//   @IsBoolean()
//   isSubjectToIrpp?: boolean;

//   @IsOptional()
//   @IsBoolean()
//   isSubjectToCnss?: boolean;

//   @IsOptional()
//   @IsString()
//   @MaxLength(500)
//   taxExemptionReason?: string;

//   // Zone TOL : VILLE (5 000 F) ou PERIPHERIE (1 000 F)
//   @IsOptional()
//   @IsString()
//   tolZone?: 'VILLE' | 'PERIPHERIE';
// }

import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsInt,
  Min,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

export enum MaritalStatus {
  SINGLE = 'SINGLE',
  MARRIED = 'MARRIED',
  DIVORCED = 'DIVORCED',
  WIDOWED = 'WIDOWED',
}

export enum ContractType {
  CDI = 'CDI',
  CDD = 'CDD',
  STAGE = 'STAGE',
  INTERIM = 'INTERIM',
  CONSULTANT = 'CONSULTANT',
  PRESTATAIRE = 'PRESTATAIRE', // 🆕 Sous-traitant/freelance — BNC 10%/20%
}

export enum PaymentMethod {
  BANK_TRANSFER = 'BANK_TRANSFER',
  MOBILE_MONEY = 'MOBILE_MONEY',
  CASH = 'CASH',
}

export class CreateEmployeeDto {
  // ============================================================================
  // 1️⃣ IDENTITÉ (Obligatoire)
  // ============================================================================

  @IsString()
  @IsNotEmpty({ message: 'Le prénom est requis' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Le nom est requis' })
  lastName: string;

  @IsDateString()
  @IsNotEmpty({ message: 'La date de naissance est requise' })
  dateOfBirth: string;

  @IsString()
  @IsNotEmpty({ message: 'Le lieu de naissance est requis' })
  placeOfBirth: string;

  @IsEnum(Gender)
  @IsNotEmpty({ message: 'Le genre est requis' })
  gender: Gender;

  // ============================================================================
  // 2️⃣ SITUATION FAMILIALE (Pour calcul fiscal IRPP/ITS)
  // ============================================================================

  @IsEnum(MaritalStatus)
  @IsNotEmpty({ message: 'La situation familiale est requise' })
  maritalStatus: MaritalStatus;

  @IsInt()
  @Min(0)
  @IsNotEmpty({
    message: "Le nombre d'enfants est requis (indiquer 0 si aucun)",
  })
  numberOfChildren: number;

  // ============================================================================
  // 3️⃣ COORDONNÉES (Obligatoire)
  // ============================================================================

  @IsOptional()
  @IsString()
  phone?: string; // ✅ optionnel : requis seulement pour la création manuelle (vérifié en service), pas pour l'import en masse

  @IsOptional()
  @IsString()
  secondaryPhone?: string; // ✅ AJOUT : numéro secondaire, informatif uniquement

  @IsEmail({}, { message: "L'email doit être valide" })
  @IsNotEmpty({ message: "L'email est requis" })
  email: string;

  @IsString()
  @IsNotEmpty({ message: "L'adresse est requise" })
  address: string;

  @IsString()
  @IsOptional()
  city?: string;

  // ============================================================================
  // 4️⃣ DOCUMENTS OFFICIELS (CNI optionnelle, CNSS optionnelle)
  // ============================================================================

  // Matricule personnalisé (optionnel — généré automatiquement si absent)
  @IsString()
  @IsOptional()
  @MaxLength(50)
  employeeNumber?: string;

  @IsString()
  @IsOptional()
  nationalIdNumber?: string;

  @IsString()
  @IsOptional()
  cnssNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  niu?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  taxNumber?: string;

  // ============================================================================
  // 5️⃣ EMPLOI (Obligatoire)
  // ============================================================================

  @IsDateString()
  @IsNotEmpty({ message: "La date d'embauche est requise" })
  hireDate: string;

  @IsEnum(ContractType)
  @IsNotEmpty({ message: 'Le type de contrat est requis' })
  contractType: ContractType;

  // 🆕 Date de fin — obligatoire pour CDD/STAGE/INTERIM/CONSULTANT, vide pour CDI
  @IsDateString()
  @IsOptional()
  contractEndDate?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'Le poste est requis' })
  position: string;

  @IsString()
  @IsNotEmpty({ message: 'Le département est requis' })
  departmentId: string;

  @IsNumber()
  @IsNotEmpty({ message: 'Le salaire de base est requis' })
  baseSalary: number;

  // ============================================================================
  // 6️⃣ PAIEMENT (Optionnel)
  // ============================================================================

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankAccountNumber?: string;

  @IsString()
  @IsOptional()
  mobileMoneyOperator?: string;

  @IsString()
  @IsOptional()
  mobileMoneyNumber?: string;

  // ============================================================================
  // 7️⃣ PHOTO
  // ============================================================================

  @IsString()
  @IsOptional()
  photoUrl?: string;

  // ============================================================================
  // 8️⃣ CONVENTION COLLECTIVE (Optionnel)
  // ============================================================================

  @IsString() @IsOptional() @MaxLength(50) professionalCategory?: string;
  @IsString() @IsOptional() @MaxLength(50) echelon?: string;

  // ============================================================================
  // 9️⃣ FISCAL
  // ============================================================================

  @IsOptional()
  @IsBoolean()
  isSubjectToIrpp?: boolean;

  @IsOptional()
  @IsBoolean()
  isSubjectToCnss?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  taxExemptionReason?: string;

  // Zone TOL : VILLE (5 000 F) ou PERIPHERIE (1 000 F)
  @IsOptional()
  @IsString()
  tolZone?: 'VILLE' | 'PERIPHERIE';

  // ── PÉRIODE D'ESSAI (CDI / CDD) ────────────────────────────────────────────
  @IsOptional()
  @IsInt()
  @Min(0)
  trialPeriodDays?: number; // Durée en jours (0 = pas d'essai)

  @IsOptional()
  @IsDateString()
  trialEndDate?: string; // Auto-calculée côté service si trialPeriodDays > 0

  // ── NATIONALITÉ / RÉSIDENCE (BNC Consultant/Prestataire) ──────────────────
  // Détermine le taux BNC : true = résident/congolais → 10% | false = étranger → 20%
  @IsOptional()
  @IsBoolean()
  isResident?: boolean; // default: true

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string; // Nom du pays en toutes lettres, normalisé côté service (ex: "Congo", "Cameroun")

  // 🆕 ANCIENNETÉ — override personnel de la formule linéaire (JSON, optionnel à la création).
  // Shape: { enabled, startYear, startRate, ratePerYear, capPercent }
  @IsOptional() seniorityLinearOverride?: Record<string, any> | null;



  // ── CUMUL CONGÉ AVANT KONZA RH (optionnel, non-BNC) ────────────────────────
@IsOptional()
@IsNumber()
openingCumulativeGross?: number;

@IsOptional()
@IsInt()
@Min(0)
openingCumulativeMonths?: number;

  // ============================================================================
  // 🔟 FICHE ORCA — Informations complémentaires (Optionnel)
  // ============================================================================

  @IsOptional() @IsString() @MaxLength(10) bloodType?: string;
  @IsOptional() @IsString() pathology?: string;
  @IsOptional() @IsString() @MaxLength(150) fatherName?: string;
  @IsOptional() @IsString() @MaxLength(150) motherName?: string;
  @IsOptional() @IsString() @MaxLength(100) educationLevel?: string;

  @IsOptional() @IsString() @MaxLength(150) emergencyContactName?: string;
  @IsOptional() @IsString() @MaxLength(50) emergencyContactRelation?: string;
  @IsOptional() @IsString() @MaxLength(20) emergencyContactPhone?: string;

  @IsOptional() @IsBoolean() hasDrivingLicense?: boolean;
  @IsOptional() @IsString() @MaxLength(50) drivingLicenseNumber?: string;

  @IsOptional() @IsString() @MaxLength(255) foreignLanguages?: string;
  @IsOptional() @IsString() @MaxLength(10) uniformSize?: string;
  @IsOptional() @IsString() @MaxLength(10) shoeSize?: string;
}
