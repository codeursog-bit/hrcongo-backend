import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class CreateCompanySiteDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsNumber()
  @Min(1) // ← 1 mètre minimum
  @IsOptional()
  radius?: number; // défaut 100m

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateCompanySiteDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsNumber()
  @IsOptional()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  radius?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
