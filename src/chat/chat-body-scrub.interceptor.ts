// ============================================================================
// 📁 chat/chat-body-scrub.interceptor.ts — le texte d'un message ne fuit jamais
// ----------------------------------------------------------------------------
// Ton app a des intercepteurs/filtres GLOBAUX (audit, suivi d'erreurs) qui
// peuvent copier req.body dans activity_logs ou app_errors. Pour la messagerie,
// ce serait une copie EN CLAIR de messages pourtant chiffrés en base.
//
// Cet intercepteur (posé sur le contrôleur du chat) remplace le texte dans
// req.body dès que la requête est traitée (succès OU erreur, y compris une
// erreur de validation) — avant que les intercepteurs/filtres globaux, qui
// s'exécutent "autour", ne le lisent au retour.
// ============================================================================
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const MASK = '[message masqué]';

export function scrubChatBody(req: any): void {
  const b = req?.body;
  if (b && typeof b === 'object' && typeof b.body === 'string') b.body = MASK;
}

@Injectable()
export class ChatBodyScrubInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      tap({
        next: () => scrubChatBody(req),
        error: () => scrubChatBody(req),
      }),
    );
  }
}