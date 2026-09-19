import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CheckinCredentialType } from '@prisma/client';

export class RegisterCredentialDto {
  @IsUUID()
  employeeId: string;

  @IsEnum(CheckinCredentialType)
  type: CheckinCredentialType;

  // Obligatoire pour NFC_BADGE (numéro de série lu depuis la tablette).
  // Ignoré pour QR_CODE : l'identifiant est généré côté serveur.
  @IsOptional()
  @IsString()
  identifier?: string;
}