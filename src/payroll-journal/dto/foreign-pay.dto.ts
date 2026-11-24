// ============================================================================
// 📁 src/payroll-journal/dto/foreign-pay.dto.ts
// Saisie manuelle de la paie étrangère d'un expatrié (V1 : FCFA uniquement).
// ============================================================================
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertForeignPayDto {
  @IsUUID()
  employeeId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  // ISO 3166-1 alpha-2 (FR, US, CN...)
  @IsString()
  @Length(2, 2)
  countryCode: string;

  @IsString()
  @MaxLength(100)
  countryName: string;

  // Entité qui paie (ex: société mère à l'étranger)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  payerName?: string;

  // Montants en FCFA
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  grossAmount: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  netAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}