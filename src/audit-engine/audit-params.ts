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

// ── CNSS (Décret n°99-284 — mêmes valeurs que payroll-calculator.service.ts) ──
export const CNSS = {
  PENSION_CEILING: 1_200_000,
  SOCIAL_CEILING: 600_000,
  SALARIAL_RATE: 0.04,
  EMPLOYER_PENSION_RATE: 0.08,
  EMPLOYER_FAMILY_RATE: 0.1003,
  EMPLOYER_ACCIDENT_RATE: 0.0225,
} as const;

// ── TUS (révisé 2026 : 7,5 % dont 2,025 % DGI et 5,475 % CNSS) ──
export const TUS = { DGI_RATE: 0.02025, CNSS_RATE: 0.05475 } as const;

/** Variation du brut d'un mois à l'autre au-delà de laquelle un humain doit justifier. */
export const VARIATION_THRESHOLD = 0.2;

/** Quotient familial légal : nombre de parts entre 1 et 6,5. */
export const FISCAL_PARTS = { MIN: 1, MAX: 6.5 } as const;

/** Tolérance d'arrondi (FCFA) entre deux calculs. */
export const ROUNDING_TOLERANCE = 1;

/** Contrats pour lesquels un bulletin « salarié » CNSS/TUS/TOL s'applique. */
export const SALARIED_PERMANENT = ['CDI', 'CDD'];