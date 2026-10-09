import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Le nom du département ne peut pas être vide' })
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;
}