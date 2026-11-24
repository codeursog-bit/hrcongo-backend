import { IsNotEmpty, IsUUID } from 'class-validator';

export class SwitchCompanyDto {
  @IsNotEmpty({ message: "L'entreprise cible est requise" })
  @IsUUID('4', { message: 'Identifiant entreprise invalide' })
  companyId: string;
}