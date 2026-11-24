import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsArray,
  IsEnum,
} from 'class-validator';
import { QuestionType } from '@prisma/client';

export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  question: string;

  @IsEnum(QuestionType)
  @IsNotEmpty()
  questionType: QuestionType; // ✅ Utilise l'enum Prisma

  @IsNumber()
  points: number;

  @IsNumber()
  order: number;

  @IsArray()
  options: string[];

  @IsArray()
  correctAnswers: string[];
}
