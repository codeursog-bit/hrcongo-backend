import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsUUID,
} from 'class-validator';

// ✅ AssetStatus conservé pour la validation du statut
export enum AssetStatus {
  AVAILABLE = 'AVAILABLE',
  IN_USE = 'IN_USE',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
}

// ✅ AssetCategory supprimé — la catégorie est maintenant un string libre
// L'utilisateur peut saisir "IT", "EPI", "Véhicule", "Mon stock custom", etc.

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  // ✅ AVANT : @IsEnum(AssetCategory)  → rejetait toute valeur personnalisée
  // ✅ APRÈS : @IsString()             → accepte n'importe quelle catégorie
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsOptional()
  status?: AssetStatus;

  @IsString()
  @IsOptional()
  condition?: string;

  @IsNumber()
  @IsOptional()
  purchaseValue?: number;

  @IsDateString()
  @IsNotEmpty()
  purchaseDate: string;

  @IsUUID()
  @IsOptional()
  employeeId?: string;
}
