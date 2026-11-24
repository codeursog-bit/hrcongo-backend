// ============================================================================
// 📁 src/contract-rupture/dto/pse.dto.ts
// ============================================================================
import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePSEDto {
  @IsString()
  motif!: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  nbPostesSupprimes!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  salariesIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateEtapePSEDto {
  @IsBoolean()
  done!: boolean;

  @IsOptional()
  @IsString()
  date?: string;
}
