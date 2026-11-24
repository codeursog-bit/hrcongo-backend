// src/affiliate/dto/affiliate-register.dto.ts
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class AffiliateRegisterDto {
  @IsEmail({}, { message: 'Email invalide' })
  email: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @MinLength(6)
  password: string;

  /**
   * Numéro de contact — OBLIGATOIRE.
   * Servira aussi de numéro Mobile Money si disbursementPhone absent.
   */
  @IsString()
  @IsNotEmpty({ message: 'Le numéro de téléphone est requis' })
  @Matches(/^[+\d][\d\s\-(). ]{7,19}$/, {
    message: 'Numéro invalide — ex: +242061234567',
  })
  phone: string;

  /**
   * Numéro Mobile Money dédié (optionnel).
   * Si absent → on utilise "phone".
   */
  @IsOptional()
  @IsString()
  @Matches(/^[+\d][\d\s\-(). ]{7,19}$/, {
    message: 'Numéro disbursement invalide',
  })
  disbursementPhone?: string;
}
