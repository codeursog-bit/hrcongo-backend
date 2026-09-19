import { IsNotEmpty, IsString, IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';

export class RegisterKioskDeviceDto {
  // Nom lisible pour l'admin, ex: "Tablette Accueil Brazzaville"
  @IsString()
  @IsNotEmpty()
  name: string;

  // ✅ Utilisateur "porteur" des pointages faits par cette tablette.
  // C'est son companyId/role qui sera utilisé pour appeler checkIn/checkOut,
  // exactement comme si cet utilisateur pointait lui-même depuis le formulaire web.
  // En pratique : l'admin ou un HR_MANAGER de l'entreprise.
  @IsUUID()
  @IsNotEmpty()
  actingUserId: string;

  // Pause déjeuner optionnelle — laisse les deux vides si l'entreprise n'en
  // a pas besoin (la tablette reste alors au repos entre les deux fenêtres
  // arrivée/départ, comme par défaut).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  midDayStartHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  midDayEndHour?: number;
}