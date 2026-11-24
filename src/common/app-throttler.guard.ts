// ============================================================================
// 📁 src/common/app-throttler.guard.ts  (NOUVEAU)
// Limiteur de débit global (remplace ThrottlerGuard dans app.module.ts).
//
// Problème corrigé : la connexion était limitée à 5 tentatives / 15 min PAR IP.
// Or beaucoup d'employés d'une même entreprise partagent une seule IP publique
// (et, derrière un reverse proxy sans TRUST_PROXY, TOUS les clients partagent
// celle du proxy) : quelques connexions suffisaient à bloquer tout le monde.
//
// Ici, pour POST /auth/login uniquement :
//   • la limite par route (5 / 15 min) s'applique par IP + IDENTIFIANT : une
//     personne qui se trompe de mot de passe ne bloque plus ses collègues ;
//   • un plafond par IP seule (toutes personnes confondues) reste en place
//     contre le bourrage d'identifiants depuis une même machine ;
//   • le verrouillage du compte reste géré dans AuthService.
// Toutes les autres routes gardent le comportement par IP d'origine.
// ============================================================================
import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { normalizeIp } from './ip.util';

const LOGIN_PATH = /\/auth\/login\/?(?:\?.*)?$/;
const IP_WINDOW_MS = 15 * 60 * 1000;
// Plafond de tentatives de connexion (réussies ou non) pour une même IP sur 15 min.
// Large exprès : une agence entière peut se connecter à 8h derrière une seule box.
const IP_CEILING = 300;

const MSG_LOGIN =
  'Trop de tentatives de connexion. Patientez quelques minutes puis réessayez.';
const MSG_DEFAULT = 'Trop de requêtes. Patientez un instant puis réessayez.';

const tooMany = (message: string) =>
  new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);

// Diagnostic : une ligne de log (max 1 / minute / IP) à chaque blocage, pour voir
// QUELLE IP le serveur voit réellement derrière le proxy. Aucun email ni mot de passe.
const LOG_EVERY_MS = 60_000;

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly diag = new Logger('Throttle');
  private readonly lastLog = new Map<string, number>();
  private readonly ipHits = new Map<string, { count: number; resetAt: number }>();

  private logBlocked(req: Record<string, any>, why: string) {
    const ip = this.ipOf(req);
    const now = Date.now();
    if ((this.lastLog.get(ip) ?? 0) + LOG_EVERY_MS > now) return;
    if (this.lastLog.size > 2000) this.lastLog.clear();
    this.lastLog.set(ip, now);
    const xff = String(req?.headers?.['x-forwarded-for'] ?? '-').slice(0, 120);
    this.diag.warn(
      `${why} ${req?.method} ${String(req?.originalUrl || req?.url || '').split('?')[0]} ` +
        `ip=${ip} req.ip=${req?.ip} xff="${xff}" proxyHops=${String(req?.app?.get?.('trust proxy'))}`,
    );
  }

  private isLogin(req: Record<string, any>): boolean {
    return (
      req?.method === 'POST' &&
      LOGIN_PATH.test(String(req.originalUrl || req.url || ''))
    );
  }

  private ipOf(req: Record<string, any>): string {
    const raw = String(req?.ip || req?.socket?.remoteAddress || 'unknown');
    return normalizeIp(raw) ?? raw;
  }

  private overIpCeiling(ip: string): boolean {
    const now = Date.now();
    if (this.ipHits.size > 5000) {
      for (const [k, v] of this.ipHits) if (v.resetAt <= now) this.ipHits.delete(k);
    }
    const hit = this.ipHits.get(ip);
    if (!hit || hit.resetAt <= now) {
      this.ipHits.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
      return false;
    }
    hit.count += 1;
    return hit.count > IP_CEILING;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest();
      if (this.isLogin(req) && this.overIpCeiling(this.ipOf(req))) {
        this.logBlocked(req, 'PLAFOND_IP');
        throw tooMany(MSG_LOGIN);
      }
    }
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = this.ipOf(req);
    if (!this.isLogin(req)) return ip;
    const raw = req?.body?.email;
    const id =
      typeof raw === 'string'
        ? raw.replace(/\s+/g, '').toLowerCase().slice(0, 200)
        : '';
    return id ? `${ip}|${id}` : ip;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    _detail?: unknown,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest();
    this.logBlocked(req, this.isLogin(req) ? 'LIMITE_LOGIN' : 'LIMITE_ROUTE');
    throw tooMany(this.isLogin(req) ? MSG_LOGIN : MSG_DEFAULT);
  }
}