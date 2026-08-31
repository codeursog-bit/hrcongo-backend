// ============================================================================
// 📁 src/permission-tickets/dto/create-permission-ticket.dto.ts
// ============================================================================

import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

export enum PermissionType {
  URGENCE = 'URGENCE', // urgence personnelle / médicale / familiale
  MISSION = 'MISSION', // mission d'entreprise à l'extérieur
  AUTRE = 'AUTRE',
}

export enum MissionType {
  PROSPECTION_CLIENT = 'PROSPECTION_CLIENT',
  RECOUVREMENT = 'RECOUVREMENT',
  SAV = 'SAV',
  REPARATION_EXTERNE = 'REPARATION_EXTERNE',
  AUTRE = 'AUTRE',
}

export class CreatePermissionTicketDto {
  /** Renseigné uniquement quand un RH/Admin/Manager crée le ticket pour un autre employé */
  @IsUUID()
  @IsOptional()
  employeeId?: string;

  @IsEnum(PermissionType)
  @IsNotEmpty()
  type: PermissionType;

  @IsEnum(MissionType)
  @IsOptional()
  missionType?: MissionType;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  destination?: string;

  @IsDateString()
  @IsNotEmpty()
  departureTime: string;

  @IsDateString()
  @IsNotEmpty()
  expectedReturnTime: string;
}
