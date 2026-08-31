import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePfaDto {
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  trainingBudget: number;
}
