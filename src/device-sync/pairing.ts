// 📁 EMPLACEMENT (projet backend) : src/device-sync/pairing.ts
// ============================================================================
// Code de jumelage : petit code à usage unique que l'admin lit dans Konza et
// tape dans l'assistant d'installation de l'agent (au lieu de manipuler un
// fichier de configuration ou une longue clé).
//   - 8 caractères, alphabet SANS 0 O 1 I L (aucune confusion à la saisie)
//   - valable 30 minutes, utilisable UNE seule fois
//   - seul son hash est stocké en base
// ============================================================================
import { createHash, randomInt } from 'crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 caractères
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 30 * 60_000;

/** Ex. « K7MQ-4XHT » (le tiret n'est que visuel). */
export function generatePairingCode(): string {
  let raw = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Accepte minuscules, espaces et tirets : « k7mq 4xht » → « K7MQ4XHT ». */
export function normalizePairingCode(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashPairingCode(input: string): string {
  return createHash('sha256').update(normalizePairingCode(input)).digest('hex');
}