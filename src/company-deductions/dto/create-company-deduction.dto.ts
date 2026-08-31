// ============================================================================
// 📁 src/company-deductions/dto/create-company-deduction.dto.ts
// ============================================================================

import { IsString, IsNumber, IsNotEmpty, Min, IsInt, IsOptional, IsBoolean } from 'class-validator';

export class CreateCompanyDeductionDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  label: string; // "Pharmacie", "Cantine", "Casse matériel"... libre

  @IsNumber()
  @Min(1)
  amount: number;

  @IsInt()
  month: number;

  @IsInt()
  year: number;

  // true (défaut) = déduite sur la paie du mois indiqué ; false = suivie
  // manuellement, réglée en espèces, jamais touchée par la génération de paie.
  @IsOptional()
  @IsBoolean()
  recoverViaPayroll?: boolean;
}