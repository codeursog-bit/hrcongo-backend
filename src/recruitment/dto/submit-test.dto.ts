import { IsInt, IsObject, IsOptional, Min, Max } from 'class-validator';

export class SubmitTestDto {
  @IsObject()
  answers: Record<string, string>;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  tabSwitchCount?: number;

  @IsOptional() @IsInt() @Min(0) @Max(86400)
  testDuration?: number;
}
