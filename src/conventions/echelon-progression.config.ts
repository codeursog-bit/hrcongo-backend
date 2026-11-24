// ============================================================================
// 📁 src/conventions/echelon-progression.config.ts
//
// Règle de progression d'échelon par convention collective.
// Transport (Art.22 + grille annexe 2) : montée tous les 2 ans, jusqu'à
// l'échelon K (index 11) qui est un plafond ("échelon plafond, au-delà le
// sujet sera évoqué en entreprise").
//
// Ajoutez une entrée par convention au fur et à mesure qu'elle est traitée.
// Une convention absente de cette map = pas de suggestion d'échelon générée
// pour elle (comportement sûr par défaut).
// ============================================================================

export interface EchelonProgressionConfig {
  /** Nombre d'années entre deux échelons (ex: 2 pour Transport) */
  stepYears: number;
  /** Index numérique max (K = 11 pour Transport) */
  maxEchelonIndex: number;
}

export const ECHELON_PROGRESSION_BY_CONVENTION: Record<
  string,
  EchelonProgressionConfig
> = {
  TRANSPORT: { stepYears: 2, maxEchelonIndex: 11 },
};

/** Retourne la config de progression pour une convention, ou null si non gérée. */
export function getEchelonProgressionConfig(
  conventionCode: string | null | undefined,
): EchelonProgressionConfig | null {
  if (!conventionCode) return null;
  return ECHELON_PROGRESSION_BY_CONVENTION[conventionCode.toUpperCase()] ?? null;
}

/**
 * Calcule l'index d'échelon "cible" pour une ancienneté donnée (années
 * complètes), plafonné à maxEchelonIndex.
 * Ex Transport (step=2, max=11) : 0-1 an → A(1), 2-3 ans → B(2), … 20+ ans → K(11).
 */
export function computeTargetEchelonIndex(
  yearsCompleted: number,
  cfg: EchelonProgressionConfig,
): number {
  const target = 1 + Math.floor(yearsCompleted / cfg.stepYears);
  return Math.min(target, cfg.maxEchelonIndex);
}