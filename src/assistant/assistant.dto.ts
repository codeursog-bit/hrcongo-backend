import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsObject,
  IsDefined,
  ValidateNested,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { ANALYSIS_TOOLS, type AnalysisTool } from './analysis-tools';
export class AnalysisRequestDto {
  @IsIn(ANALYSIS_TOOLS) tool!: AnalysisTool;
  @IsInt() @Min(1) @Max(12) month!: number;
  @IsInt() @Min(2020) @Max(2100) year!: number;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsNumber() @Min(0.5) @Max(366) days?: number;
}
/** Choix d'un employé parmi des homonymes proposés par l'Assistant (validé côté serveur). */
export class ChoiceDto {
  @IsUUID() employeeId!: string;
}
export class ChatDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChoiceDto)
  choice?: ChoiceDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalysisRequestDto)
  analysis?: AnalysisRequestDto;
  @IsOptional() @IsUUID() conversationId?: string;
  @IsUUID() requestId!: string;
  @IsString() @MinLength(1) @MaxLength(800) message!: string;
}
export class FeedbackDto {
  @IsUUID() messageId!: string;
  @IsIn([-1, 1]) rating!: number;
}
export class PlanLimitDto {
  @IsIn(['OFF', 'INTEGRE', 'IA_AVANCEE']) maxMode!: string;
  @IsInt() @Min(0) @Max(100000) monthlyAnalyses!: number;
}
export class PlanLimitsDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanLimitDto)
  TRIAL!: PlanLimitDto;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanLimitDto)
  FREE!: PlanLimitDto;
  // STARTER existe dans les limites par défaut du serveur : il doit être accepté au
  // renvoi du formulaire, sinon « planLimits.property STARTER should not exist ».
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanLimitDto)
  STARTER?: PlanLimitDto;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanLimitDto)
  BASIC!: PlanLimitDto;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanLimitDto)
  PRO!: PlanLimitDto;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanLimitDto)
  ENTERPRISE!: PlanLimitDto;
}

export class AssistantSettingsDto {
  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  licenseConfirmed?: boolean;
  @IsOptional()
  @IsIn(['openai', 'anthropic', 'google', 'mistral'])
  provider?: string;
  @IsOptional()
  @IsIn(['openai', 'anthropic', 'google', 'mistral'])
  licenseProvider?: string;
  @IsOptional() @IsDateString() licenseDate?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  licenseReference?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) model?: string;
  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  analysisEnabled?: boolean;
  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  killSwitch?: boolean;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanLimitsDto)
  planLimits?: PlanLimitsDto;
  @IsOptional() @IsInt() @Min(0) @Max(100000) trialCredits?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) creditsPerAnalysis?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) creditsPerMessage?: number;
  @IsIn(['OFF', 'INTEGRE', 'IA_AVANCEE']) mode!: string;
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() guideEnabled!: boolean;
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(['payroll-create', 'recruitment-create', 'employee-create', 'getting-started', 'contract-generate', 'contract-manage'], {
    each: true,
  })
  disabledGuides!: string[];
  @IsInt() @Min(1) @Max(90) retentionDays!: number;
}
export class AssistantOverrideDto {
  @IsOptional() @IsIn(['OFF', 'INTEGRE']) forceMode?: string | null;
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() allowed!: boolean;
}
export class CompanyAssistantDto {
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() analysisEnabled!: boolean;
}
export class GuideEventDto {
  @IsUUID() sessionId!: string;
  @IsIn(['payroll-create', 'recruitment-create', 'employee-create', 'getting-started', 'contract-generate', 'contract-manage'])
  guideId!: string;
  @IsIn(['STARTED', 'COMPLETED', 'DISMISSED', 'POSTPONED'])
  state!: 'STARTED' | 'COMPLETED' | 'DISMISSED' | 'POSTPONED';
}
export class CreditAdjustDto {
  @IsInt() @Min(-100000) @Max(100000) credits!: number;
  @IsIn(['GRANT', 'PURCHASE', 'ADJUST']) reason!: 'GRANT' | 'PURCHASE' | 'ADJUST';
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsString() @MaxLength(64) reference?: string;
}
export class CreditPackDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsInt() @Min(1) @Max(1000000) credits!: number;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
/** Statut de traitement d'une question restée sans réponse (côté super admin). */
export class UnansweredUpdateDto {
  @IsIn(['NEW', 'PLANNED', 'DONE', 'IGNORED'])
  status!: 'NEW' | 'PLANNED' | 'DONE' | 'IGNORED';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}