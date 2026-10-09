// ============================================================================
// 📁 chat/chat-crypto.ts — Chiffrement des messages au repos (AES-256-GCM)
// ----------------------------------------------------------------------------
// Pourquoi : même si la base (ou un backup Neon) fuite, les messages restent
// illisibles sans CHAT_ENCRYPTION_KEY, qui ne vit que dans l'environnement du
// serveur (Coolify).
//
// • Format stocké : "v1:<iv>:<tag>:<ciphertext>" (base64). Le préfixe de version
//   permet de changer d'algorithme/clé plus tard sans casser l'existant.
// • AAD = id de la conversation : un message copié d'une conversation vers une
//   autre (manipulation SQL) ne se déchiffre plus.
// • Coût CPU négligeable (AES-GCM est accéléré matériellement).
//
// Générer la clé (une seule fois, à garder précieusement) :
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// ============================================================================
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1';
let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.CHAT_ENCRYPTION_KEY;
  if (!raw) return (cachedKey = null);
  const buf = Buffer.from(raw, 'base64');
  return (cachedKey = buf.length === 32 ? buf : null);
}

export function isChatCryptoReady(): boolean {
  return loadKey() !== null;
}

export function encryptChatText(plain: string, aad: string): string {
  const key = loadKey();
  if (!key) throw new Error('CHAT_ENCRYPTION_KEY manquante ou invalide (32 octets base64 attendus)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptChatText(payload: string, aad: string): string {
  const key = loadKey();
  if (!key) return '[message indisponible]';
  try {
    const [version, ivB64, tagB64, ctB64] = payload.split(':');
    if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) return '[message illisible]';
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '[message illisible]';
  }
}