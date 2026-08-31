// src/notifications/notifications.module.ts

import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationsService], // 🆕
  exports: [NotificationsService, PushNotificationsService], // 🆕
})
export class NotificationsModule {}
