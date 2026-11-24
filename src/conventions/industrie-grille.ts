// ============================================================================
// 📁 src/conventions/industrie-grille.ts
//
// Convention Collective de l'Industrie et Métallurgie (30/03/2010).
//
// Annexe I "Barème des salaires" (page 104 du PDF signé le 30/03/2010) —
// transcrite depuis une image nette, relue ligne par ligne.
//
// 11 catégories. Le barème d'origine ne chiffre qu'1 ou 2 échelons par
// catégorie (les cases "3ème échelon" sont vides pour TOUTES les catégories —
// c'est le document original qui est ainsi, pas un manque de transcription) :
//   2 échelons : catégories 1, 4, 6, 7, 8, 9
//   1 échelon  : catégories 2, 3, 5, 10, 11
//
// ── Règle de l'application pour les échelons non chiffrés ──────────────────
// Le barème sert de PLANCHER (salaire minimum conventionnel) et de suggestion :
// le salaire réel est fixé par l'administrateur / l'employeur. Quand un échelon
// n'est pas chiffré (ex. échelon 3 alors que le barème s'arrête à l'échelon 2),
// on retombe sur le DERNIER échelon chiffré de la catégorie. Cohérent avec
// l'Annexe II : les entreprises créent elles-mêmes les échelons intermédiaires,
// avec un salaire de base au plus égal au 1er échelon de la catégorie supérieure.
//
// Avancement (Annexe II) : d'échelon en échelon "en fonction des résultats des
// appréciations annuelles", après 2 ou 3 bonnes appréciations — décision de
// mérite, donc pas de progression d'échelon automatique (rien dans
// echelon-progression.config.ts pour cette convention).
//
// ⚠️ Barème de 2010 : à vérifier s'il existe un avenant salarial plus récent
// avant usage en paie (Art.37 : les salaires sont fixés/modifiés par avenant
// d'une commission mixte paritaire).
// ============================================================================

import type { ConventionRule } from './conventions.service';

/** categories[catégorie 1-11][échelon 1..N] = salaire de base FCFA (Annexe I, barème 2010) */
export const INDUSTRIE_SALARY_GRID: Record<number, number[]> = {
  1: [50463, 52558],
  2: [55284],
  3: [67088],
  4: [70507, 79107],
  5: [87383],
  6: [102683, 107680],
  7: [120641, 133446],
  8: [140657, 158301],
  9: [164337, 173098],
  10: [187357],
  11: [229495],
};

export function industrieCollege(categorie: number): 'Exécution' | 'Maîtrise' | 'Cadre' {
  // Art.17 (période d'essai) confirme ce découpage : catégories 1-7 =
  // ouvriers/employés, 8-9 = maîtrise, 10-11 = cadres.
  if (categorie <= 7) return 'Exécution';
  if (categorie <= 9) return 'Maîtrise';
  return 'Cadre';
}

/**
 * Échelon réellement chiffré dans le barème pour (catégorie, échelon demandé).
 * Un échelon au-delà du dernier chiffré retombe sur le dernier chiffré
 * (ex. catégorie 4, échelon 3 → échelon 2). Retourne 0 si la catégorie n'existe pas.
 */
export function resolveIndustrieEchelon(categorie: number, echelonIndex = 1): number {
  const row = INDUSTRIE_SALARY_GRID[categorie];
  if (!row) return 0;
  return Math.min(Math.max(Math.trunc(echelonIndex) || 1, 1), row.length);
}

/** Salaire de base minimum conventionnel (plancher). 0 si la catégorie est inconnue. */
export function getIndustrieBaseSalary(categorie: number, echelonIndex = 1): number {
  const row = INDUSTRIE_SALARY_GRID[categorie];
  if (!row) return 0;
  return row[resolveIndustrieEchelon(categorie, echelonIndex) - 1];
}

/**
 * Plancher à partir d'un code du picker ("I4-E2"). Tolère un échelon non chiffré
 * ("I4-E3" → échelon 2). Retourne 0 si le code est invalide.
 */
export function getIndustrieMinSalaryByCode(code: string): number {
  const m = /^I(\d{1,2})-E(\d{1,2})$/.exec(code.trim());
  if (!m) return 0;
  return getIndustrieBaseSalary(Number(m[1]), Number(m[2]));
}

/** Catégories/échelons pour le picker de convention et le contrôle de salaire minimum. */
export function buildIndustrieCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  for (let cat = 1; cat <= 11; cat++) {
    const row = INDUSTRIE_SALARY_GRID[cat];
    if (!row) continue;
    row.forEach((minSalary, i) => {
      out.push({
        code: `I${cat}-E${i + 1}`,
        label: `Cat.${cat} Éch.${i + 1} (${industrieCollege(cat)})`,
        minSalary,
      });
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art.40 (texte clair, prose — fiable, aucun problème
// d'OCR contrairement à la grille).
// "3% après 3 années de présence effective ; 1% par année de présence à
// partir de la 3ème année avec un maximum de 25%."
// → année 3 : 3% (point de départ) ; +1%/an ensuite ; plafond 25% atteint à
//   l'année 25, reste flat au-delà (le texte ne prévoit pas de palier
//   supérieur, contrairement à Commerce/Pétrole qui sautent à 30%).
// ============================================================================

export function buildIndustrieAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];

  for (let year = 3; year <= 25; year++) {
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: year, // 3% à l'année 3, 4% à l'année 4, ... 25% à l'année 25
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year < 25 ? year * 12 + 11 : undefined, // dernier palier ouvert
      description: `${year}% du salaire de base (Art.40) — ${year} ans complets`,
    });
  }

  return rules;
}