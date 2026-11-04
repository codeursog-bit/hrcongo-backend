import {
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
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

  // 🆕 Pause de la journée : début + fin (ISO). Crée la pause si elle n'existe pas.
  @IsOptional()
  @IsDateString()
  breakStart?: string;

  @IsOptional()
  @IsDateString()
  breakEnd?: string;

  // 🆕 Supprime la pause de la journée (le temps de pause redevient du temps travaillé)
  @IsOptional()
  @IsBoolean()
  removeBreak?: boolean;

  @IsNotEmpty()
  @IsString()
  reason: string;
}