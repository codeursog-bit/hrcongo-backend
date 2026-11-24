// ============================================================================
// 📁 src/crypto/crypto.service.ts
// Chiffrement AES-256-GCM des données sensibles en base de données
// Champs concernés : nationalIdNumber, cnssNumber, niu, taxNumber, bankAccountNumber
//
// Format stocké : iv:authTag:ciphertext (tout en hex, séparé par ':')
// La clé vient de ENCRYPTION_KEY dans .env (32 caractères min)
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret || secret.length < 32) {
      throw new Error(
        '❌ ENCRYPTION_KEY manquante ou trop courte (32 caractères minimum requis)',
      );
    }
    // Dériver une clé de 32 bytes depuis le secret
    this.key = crypto.scryptSync(secret, 'konza-rh-salt', 32);
    this.logger.log('✅ CryptoService initialisé (AES-256-GCM)');
  }

  // ── Chiffrer un texte ──────────────────────────────────────────────────────
  encrypt(text: string | null | undefined): string | null {
    if (!text) return text ?? null;

    // Déjà chiffré ? (protection contre double chiffrement)
    if (this.isEncrypted(text)) return text;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Format : iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  // ── Déchiffrer un texte ────────────────────────────────────────────────────
  decrypt(encryptedText: string | null | undefined): string | null {
    if (!encryptedText) return encryptedText ?? null;

    // Pas chiffré (données legacy avant migration) → retourner tel quel
    if (!this.isEncrypted(encryptedText)) return encryptedText;

    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) return encryptedText; // format invalide

      const [ivHex, authTagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      this.logger.error('Erreur déchiffrement — données corrompues ?', err);
      return null;
    }
  }

  // ── Vérifier si une valeur est déjà chiffrée ──────────────────────────────
  isEncrypted(value: string): boolean {
    if (!value) return false;
    const parts = value.split(':');
    // Format attendu : 3 parties hex de longueurs fixes (32:32:variable)
    return (
      parts.length === 3 &&
      parts[0].length === 32 && // IV = 16 bytes = 32 hex
      parts[1].length === 32 // authTag = 16 bytes = 32 hex
    );
  }

  // ── Chiffrer un objet (plusieurs champs à la fois) ────────────────────────
  encryptFields<T extends object>(obj: T, fields: (keyof T)[]): T {
    const result = { ...obj };
    for (const field of fields) {
      const val = result[field];
      if (typeof val === 'string') {
        (result[field] as any) = this.encrypt(val);
      }
    }
    return result;
  }

  // ── Déchiffrer un objet (plusieurs champs à la fois) ──────────────────────
  decryptFields<T extends object>(obj: T, fields: (keyof T)[]): T {
    if (!obj) return obj;
    const result = { ...obj };
    for (const field of fields) {
      const val = result[field];
      if (typeof val === 'string') {
        (result[field] as any) = this.decrypt(val);
      }
    }
    return result;
  }
}
