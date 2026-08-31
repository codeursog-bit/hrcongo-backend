// ============================================================================
// 📁 src/employees/dto/execute-import.dto.ts
// ============================================================================

import { IsNotEmpty, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class ExecuteImportDto {
  @IsObject()
  @IsNotEmpty()
  @Type(() => Object)
  mappings: Record<string, string>;
}
