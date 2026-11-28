// ============================================================================
// 📁 src/filters/global-exception.filter.ts
// Capture TOUTES les exceptions HTTP et les stocke dans app_errors
// Erreurs 4xx (validation, auth, not found) + 5xx (serveur)
// ============================================================================
import { isDailyPrivateRoute } from '../daily-workspace/daily-privacy';
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { IncidentsService } from '../incidents/incidents.service';
import { safeIncidentText, safeIncidentPath } from '../incidents/incident-privacy';
import * as jwt from 'jsonwebtoken';
import { pickFreshestCookie } from '../common/utils/cookie.util';
import { isKnownApiPath } from './known-api-prefixes';

// Champs sensibles à ne jamais logguer (insensible à la casse, à n'importe quel niveau)
const REDACT = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'temptoken',
  'secret',
  'code',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'apikey',
  'pin',
  'otp',
  'signature',
]);
// Noms contenant ces morceaux → masqués aussi (secrets, salaires, identifiants financiers/civils)
const REDACT_PATTERN =
  /pass|token|secret|apikey|salary|salaire|iban|\brib\b|bankaccount|mobilemoneynumber|nationalid|cnssnumber|taxnumber|niu/i;

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING = 300;

// Statuts à ne pas stocker (trop fréquents / pas utiles)
const SKIP_STATUSES = new Set([
  401, // Sessions expirées normales — trop nombreuses
]);

// Chemins à ignorer (health checks, assets)
const SKIP_PATHS_REGEX = /^\/(health|favicon|_next|static)/;
// 🧹 Bruit : scanners de bots (fichiers sensibles / sitemap / robots) → 404 normal, inutile dans l'ErrorTracker.
const BOT_PROBE_REGEX =
  /(^\/\.[^/]+|\/\.(env|git|vscode|npmrc|bash_history|aws|ssh)|\.(sql|bak|zip|tar|gz|old|log|php)$|^\/(robots\.txt|sitemap\.xml|wp-|phpmyadmin|admin\.php)|\/robots\.txt$)/i;
// 🧹 Refus métier attendus (le front les gère) : on ne les stocke plus comme erreurs.
const EXPECTED_CLIENT_ERRORS: Array<{ path: RegExp; statuses: number[] }> = [
  { path: /^\/leaves\/me\/balance-explained/, statuses: [400] }, // prestataire / stagiaire sans droit aux congés
  { path: /^\/employees\/me$/, statuses: [404] }, // compte sans fiche employé (admin pur, cabinet…)
];

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorTracker');

  constructor(private readonly prisma: PrismaService, private readonly incidents?: IncidentsService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // ── Extraire infos HTTP ──────────────────────────────────────────────────
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException ? exception.getResponse() : null;

    // Message lisible
    let message = 'Erreur interne du serveur';
    let errorCode = 'INTERNAL_ERROR';
    let validationErrors: string[] | undefined;

    if (isHttpException) {
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const r = exceptionResponse as any;
        message = r.message ?? message;
        errorCode = r.error ?? this.inferErrorCode(statusCode);
        // ValidationPipe retourne un tableau de messages
        if (Array.isArray(r.message)) {
          validationErrors = r.message;
          message = validationErrors!.join(' | ');
          errorCode = 'VALIDATION_ERROR';
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errorCode = exception.name ?? 'INTERNAL_ERROR';
    }

    // ── Sévérité ────────────────────────────────────────────────────────────
    const severity =
      statusCode >= 500
        ? 'CRITICAL'
        : statusCode === 403
          ? 'WARN'
          : statusCode === 400
            ? 'WARN'
            : 'ERROR';

    // ── Réponse au client ────────────────────────────────────────────────────
    const containsInternalDetails = /prisma\.|Invalid `|\.service\.ts:\d|[A-Z]:\\.*\\src\\/i.test(String(message));
    response.status(statusCode).json({
      statusCode,
      message: statusCode >= 500 ? 'Erreur interne du serveur' : containsInternalDetails ? 'Requête invalide.' : message,
      error: statusCode >= 500 ? 'INTERNAL_ERROR' : errorCode,
      ...(statusCode < 500 && validationErrors ? { details: validationErrors } : {}),
    });

    // ── Ne pas stocker certains statuts / chemins ────────────────────────────
    const path = request.path ?? request.url ?? '';
    if (path.startsWith('/client-errors')) return;
    if (statusCode === 401 && /\/auth\/login/.test(path)) this.incidents?.capture({source:'BACK',code:'AUTH_FAILURE',message:'Échec d’authentification.',path:'/auth/login',severity:'WARN'});
    if (SKIP_STATUSES.has(statusCode) || SKIP_PATHS_REGEX.test(path)) {
      return;
    }
    if (statusCode === 404 && BOT_PROBE_REGEX.test(path)) return;
    // 🧹 404 anonyme hors API : sonde de robot (/config.json, /aws…) → ni stocké, ni logué.
    // On GARDE tout 404 d'un utilisateur connecté (ex. un appel erroné du front) et tout 404
    // sous un préfixe réel de l'API (/employees/…, /blog/…).
    if (statusCode === 404 && !isKnownApiPath(path) && !this.hasValidSession(request)) return;
    if (EXPECTED_CLIENT_ERRORS.some((r) => r.path.test(path) && r.statuses.includes(statusCode))) return;

    // ── Log console ─────────────────────────────────────────────────────────
    const privateRoute = isDailyPrivateRoute(path);
    const storedMessage = privateRoute && statusCode >= 500 ? 'Erreur interne du module quotidien.' : safeIncidentText(message);
    const logLine = `[${statusCode}] ${errorCode} | ${request.method} ${path} | ${storedMessage}`;
    if (statusCode >= 500) {
      this.logger.error(logLine);
      if (!privateRoute && exception instanceof Error) this.logger.error(safeIncidentText(exception.stack,6000));
    } else {
      this.logger.warn(logLine);
    }

    // ── Stocker en base (async, ne bloque pas la réponse) ───────────────────
    const user = (request as any).user;
    const userId = user?.userId ?? null;
    const companyId = user?.companyId ?? null;
    if (statusCode >= 500 && this.incidents?.enabled) {
      this.incidents.capture({source:'BACK',code:errorCode,message:storedMessage,
        stack:!privateRoute && exception instanceof Error ? exception.stack : undefined,
        path,method:request.method,statusCode,severity:/payroll|paie|cnss/i.test(path)?'CRITICAL':'ERROR',userId,companyId,
        version:process.env.APP_VERSION});
      return;
    }
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip ??
      null;

    const sanitizedBody = privateRoute ? { redacted: true } : request.body && typeof request.body === 'object' ? {fields:Object.keys(request.body).slice(0,30)} : undefined;
    const sanitizedQuery =
      request.query && Object.keys(request.query).length
        ? privateRoute ? { redacted: true } : { fields: Object.keys(request.query).slice(0,30) }
        : undefined;

    this.prisma.appError
      .create({
        data: {
          errorCode,
          statusCode,
          message: storedMessage,
          stack:
            !privateRoute && statusCode >= 500 && exception instanceof Error
              ? safeIncidentText(exception.stack,2000)
              : null,
          method: request.method,
          path: safeIncidentPath(path),
          body: sanitizedBody ?? undefined,
          query: sanitizedQuery ?? undefined,
          userId,
          companyId,
          ip: ip?.includes(':') ? ip.split(':').slice(0,3).join(':')+'::' : ip?.split('.').slice(0,3).join('.')+'.0',
          severity,
        },
      } as any)
      .catch((e) => this.logger.error('Erreur persist AppError:', e));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Vrai si la requête porte une session émise par nous (signature vérifiée, expiration ignorée).
  // Nécessaire : sur une route INEXISTANTE (404 du routeur) aucun guard ne s'exécute, donc
  // request.user est vide même pour un utilisateur connecté. Aucun accès base de données.
  private hasValidSession(request: Request): boolean {
    if ((request as any).user) return true;
    const secret = process.env.JWT_SECRET;
    if (!secret) return true; // impossible de vérifier → comportement historique (on stocke)
    let token: string | null = null;
    try {
      token = pickFreshestCookie(request, 'access_token'); // peut lever sur un cookie mal encodé (robots)
    } catch {
      token = null;
    }
    if (!token) {
      const auth = request.headers?.authorization;
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) token = auth.slice(7);
    }
    if (!token) {
      const q = (request.query as any)?.token;
      if (typeof q === 'string') token = q;
    }
    if (!token) return false;
    try {
      const payload = jwt.verify(token, secret, { ignoreExpiration: true }) as any;
      return payload?.type === 'access';
    } catch {
      return false;
    }
  }

  private inferErrorCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return codes[status] ?? 'HTTP_ERROR';
  }

  private sanitize(body: any): Record<string, any> | undefined {
    if (!body || typeof body !== 'object') return undefined;
    return this.redact(body, 0) as Record<string, any>;
  }

  // Masque récursivement les champs sensibles, tronque les gros textes (base64, imports)
  // et plafonne la profondeur / la taille des tableaux pour ne pas gonfler app_errors.
  private redact(value: any, depth: number): any {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…[tronqué]' : value;
    }
    if (typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return '[trop profond]';
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => this.redact(v, depth + 1));
      if (value.length > MAX_ARRAY_ITEMS) items.push(`…[+${value.length - MAX_ARRAY_ITEMS} éléments]`);
      return items;
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        REDACT.has(k.toLowerCase()) || REDACT_PATTERN.test(k)
          ? '[REDACTED]'
          : this.redact(v, depth + 1);
    }
    return out;
  }
}