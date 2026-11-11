// ============================================================================
// src/admin/actions/admin-actions.dto.ts
// DTO des actions de support du super admin (remplacent les requêtes SQL à la main)
// ============================================================================
import {
  IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const PAYROLL_STATUSES = ['DRAFT', 'VALIDATED', 'TO_PAY', 'PAID', 'CANCELLED'] as const;
export type PayrollStatusValue = (typeof PAYROLL_STATUSES)[number];

/** Motif obligatoire : chaque action est tracée dans le journal d'audit de l'entreprise. */
const REASON_MSG = 'Un motif de 5 à 300 caractères est obligatoire';

export class ListPayrollsQueryDto {
  @IsUUID() companyId: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year?: number;
  @IsOptional() @IsEnum(PAYROLL_STATUSES) status?: PayrollStatusValue;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class ChangePayrollStatusDto {
  @IsEnum(PAYROLL_STATUSES) status: PayrollStatusValue;

  @IsString({ message: REASON_MSG }) @MinLength(5, { message: REASON_MSG }) @MaxLength(300, { message: REASON_MSG })
  reason: string;
}

export class DeletePayrollDto {
  @IsString({ message: REASON_MSG }) @MinLength(5, { message: REASON_MSG }) @MaxLength(300, { message: REASON_MSG })
  reason: string;

  /** Requis pour supprimer un bulletin PAID ou TO_PAY (action critique). */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class SearchSupportUsersQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() companyId?: string;
}

export class UserSupportActionDto {
  @IsString({ message: REASON_MSG }) @MinLength(5, { message: REASON_MSG }) @MaxLength(300, { message: REASON_MSG })
  reason: string;
}

export class SetUserActiveDto extends UserSupportActionDto {
  @IsBoolean() isActive: boolean;
}

/** Rôles « entreprise » attribuables par le super admin (jamais SUPER_ADMIN ni rôles cabinet) */
export const ASSIGNABLE_ROLES = ['ADMIN', 'HR_MANAGER', 'MANAGER', 'EMPLOYEE'] as const;

export class ChangeUserEmailDto extends UserSupportActionDto {
  @IsEmail({}, { message: 'Adresse email invalide' }) @MaxLength(255) email: string;
}

export class ChangeUserRoleDto extends UserSupportActionDto {
  @IsIn(ASSIGNABLE_ROLES as unknown as string[]) role: (typeof ASSIGNABLE_ROLES)[number];
}

export class ActionsHistoryQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}