// ============================================================================
// 📄 src/performance/json-only.guard.ts
// 🔒 Anti-CSRF pour les routes POST.
//
// Les cookies d'authentification sont envoyés automatiquement par le navigateur
// (et en production sans COOKIE_DOMAIN ils sont SameSite=None). Un site tiers
// peut donc faire poster un <form> vers l'API : ce POST « simple » (type
// application/x-www-form-urlencoded ou text/plain) part SANS contrôle CORS, et
// une route qui accepte un corps vide (ex. lancer un cycle, générer un modèle)
// s'exécuterait avec la session de la victime.
//
// Un formulaire ne peut PAS envoyer `Content-Type: application/json`, et un
// fetch cross-origin avec ce type déclenche un pré-vol CORS refusé par la liste
// d'origines autorisées. Exiger du JSON sur les POST ferme donc ce vecteur.
// (PATCH / DELETE ne sont pas des méthodes « simples » : le pré-vol CORS les
// protège déjà.)
// ============================================================================

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
} from '@nestjs/common';

@Injectable()
export class JsonOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.method !== 'POST') return true;
    const ct = String(req.headers?.['content-type'] ?? '').toLowerCase();
    if (!ct.startsWith('application/json'))
      throw new HttpException(
        'Content-Type application/json requis',
        415,
      );
    return true;
  }
}