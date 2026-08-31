import {
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';
import { DayStatusEnum } from '../attendance.service';

/**
 * ✅ DTO POUR CORRECTIONS D'ATTENDANCE (DOC 4)
 */
export class CorrectAttendanceDto {
  @IsOptional()
  @IsEnum(DayStatusEnum)
  status?: DayStatusEnum;

  @IsOptional()
  @IsDateString()
  checkIn?: string; // ← Date → string

  @IsOptional()
  @IsDateString()
  checkOut?: string; // ← Date → string

  @IsOptional()
  @IsNumber()
  totalHours?: number;

  @IsNotEmpty()
  @IsString()
  reason: string;
}
