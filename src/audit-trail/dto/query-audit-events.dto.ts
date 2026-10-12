import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class QueryAuditEventsDto {
  /** Cabinet / multi-entreprises / super admin : entreprise ciblée (vérifiée côté serveur). */
  @IsOptional() @IsUUID() companyId?: string;

  @IsOptional() @IsString() @MaxLength(50) @Matches(/^[A-Z_]+$/) entity?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[A-Z0-9_]+$/) action?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsIn(['INFO', 'WARN', 'CRITICAL']) severity?: 'INFO' | 'WARN' | 'CRITICAL';
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 50;
}

export class AuditHistoryQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
}

export class AuditStatsQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  /** Fenêtre en jours (7 à 365). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(365) days: number = 30;
}