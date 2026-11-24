// ============================================================================
// 📁 src/contract-templates/contract-templates.dto.ts
// ============================================================================
import { IsString, IsOptional, IsObject, IsUUID, MaxLength, MinLength, IsIn } from 'class-validator';

export const TEMPLATE_CATEGORIES = ['CDI', 'CDD', 'ESSAI', 'STAGE', 'PRESTATION', 'AUTRE'] as const;

export class CreateTemplateDto {
  @IsString() @MinLength(2) @MaxLength(150)
  name: string;

  @IsOptional() @IsIn(TEMPLATE_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsObject()
  content: Record<string, any>; // document JSON (nettoyé côté serveur)

  @IsOptional() @IsObject()
  settings?: Record<string, any>;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150)
  name?: string;

  @IsOptional() @IsIn(TEMPLATE_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @IsObject()
  content?: Record<string, any>;

  @IsOptional() @IsObject()
  settings?: Record<string, any>;
}

export class ResolveDto {
  @IsUUID()
  templateId: string;

  @IsUUID()
  employeeId: string;

  // valeurs saisies/corrigées par l'utilisateur : { cle_variable: 'valeur' }
  @IsOptional() @IsObject()
  overrides?: Record<string, string>;
}

export class GenerateCustomContractDto extends ResolveDto {
  @IsOptional() @IsString() @MaxLength(200)
  name?: string;
}

export class CustomVariableDto {
  @IsString() @MinLength(2) @MaxLength(60)
  key: string;

  @IsString() @MinLength(1) @MaxLength(120)
  label: string;

  @IsString() @MaxLength(2000)
  value: string;
}

export class SaveDefaultDto {
  @IsString() @MinLength(2) @MaxLength(60)
  key: string;

  // vide = on retire la valeur enregistrée
  @IsString() @MaxLength(2000)
  value: string;
}