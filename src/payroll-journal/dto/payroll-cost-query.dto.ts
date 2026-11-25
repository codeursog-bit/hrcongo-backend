import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ContractType } from '@prisma/client';

export class PayrollCostQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year: number;
  @IsOptional() @IsUUID() companyId?: string;
}
export class PayrollCostEmployeesQueryDto extends PayrollCostQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsEnum(ContractType) contractType?: ContractType;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsIn(['grossSalary', 'netSalary', 'totalDeductions', 'totalEmployerCost']) sort = 'totalEmployerCost';
  @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'desc';
}
