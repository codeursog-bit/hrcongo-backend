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
//
// 🆕 Même logique pour les sondages automatiques du front (cloche, compteurs
// de la sidebar, vérification de session) : GET /notifications,
// GET /approvals/inbox/all, GET /dashboard/pending-requests-count,
// POST /push/ack/:id, POST /auth/refresh|verify. Ils partent seuls toutes les
// 1 à 3 min : sans exclusion, un onglet oublié ouvert gardait l'utilisateur
// « actif » en permanence et déclenchait des écritures en base pour rien.

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

// Sondages automatiques en GET uniquement (un POST/PATCH reste une action humaine)
const BACKGROUND_GET_ROUTE =
  /\/(notifications(\/unread-count)?|approvals\/inbox\/all|dashboard\/pending-requests-count|subscriptions\/(usage|current))(\?|$)/;
// Appels techniques en POST
const BACKGROUND_POST_ROUTE = /\/(push\/ack\/[^/?]+|auth\/(refresh|verify))(\?|$)/;

@Injectable()
export class ActivityTrackingInterceptor implements NestInterceptor {
  constructor(private tracking: UserActivityTrackingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req.user; // posé par JwtAuthGuard — undefined si route publique

    const url: string = req.originalUrl ?? req.url ?? '';
    const method: string = (req.method ?? 'GET').toUpperCase();
    const isChatBackground =
      CHAT_BACKGROUND_ROUTE.test(url) ||
      (method === 'GET' && BACKGROUND_GET_ROUTE.test(url)) ||
      (method === 'POST' && BACKGROUND_POST_ROUTE.test(url));

    if (user?.userId && !isChatBackground) {
      this.tracking.track(user.userId, user.companyId ?? null);
    }

    return next.handle();
  }
}