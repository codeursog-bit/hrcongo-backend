// ============================================================================
// 📄 src/performance/performance-validation.util.ts
// 🔒 Validation d'entrée commune au module performance.
//
// Pourquoi : les corps de requête arrivent en `any`. Sans contrôle de type, un
// attaquant peut envoyer un OBJET à la place d'un identifiant
// (`{"employeeId": {"not": "x"}}`, ou `?companyId[not]=x`) : Prisma l'interprète
// alors comme un opérateur de filtre et la requête porte sur d'AUTRES
// entreprises ("injection d'opérateur"). Tout identifiant venant du client doit
// donc être une chaîne UUID stricte, et tout texte/tableau doit être borné.
// ============================================================================

import { BadRequestException } from '@nestjs/common';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && UUID_RE.test(v);

/** Identifiant obligatoire : chaîne UUID, sinon 400 */
export function asUuid(v: unknown, label = 'Identifiant'): string {
  if (!isUuid(v)) throw new BadRequestException(`${label} invalide`);
  return v;
}

/** Identifiant facultatif : undefined/null/'' → null ; sinon UUID strict */
export function asOptUuid(v: unknown, label = 'Identifiant'): string | null {
  if (v === undefined || v === null || v === '') return null;
  return asUuid(v, label);
}

/** Tableau d'UUID borné (refuse tout ce qui n'est pas un tableau) */
export function asUuidArray(v: unknown, label: string, max = 1000): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadRequestException(`${label} : liste attendue`);
  if (v.length > max) throw new BadRequestException(`${label} : ${max} éléments maximum`);
  return v.map((x) => asUuid(x, label));
}

/** Tableau borné (refuse tout ce qui n'est pas un tableau) */
export function asArray<T = any>(v: unknown, label: string, max: number): T[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadRequestException(`${label} : liste attendue`);
  if (v.length > max) throw new BadRequestException(`${label} : ${max} éléments maximum`);
  return v as T[];
}

/**
 * Texte : refuse les non-chaînes (objets, nombres…), supprime les caractères de
 * contrôle, borne la longueur. `undefined` reste `undefined` (champ non fourni).
 */
export function asText(
  v: unknown,
  label: string,
  max: number,
): string | undefined {
  if (v === undefined) return undefined;
  if (v === null) return '';
  if (typeof v !== 'string')
    throw new BadRequestException(`${label} : texte attendu`);
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (clean.length > max)
    throw new BadRequestException(`${label} : ${max} caractères maximum`);
  return clean;
}

/** Texte obligatoire non vide */
export function asRequiredText(v: unknown, label: string, max: number): string {
  const t = asText(v, label, max);
  if (!t || !t.trim()) throw new BadRequestException(`${label} requis`);
  return t.trim();
}

/** Nombre fini dans [min, max] */
export function asNumber(v: unknown, label: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
    throw new BadRequestException(`${label} : valeur entre ${min} et ${max} attendue`);
  return n;
}

/** Valeur parmi une liste blanche */
export function asEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
    throw new BadRequestException(`${label} invalide`);
  return v as T;
}

/** Date valide dans une fenêtre raisonnable (évite 0001-01-01 / 9999-12-31) */
export function asDate(v: unknown, label: string): Date {
  if (typeof v !== 'string' && !(v instanceof Date))
    throw new BadRequestException(`${label} : date invalide`);
  const d = new Date(v as any);
  if (isNaN(d.getTime()) || d.getFullYear() < 1950 || d.getFullYear() > 2100)
    throw new BadRequestException(`${label} : date invalide`);
  return d;
}

/** Corps de requête : doit être un objet simple (pas un tableau, pas null) */
export function asBody(v: unknown): Record<string, any> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v))
    throw new BadRequestException('Corps de requête invalide');
  return v as Record<string, any>;
}

/** Limites de taille communes */
export const LIMITS = {
  SHORT: 160,
  TITLE: 200,
  KPI: 500,
  COMMENT: 5000,
  LONG: 10000,
  LIST: 100,
} as const;