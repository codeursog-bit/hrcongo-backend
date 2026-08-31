// ============================================================================
// 📁 src/absence-requests/absence-requests.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { AbsenceRequestsController } from './absence-requests.controller';
import { AbsenceRequestsService } from './absence-requests.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [AbsenceRequestsController],
  providers: [AbsenceRequestsService],
  exports: [AbsenceRequestsService],
})
export class AbsenceRequestsModule {}
