import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsString,
  IsNumber,
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
}
