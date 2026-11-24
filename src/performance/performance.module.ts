import { Module } from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { PerformanceController } from './performance.controller';
import { PerformanceAccessService } from './performance-access.service';
import { ReviewCyclesService } from './review-cycles.service';
import { ReviewSheetService } from './review-sheet.service';
import { CompetenciesService } from './competencies.service';
import { CompetenciesController } from './competencies.controller';
import { CareerService } from './career.service';
import { DevelopmentService } from './development.service';
import { CareerController } from './career.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [PerformanceController, CompetenciesController, CareerController],
  providers: [
    PerformanceService,
    PerformanceAccessService,
    ReviewCyclesService,
    ReviewSheetService,
    CompetenciesService,
    CareerService,
    DevelopmentService,
  ],
})
export class PerformanceModule {}