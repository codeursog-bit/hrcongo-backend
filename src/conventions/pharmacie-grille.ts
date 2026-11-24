// ============================================================================
// 📁 src/conventions/pharmacie-grille.ts  (VERSION CORRIGÉE)
//
// Convention Collective applicable au personnel des Officines de Pharmacie
// — grille datée du 11/07/2012 (Annexe II).
//
// ⚠️ Cette grille date de 2012 et n'a probablement pas été révisée depuis —
// certains montants (Cat.1, Cat.2/éch.1) sont aujourd'hui sous le SMIG en
// vigueur (70 400 FCFA, décret n°2024-2762, effet 01/01/2025).
//
// RÈGLE PRODUIT : cette grille n'est qu'une SUGGESTION de salaire de base au
// moment où l'admin classe un employé dans une catégorie/échelon. Elle ne
// bloque JAMAIS rien : l'admin reste seul responsable du salaire réel de
// chaque employé, qu'il peut modifier librement sans que ça ne change son
// classement (catégorie/échelon restent ce qu'ils sont — seul le montant du
// salaire de base de CET employé change). Aucune valeur plancher n'est donc
// imposée ici, contrairement à une version précédente de ce fichier.
// ============================================================================

import type { ConventionRule } from './conventions.service';

/** categories[1-10][échelon 1..N, N variable] = salaire de base SUGGÉRÉ FCFA (grille 2012) */
export const PHARMACIE_SALARY_GRID: Record<number, number[]> = {
  1: [57380, 58655, 59820, 61095],
  2: [63430, 64595, 65760, 66925],
  3: [73835, 76960, 80080, 83205],
  4: [90245, 93635, 97020, 100410],
  5: [110840, 114800, 118760, 122720],
  6: [131080, 132400, 133940, 135040],
  7: [165000],
  8: [198000, 217800],
  9: [247500],
  10: [357500],
};

/** Année de référence de cette grille — à afficher à côté du montant suggéré côté UI. */
export const PHARMACIE_GRID_YEAR = 2012;

export function pharmacieCollege(categorie: number): 'Exécution' | 'Maîtrise' | 'Cadre' {
  if (categorie <= 4) return 'Exécution';
  if (categorie <= 7) return 'Maîtrise';
  return 'Cadre';
}

/** Salaire de base SUGGÉRÉ — jamais un plancher imposé. L'admin peut saisir tout autre montant. */
export function getPharmacieBaseSalary(categorie: number, echelonIndex = 1): number {
  const row = PHARMACIE_SALARY_GRID[categorie];
  if (!row) return 0;
  const idx = Math.min(Math.max(echelonIndex, 1), row.length) - 1;
  return row[idx];
}

export function buildPharmacieCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  for (let cat = 1; cat <= 10; cat++) {
    const row = PHARMACIE_SALARY_GRID[cat];
    row.forEach((minSalary, i) => {
      out.push({
        code: `PH${cat}-E${i + 1}`,
        label: `Cat.${cat} Éch.${i + 1} (${pharmacieCollege(cat)}) — grille ${PHARMACIE_GRID_YEAR}`,
        minSalary,
      });
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art.37 (inchangé).
// ============================================================================

export function buildPharmacieAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];

  for (let year = 2; year <= 29; year++) {
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: year,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${year}% du salaire de base (Art.37) — ${year} ans complets`,
    });
  }

  const MAX_YEAR = 45;
  for (let year = 30; year < MAX_YEAR; year++) {
    const percent = 29 + 2 * (year - 29);
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: percent,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${percent}% du salaire de base (Art.37) — ${year} ans complets`,
    });
  }
  const lastPercent = 29 + 2 * (MAX_YEAR - 29);
  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: `Prime d'ancienneté — ${MAX_YEAR} ans et plus`,
    bonusPercentage: lastPercent,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: MAX_YEAR * 12,
    description: `${lastPercent}% du salaire de base (Art.37) — ${MAX_YEAR} ans et plus`,
  });

  return rules;
}