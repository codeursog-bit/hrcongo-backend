// ============================================================================
// 📁 src/filters/global-exception.filter.ts
// Capture TOUTES les exceptions HTTP et les stocke dans app_errors
// Erreurs 4xx (validation, auth, not found) + 5xx (serveur)
// ============================================================================
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

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorTracker');

  constructor(private readonly prisma: PrismaService) {}

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
    response.status(statusCode).json({
      statusCode,
      message: Array.isArray(message) ? message : message,
      error: errorCode,
      ...(validationErrors ? { details: validationErrors } : {}),
    });

    // ── Ne pas stocker certains statuts / chemins ────────────────────────────
    const path = request.path ?? request.url ?? '';
    if (SKIP_STATUSES.has(statusCode) || SKIP_PATHS_REGEX.test(path)) {
      return;
    }

    // ── Log console ─────────────────────────────────────────────────────────
    const logLine = `[${statusCode}] ${errorCode} | ${request.method} ${path} | ${message}`;
    if (statusCode >= 500) {
      this.logger.error(logLine);
      if (exception instanceof Error) this.logger.error(exception.stack);
    } else {
      this.logger.warn(logLine);
    }

    // ── Stocker en base (async, ne bloque pas la réponse) ───────────────────
    const user = (request as any).user;
    const userId = user?.userId ?? null;
    const companyId = user?.companyId ?? null;
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip ??
      null;

    const sanitizedBody = this.sanitize(request.body);
    const sanitizedQuery =
      request.query && Object.keys(request.query).length
        ? this.sanitize(request.query)
        : undefined;

    this.prisma.appError
      .create({
        data: {
          errorCode,
          statusCode,
          message,
          stack:
            statusCode >= 500 && exception instanceof Error
              ? (exception.stack?.slice(0, 2000) ?? null)
              : null,
          method: request.method,
          path,
          body: sanitizedBody ?? undefined,
          query: sanitizedQuery ?? undefined,
          userId,
          companyId,
          ip,
          severity,
        },
      } as any)
      .catch((e) => this.logger.error('Erreur persist AppError:', e));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
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