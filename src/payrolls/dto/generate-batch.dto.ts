import { IsInt, IsOptional, IsArray, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateBatchDto {
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  month: number; // 1-12

  @IsInt()
  @Min(2020)
  @Max(2100)
  @Type(() => Number)
  year: number;

  @IsOptional()
  @IsArray()
  @Type(() => String)
  employeeIds?: string[]; // Liste des IDs à traiter (optionnel = tous)

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(31)
  @Type(() => Number)
  workDays?: number; // Jours ouvrés personnalisés (optionnel = défaut 26)
}

// import { IsInt, IsArray, IsOptional, Min, Max } from 'class-validator';

// export class GenerateBatchDto {
//   @IsInt()
//   @Min(1)
//   @Max(12)
//   month: number;

//   @IsInt()
//   @Min(2020)
//   year: number;

//   @IsArray()
//   @IsOptional()
//   employeeIds?: string[];

//   @IsInt()
//   @IsOptional()
//   @Min(1)
//   @Max(31)
//   workDays?: number;
// }
