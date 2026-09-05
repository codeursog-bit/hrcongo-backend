// src/bulletin-template/bulletin-template.dto.ts
import { IsOptional, IsString, IsArray, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// DTO pour chaque bloc — déclare tous les champs pour que whitelist les garde
export class BlockConfigDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() display?: string;
  @IsOptional() visible?: boolean;
  @IsOptional() @IsString() scope?: string;
  @IsOptional() order?: number;
}

// DTO pour le style
export class StyleConfigDto {
  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() secondaryColor?: string;
  @IsOptional() @IsString() textColor?: string;
  @IsOptional() @IsString() fontFamily?: string;
  @IsOptional() @IsString() fontSize?: string;
  @IsOptional() @IsString() density?: string;
  @IsOptional() @IsString() layout?: string;
  @IsOptional() borderRadius?: number;
  @IsOptional() @IsString() headerStyle?: string;
  @IsOptional() showLogo?: boolean;
  @IsOptional() @IsString() logoPosition?: string;
  @IsOptional() showAddress?: boolean;
  @IsOptional() showFiscalNumbers?: boolean;
  @IsOptional() showPageNumber?: boolean;
  @IsOptional() showGeneratedDate?: boolean;
  @IsOptional() showHrSignature?: boolean;
  @IsOptional() @IsString() footerMessage?: string;
}

export class UpsertBulletinTemplateDto {
  @IsOptional() @IsString() mode?: string;
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StyleConfigDto)
  style?: StyleConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlockConfigDto)
  blocks?: BlockConfigDto[];

  @IsOptional() canvasLayout?: Record<string, any>;

  // 🆕 Choix du modèle de FACTURE pour les contrats prestataire/consultant/
  // intérim/stagiaire (cf. FACTURE_CONTRACT_TYPES côté front). Stocké dans
  // le même config Json que le bulletin — aucune colonne/table ajoutée.
  @IsOptional() @IsIn(['forfait', 'detaillee']) factureTemplateId?: string;
}