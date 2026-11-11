// ============================================================================
// src/admin/payments/admin-payments.dto.ts
// ============================================================================
import { IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
export const PAYMENT_PROVIDERS = ['YABETOOPAY', 'CHARIOW', 'MOTEKI', 'MANUAL'] as const;

const REASON_MSG = 'Un motif de 5 à 300 caractères est obligatoire';

export class ListPaymentsQueryDto {
  @IsOptional() @IsEnum(PAYMENT_STATUSES) status?: (typeof PAYMENT_STATUSES)[number];
  @IsOptional() @IsEnum(PAYMENT_PROVIDERS) provider?: (typeof PAYMENT_PROVIDERS)[number];
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  /** Paiements restés PENDING/PROCESSING depuis plus d'une heure */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() stuck?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100) pageSize?: number;
}

export class PaymentActionDto {
  @IsString({ message: REASON_MSG }) @MinLength(5, { message: REASON_MSG }) @MaxLength(300, { message: REASON_MSG })
  reason: string;
}