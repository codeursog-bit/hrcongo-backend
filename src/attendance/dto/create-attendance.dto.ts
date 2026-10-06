import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class CreateAttendanceDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // ✅ Coordonnées GPS pour validation
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  // Précision GPS annoncée par l'appareil (mètres) — sert à la marge de tolérance
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy?: number;
}