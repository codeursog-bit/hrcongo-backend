// 📁 EMPLACEMENT (projet backend) : src/device-sync/dto/device-sync.dto.ts
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export enum ConnectorKindDto {
  ZKTECO_NETWORK = 'ZKTECO_NETWORK',
  FILE_IMPORT = 'FILE_IMPORT',
  HTTP_API = 'HTTP_API',
  CUSTOM = 'CUSTOM',
}

// ── Admin ────────────────────────────────────────────────────────────────
export class CreateConnectorDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsEnum(ConnectorKindDto)
  kind: ConnectorKindDto;

  // Paramètres non secrets pour l'agent (ip, port, colonnes…)
  @IsOptional() @IsObject()
  config?: Record<string, any>;
}

export class UpdateConnectorDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptional() @IsBoolean()
  autoSyncEnabled?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsObject()
  config?: Record<string, any>;
}

export class StartSyncDto {
  @IsOptional() @Matches(DATE_RE, { message: 'rangeFrom doit être au format YYYY-MM-DD' })
  rangeFrom?: string;

  @IsOptional() @Matches(DATE_RE, { message: 'rangeTo doit être au format YYYY-MM-DD' })
  rangeTo?: string;
}

export class MappingItemDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  deviceUserId: string;

  @IsOptional() @IsUUID()
  employeeId?: string | null;
}

export class SaveMappingsDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => MappingItemDto)
  mappings: MappingItemDto[];
}

export class ResolveIncompleteDto {
  @IsUUID() employeeId: string;
  @Matches(DATE_RE) date: string;

  // Heure manquante saisie par l'admin (une des trois options)
  @IsOptional() @Matches(TIME_RE, { message: 'Heure attendue au format HH:mm' })
  checkOutTime?: string;

  @IsOptional() @Matches(TIME_RE, { message: 'Heure attendue au format HH:mm' })
  checkInTime?: string;

  // Écarter ces pointages (badgeage par erreur)
  @IsOptional() @IsBoolean()
  ignore?: boolean;
}

export class ResolveConflictDto {
  @IsUUID() employeeId: string;
  @Matches(DATE_RE) date: string;

  // APPLY = remplacer la présence existante par les heures de la pointeuse
  // KEEP  = garder la présence existante, écarter les pointages
  @IsEnum(['APPLY', 'KEEP'])
  action: 'APPLY' | 'KEEP';
}

// ── Agent ────────────────────────────────────────────────────────────────
export class AgentPunchDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  deviceUserId: string;

  // ISO 8601 AVEC fuseau (ex. 2026-11-09T07:55:00+01:00)
  @IsDateString()
  punchedAt: string;

  @IsOptional() @IsInt()
  state?: number;

  @IsOptional() @IsObject()
  raw?: Record<string, any>;
}

export class AgentUserDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  deviceUserId: string;

  @IsOptional() @IsString() @MaxLength(150)
  name?: string;
}

export class AgentBatchDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => AgentPunchDto)
  punches: AgentPunchDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(3000) @ValidateNested({ each: true }) @Type(() => AgentUserDto)
  users?: AgentUserDto[];

  // true sur le DERNIER lot : déclenche le traitement côté Konza
  @IsOptional() @IsBoolean()
  done?: boolean;
}

export class AgentFailDto {
  @IsString() @MaxLength(500)
  error: string;
}