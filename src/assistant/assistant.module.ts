import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DailyWorkspaceModule } from '../daily-workspace/daily-workspace.module';
import { AssistantService } from './assistant.service';
import { ReportsModule } from '../reports/reports.module';
import { AssistantAnalysisService } from './assistant-analysis.service';
import {
  AssistantController,
  AssistantAdminController,
} from './assistant.controller';
@Module({
  imports: [PrismaModule, DailyWorkspaceModule, ReportsModule],
  providers: [AssistantService, AssistantAnalysisService],
  controllers: [AssistantController, AssistantAdminController],
})
export class AssistantModule {}
