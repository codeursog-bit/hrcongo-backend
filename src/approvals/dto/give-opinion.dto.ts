import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { APPROVAL_FUNCTION_CODES, OPINION_VALUES } from '../approvals.constants';

export class GiveOpinionDto {
  // Casquette avec laquelle la personne donne son avis (elle peut en avoir plusieurs).
  @IsString()
  @IsIn(APPROVAL_FUNCTION_CODES, { message: 'Fonction inconnue' })
  functionCode: string;

  @IsString()
  @IsIn(OPINION_VALUES as unknown as string[], { message: 'Avis invalide' })
  opinion: string;

  // Commentaire recommandé mais OPTIONNEL (même pour un avis défavorable).
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
