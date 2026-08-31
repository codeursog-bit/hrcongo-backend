import { IsNotEmpty, IsString, MinLength, IsOptional } from 'class-validator';

// ✅ Le champ `email` accepte maintenant soit une adresse email, soit un numéro de téléphone.
// On garde le nom `email` pour ne rien casser côté front existant (payload identique).
// La distinction email vs téléphone est faite dans AuthService.login().
export class LoginDto {
  @IsNotEmpty({ message: "L'email ou le téléphone est requis" })
  @IsString()
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est requis' })
  @MinLength(6, { message: 'Le mot de passe est trop court' })
  password: string;

  // ✅ AJOUT : Propriété IP optionnelle
  @IsOptional()
  @IsString()
  ip?: string;
}
