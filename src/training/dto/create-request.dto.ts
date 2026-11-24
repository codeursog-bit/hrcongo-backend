import { IsString, IsOptional } from 'class-validator';

export class CreateTrainingRequestDto {
  @IsString()
  courseId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
