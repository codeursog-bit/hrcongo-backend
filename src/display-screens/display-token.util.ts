// ============================================================================
// 📁 src/display-screens/display-token.util.ts
// Jetons du QR dynamique, jetons d'appareil et empreintes des codes secrets.
// Tout est calculé avec le module natif `crypto` : aucune dépendance en plus.
// ============================================================================
import * as crypto from 'crypto';

export const QR_STEP_MS = 30_000; // le QR change toutes les 30 s
export const QR_STEP_SECONDS = QR_STEP_MS / 1000;
export const QR_BATCH_SIZE = 20; // ≈ 10 min de tokens d'avance pour la tablette
export const QR_PREFIX = 'KONZA1.'; // préfixe lisible par le scanner de l'appli
export const PAIRING_TTL_MS = 10 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I

function serverKey(): string {
  const k = process.env.DISPLAY_QR_KEY || process.env.ENCRYPTION_KEY;
  if (!k || k.length < 32) {
    throw new Error(
      '❌ DISPLAY_QR_KEY (ou ENCRYPTION_KEY) manquante ou trop courte (32 caractères minimum)',
    );
  }
  return k;
}

export const sha256 = (v: string): string =>
  crypto.createHash('sha256').update(v).digest('hex');

export const randomToken = (bytes = 32): string =>
  crypto.randomBytes(bytes).toString('hex');

export function generatePairingCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += PAIRING_ALPHABET[crypto.randomInt(PAIRING_ALPHABET.length)];
  }
  return out;
}

// ── QR dynamique ────────────────────────────────────────────────────────────
export const slotOf = (ms: number): number => Math.floor(ms / QR_STEP_MS);

function qrSignature(screenId: string, salt: string, slot: number): string {
  // clé propre à l'écran = HMAC(clé serveur, sel de l'écran)
  const screenKey = crypto
    .createHmac('sha256', serverKey())
    .update(`display-qr:${salt}`)
    .digest();
  return crypto
    .createHmac('sha256', screenKey)
    .update(`${screenId}.${slot}`)
    .digest('hex')
    .slice(0, 32);
}

export function buildQrToken(
  screenId: string,
  salt: string,
  slot: number,
): string {
  return `${screenId}.${slot}.${qrSignature(screenId, salt, slot)}`;
}

export interface ParsedQrToken {
  screenId: string;
  slot: number;
  sig: string;
}

export function parseQrToken(raw: string): ParsedQrToken | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.startsWith(QR_PREFIX) ? raw.slice(QR_PREFIX.length) : raw;
  const parts = clean.split('.');
  if (parts.length !== 3) return null;
  const [screenId, slotStr, sig] = parts;
  if (!UUID_RE.test(screenId) || !/^\d{1,10}$/.test(slotStr)) return null;
  if (!/^[0-9a-f]{32}$/.test(sig)) return null;
  return { screenId, slot: Number(slotStr), sig };
}

export function verifyQrSignature(
  screenId: string,
  salt: string,
  slot: number,
  sig: string,
): boolean {
  const expected = Buffer.from(qrSignature(screenId, salt, slot));
  const given = Buffer.from(sig);
  return (
    expected.length === given.length && crypto.timingSafeEqual(expected, given)
  );
}

// ── Mot secret / PIN ────────────────────────────────────────────────────────
export function normalizeSecret(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/\s+/g, ''); // espaces
}

/** Empreinte déterministe (HMAC + clé serveur) : sert d'index unique ET de vérification. */
export function secretLookup(normalized: string): string {
  const pepper = process.env.SECRET_PEPPER || serverKey();
  return crypto
    .createHmac('sha256', pepper)
    .update(`employee-secret:${normalized}`)
    .digest('hex');
}

function isSequence(digits: string): boolean {
  let asc = true;
  let desc = true;
  for (let i = 1; i < digits.length; i++) {
    const d = Number(digits[i]) - Number(digits[i - 1]);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  return asc || desc;
}

/** Retourne un message d'erreur, ou null si le code est acceptable. */
export function validateSecretStrength(raw: string): string | null {
  const n = normalizeSecret(raw);
  if (/^\d+$/.test(n)) {
    if (n.length < 6 || n.length > 10)
      return 'Un PIN doit contenir entre 6 et 10 chiffres.';
    if (/^(\d)\1+$/.test(n) || isSequence(n))
      return 'Ce PIN est trop facile à deviner (suite ou chiffre répété).';
    return null;
  }
  if (n.length < 5 || n.length > 32)
    return 'Un mot secret doit contenir entre 5 et 32 caractères.';
  if (/^(.)\1+$/.test(n)) return 'Ce mot secret est trop facile à deviner.';
  return null;
}