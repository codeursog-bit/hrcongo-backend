import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { RealtimeModule } from '../realtime.module';
import { IncidentsService } from './incidents.service';
import { IncidentAlertsService } from './incident-alerts.service';
import {
  ClientErrorsController,
  OptionalIncidentSessionGuard,
} from './client-errors.controller';
import { AdminIncidentsController } from './admin-incidents.controller';
@Global()
@Module({
  imports: [PrismaModule, NotificationsModule, MailModule, RealtimeModule],
  controllers: [ClientErrorsController, AdminIncidentsController],
  providers: [
    IncidentsService,
    IncidentAlertsService,
    OptionalIncidentSessionGuard,
  ],
  exports: [IncidentsService],
})
export class IncidentsModule {}
