import * as CryptoJS from 'crypto-js';

// ✅ CORRECTION : Garantir que SECRET n'est jamais undefined
const SECRET =
  process.env.ENCRYPTION_KEY ||
  process.env.JWT_SECRET ||
  'fallback_secret_key_2025';

// ⚠️ Avertissement en développement si la clé n'est pas définie
if (!process.env.ENCRYPTION_KEY && !process.env.JWT_SECRET) {
  console.warn(
    '⚠️ WARNING: ENCRYPTION_KEY and JWT_SECRET not defined in .env. Using fallback key.',
  );
}

export class CryptoUtil {
  static encrypt(text: string | number): string {
    if (text === null || text === undefined) return '';
    // ✅ SECRET est maintenant toujours une string (jamais undefined)
    return CryptoJS.AES.encrypt(String(text), SECRET).toString();
  }

  static decrypt(encrypted: string): string {
    if (!encrypted) return '';
    try {
      // ✅ SECRET est maintenant toujours une string (jamais undefined)
      const bytes = CryptoJS.AES.decrypt(encrypted, SECRET);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
      console.error('Decryption error:', e);
      return '';
    }
  }

  static encryptNumber(num: number): string {
    return this.encrypt(num.toString());
  }

  static decryptNumber(encrypted: string): number {
    const decrypted = this.decrypt(encrypted);
    return parseFloat(decrypted) || 0;
  }
}
