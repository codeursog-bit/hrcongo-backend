import { IsDefined, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
export class UpdateCompanyEntitlementDto {
  @IsDefined() value:boolean|number;
  @IsOptional() @IsISO8601() expiresAt?:string|null;
  @IsOptional() @IsString() @MaxLength(500) note?:string;
}
