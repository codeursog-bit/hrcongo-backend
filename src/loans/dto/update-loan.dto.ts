// ============================================================================
// 📁 src/loans/dto/update-loan.dto.ts
// ============================================================================

import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
} from 'class-validator';

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
}
