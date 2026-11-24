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
import { RecruitmentTestAccessService } from './recruitment-test-access.service';
import { RecruitmentProService } from './recruitment-pro.service';
import { RecruitmentProController } from './recruitment-pro.controller';
import { RecruitmentRequisitionsService } from './recruitment-requisitions.service';
import { RecruitmentRequisitionsController } from './recruitment-requisitions.controller';
import { RecruitmentRemindersService } from './recruitment-reminders.service';

@Module({
  imports: [PrismaModule, SubscriptionsModule, CloudinaryModule],
  controllers: [
    RecruitmentController,
    RecruitmentProController,
    RecruitmentRequisitionsController,
    PublicRecruitmentController,
  ],
  providers: [
    RecruitmentTestAccessService,
    RecruitmentService,
    RecruitmentAIService,
    JobExpirationService,
    PDFExtractionService,
    RecruitmentProService,
    RecruitmentRequisitionsService,
    RecruitmentRemindersService,
  ],
  exports: [RecruitmentService, RecruitmentAIService, JobExpirationService, RecruitmentProService],
})
export class RecruitmentModule {}