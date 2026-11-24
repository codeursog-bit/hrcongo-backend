import { IsOptional, IsString, IsBoolean, IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // 🆕 Permission "secrétaire" : pointage manuel pour tout le monde
  @IsOptional()
  @IsBoolean()
  canRecordAttendanceForAll?: boolean;
}