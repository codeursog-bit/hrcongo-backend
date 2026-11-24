// ============================================================================
// 📁 src/conventions/petrole-grille.ts  (REMPLACE la version précédente)
//
// Convention Collective des Entreprises de Services Pétroliers (février 2010)
// — Barème des salaires, effet 1er juillet 2023. Transcrit depuis une image
// nette du tableau signé (plus fiable que l'OCR du PDF utilisé précédemment)
// — les échelons 5-6 et la cellule Cat.11/Éch.2 sont maintenant confirmés.
//
// Nombre d'échelons variable selon la catégorie (pas toutes les catégories
// vont jusqu'à l'échelon 6) :
//   Cat. 1,2,3,4,6,10        → 4 échelons
//   Cat. 5,7,8               → 5 échelons
//   Cat. 9,11,12             → 6 échelons
//   Cat. 13                  → 1 échelon (au-delà : HC, voir ci-dessous)
//
// HC = "Hors Classe" : au-delà de ce niveau, le texte de la convention ne
// fixe plus de salaire par la grille — la rémunération est négociée
// individuellement entre l'entreprise et le salarié (cadres supérieurs /
// direction). Ce n'est pas une donnée manquante : c'est ce que dit le texte.
// `getPetroleBaseSalary()` retourne donc le dernier échelon chiffré de la
// catégorie pour tout échelon demandé au-delà (comportement "plancher",
// jamais une sous-estimation par rapport à la grille officielle).
//
// ⚠️ Cette convention se renégocie quasi chaque année (12 barèmes différents
// entre 2010 et 2023 dans le document source) — à remettre à jour bien plus
// souvent que Transport/Commerce, c'est structurel à cette convention.
//
// Collèges (Annexe 2, classification par filière) :
//   Exécution : catégories 1-8 | Maîtrise : 9-10 | Cadre : 11-13
// ============================================================================

import type { ConventionRule } from './conventions.service';

/** categories[1-13][échelon 1..N, N variable] = salaire de base FCFA (barème 01/07/2023) */
export const PETROLE_SALARY_GRID: Record<number, number[]> = {
  1: [130589, 138062, 145536, 151746],
  2: [156482, 161957, 166221, 170486],
  3: [178311, 185316, 192903, 207852],
  4: [221498, 230433, 239369, 244842],
  5: [250077, 259560, 271510, 282227, 290472],
  6: [301416, 310855, 319186, 326661],
  7: [335849, 349852, 363053, 376653, 390255],
  8: [401201, 415205, 427949, 443235, 458520],
  9: [473470, 485178, 512174, 525670, 539168, 566161],
  10: [634151, 649347, 692812, 751470],
  11: [757183, 815842, 878049, 956247, 1077103, 1135762],
  12: [1194421, 1212201, 1290391, 1407689, 1446802, 1564133],
};

/** Catégorie 13 : seul l'échelon 1 (base) est chiffré — au-delà "HC" (négocié individuellement) */
export const PETROLE_CAT13_BASE = 1642319;

export function petroleCollege(categorie: number): 'Exécution' | 'Maîtrise' | 'Cadre' {
  if (categorie <= 8) return 'Exécution';
  if (categorie <= 10) return 'Maîtrise';
  return 'Cadre';
}

/**
 * Salaire de base pour une catégorie/échelon. Si l'échelon demandé dépasse
 * le nombre d'échelons réellement chiffrés pour cette catégorie (HC ou
 * catégorie plus courte), retombe sur le DERNIER échelon chiffré — jamais
 * une sous-estimation par rapport au texte.
 */
export function getPetroleBaseSalary(categorie: number, echelonIndex = 1): number {
  if (categorie === 13) return PETROLE_CAT13_BASE; // HC au-delà de l'échelon 1
  const row = PETROLE_SALARY_GRID[categorie];
  if (!row) return 0;
  const idx = Math.min(Math.max(echelonIndex, 1), row.length) - 1;
  return row[idx];
}

export function buildPetroleCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  for (let cat = 1; cat <= 12; cat++) {
    const row = PETROLE_SALARY_GRID[cat];
    row.forEach((minSalary, i) => {
      out.push({
        code: `P${cat}-E${i + 1}`,
        label: `Cat.${cat} Éch.${i + 1} (${petroleCollege(cat)})`,
        minSalary,
      });
    });
  }
  out.push({
    code: 'P13-E1',
    label: 'Cat.13 Éch.1 (Cadre — au-delà : HC, négocié individuellement)',
    minSalary: PETROLE_CAT13_BASE,
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art.59 (inchangé par rapport à la version précédente)
// 2% après 2 ans ; +1%/an de l'année 3 à l'année 25 (25%) ; +2%/an à partir
// de l'année 26, plafonné à 30% (atteint à l'année 28).
// ============================================================================

export function buildPetroleAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];

  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 2e année",
    bonusPercentage: 2,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: 24,
    maxMonthsOfService: 35,
    description: "2% du salaire conventionnel de base (Art.59) — 2 ans de présence",
  });

  for (let year = 3; year <= 25; year++) {
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: year,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${year}% du salaire conventionnel de base (Art.59) — ${year} ans complets`,
    });
  }

  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 26e année",
    bonusPercentage: 27,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: 26 * 12,
    maxMonthsOfService: 26 * 12 + 11,
    description: "27% du salaire conventionnel de base (Art.59) — 26 ans complets",
  });
  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 27e année",
    bonusPercentage: 29,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: 27 * 12,
    maxMonthsOfService: 27 * 12 + 11,
    description: "29% du salaire conventionnel de base (Art.59) — 27 ans complets",
  });
  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 28 ans et plus (plafond)",
    bonusPercentage: 30,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: 28 * 12,
    description: "30% du salaire conventionnel de base (Art.59) — plafond, 28 ans et plus",
  });

  return rules;
}