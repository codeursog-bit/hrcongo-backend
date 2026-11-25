import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
export class IncidentBreadcrumbDto {
  @IsIn(['NAV', 'API']) type: 'NAV' | 'API';
  @IsString() @MaxLength(500) path: string;
  @IsOptional()
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
  method?: string;
  @IsOptional() @IsInt() @Min(0) @Max(599) status?: number;
}
export class ClientErrorDto {
  @IsString() @MaxLength(2000) message: string;
  @IsOptional() @IsString() @MaxLength(6000) stack?: string;
  @IsString() @MaxLength(500) path: string;
  @IsIn(['JS_ERROR', 'REJECTION', 'REACT_ERROR', 'API_ERROR', 'CHUNK_LOAD'])
  code: string;
  @IsOptional() @IsString() @MaxLength(100) version?: string;
  @IsOptional() @IsString() @MaxLength(300) browser?: string;
  @IsOptional() @IsString() @MaxLength(80) screen?: string;
  @IsOptional() @IsBoolean() online?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => IncidentBreadcrumbDto)
  breadcrumbs?: IncidentBreadcrumbDto[];
}
