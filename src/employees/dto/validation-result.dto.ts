// 📁 src/employees/dto/validation-result.dto.ts
// ============================================================================

import { IsBoolean, IsNumber, IsArray } from 'class-validator';

export class ValidationResultDto {
  @IsBoolean()
  isValid: boolean;

  @IsArray()
  errors: string[];

  @IsArray()
  warnings: string[];

  @IsNumber()
  validRows: number;

  @IsNumber()
  invalidRows: number;
}
