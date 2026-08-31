// ============================================================================
// 📁 src/contact/dto/contact.dto.ts
// ============================================================================
import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsIn,
} from 'class-validator';

export const SUBJECTS = [
  'Demande de démo',
  'Question sur les tarifs',
  'Support technique',
  'Partenariat commercial',
  'Demande de formation sur site',
  'Signalement / Bug',
  'Autre',
] as const;

export class CreateContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsIn(SUBJECTS)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message: string;
}
