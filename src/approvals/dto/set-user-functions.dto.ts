import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  ValidateNested,
} from 'class-validator';
import { APPROVAL_FUNCTION_CODES } from '../approvals.constants';

export class UserFunctionItemDto {
  @IsString()
  @IsIn(APPROVAL_FUNCTION_CODES, { message: 'Fonction inconnue' })
  code: string;

  // Droit de signer : séparé du droit de donner un avis.
  @IsBoolean()
  canSign: boolean;
}

export class SetUserFunctionsDto {
  // Liste COMPLÈTE des fonctions de l'utilisateur (remplace l'existant).
  // Tableau vide = on retire toutes les fonctions.
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => UserFunctionItemDto)
  functions: UserFunctionItemDto[];
}
