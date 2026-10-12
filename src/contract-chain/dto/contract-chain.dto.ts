import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CDD_MOTIF_CODES } from '../contract-chain.rules';

export class RenewContractDto {
  /** Défaut : lendemain de la fin du contrat actuel. */
  @IsOptional() @IsDateString() startDate?: string;
  @IsDateString() endDate!: string;

  @IsOptional() @IsIn(CDD_MOTIF_CODES) cddMotif?: string;

  /** Raison du renouvellement (conservée dans l'historique). */
  @IsString() @MinLength(5) @MaxLength(255) reason!: string;

  /** Date de signature de l'avenant (doit précéder la fin du contrat actuel). */
  @IsOptional() @IsDateString() signedAt?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) baseSalary?: number;
  @IsOptional() @IsString() @MaxLength(100) position?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /** ADMIN uniquement : régularisation d'un blocage de procédure (terme dépassé…). */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(500) overrideReason?: string;
}

export class ConvertToCdiDto {
  @IsOptional() @IsDateString() startDate?: string;
  @IsString() @MinLength(5) @MaxLength(255) reason!: string;
  @IsOptional() @IsDateString() signedAt?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) baseSalary?: number;
  @IsOptional() @IsString() @MaxLength(100) position?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}