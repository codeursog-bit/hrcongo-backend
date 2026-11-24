import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SupportPageDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(100000)
  offset?: number;
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status?: string;
}
export class SupportMessagesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  after?: number;
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  before?: number;
}
export class SupportCreateDto {
  @IsUUID('4') clientId: string;
  @IsString() @MinLength(3) @MaxLength(150) subject: string;
  @IsIn(['QUESTION', 'INCIDENT', 'COMPLAINT', 'SUGGESTION', 'FEEDBACK']) category: string;
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
}
export class SupportSendDto {
  @IsUUID('4') clientId: string;
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  internal?: boolean;
}
export class SupportUpdateDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED'])
  status?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['NORMAL', 'HIGH'])
  priority?: string;
  @IsOptional() @IsUUID('4') assigneeId?: string | null;
}
export class SupportGuestDto {
  @IsUUID('4') id: string;
  @IsString() @MinLength(64) @MaxLength(64) token: string;
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  after?: number;
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  before?: number;
}
export class SupportGuestSendDto extends SupportGuestDto {
  @IsUUID('4') clientId: string;
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
}
export class SupportAgentCreateDto {
  @IsEmail() @MaxLength(255) email: string;
  @IsString() @MinLength(1) @MaxLength(100) firstName: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName: string;
  @IsString() @MinLength(12) @MaxLength(128) password: string;
}
export class SupportAgentUpdateDto {
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() isActive: boolean;
}
