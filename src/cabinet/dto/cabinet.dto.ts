import {
  IsString,
  IsEmail,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsEnum,
  MinLength,
  Matches,
  IsInt,
  Min,
  IsIn,
} from 'class-validator';
import { CabinetRole } from '@prisma/client';

export class CreateCabinetDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(3)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Sous-domaine : lettres minuscules, chiffres et tirets uniquement',
  })
  subdomain: string;
}

export class UpdateCabinetDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
}

export class AddCabinetUserDto {
  @IsEmail()
  email: string;

  @IsEnum(CabinetRole)
  role: CabinetRole;
}

export class AddCompanyToCabinetDto {
  @IsUUID()
  companyId: string;

  @IsOptional()
  @IsString()
  startDate?: string;
}

export class UpdatePortalAccessDto {
  @IsOptional() @IsBoolean() pmePortalEnabled?: boolean;
  @IsOptional() @IsBoolean() employeeAccessEnabled?: boolean;
}

export class PurchasePackDto {
  @IsIn(['PACK_50', 'PACK_100', 'PACK_200'])
  pack: 'PACK_50' | 'PACK_100' | 'PACK_200';

  @IsString()
  reference: string;
}

export class ActivateForfaitDto {
  @IsString()
  reference: string;
}

export class InitBatchClosureDto {
  @IsInt() @Min(1) month: number;
  @IsInt() @Min(2020) year: number;

  @IsOptional()
  @IsUUID('all', { each: true })
  companyIds?: string[];
}
