// ============================================================================
// 📁 src/permission-tickets/permission-tickets.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { PermissionTicketsController } from './permission-tickets.controller';
import { PermissionTicketsService } from './permission-tickets.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, NotificationsModule, SubscriptionsModule],
  controllers: [PermissionTicketsController],
  providers: [PermissionTicketsService],
  exports: [PermissionTicketsService],
})
export class PermissionTicketsModule {}