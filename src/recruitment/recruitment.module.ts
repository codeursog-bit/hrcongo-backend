// src/recruitment/recruitment.module.ts
import { Module } from '@nestjs/common';
import { RecruitmentController } from './recruitment.controller';
import { PublicRecruitmentController } from './public-recruitment.controller';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentAIService } from './recruitment-ai.service';
import { JobExpirationService } from './job-expiration.service';
import { PDFExtractionService } from './pdf-extraction.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule, CloudinaryModule],
  controllers: [RecruitmentController, PublicRecruitmentController],
  providers: [
    RecruitmentService,
    RecruitmentAIService,
    JobExpirationService,
    PDFExtractionService,
  ],
  exports: [RecruitmentService, RecruitmentAIService, JobExpirationService],
})
export class RecruitmentModule {}
