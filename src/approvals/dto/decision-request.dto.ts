import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class DecisionRequestDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;

  @IsOptional()
  @IsBoolean()
  recoverViaPayroll?: boolean;

  // Absences : la RH peut trancher « payée / non payée » à la décision (comme avant).
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  // Congés : mêmes champs qu'avant à l'approbation (jours d'ancienneté déjà reportés,
  // motif de report affiché sur la lettre de départ).
  @IsOptional()
  @IsNumber()
  @Min(0)
  extraDaysGranted?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resumptionNote?: string;

  // ASK  : (défaut) renvoie la liste des avis manquants pour que l'écran propose le choix
  // WAIT : enregistre la décision, finalisée quand les avis sont donnés
  // NOW  : valide tout de suite, sans attendre les avis (urgence)
  @IsOptional()
  @IsString()
  @IsIn(['ASK', 'WAIT', 'NOW'])
  mode?: 'ASK' | 'WAIT' | 'NOW';
}
