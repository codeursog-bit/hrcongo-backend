// ============================================================================
// 📁 src/leaves/dto/create-leave.dto.ts
// ✅ Depuis la restructuration des types de congé : le module "Leave" ne
//    couvre plus que le congé annuel (normal ou anticipé). Maladie,
//    maternité, paternité, mariage, décès, etc. passent par le module
//    Absences (conventionnelle/exceptionnelle) — voir
//    src/absence-requests/dto/create-absence-request.dto.ts
// ✅ LeaveType garde ses anciennes valeurs (SICK/MATERNITY/PATERNITY/UNPAID/
//    COMPENSATORY) au niveau du schéma Prisma pour ne pas casser l'historique
//    déjà en base, mais elles ne sont plus acceptées à la création — seul
//    CreatableLeaveType (ANNUAL / ANNUAL_ANTICIPATED) est validé ici.
// ============================================================================

import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsEnum,
  IsUUID,
  IsOptional,
} from 'class-validator';

// ✅ Types encore acceptés à la création d'un congé
export enum CreatableLeaveType {
  ANNUAL = 'ANNUAL', // Congé annuel normal (fin de cycle)
  ANNUAL_ANTICIPATED = 'ANNUAL_ANTICIPATED', // Congé annuel anticipé (avant fin de cycle, plafonné au solde accumulé)
}

export class CreateLeaveDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(CreatableLeaveType)
  @IsNotEmpty()
  type: CreatableLeaveType;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  attachmentUrl?: string;
}
