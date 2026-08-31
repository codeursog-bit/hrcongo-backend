// src/recruitment/dto/create-job.dto.ts
import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateJobDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  requirements?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsString()
  departmentId: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsString()
  contractType: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  processingMode?: string;

  // ✅ Transformation pour aiConfig (JSON string → objet)
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  })
  aiConfig?: any;

  // ✅ Transformation pour requiredSkills (JSON string → array)
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return Array.isArray(value) ? value : [];
  })
  @IsArray()
  requiredSkills?: string[];

  // ✅ Transformation pour minExperience (string → number)
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return parseInt(value, 10);
    return value;
  })
  @IsNumber()
  minExperience?: number;

  @IsOptional()
  @IsString()
  educationLevel?: string;

  // ✅ Transformation pour salaryMin (string → number)
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return parseFloat(value);
    return value;
  })
  @IsNumber()
  salaryMin?: number;

  // ✅ Transformation pour salaryMax (string → number)
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return parseFloat(value);
    return value;
  })
  @IsNumber()
  salaryMax?: number;

  @IsOptional()
  @IsString()
  salaryCurrency?: string;

  // ✅ Transformation pour showOnPortal (string → boolean)
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value === 'true';
    return value;
  })
  @IsBoolean()
  showOnPortal?: boolean;

  // ✅ Transformation pour isPremium (string → boolean)
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value === 'true';
    return value;
  })
  @IsBoolean()
  isPremium?: boolean;

  // ✅ CHANGEMENT ICI : Date → string (sera converti par le service)
  @IsOptional()
  @IsDateString()
  startDate?: string;

  // ✅ CHANGEMENT ICI : Date → string (sera converti par le service)
  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  // ✅ Document supplémentaire requis du candidat
  @IsOptional()
  @IsString()
  additionalDocumentType?: string;

  @IsOptional()
  @IsString()
  additionalDocumentLabel?: string;
}
