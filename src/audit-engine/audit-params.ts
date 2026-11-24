// ============================================================================
// 📁 src/audit-engine/audit-params.ts
// Paramètres légaux utilisés par les contrôles, VERSIONNÉS par date d'effet.
// Une valeur qui change = une ligne de plus ici (jamais un remplacement) : les
// anciens bulletins restent contrôlés avec la valeur en vigueur à leur période.
// ============================================================================

/**
 * SMIG mensuel (Congo-Brazzaville). Décret n°2024-2762 : 50 400 → 70 400 FCFA
 * à compter de janvier 2025.
 * ⚠️ `SMIC_CONGO = 50_000` dans payrolls/constants/payroll.constants.ts est
 * incohérent avec cette valeur (voir patches/04-incoherence-smig.md).
 */
export const SMIG_HISTORY: ReadonlyArray<{ from: string; value: number }> = [
  { from: '2025-01-01', value: 70_400 },
  { from: '1900-01-01', value: 50_400 },
];

export const smigAt = (date: Date): number => {
  const d = date.toISOString().slice(0, 10);
  return (SMIG_HISTORY.find((h) => h.from <= d) ?? SMIG_HISTORY[SMIG_HISTORY.length - 1]).value;
};

// ── CNSS / TUS / parts : lus dans le référentiel légal (super administrateur),
// à la date du bulletin contrôlé. Valeurs par défaut = anciennes constantes.
import { legalAtPeriod } from '../legal-parameters/legal-parameters.core';

export const cnssAt = (year: number, month: number) => {
  const c = legalAtPeriod(year, month).cnss;
  return {
    PENSION_CEILING: c.pensionCeiling,
    SOCIAL_CEILING: c.socialCeiling,
    SALARIAL_RATE: c.salarialRate,
    EMPLOYER_PENSION_RATE: c.employerPensionRate,
    EMPLOYER_FAMILY_RATE: c.employerFamilyRate,
    EMPLOYER_ACCIDENT_RATE: c.employerAccidentRate,
  };
};

export const tusAt = (year: number, month: number) => {
  const t = legalAtPeriod(year, month).tus;
  return { DGI_RATE: t.dgiRate, CNSS_RATE: t.cnssRate };
};

/** Quotient familial légal : nombre de parts entre 1 et le maximum en vigueur. */
export const fiscalPartsAt = (year: number, month: number) => ({
  MIN: 1,
  MAX: legalAtPeriod(year, month).fiscal.maxParts,
});

/** Variation du brut d'un mois à l'autre au-delà de laquelle un humain doit justifier. */
export const VARIATION_THRESHOLD = 0.2;

/** Tolérance d'arrondi (FCFA) entre deux calculs. */
export const ROUNDING_TOLERANCE = 1;

/** Contrats pour lesquels un bulletin « salarié » CNSS/TUS/TOL s'applique. */
export const SALARIED_PERMANENT = ['CDI', 'CDD'];