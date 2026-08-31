import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty({ message: 'Le nom du département est requis' })
  name: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;
}
