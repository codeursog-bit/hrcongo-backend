// ============================================================================
// 📄 src/performance/performance-scoring.util.ts
// Calcul des scores d'évaluation — fonctions pures (aucune dépendance Nest/Prisma)
// Reproduit la logique de la fiche Excel :
//   • Objectifs        : Σ(poids × score) / Σ(poids)           → note sur 5
//   • Facteurs/compét. : idem                                  → note sur 5
//   • Score final      : obj × (objectivesWeight %) + comp × (reste)
//   • Verdict          : seuils sur ratio = score / 5
// ============================================================================

export interface WeightedItem {
  weight?: number | string | null;
  score?: number | string | null;
}

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** Libellés par niveau (affichés sous les boutons 1–5 sur mobile) */
export const SCORE_LEVELS: Record<number, string> = {
  1: 'Insuffisant',
  2: 'À améliorer',
  3: 'Conforme aux attentes',
  4: 'Dépasse les attentes',
  5: 'Exceptionnel',
};

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function sumWeights(items: WeightedItem[] | null | undefined): number {
  if (!items?.length) return 0;
  return round2(items.reduce((s, i) => s + num(i.weight), 0));
}

/** Moyenne pondérée sur 5 (0 si aucun poids). Les scores non renseignés comptent pour 0. */
export function weightedAverage(
  items: WeightedItem[] | null | undefined,
): number {
  if (!items?.length) return 0;
  const totalW = items.reduce((s, i) => s + num(i.weight), 0);
  if (totalW <= 0) return 0;
  const total = items.reduce((s, i) => s + num(i.weight) * num(i.score), 0);
  return round2(total / totalW);
}

/**
 * Combine les deux sections. Si une section est vide (ex : pas d'objectifs),
 * l'autre compte pour 100 % au lieu de tirer la note vers 0.
 */
export function combineScores(
  objectivesScore: number | null,
  competenciesScore: number | null,
  objectivesWeightPct: number,
): number {
  const hasObj = objectivesScore !== null;
  const hasComp = competenciesScore !== null;
  if (!hasObj && !hasComp) return 0;
  if (hasObj && !hasComp) return round2(objectivesScore as number);
  if (!hasObj && hasComp) return round2(competenciesScore as number);
  const wObj = Math.min(100, Math.max(0, objectivesWeightPct)) / 100;
  return round2(
    (objectivesScore as number) * wObj +
      (competenciesScore as number) * (1 - wObj),
  );
}

/** Verdict — mêmes seuils que la fiche Excel (ratio = score / 5) */
export function verdictLabel(score5: number): string {
  const ratio = score5 / SCORE_MAX;
  if (ratio < 0.4) return 'Insuffisant';
  if (ratio < 0.6) return 'En dessous des attentes';
  if (ratio < 0.75) return 'Atteint';
  if (ratio < 0.9) return 'Dépasse les attentes';
  return 'Excellent';
}

/** Les poids doivent faire 100 (tolérance 0,01 pour les décimales) */
export function weightsAreComplete(
  items: WeightedItem[] | null | undefined,
): boolean {
  return Math.abs(sumWeights(items) - 100) < 0.011;
}

export function allScored(items: WeightedItem[] | null | undefined): boolean {
  if (!items?.length) return true;
  return items.every((i) => {
    const s = num(i.score);
    return s >= SCORE_MIN && s <= SCORE_MAX;
  });
}

export function isValidScore(v: unknown): boolean {
  const s = num(v);
  return Number.isInteger(s) && s >= SCORE_MIN && s <= SCORE_MAX;
}