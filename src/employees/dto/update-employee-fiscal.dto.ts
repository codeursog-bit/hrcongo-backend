// ============================================================================
// 📁 src/employees/dto/update-employee-fiscal.dto.ts
// ============================================================================

import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmployeeFiscalDto {
  @IsOptional()
  @IsBoolean()
  isSubjectToIrpp?: boolean;

  @IsOptional()
  @IsBoolean()
  isSubjectToCnss?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  taxExemptionReason?: string;
}
