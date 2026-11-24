// ============================================================================
// src/admin/accounts/accounts.dto.ts
// ============================================================================
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const ACCOUNT_STATES = [
  'active', 'disabled', 'locked', 'never_logged', 'inactive_90', 'no_2fa', 'multi', 'must_change',
] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export const ACCOUNT_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'MANAGER', 'EMPLOYEE', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE',
] as const;

export class ListAccountsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(ACCOUNT_ROLES) role?: (typeof ACCOUNT_ROLES)[number];
  @IsOptional() @IsEnum(ACCOUNT_STATES) state?: AccountState;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100) pageSize?: number;
}