import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReviewAction {
  APPROVED = 'APPROVED',
  CANCELLED = 'CANCELLED',
}

export class ReviewRequestDto {
  @IsEnum(ReviewAction)
  status: ReviewAction;

  @IsOptional()
  @IsString()
  reviewNote?: string;
}
