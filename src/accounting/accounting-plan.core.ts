// ============================================================================
// 📁 src/accounting/accounting-plan.core.ts — logique PURE du plan de comptes
// (fusion, validation, sélection de version). Sans dépendance Nest/Prisma.
// ============================================================================
import { AccountPlan, DEFAULT_COUNTRY, DEFAULT_PLAN } from './syscohada';

export type StoredPlanVersion = { id: string; countryCode: string; effectiveFrom: string; createdAt: string; accounts: AccountPlan; note?: string | null };

export const normalizeCountry = (c?: string | null): string => {
  const v = (c ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : DEFAULT_COUNTRY;
};

/** Dernière version dont la date d'effet est <= dateKey, pour le pays demandé. */
export function pickPlanVersion(versions: StoredPlanVersion[], country: string, dateKey: string): StoredPlanVersion | undefined {
  let best: StoredPlanVersion | undefined;
  for (const v of versions) {
    if (v.countryCode !== country || v.effectiveFrom > dateKey) continue;
    if (!best || (v.effectiveFrom + v.createdAt) >= (best.effectiveFrom + best.createdAt)) best = v;
  }
  return best;
}

/** Plan effectif = défaut du code ⊕ surcharges (seules les surcharges sont stockées). */
export const mergePlan = (overrides?: AccountPlan | null, base: Readonly<AccountPlan> = DEFAULT_PLAN): AccountPlan => ({ ...base, ...(overrides ?? {}) });

/** Ne garde que ce qui diffère du défaut (ou n'existe pas au catalogue : rubriques ajoutées). */
export function diffFromDefaults(plan: AccountPlan): AccountPlan {
  const out: AccountPlan = {};
  for (const [key, acc] of Object.entries(plan)) {
    const d = DEFAULT_PLAN[key];
    if (!d || d.code !== acc.code || d.name !== acc.name) out[key] = { code: acc.code, name: acc.name };
  }
  return out;
}

const KEY_RE = /^[A-Z][A-Z0-9_]{1,79}$/;
export function validatePlanAccounts(input: unknown): { accounts: AccountPlan; errors: string[] } {
  const errors: string[] = [];
  const accounts: AccountPlan = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { accounts, errors: ['Le plan doit être un objet {rubrique: {code, name}}.'] };
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 300) errors.push('Trop de rubriques (300 maximum).');
  for (const [key, raw] of entries) {
    if (!KEY_RE.test(key)) { errors.push(`Rubrique « ${key} » invalide (majuscules, chiffres et _ ; 2 à 80 caractères).`); continue; }
    const v = raw as { code?: unknown; name?: unknown };
    const code = typeof v?.code === 'string' ? v.code.trim() : '';
    const name = typeof v?.name === 'string' ? v.name.trim().replace(/\s+/g, ' ') : '';
    if (!/^\d{2,10}$/.test(code)) errors.push(`${key} : numéro de compte invalide (2 à 10 chiffres).`);
    // eslint-disable-next-line no-control-regex
    else if (name.length < 2 || name.length > 120 || /[\u0000-\u001f]/.test(name)) errors.push(`${key} : libellé du compte invalide (2 à 120 caractères).`);
    else accounts[key] = { code, name };
  }
  return { accounts, errors };
}