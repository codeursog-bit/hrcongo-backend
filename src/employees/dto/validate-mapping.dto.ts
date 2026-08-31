// ============================================================================
// 📁 src/employees/dto/validate-mapping.dto.ts
// ============================================================================

import { IsNotEmpty, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class ValidateMappingDto {
  @IsObject()
  @IsNotEmpty()
  @Type(() => Object)
  mappings: Record<string, string>; // { excelColumn: dbField }
}
