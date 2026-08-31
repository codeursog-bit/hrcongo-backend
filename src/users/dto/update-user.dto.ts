import { IsOptional, IsString, IsBoolean, IsEnum } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // 🆕 Permission "secrétaire" : pointage manuel pour tout le monde
  @IsOptional()
  @IsBoolean()
  canRecordAttendanceForAll?: boolean;
}
