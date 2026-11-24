import {
  IsOptional,
  IsString,
  IsBoolean,
  MaxLength,
  IsEmail,
} from 'class-validator';

// ============================================================================
// ⚠️ Ce DTO est volontairement une liste blanche stricte : SEULS ces champs
// peuvent être modifiés par l'employé lui-même, via PATCH /employees/me.
// Rien de contractuel (contrat, poste, département, dates), rien de sensible
// à la paie (salaire, catégorie/échelon, mode de paiement, banque, fiscalité,
// situation familiale, nombre d'enfants — ces deux derniers impactent le
// nombre de parts fiscales et le calcul de la paie), et rien d'administratif
// légal (CNI, CNSS, NIU) n'apparaît ici — et ne doit JAMAIS y être ajouté sans
// revalider ce choix avec le RH.
//
// maritalStatus et numberOfChildren sont volontairement ABSENTS : avec
// ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }) dans
// main.ts, un employé qui tente de les envoyer via PATCH /employees/me reçoit
// un 400 "property maritalStatus should not exist" — ils ne peuvent être
// modifiés que par un ADMIN/HR_MANAGER via PATCH /employees/:id
// (UpdateEmployeeDto, endpoint réservé à EDIT_ROLES).
// ============================================================================
export class SelfServiceUpdateEmployeeDto {
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) nationality?: string;

  @IsOptional() @IsString() gender?: string;

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