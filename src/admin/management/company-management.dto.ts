// ============================================================================
// src/admin/management/company-management.dto.ts
// ============================================================================
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TrendsQueryDto {
  /** Nombre de mois affichés (dernier mois = mois en cours) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(24) months?: number;
}

export class ConsistencyQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year?: number;
}

export const REPORT_PERIODS = ['month', 'quarter', 'year'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export class ReportQueryDto {
  @IsEnum(REPORT_PERIODS) period: ReportPeriod;
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year: number;
  /** month: 1-12 · quarter: 1-4 · year: ignoré */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) index?: number;
}