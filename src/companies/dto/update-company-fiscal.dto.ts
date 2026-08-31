// ============================================================================
// 📁 src/companies/dto/update-company-fiscal.dto.ts
// ============================================================================

import { IsBoolean, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCompanyFiscalDto {
  @IsOptional()
  @IsBoolean()
  appliesCnssEmployer?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  @Type(() => Number)
  cnssEmployerRate?: number;

  @IsOptional()
  @IsBoolean()
  defaultAppliesIrpp?: boolean;

  @IsOptional()
  @IsBoolean()
  defaultAppliesCnss?: boolean;
}
