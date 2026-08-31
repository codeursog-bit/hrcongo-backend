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

// Champs sensibles à ne jamais logguer
const REDACT = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'tempToken',
  'secret',
  'code',
  'accessToken',
  'refreshToken',
]);

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
        ? request.query
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
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      out[k] = REDACT.has(k) ? '[REDACTED]' : v;
    }
    return out;
  }
}
