import { IsNotEmpty, IsUUID } from 'class-validator';
import { CreateEmployeeDto } from '../../../employees/dto/create-employee.dto';

export class CreatePortfolioEmployeeDto extends CreateEmployeeDto {
  @IsNotEmpty({ message: "L'entreprise cible est requise" })
  @IsUUID('4', { message: 'Identifiant entreprise invalide' })
  companyId: string;
}