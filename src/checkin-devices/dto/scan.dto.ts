import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScanCheckinDto {
  // Le numéro de série du badge NFC, ou le token encodé dans le QR code.
  @IsString()
  @IsNotEmpty()
  identifier: string;

  // Repris tels quels par checkIn() existant — mêmes confirmations
  // que sur le formulaire web (jour de repos / travail pendant congé).
  @IsOptional()
  @IsBoolean()
  confirmRestDay?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmWorkDuringLeave?: boolean;
}