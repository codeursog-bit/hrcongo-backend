// ============================================================================
// 📁 src/legal-parameters/legal-parameters.core.ts
// 🇨🇬 RÉFÉRENTIEL LÉGAL — cœur pur (aucune dépendance Nest/Prisma)
// ----------------------------------------------------------------------------
// Les valeurs ci-dessous sont EXACTEMENT celles qui étaient codées en dur
// avant la création du référentiel : tant que le super administrateur ne
// publie aucune version, les calculs de paie ne changent pas d'un franc.
// ============================================================================

export type PartsMode = 'FAMILY_QUOTIENT' | 'SINGLE_PART';

/** Tranche stockée en JSON : `max: null` = tranche ouverte (« au-delà de »). */
export interface BracketParam {
  min: number;
  max: number | null;
  rate: number; // 0.10 = 10 %
  fixed: number; // montant fixe annuel par part (0 si calcul en %)
}

export interface LegalParams {
  schemaVersion: 1;
  fiscal: {
    /** Nom affiché de l'impôt (ex. « ITS »), au cas où il serait renommé. */
    regimeLabel: string;
    abattementRate: number; // 0.2 = 20 %
    brackets: {
      ITS_2026: BracketParam[];
      IRPP_LEGACY: BracketParam[];
    };
    /** FAMILY_QUOTIENT = parts selon situation familiale ; SINGLE_PART = 1 part pour tous. */
    partsMode: PartsMode;
    maxParts: number;
    /**
     * Mode fiscal « AUTO » : barème ITS à partir de cette année, ancien barème
     * IRPP avant. (2026 = valeur historique.)
     */
    autoItsFromYear: number;
  };
  cnss: {
    salarialRate: number;
    pensionCeiling: number;
    socialCeiling: number;
    employerPensionRate: number;
    employerFamilyRate: number;
    employerAccidentRate: number;
  };
  tus: {
    dgiRate: number;
    cnssRate: number;
  };
  /** Règles de congé payé (indemnité). Absentes des anciennes versions → valeurs par défaut. */
  leave: {
    /** Jours ouvrables de congé payé par cycle de 12 mois (Code du travail : 26 minimum).
     *  Les congés supplémentaires d'ancienneté des conventions collectives ne sont PAS ici. */
    annualDays: number;
    /** Cumul maximum de congés non pris, en années (Code du travail : 3). */
    maxCumulYears: number;
    /** Ancienneté minimale avant le premier congé, en mois (Code du travail : 12). */
    minMonthsBeforeLeave: number;
    /** Diviseur de la somme des bruts pour le PREMIER cycle (11 ou 12 — à confirmer par l'expert). */
    firstCycleDivisor: number;
    /** Diviseur pour les cycles suivants. */
    nextCycleDivisor: number;
  };
}

/** Tranche prête pour le calcul (même forme que TaxBracket historique). */
export interface RuntimeBracket {
  min: number;
  max: number;
  rate: number;
  fixed: number;
  label: string;
}

// ── Valeurs actuelles (= ancien code en dur) ────────────────────────────────
export const DEFAULT_LEGAL_PARAMS: LegalParams = {
  schemaVersion: 1,
  fiscal: {
    regimeLabel: 'ITS',
    abattementRate: 0.2,
    brackets: {
      ITS_2026: [
        { min: 0, max: 615_000, rate: 0, fixed: 1_200 },
        { min: 615_000, max: 1_500_000, rate: 0.1, fixed: 0 },
        { min: 1_500_000, max: 3_500_000, rate: 0.15, fixed: 0 },
        { min: 3_500_000, max: 5_000_000, rate: 0.2, fixed: 0 },
        { min: 5_000_000, max: null, rate: 0.3, fixed: 0 },
      ],
      IRPP_LEGACY: [
        { min: 0, max: 464_000, rate: 0.01, fixed: 0 },
        { min: 464_000, max: 1_000_000, rate: 0.1, fixed: 0 },
        { min: 1_000_000, max: 3_000_000, rate: 0.25, fixed: 0 },
        { min: 3_000_000, max: null, rate: 0.4, fixed: 0 },
      ],
    },
    partsMode: 'FAMILY_QUOTIENT',
    maxParts: 6.5,
    autoItsFromYear: 2026,
  },
  cnss: {
    salarialRate: 0.04,
    pensionCeiling: 1_200_000,
    socialCeiling: 600_000,
    employerPensionRate: 0.08,
    employerFamilyRate: 0.1003,
    employerAccidentRate: 0.0225,
  },
  tus: {
    dgiRate: 0.02025,
    cnssRate: 0.05475,
  },
  leave: {
    annualDays: 26,
    maxCumulYears: 3,
    minMonthsBeforeLeave: 12,
    firstCycleDivisor: 12,
    nextCycleDivisor: 12,
  },
};

// ── Utilitaires ─────────────────────────────────────────────────────────────

export function cloneParams<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Fusion profonde « valeurs stockées par-dessus les valeurs par défaut ».
 * Les tableaux (barèmes) sont remplacés en bloc, jamais fusionnés ligne à ligne.
 * Une clé absente d'une ancienne version reprend donc sa valeur par défaut.
 */
export function mergeWithDefaults(stored: unknown, base: LegalParams = DEFAULT_LEGAL_PARAMS): LegalParams {
  const out = cloneParams(base) as unknown as Record<string, unknown>;
  const walk = (target: Record<string, unknown>, src: unknown) => {
    if (!isObj(src)) return;
    for (const key of Object.keys(src)) {
      const sv = src[key];
      const tv = target[key];
      if (isObj(sv) && isObj(tv)) walk(tv, sv);
      else if (sv !== undefined && sv !== null) target[key] = cloneParams(sv);
    }
  };
  walk(out, stored);
  return out as unknown as LegalParams;
}

const fmt = (n: number) => n.toLocaleString('fr-FR');

export function toRuntimeBrackets(brackets: BracketParam[]): RuntimeBracket[] {
  return brackets.map((b) => {
    const max = b.max === null ? Infinity : b.max;
    const label =
      b.fixed > 0
        ? `${fmt(b.min)} – ${max === Infinity ? '∞' : fmt(max)} FCFA (${fmt(b.fixed)} F fixe)`
        : `${fmt(b.min)} – ${max === Infinity ? '∞' : fmt(max)} FCFA (${Math.round(b.rate * 10000) / 100}%)`;
    return { min: b.min, max, rate: b.rate, fixed: b.fixed, label };
  });
}

// ── Validation ──────────────────────────────────────────────────────────────

function checkBrackets(name: string, br: unknown, errors: string[]) {
  if (!Array.isArray(br) || br.length === 0) {
    errors.push(`${name} : au moins une tranche est requise.`);
    return;
  }
  const list = br as BracketParam[];
  list.forEach((b, i) => {
    const where = `${name}, tranche ${i + 1}`;
    if (!Number.isFinite(b?.min) || b.min < 0) errors.push(`${where} : « de » invalide.`);
    if (b?.max !== null && !(Number.isFinite(b?.max) && (b.max as number) > b.min))
      errors.push(`${where} : « à » doit être supérieur à « de » (ou vide pour la dernière tranche).`);
    if (!Number.isFinite(b?.rate) || b.rate < 0 || b.rate > 1)
      errors.push(`${where} : le taux doit être compris entre 0 et 1 (ex. 0,10 pour 10 %).`);
    if (!Number.isFinite(b?.fixed) || b.fixed < 0) errors.push(`${where} : montant fixe invalide.`);
  });
  if (list[0]?.min !== 0) errors.push(`${name} : la première tranche doit commencer à 0.`);
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].max !== list[i].min)
      errors.push(`${name} : la tranche ${i + 1} doit commencer là où la tranche ${i} se termine.`);
  }
  if (list[list.length - 1]?.max !== null)
    errors.push(`${name} : la dernière tranche doit être ouverte (sans plafond).`);
  list.slice(0, -1).forEach((b, i) => {
    if (b.max === null) errors.push(`${name} : seule la dernière tranche peut être ouverte (tranche ${i + 1}).`);
  });
}

/** Retourne la liste des erreurs (vide = valide). */
export function validateLegalParams(p: LegalParams): string[] {
  const errors: string[] = [];
  const rate = (label: string, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
      errors.push(`${label} : taux invalide (entre 0 et 1, ex. 0,04 pour 4 %).`);
  };
  const amount = (label: string, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) errors.push(`${label} : montant invalide.`);
  };

  if (!p || p.schemaVersion !== 1) errors.push('Version de format inconnue.');
  if (!p?.fiscal || !p?.cnss || !p?.tus) {
    errors.push('Sections fiscal, cnss et tus requises.');
    return errors;
  }

  rate('Abattement', p.fiscal.abattementRate);
  checkBrackets('Barème ITS', p.fiscal.brackets?.ITS_2026, errors);
  checkBrackets('Barème IRPP historique', p.fiscal.brackets?.IRPP_LEGACY, errors);
  if (!['FAMILY_QUOTIENT', 'SINGLE_PART'].includes(p.fiscal.partsMode))
    errors.push('Mode des parts : FAMILY_QUOTIENT ou SINGLE_PART.');
  if (!Number.isFinite(p.fiscal.maxParts) || p.fiscal.maxParts < 1) errors.push('Maximum de parts invalide (≥ 1).');
  if (!Number.isInteger(p.fiscal.autoItsFromYear) || p.fiscal.autoItsFromYear < 2000 || p.fiscal.autoItsFromYear > 2100)
    errors.push("Année de bascule ITS (mode automatique) invalide.");
  if (!p.fiscal.regimeLabel || !String(p.fiscal.regimeLabel).trim()) errors.push("Nom de l'impôt requis.");

  rate('CNSS salariale', p.cnss.salarialRate);
  rate('CNSS patronale retraite', p.cnss.employerPensionRate);
  rate('CNSS patronale famille', p.cnss.employerFamilyRate);
  rate('CNSS patronale accidents', p.cnss.employerAccidentRate);
  amount('Plafond CNSS retraite', p.cnss.pensionCeiling);
  amount('Plafond CNSS famille/accidents', p.cnss.socialCeiling);
  rate('TUS part État (DGI)', p.tus.dgiRate);
  rate('TUS part CNSS', p.tus.cnssRate);

  const lv = p.leave;
  if (!lv) errors.push('Section congé requise.');
  else {
    if (!Number.isFinite(lv.annualDays) || lv.annualDays < 1 || lv.annualDays > 60)
      errors.push('Jours de congé par an : valeur entre 1 et 60.');
    if (!Number.isInteger(lv.maxCumulYears) || lv.maxCumulYears < 1 || lv.maxCumulYears > 10)
      errors.push('Cumul maximum (années) : entier entre 1 et 10.');
    if (!Number.isInteger(lv.minMonthsBeforeLeave) || lv.minMonthsBeforeLeave < 0 || lv.minMonthsBeforeLeave > 36)
      errors.push('Ancienneté minimale (mois) : entier entre 0 et 36.');
    for (const [label, v] of [['Diviseur du 1er cycle', lv.firstCycleDivisor], ['Diviseur des cycles suivants', lv.nextCycleDivisor]] as const)
      if (!Number.isInteger(v) || v < 1 || v > 12) errors.push(`${label} : entier entre 1 et 12 (ex. 11 ou 12).`);
  }

  return errors;
}

// ── Résolution par date d'effet ─────────────────────────────────────────────

export interface StoredVersion {
  id: string;
  effectiveFrom: string; // 'YYYY-MM-DD'
  createdAt: string; // ISO
  params: unknown;
}

/** Clé 'YYYY-MM-DD' à partir des composantes LOCALES (évite le décalage UTC+1). */
export function dateKeyLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Version applicable à `key` : la plus récente date d'effet ≤ key ;
 * à date d'effet égale, la dernière créée l'emporte (correction sans effacer l'historique).
 * Aucune version applicable → null (l'appelant retombe sur les valeurs par défaut).
 */
export function pickVersion<T extends StoredVersion>(versions: T[], key: string): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > key) continue;
    if (
      !best ||
      v.effectiveFrom > best.effectiveFrom ||
      (v.effectiveFrom === best.effectiveFrom && v.createdAt > best.createdAt)
    )
      best = v;
  }
  return best;
}


/**
 * Mode fiscal à appliquer quand l'entreprise est en « AUTO » (ou ne force rien) :
 * ancien barème avant l'année de bascule, ITS à partir de cette année.
 */
export function autoFiscalMode(params: LegalParams, year: number): 'ITS_2026' | 'IRPP_LEGACY' {
  return year < params.fiscal.autoItsFromYear ? 'IRPP_LEGACY' : 'ITS_2026';
}

// ── Accès global en lecture (pour le code qui n'est pas injecté par Nest) ───
// LegalParametersService s'enregistre ici au démarrage. Sans enregistrement
// (tests unitaires, scripts), on retombe sur les valeurs par défaut.
type Resolver = (key: string) => LegalParams;
let globalResolver: Resolver | null = null;

export function bindLegalResolver(fn: Resolver | null): void {
  globalResolver = fn;
}

/** Règles légales applicables à un mois de paie. */
export function legalAtPeriod(year: number, month: number): LegalParams {
  return globalResolver ? globalResolver(periodKey(year, month)) : DEFAULT_LEGAL_PARAMS;
}

/** Règles légales applicables aujourd'hui. */
export function legalNow(): LegalParams {
  return globalResolver ? globalResolver(dateKeyLocal(new Date())) : DEFAULT_LEGAL_PARAMS;
}

/** Pourcentage lisible : 0.1003 → « 10,03 % ». */
export function pctLabel(rate: number): string {
  return `${(+(rate * 100).toFixed(3)).toLocaleString('fr-FR')} %`;
}