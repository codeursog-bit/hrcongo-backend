// ============================================================================
// 📁 src/common/ip.util.ts  (NOUVEAU)
// Normalisation d'IP pour comparer l'IP du pointage à la liste « IP de confiance ».
//  - IPv4            → telle quelle
//  - ::ffff:a.b.c.d  → a.b.c.d  (IPv4 vue en IPv6, fréquent derrière un proxy)
//  - IPv6            → préfixe /64 (une box change souvent les 64 derniers bits)
// ============================================================================
import { isIPv4, isIPv6 } from 'net';

function expandIpv6(ip: string): number[] | null {
  let s = ip;
  if (s.includes('.')) {
    // IPv4 embarquée en fin d'adresse IPv6
    const lastColon = s.lastIndexOf(':');
    const v4 = s.slice(lastColon + 1).split('.').map(Number);
    if (v4.length !== 4 || v4.some((n) => !(n >= 0 && n <= 255))) return null;
    s =
      s.slice(0, lastColon + 1) +
      (((v4[0] << 8) | v4[1]).toString(16)) +
      ':' +
      (((v4[2] << 8) | v4[3]).toString(16));
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (parts.length === 1) {
    if (left.length !== 8) return null;
    return left.map((g) => parseInt(g, 16));
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill('0'), ...right].map((g) => parseInt(g, 16));
}

/** IP normalisée (voir en-tête) ou null si invalide. */
export function normalizeIp(raw?: string | null): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];
  if (isIPv4(ip)) return ip;
  if (isIPv6(ip)) {
    const g = expandIpv6(ip);
    if (!g || g.some((n) => Number.isNaN(n))) return null;
    return g.slice(0, 4).map((n) => n.toString(16)).join(':') + '::/64';
  }
  return null;
}

/**
 * IP privée / locale / de proxy interne. Ne JAMAIS l'enregistrer comme « IP de
 * confiance » : si TRUST_PROXY n'est pas défini, Express voit l'IP du proxy
 * (Traefik/Coolify) pour tout le monde — l'enregistrer validerait tous les pointages.
 */
export function isPrivateOrLocalIp(normalized: string): boolean {
  if (normalized.includes(':')) {
    const first = parseInt(normalized.split(':')[0] || '0', 16);
    return normalized.startsWith('0:0:0:0') || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  const [a, b] = normalized.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT
  );
}