// ============================================================================
// 📁 src/loans/dto/update-loan.dto.ts
// ============================================================================

import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  IsEnum,
  Min,
} from 'class-validator';
import { LoanNature } from './create-loan.dto';

export class UpdateLoanDto {
  @IsNumber()
  @Min(1)
  @IsOptional()
  amount?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  monthlyRepayment?: number;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  /** Permet à RH/Admin de corriger la nature du prêt après coup. */
  @IsEnum(LoanNature)
  @IsOptional()
  nature?: LoanNature;

  @IsString()
  @IsOptional()
  attachmentUrl?: string;
}