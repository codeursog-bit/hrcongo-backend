// ============================================================================
// 📁 src/admin/server-monitor/dto/purge.dto.ts
// ============================================================================
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PURGE_KEYS } from '../purge-registry';

export class PurgeItemDto {
  /** Doit exister dans la liste blanche (purge-registry.ts) */
  @IsString()
  @IsIn(PURGE_KEYS)
  key: string;

  /** Supprimer ce qui est plus vieux que N jours (le serveur impose aussi un minimum par règle) */
  @IsInt()
  @Min(1)
  @Max(3650)
  days: number;

  /** Nombre affiché à l'aperçu : si le volume a beaucoup changé depuis, la purge est refusée */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedCount?: number;
}

export class PurgePreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PurgeItemDto)
  items: PurgeItemDto[];
}

export class PurgeExecuteDto extends PurgePreviewDto {
  /** Doit être explicitement true */
  @IsBoolean()
  confirm: boolean;

  /** Requis (valeur « SUPPRIMER ») si une règle de risque CAUTION est incluse */
  @IsOptional()
  @IsString()
  confirmText?: string;
}