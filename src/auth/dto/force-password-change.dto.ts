// ============================================================================
// 📁 src/auth/dto/force-password-change.dto.ts
// ============================================================================

import { IsString, MinLength, Matches } from 'class-validator';

export class ForcePasswordChangeDto {
  @IsString({ message: 'Le token temporaire est requis' })
  tempToken: string;

  @IsString({ message: 'Le mot de passe est requis' })
  @MinLength(8, {
    message: 'Le mot de passe doit contenir au moins 8 caractères',
  })
  @Matches(/[A-Z]/, {
    message: 'Le mot de passe doit contenir au moins une majuscule',
  })
  @Matches(/[a-z]/, {
    message: 'Le mot de passe doit contenir au moins une minuscule',
  })
  @Matches(/[0-9]/, {
    message: 'Le mot de passe doit contenir au moins un chiffre',
  })
  newPassword: string;
}
