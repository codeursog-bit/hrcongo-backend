// ============================================================================
// 📁 src/conventions/commerce-grille.ts
//
// Convention Collective du Commerce (signée 03/08/2011) + Protocole d'accord
// de révision de la grille salariale du 16/10/2024 (Arrêté n°6191/MFPTSS-CAB
// du 5 avril 2024), effet au 01/01/2025 — Annexe III.
//
// La grille précédemment codée dans conventions.service.ts était PARTIELLE
// (1 à 2 échelons sur 5 selon la catégorie, plusieurs manquants) et déjà
// alignée par coïncidence sur les valeurs 2024 pour les échelons présents —
// ce fichier la complète avec les 5 valeurs par catégorie (base + 4
// échelons) pour les catégories 1 à 8, et les 2 valeurs uniques (sans
// échelon) pour les catégories 9 et 10.
//
// Numérotation des échelons : E1 = salaire de base de la catégorie (sans
// échelon), E2 = "1er échelon", E3 = "2ème échelon", E4 = "3ème échelon",
// E5 = "4ème échelon" — reprend exactement la convention déjà utilisée dans
// conventions.service.ts (ex: "C1-E1" désignait déjà le salaire de base),
// pour ne rien casser côté _parseCategorieNum()/_getSalaireMinFromCategories().
// ============================================================================

import type { ConventionRule } from './conventions.service';

/** categories[catégorie 1-10][échelon] = salaire de base FCFA (2025) */
export const COMMERCE_SALARY_GRID: Record<number, number[]> = {
  1: [71000, 72139, 73278, 74417, 75556],
  2: [76695, 78037, 79379, 80720, 82061],
  3: [81169, 82475, 83781, 85085, 86391],
  4: [87697, 91934, 96171, 100409, 104645],
  5: [105939, 109342, 112746, 116149, 118978],
  6: [122956, 126647, 130338, 134029, 137720],
  7: [141411, 149081, 156751, 164420, 172090],
  8: [173250, 174636, 176022, 177366, 178794],
  9: [180180], // catégorie sans échelon
  10: [222915], // catégorie sans échelon
};

export function getCommerceBaseSalary(categorie: number, echelonIndex = 1): number {
  const row = COMMERCE_SALARY_GRID[categorie];
  if (!row) return 0;
  const idx = Math.min(Math.max(echelonIndex, 1), row.length) - 1;
  return row[idx];
}

export function buildCommerceCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  const ECHELON_LABELS = ['Base', '1er éch.', '2ème éch.', '3ème éch.', '4ème éch.'];
  for (let cat = 1; cat <= 10; cat++) {
    const row = COMMERCE_SALARY_GRID[cat];
    row.forEach((minSalary, i) => {
      out.push({
        code: `C${cat}-E${i + 1}`,
        label: `Cat.${cat} ${ECHELON_LABELS[i]}`,
        minSalary,
      });
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art. 41 (remplace le barème 3%/7%/12% précédemment
// codé, qui ne correspondait à aucun palier du texte réel).
//
// Texte : "2% du salaire de base après 2 années de présence ; 1% du salaire
// de base à partir de la 3ème année de présence plafonné à 25% jusqu'à 29
// ans d'ancienneté ; 30% à partir de la 30ème année d'ancienneté."
//
// → année 2 : 2% ; +1%/an à partir de l'année 3, plafond 25% (atteint à
//   l'année 25, reste flat jusqu'à l'année 29) ; saut à 30% flat dès l'année 30.
// ============================================================================

export function buildCommerceAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];

  // Années 2 à 24 : progression 2%, 3%, 4%… jusqu'à 24% (formule 2 + (année-2))
  for (let year = 2; year <= 24; year++) {
    const percent = 2 + (year - 2);
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: percent,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${percent}% du salaire de base (Art.41) — ${year} ans complets`,
    });
  }

  // Années 25 à 29 : plafond à 25%
  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 25 à 29 ans",
    bonusPercentage: 25,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: 25 * 12,
    maxMonthsOfService: 29 * 12 + 11,
    description: '25% du salaire de base (Art.41) — plafond entre 25 et 29 ans',
  });

  // 30 ans et plus : saut à 30%, ouvert (pas de plafond mentionné au-delà)
  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 30 ans et plus",
    bonusPercentage: 30,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: 30 * 12,
    description: '30% du salaire de base (Art.41) — 30 ans et plus',
  });

  return rules;
}