// ============================================================================
// 📁 src/loans/dto/create-advance.dto.ts
// ============================================================================

import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsInt,
} from 'class-validator';

export class CreateAdvanceDto {
  /** Renseigné uniquement quand un RH/Admin crée l'avance pour un employé (sinon résolu depuis l'utilisateur connecté) */
  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  amount: number;

  @IsNotEmpty()
  @IsInt()
  deductMonth: number; // Mois de déduction (1-12)

  @IsNotEmpty()
  @IsInt()
  deductYear: number;

  /** Période de la demande (mois/année) — optionnelle, défaut = mois courant.
   *  Sert de date de référence de l'avance dans le profil/suivi de l'employé. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  year?: number;

  @IsString()
  reason: string;

  /** Pris en compte uniquement si un ADMIN/SUPER_ADMIN/HR_MANAGER crée directement pour un employé (auto-approuvé) — sinon défini à la décision. */
  @IsBoolean()
  @IsOptional()
  recoverViaPayroll?: boolean;
}