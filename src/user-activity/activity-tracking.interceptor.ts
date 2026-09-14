// ============================================================================
// Fichier: backend/src/user-activity/activity-tracking.interceptor.ts
// ============================================================================
// Enregistré globalement dans main.ts. Ne bloque jamais la requête : le
// tracking se fait en fire-and-forget après coup.

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserActivityTrackingService } from './user-activity-tracking.service';

@Injectable()
export class ActivityTrackingInterceptor implements NestInterceptor {
  constructor(private tracking: UserActivityTrackingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req.user; // posé par JwtAuthGuard — undefined si route publique

    if (user?.userId) {
      this.tracking.track(user.userId, user.companyId ?? null);
    }

    return next.handle();
  }
}