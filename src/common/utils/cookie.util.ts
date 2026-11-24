// ============================================================================
// 📁 src/common/utils/cookie.util.ts
// ============================================================================
// Contexte : après l'ajout de COOKIE_DOMAIN=.konza-rh.cg, les navigateurs qui
// avaient déjà une session gardent l'ANCIEN cookie host-only (posé sur
// api.konza-rh.cg sans `domain`) EN PLUS du nouveau cookie avec `domain`. Les
// deux portent le même nom (access_token, refresh_token, trust_device) et sont
// envoyés ensemble par le navigateur. `cookie-parser` ne garde que le premier
// de la chaîne "Cookie:", qui n'est pas forcément le plus récent — d'où des
// connexions qui échouent silencieusement pour certains utilisateurs.
//
// `pickFreshestCookie` relit l'en-tête brut, récupère TOUTES les valeurs pour
// un même nom de cookie, et retourne celle dont le JWT a le `iat` le plus
// élevé (donc le plus récemment émis). `jwt.decode` ne vérifie PAS la
// signature — il sert uniquement à comparer les dates ; la vérification réelle
// (signature + expiration) est toujours faite ensuite par passport ou
// jwtService.verify, donc ceci n'introduit aucun risque de sécurité.
//
// `clearLegacyCookies` doit être appelée avant de poser les nouveaux cookies
// (login, refresh, 2FA) le temps que les anciennes sessions expirent
// naturellement (~30 jours, durée de vie du refresh token) — après quoi elle
// peut être retirée.

import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';

function readAllCookies(req: Request, name: string): string[] {
  const raw = req.headers?.cookie;
  if (!raw) return [];
  return raw
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.startsWith(name + '='))
    .map((c) => decodeURIComponent(c.slice(name.length + 1)))
    .filter(Boolean);
}

/**
 * Retourne la valeur la plus "fraîche" (iat le plus élevé) parmi tous les
 * cookies portant ce nom. Si un seul existe, le retourne tel quel. Si aucun
 * n'est trouvé via l'en-tête brut, se rabat sur req.cookies (cookie-parser).
 */
export function pickFreshestCookie(req: Request, name: string): string | null {
  const tokens = readAllCookies(req, name);
  if (tokens.length === 0) return (req.cookies?.[name] as string) ?? null;
  if (tokens.length === 1) return tokens[0];

  return tokens
    .map((t) => {
      let iat = 0;
      try {
        const decoded = jwt.decode(t) as { iat?: number } | null;
        iat = decoded?.iat ?? 0;
      } catch {
        iat = 0;
      }
      return { t, iat };
    })
    .sort((a, b) => b.iat - a.iat)[0].t;
}

/**
 * Efface les anciens cookies host-only (posés avant l'introduction de
 * COOKIE_DOMAIN, donc sans `domain` et en SameSite=None). Sans effet si
 * COOKIE_DOMAIN n'est pas configuré (rien à nettoyer dans ce cas). Ne touche
 * jamais aux nouveaux cookies avec `domain`, car res.clearCookie ne cible que
 * les options exactes passées ici (path + absence de `domain`).
 */
export function clearLegacyCookies(res: Response): void {
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  if (!cookieDomain) return; // Rien à nettoyer si pas de domaine configuré

  const isProd = process.env.NODE_ENV === 'production';
  const legacyBase = { secure: isProd, sameSite: 'none' as const };

  res.clearCookie('access_token', { ...legacyBase, path: '/' });
  res.clearCookie('refresh_token', { ...legacyBase, path: '/auth/refresh' });
  res.clearCookie('trust_device', { ...legacyBase, path: '/' });
}