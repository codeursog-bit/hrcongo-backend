import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsString } from 'class-validator';
import { APPROVAL_FUNCTION_CODES, MAX_CIRCUIT_STEPS } from '../approvals.constants';

export class SaveCircuitDto {
  @IsBoolean()
  isActive: boolean;

  // Codes de fonctions DANS L'ORDRE (ex. ['ACCOUNTANT', 'HR', 'DG']).
  @IsArray()
  @ArrayMaxSize(MAX_CIRCUIT_STEPS)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(APPROVAL_FUNCTION_CODES, { each: true, message: 'Fonction inconnue' })
  steps: string[];
}
