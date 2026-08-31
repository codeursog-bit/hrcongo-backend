import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  ValidateIf,
  Matches,
} from 'class-validator';

export type AccountType = 'COMPANY' | 'CABINET';

export class RegisterDto {
  // ─── Champs communs ────────────────────────────────────────────────────────

  @IsEmail({}, { message: "L'email doit être valide" })
  @IsNotEmpty({ message: "L'email est requis" })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est requis' })
  @MinLength(6, {
    message: 'Le mot de passe doit contenir au moins 6 caractères',
  })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'Le prénom est requis' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Le nom est requis' })
  lastName: string;

  @IsEnum(['COMPANY', 'CABINET'], {
    message: "Le type de compte doit être 'COMPANY' ou 'CABINET'",
  })
  accountType: AccountType;

  // ─── Champs cabinet uniquement ─────────────────────────────────────────────

  @ValidateIf((o) => o.accountType === 'CABINET')
  @IsString()
  @IsNotEmpty({ message: 'Le nom du cabinet est requis' })
  cabinetName?: string;

  @ValidateIf((o) => o.accountType === 'CABINET')
  @IsString()
  @IsNotEmpty({ message: 'Le sous-domaine est requis' })
  @MinLength(3, {
    message: 'Le sous-domaine doit contenir au moins 3 caractères',
  })
  @Matches(/^[a-z0-9-]+$/, {
    message:
      'Le sous-domaine ne peut contenir que des lettres minuscules, chiffres et tirets',
  })
  subdomain?: string; // ex: "gl-conseil" → gl-conseil.konza-rh.app

  @ValidateIf((o) => o.accountType === 'CABINET')
  @IsOptional()
  @IsString()
  cabinetPhone?: string;

  // ─── Champs entreprise uniquement ──────────────────────────────────────────
  // (les champs company existants restent dans CreateCompanyDto,
  //  on garde juste le DTO simple ici pour l'inscription initiale)

  // ─── Code affilié (optionnel) ──────────────────────────────────────────────
  // Transmis via le paramètre ?ref=XXXXXX dans l'URL d'inscription
  @IsOptional()
  @IsString()
  affiliateCode?: string;
}
