// ============================================================================
// 📁 src/display-screens/dto.ts — DTOs (ValidationPipe whitelist déjà actif)
// ============================================================================
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PollPairingDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  pollToken: string;
}

export class ApproveScreenDto {
  @IsString()
  @Length(4, 8)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsIn(['COMPANY', 'PORTFOLIO'])
  scope: 'COMPANY' | 'PORTFOLIO';
}

export class RenameScreenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class QrScanDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;

  /** true = « oui, je travaille » après un avertissement congé / férié / repos */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class SecretPunchDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  secret: string;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class SetSecretDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  secret: string;
}