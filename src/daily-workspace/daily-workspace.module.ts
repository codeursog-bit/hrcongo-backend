import { Module } from '@nestjs/common';
import { DailyWorkspaceController } from './daily-workspace.controller';
import { DailyWorkspaceService } from './daily-workspace.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DailyWorkspaceController],
  providers: [DailyWorkspaceService],
  exports: [DailyWorkspaceService],
})
export class DailyWorkspaceModule {}
