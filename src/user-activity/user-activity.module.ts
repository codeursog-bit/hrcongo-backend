// ============================================================================
// Fichier: backend/src/user-activity/user-activity.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { UserActivityTrackingService } from './user-activity-tracking.service';
import { ActivityTrackingInterceptor } from './activity-tracking.interceptor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [UserActivityTrackingService, ActivityTrackingInterceptor],
  exports: [UserActivityTrackingService, ActivityTrackingInterceptor],
})
export class UserActivityModule {}