// ============================================================================
// 📁 src/loans/dto/create-loan.dto.ts
// ============================================================================

import {
  IsString,
  IsNumber,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  Min,
} from 'class-validator';

export enum LoanType {
  ARGENT = 'ARGENT',
  MARCHANDISE = 'MARCHANDISE',
  AUTRE = 'AUTRE',
}

export class CreateLoanDto {
  /** Renseigné uniquement quand un RH/Admin crée le prêt pour un employé (sinon résolu depuis l'utilisateur connecté) */
  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsEnum(LoanType)
  @IsOptional()
  type?: LoanType;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  amount: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  monthlyRepayment: number;

  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @IsNotEmpty()
  @IsDateString()
  endDate: string;

  @IsString()
  reason: string;

  /** Utilisé seulement quand un ADMIN/SUPER_ADMIN crée le prêt directement finalisé (voir service) */
  @IsOptional()
  recoverViaPayroll?: boolean;
}
