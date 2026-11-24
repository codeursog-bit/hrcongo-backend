// ============================================================================
// 📁 src/blog/dto/blog.dto.ts — COMPLET avec champs SEO
// ============================================================================
import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  MinLength,
  MaxLength,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';

export enum BlogCategory {
  GENERAL = 'GENERAL',
  PAIE = 'PAIE',
  DROIT_TRAVAIL = 'DROIT_TRAVAIL',
  RECRUTEMENT = 'RECRUTEMENT',
  FORMATION = 'FORMATION',
  ANNONCE = 'ANNONCE',
  TEMOIGNAGE = 'TEMOIGNAGE',
}

export class CreatePostDto {
  @IsString()
  @MinLength(5, { message: 'Le titre doit faire au moins 5 caractères' })
  @MaxLength(255, { message: 'Le titre ne peut pas dépasser 255 caractères' })
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsString()
  @MinLength(20, { message: 'Le contenu doit faire au moins 20 caractères' })
  content: string;

  @IsOptional()
  @IsEnum(BlogCategory)
  category?: BlogCategory;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  // ── Champs SEO ──────────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'Titre SEO max 60 caractères' })
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160, { message: 'Meta description max 160 caractères' })
  seoDesc?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @ArrayMaxSize(10)
  keywords?: string[];
}

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MinLength(20)
  content?: string;

  @IsOptional()
  @IsEnum(BlogCategory)
  category?: BlogCategory;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  // ── Champs SEO ──────────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(60)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  seoDesc?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @ArrayMaxSize(10)
  keywords?: string[];
}

export class BlogQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(BlogCategory)
  category?: BlogCategory;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  page?: string;

  @IsOptional()
  limit?: string;
}
