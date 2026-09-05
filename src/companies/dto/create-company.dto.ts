import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEmail,
  IsNumber,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty({ message: 'Le nom légal est requis' })
  legalName: string;

  @IsString()
  @IsOptional()
  tradeName?: string;

  @IsString()
  @IsNotEmpty({ message: 'Le numéro RCCM est requis' })
  rccmNumber: string;

  @IsString()
  @IsOptional()
  cnssNumber?: string;

  @IsString()
  @IsOptional()
  taxNumber?: string;

  @IsString()
  @IsNotEmpty({ message: "L'adresse est requise" })
  address: string;

  @IsString()
  @IsNotEmpty({ message: 'La ville est requise' })
  city: string;

  @IsString()
  @IsNotEmpty({ message: 'Le pays est requis' })
  country: string = 'CG';

  @IsString()
  @IsNotEmpty({ message: 'Le téléphone est requis' })
  phone: string;

  @IsEmail({}, { message: "L'email doit être valide" })
  @IsNotEmpty({ message: "L'email est requis" })
  email: string;

  @IsString()
  @IsOptional()
  industry?: string;

  // --- GÉOLOCALISATION (Pour le pointage) ---

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  allowedRadius?: number; // Rayon en mètres

  // 🆕 CHAMPS FISCAUX
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

  @IsOptional()
  @IsString()
  affiliateCode?: string;

  // 🆕 ANCIENNETÉ — formule linéaire générale (optionnelle à la création)
  @IsOptional()
  seniorityLinearConfig?: Record<string, any> | null;

  // 🆕 CONGÉS — méthode de calcul de l'indemnité (optionnelle à la création)
  @IsOptional()
  @IsString()
  leaveIndemnityMethod?: 'AVERAGE_12M' | 'CURRENT_SALARY';

  // 🆕 CONGÉS — mode de cycle de départ (voir update-company.dto.ts)
  @IsOptional()
  @IsString()
  leaveCycleMode?: 'ROLLING' | 'ANNIVERSARY';

  @IsOptional()
  @IsString()
  leaveReferenceCycle?: 'JANUARY' | 'HIRE_DATE' | 'JUNE';

  @IsBoolean() @IsOptional() appliesSeniorityLeaveBonus?: boolean;
  @IsString() @IsOptional() leaveConventionKey?: string;
  @IsBoolean() @IsOptional() echelonReminderEnabled?: boolean;
}