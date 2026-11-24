// create-payroll.dto.ts
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsUUID,
  IsOptional,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePayrollDto {
  @ApiProperty({ example: 'uuid-employee-123' })
  @IsUUID()
  @IsNotEmpty()
  employeeId!: string; // ✅ Ajout du ! pour supprimer l'erreur TS

  @ApiProperty({ example: 'Mars' })
  @IsString()
  @IsNotEmpty()
  month!: string; // ✅ Idem ici

  @ApiProperty({ example: 2026 })
  @IsNumber()
  @IsNotEmpty()
  year!: number; // ✅ Idem ici

  @ApiPropertyOptional({ example: 26 })
  @IsNumber()
  @IsOptional()
  workedDays?: number;

  // ✅ 4 catégories Décret 78-360 (Spécifique Congo-Brazza)
  @ApiPropertyOptional({ description: 'Heures sup à 10%' })
  @IsNumber()
  @IsOptional()
  overtime10?: number;

  @ApiPropertyOptional({ description: 'Heures sup à 25%' })
  @IsNumber()
  @IsOptional()
  overtime25?: number;

  @ApiPropertyOptional({ description: 'Heures sup à 50%' })
  @IsNumber()
  @IsOptional()
  overtime50?: number;

  @ApiPropertyOptional({ description: 'Heures sup à 100%' })
  @IsNumber()
  @IsOptional()
  overtime100?: number;

  // Legacy (conservé pour compatibilité)
  @IsNumber()
  @IsOptional()
  overtime15?: number;

  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  bonuses?: any[];

  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  deductions?: any[];

  // ✅ FIX BUG 6: utilisé par CABINET_ADMIN
  @ApiPropertyOptional()
  @IsOptional()
  companyId?: string;
}
