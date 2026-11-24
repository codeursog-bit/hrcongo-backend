import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PersonalTaskDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  /** Échéance (jour, YYYY-MM-DD) : permet de planifier une tâche « À venir ». Absente = aujourd hui. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
}
export class AssignTaskDto extends PersonalTaskDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assigneeIds!: string[];
  @IsOptional() @IsUUID() departmentId?: string;
}
export class TaskStatusDto {
  @IsIn(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']) status!: string;
  @IsOptional() @IsString() @MaxLength(2000) blockedReason?: string;
}
export class TaskCommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
}
export class AnnouncementDto extends PersonalTaskDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}
export class EventCommentDto {
  @IsString() @MinLength(1) @MaxLength(1000) text!: string;
}
export const REACTIONS = ['🎉', '👏', '❤️', '🎂', '👍'];
export class ReactionDto {
  @IsIn(REACTIONS) emoji!: string;
}
export class ColorsDto {
  @IsString() @Matches(/^#[0-9a-f]{6}$/i) accent!: string;
  @IsIn(['neutral', 'warm', 'cream', 'stone']) ambianceLight!: string;
  @IsIn(['anthracite', 'graphite', 'warm']) ambianceDark!: string;
}
export class UserAppearanceDto {
  @IsIn(['light', 'dark', 'auto']) mode!: string;
  @ValidateIf((_o, v) => v !== null)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ColorsDto)
  colors!: ColorsDto | null;
}
export class CompanyAppearanceDto {
  @ValidateIf((_o, v) => v !== null)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ColorsDto)
  colors!: ColorsDto | null;
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  allowEmployeeCustomization!: boolean;
}