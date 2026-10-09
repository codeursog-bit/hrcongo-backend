// src/notifications/notifications.module.ts

import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { PushAckController } from './push-ack.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SystemLogsModule } from '../system-logs/system-logs.module';
import { CronLockModule } from '../cron-lock/cron-lock.module';
import { PushBroadcastService } from './push-broadcast.service';

@Module({
  imports: [PrismaModule, SystemLogsModule, CronLockModule],
  controllers: [NotificationsController, PushAckController],
  providers: [NotificationsService, PushNotificationsService, PushBroadcastService],
  exports: [NotificationsService, PushNotificationsService, PushBroadcastService],
})
export class NotificationsModule {}