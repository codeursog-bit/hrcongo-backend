// ============================================================================
// Fichier: backend/src/user-activity/activity-tracking.interceptor.ts
// ============================================================================
// Enregistré globalement dans main.ts. Ne bloque jamais la requête : le
// tracking se fait en fire-and-forget après coup.
//
// 🆕 Le poll automatique de la messagerie (/chat/poll toutes les 3 à 30 s,
// et /chat/away) est EXCLU : ce n'est pas une activité humaine. Sans ça, il
// déclencherait 3 écritures en base par utilisateur et par minute, et un
// onglet resté ouvert compterait comme « en ligne / actif » en permanence.
// Les autres routes du chat (envoyer, lire, ouvrir) comptent normalement.

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserActivityTrackingService } from './user-activity-tracking.service';

// Fonctionne avec ou sans préfixe global ("/api/chat/poll" ou "/chat/poll")
const CHAT_BACKGROUND_ROUTE = /\/chat\/(poll|away)(\?|$)/;

@Injectable()
export class ActivityTrackingInterceptor implements NestInterceptor {
  constructor(private tracking: UserActivityTrackingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req.user; // posé par JwtAuthGuard — undefined si route publique

    const url: string = req.originalUrl ?? req.url ?? '';
    const isChatBackground = CHAT_BACKGROUND_ROUTE.test(url);

    if (user?.userId && !isChatBackground) {
      this.tracking.track(user.userId, user.companyId ?? null);
    }

    return next.handle();
  }
}