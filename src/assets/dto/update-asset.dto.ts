import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsNotEmpty,
  Min,
} from 'class-validator';

// Tous les champs sont optionnels : on ne modifie que ce qui est envoyé.
export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Le nom du matériel ne peut pas être vide' })
  name?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  // Catégorie libre (même règle qu'à la création)
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'La catégorie ne peut pas être vide' })
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchaseValue?: number;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;
}