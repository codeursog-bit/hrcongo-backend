// ============================================================================
// 📁 src/permission-tickets/dto/permission-return.dto.ts
// ✅ DTO du circuit « retour de permission » : confirmation, refus et
//    correction des heures (réservés Admin / RH manager)
// ============================================================================

import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Confirmation du retour déclaré par l'employé */
export class ConfirmReturnDto {
  /** Heure de retour retenue — par défaut : l'heure déclarée par l'employé */
  @IsDateString()
  @IsOptional()
  actualReturnTime?: string;

  /** Heure de sortie effective — par défaut : sortie autorisée (ou déjà corrigée) */
  @IsDateString()
  @IsOptional()
  actualDepartureTime?: string;

  /** Obligatoire dès qu'une heure diffère de ce que l'employé a déclaré */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

/** Retour non validé (déclaré par erreur, faux, etc.) */
export class RejectReturnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** Correction des heures effectives par l'administration */
export class UpdateTimesDto {
  @IsDateString()
  @IsOptional()
  actualDepartureTime?: string;

  @IsDateString()
  @IsOptional()
  actualReturnTime?: string;

  /** Toujours obligatoire : une correction doit pouvoir s'expliquer */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
