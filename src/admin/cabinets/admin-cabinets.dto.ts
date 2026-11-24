// ============================================================================
// src/admin/cabinets/admin-cabinets.dto.ts
// ============================================================================
import {
  IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const REASON_MSG = 'Un motif de 5 à 300 caractères est obligatoire';

export const CABINET_STATES = ['active', 'inactive', 'no_balance', 'trial', 'forfait', 'no_wallet'] as const;

export class ListCabinetsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(CABINET_STATES) state?: (typeof CABINET_STATES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100) pageSize?: number;
}

export class CabinetActionDto {
  @IsString({ message: REASON_MSG }) @MinLength(5, { message: REASON_MSG }) @MaxLength(300, { message: REASON_MSG })
  reason: string;
}

export class AdjustBulletinsDto extends CabinetActionDto {
  /** > 0 = crédit offert / régularisation · < 0 = correction d'un crédit erroné */
  @Type(() => Number) @IsInt() @Min(-10000) @Max(10000) delta: number;
}

export class SetForfaitDto extends CabinetActionDto {
  @IsBoolean() active: boolean;
  /** Durée ajoutée à l'activation (ignorée à la désactivation) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) months?: number;
}

export class ExtendTrialDto extends CabinetActionDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(180) days: number;
}

export class SetCabinetActiveDto extends CabinetActionDto {
  @IsBoolean() isActive: boolean;
}

export class CompanyAccessDto extends CabinetActionDto {
  @IsOptional() @IsBoolean() pmePortalEnabled?: boolean;
  @IsOptional() @IsBoolean() employeeAccessEnabled?: boolean;
}