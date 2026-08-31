import {
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
  IsEmail,
} from 'class-validator';

// ============================================================================
// ⚠️ Ce DTO est volontairement une liste blanche stricte : SEULS ces champs
// peuvent être modifiés par l'employé lui-même, via PATCH /employees/me.
// Rien de contractuel (contrat, poste, département, dates), rien de sensible
// à la paie (salaire, catégorie/échelon, mode de paiement, banque, fiscalité),
// et rien d'administratif légal (CNI, CNSS, NIU) n'apparaît ici — et ne doit
// JAMAIS y être ajouté sans revalider ce choix avec le RH.
// ============================================================================
export class SelfServiceUpdateEmployeeDto {
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) nationality?: string;

  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() maritalStatus?: string;
  @IsOptional() @IsInt() @Min(0) numberOfChildren?: number;

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

  @IsOptional() @IsString() photoUrl?: string;
}
