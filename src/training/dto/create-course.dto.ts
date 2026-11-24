// src/training/dto/create-course.dto.ts
import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsDateString,
  IsUrl,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum TrainingFormat {
  ONLINE = 'ONLINE',
  IN_PERSON = 'IN_PERSON',
  HYBRID = 'HYBRID',
}
export enum ProviderType {
  INTERNAL = 'INTERNAL',
  EXTERNAL_VENDOR = 'EXTERNAL_VENDOR',
  ONLINE_PLATFORM = 'ONLINE_PLATFORM',
}

export class CreateCourseDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  durationHours?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  cost?: number;

  @IsEnum(TrainingFormat)
  format: TrainingFormat;

  @IsEnum(ProviderType)
  providerType: ProviderType;

  @IsOptional()
  @IsString()
  providerName?: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsDateString()
  dateSchedule?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
}
