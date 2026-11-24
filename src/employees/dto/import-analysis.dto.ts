// ============================================================================
// 📁 src/employees/dto/import-analysis.dto.ts
// ============================================================================

import { IsNotEmpty, IsArray, IsNumber, IsString } from 'class-validator';

export class ColumnMappingDto {
  @IsString()
  @IsNotEmpty()
  excelColumn: string;

  @IsString()
  @IsNotEmpty()
  dbField: string;

  @IsNumber()
  confidence: number;

  isRequired: boolean;
}

export class ImportAnalysisDto {
  @IsNumber()
  totalRows: number;

  @IsArray()
  previewData: any[];

  @IsArray()
  @IsString({ each: true })
  detectedColumns: string[];

  @IsArray()
  suggestedMappings: ColumnMappingDto[];

  @IsArray()
  @IsString({ each: true })
  warnings: string[];
}
