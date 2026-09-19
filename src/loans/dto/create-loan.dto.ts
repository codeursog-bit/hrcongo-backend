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

export enum LoanNature {
  SOCIAL = 'SOCIAL',
  SCOLARITE = 'SCOLARITE',
  LOGEMENT = 'LOGEMENT',
  EXCEPTIONNEL = 'EXCEPTIONNEL',
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

  /** "Nature du prêt" du modèle papier (Social/Scolarité/...) — affichée
   *  seulement par les entreprises au modèle de document STANDARD. */
  @IsEnum(LoanNature)
  @IsOptional()
  nature?: LoanNature;

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