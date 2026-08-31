// ============================================================================
// 📁 src/loans/dto/update-advance.dto.ts
// ============================================================================

import { IsString, IsNumber, IsOptional, Min, IsInt } from 'class-validator';

export class UpdateAdvanceDto {
  @IsNumber()
  @Min(1)
  @IsOptional()
  amount?: number;

  @IsInt()
  @IsOptional()
  deductMonth?: number;

  @IsInt()
  @IsOptional()
  deductYear?: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
