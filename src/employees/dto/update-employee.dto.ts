// ============================================================================
// 📁 src/employees/dto/update-employee.dto.ts
// 🆕 Ajout de contractEndDate
// ============================================================================
import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  IsNumber,
  IsDateString,
  IsInt,
  Min,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import {
  Gender,
  MaritalStatus,
  ContractType,
  PaymentMethod,
} from './create-employee.dto';

enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class UpdateEmployeeDto {
  @IsString() @IsOptional() firstName?: string;
  @IsString() @IsOptional() lastName?: string;
  @IsDateString() @IsOptional() dateOfBirth?: string;
  @IsString() @IsOptional() placeOfBirth?: string;
  @IsEnum(Gender) @IsOptional() gender?: Gender;
  @IsString() @IsOptional() city?: string;
  @IsEnum(MaritalStatus) @IsOptional() maritalStatus?: MaritalStatus;
  @IsInt() @Min(0) @IsOptional() numberOfChildren?: number;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() secondaryPhone?: string; // ✅ AJOUT : numéro secondaire, informatif uniquement
  @IsEmail({}, { message: "L'email doit être valide" })
  @IsOptional()
  email?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() nationalIdNumber?: string;
  @IsString() @IsOptional() cnssNumber?: string;
  @IsDateString() @IsOptional() hireDate?: string;
  @IsEnum(ContractType) @IsOptional() contractType?: ContractType;

  // 🆕 Date de fin de contrat (CDD, STAGE, INTERIM, CONSULTANT)
  @IsDateString() @IsOptional() contractEndDate?: string | null;

  @IsString() @IsOptional() position?: string;
  @IsString() @IsOptional() departmentId?: string;
  @IsNumber() @IsOptional() baseSalary?: number;
  @IsString() @IsOptional() photoUrl?: string;
  @IsEnum(PaymentMethod) @IsOptional() paymentMethod?: PaymentMethod;
  @IsString() @IsOptional() bankName?: string;
  @IsString() @IsOptional() bankAccountNumber?: string;
  @IsString() @IsOptional() mobileMoneyOperator?: string;
  @IsString() @IsOptional() mobileMoneyNumber?: string;
  @IsBoolean() @IsOptional() isSubjectToIrpp?: boolean;
  @IsBoolean() @IsOptional() isSubjectToCnss?: boolean;

  // Zone TOL : VILLE (5 000 F) ou PERIPHERIE (1 000 F)
  @IsOptional()
  @IsString()
  tolZone?: 'VILLE' | 'PERIPHERIE';
  @IsString() @IsOptional() @MaxLength(500) taxExemptionReason?: string;
  @IsString() @IsOptional() @MaxLength(50) professionalCategory?: string;
  @IsString() @IsOptional() @MaxLength(50) echelon?: string;
  @IsString() @IsOptional() @MaxLength(50) employeeNumber?: string;
  @IsString() @IsOptional() @MaxLength(50) niu?: string;
  @IsString() @IsOptional() @MaxLength(50) taxNumber?: string;
  @IsInt() @Min(0) @IsOptional() trialPeriodDays?: number;
  @IsDateString() @IsOptional() trialEndDate?: string | null;
  @IsEnum(EmployeeStatus) @IsOptional() status?: EmployeeStatus;
  @IsDateString() @IsOptional() terminationDate?: string | null;
  @IsString() @IsOptional() @MaxLength(500) terminationReason?: string | null;

  // YTD CarryOver — point de depart historique (saisi en jan ou retour conge)
  @IsNumber() @IsOptional() ytdCarryOverBrut?: number;
  @IsNumber() @IsOptional() ytdCarryOverNetImp?: number;
  @IsNumber() @IsOptional() ytdCarryOverNetSalary?: number;
  @IsNumber() @IsOptional() ytdCarryOverChargesSal?: number;
  @IsNumber() @IsOptional() ytdCarryOverChargesPat?: number;
  @IsDateString() @IsOptional() ytdCarryOverDate?: string;

  // ── CUMUL CONGÉ AVANT KONZA RH (optionnel, non-BNC) ────────────────────────
@IsOptional()
@IsNumber()
openingCumulativeGross?: number;

@IsOptional()
@IsInt()
@Min(0)
openingCumulativeMonths?: number;

  // 🆕 ANCIENNETÉ — override personnel de la formule linéaire (JSON).
  // null = hérite de Company.seniorityLinearConfig.
  // Shape: { enabled, startYear, startRate, ratePerYear, capPercent }
  @IsOptional() seniorityLinearOverride?: Record<string, any> | null;

  // 🆕 FICHE ORCA — Informations complémentaires
  @IsString() @IsOptional() @MaxLength(10) bloodType?: string;
  @IsString() @IsOptional() pathology?: string;
  @IsString() @IsOptional() @MaxLength(150) fatherName?: string;
  @IsString() @IsOptional() @MaxLength(150) motherName?: string;
  @IsString() @IsOptional() @MaxLength(100) educationLevel?: string;

  @IsString() @IsOptional() @MaxLength(150) emergencyContactName?: string;
  @IsString() @IsOptional() @MaxLength(50) emergencyContactRelation?: string;
  @IsString() @IsOptional() @MaxLength(20) emergencyContactPhone?: string;

  @IsBoolean() @IsOptional() hasDrivingLicense?: boolean;
  @IsString() @IsOptional() @MaxLength(50) drivingLicenseNumber?: string;

  @IsString() @IsOptional() @MaxLength(255) foreignLanguages?: string;
  @IsString() @IsOptional() @MaxLength(10) uniformSize?: string;
  @IsString() @IsOptional() @MaxLength(10) shoeSize?: string;

  // 🆕 Nationalité + statut de résidence (manquaient — cause de l'erreur "property nationality should not exist")
  @IsBoolean() @IsOptional() isResident?: boolean;
  @IsString() @IsOptional() @MaxLength(100) nationality?: string;
}
