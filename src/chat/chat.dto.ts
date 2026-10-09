import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { MAX_BODY_LENGTH } from './chat.types';

export class OpenConversationDto {
  @IsUUID()
  userId!: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BODY_LENGTH)
  body!: string;

  /** UUID généré côté client : rend l'envoi idempotent (renvoi réseau sans doublon). */
  @IsOptional()
  @IsUUID()
  clientId?: string;
}