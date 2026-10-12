import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { CHECKPOINTS } from '../rules/checkpoints';

export class CompanyScopeDto {
  /** Contexte cabinet / PME : entreprise ciblée (toujours revérifiée côté serveur). */
  @IsOptional() @IsUUID() companyId?: string;
}

export class RunAuditDto extends CompanyScopeDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year!: number;
}

export class PeriodQueryDto extends CompanyScopeDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year?: number;
}

export class TrendQueryDto extends CompanyScopeDto {
  /** Fenêtre de la courbe, en mois (3 à 24). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(24) months: number = 12;
}

export class QueryFindingsDto extends PeriodQueryDto {
  @IsOptional() @IsIn(['OPEN', 'JUSTIFIED', 'WAIVED', 'RESOLVED']) status?: 'OPEN' | 'JUSTIFIED' | 'WAIVED' | 'RESOLVED';
  @IsOptional() @IsIn(['INFO', 'WARN', 'CRITICAL']) severity?: 'INFO' | 'WARN' | 'CRITICAL';
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() blocking?: boolean;
  @IsOptional() @IsString() @MaxLength(60) @Matches(/^[A-Z_]+$/) ruleCode?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 25;
}

export class FindingNoteDto {
  /** Motif écrit : conservé dans l'écart ET dans le journal d'audit. */
  @IsString() @MinLength(10) @MaxLength(500) note!: string;
}

export class AttestCheckpointDto extends CompanyScopeDto {
  @IsIn(CHECKPOINTS.map((c) => c.code)) code!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year!: number;
  @IsIn(['DONE', 'NOT_APPLICABLE']) status!: 'DONE' | 'NOT_APPLICABLE';
  /** Preuve : n° de reçu, accusé e-Tax… (obligatoire si DONE). */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) evidenceRef?: string;
  /** Obligatoire si NOT_APPLICABLE. */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(500) note?: string;
}