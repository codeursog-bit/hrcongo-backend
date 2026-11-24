// ============================================================================
// 📁 src/conventions/btp-grille.ts
//
// Convention Collective du Bâtiment, des Travaux Publics et Activités
// Connexes (08/08/1992) — Annexe "Barème des salaires", datée du
// 01/12/1990 (antérieure même à la signature de la convention — c'est la
// seule grille fournie dans le document).
//
// ⚠️ CETTE GRILLE A 35 ANS. Les montants (ex: Manœuvre Ordinaire ≈ 42 466
// FCFA/mois) sont très en dessous du SMIG actuel (70 400 FCFA, décret
// 2024-2762). Conformément à la règle produit validée : cette grille n'est
// qu'une SUGGESTION de départ, jamais un plancher imposé — l'admin modifie
// librement le salaire de base de chaque employé sans que ça ne touche à
// son classement catégorie/échelon. Aucun blocage, aucune valeur plancher
// appliquée ici.
//
// PARTICULARITÉ : cette convention a DEUX filières de classification
// distinctes, pas une seule échelle numérique comme les autres conventions
// déjà traitées :
//   - "Ouvrier" : 10 niveaux nommés (Manœuvre Ordinaire → O. Hautement
//     Qualifié), payés à l'heure (converti ici en équivalent mensuel sur la
//     base de 173,33h/mois, comme indiqué dans le barème).
//   - "Employé" (+ encadrement) : 11 catégories numérotées avec échelons,
//     payées au mois — catégories 9 à 11 correspondent à l'encadrement
//     (Chef de chantier, Conducteur de travaux, Ingénieur — Annexe 3).
// ============================================================================

import type { ConventionRule } from './conventions.service';

/** Filière "Ouvrier" — payée à l'heure, convertie en équivalent mensuel (173,33h) */
export const BTP_OUVRIER_GRID: { code: string; label: string; hourlyRate: number; monthlyEquivalent: number }[] = [
  { code: 'O1', label: 'Manœuvre Ordinaire', hourlyRate: 245, monthlyEquivalent: 42466 },
  { code: 'O2', label: 'Manœuvre Bâtiment', hourlyRate: 250, monthlyEquivalent: 43333 },
  { code: 'O3', label: 'Manœuvre Spécialisé', hourlyRate: 255, monthlyEquivalent: 44199 },
  { code: 'O4', label: 'Ouvrier Spécialisé — éch.1', hourlyRate: 270, monthlyEquivalent: 46799 },
  { code: 'O5', label: 'Ouvrier Spécialisé — éch.2', hourlyRate: 280, monthlyEquivalent: 48532 },
  { code: 'O6', label: 'Ouvrier Spécialisé — éch.3', hourlyRate: 295, monthlyEquivalent: 51132 },
  { code: 'O7', label: 'Ouvrier Professionnel — éch.1', hourlyRate: 300, monthlyEquivalent: 51999 },
  { code: 'O8', label: 'Ouvrier Professionnel — éch.2', hourlyRate: 315, monthlyEquivalent: 54599 },
  { code: 'O9', label: 'Ouvrier Qualifié', hourlyRate: 350, monthlyEquivalent: 60666 },
  { code: 'O10', label: 'Ouvrier Hautement Qualifié', hourlyRate: 415, monthlyEquivalent: 71932 },
];

/** Filière "Employé" (+ encadrement cat.9-11) — categories[1-11][échelon] = salaire mensuel FCFA */
export const BTP_EMPLOYE_GRID: Record<number, number[]> = {
  1: [42500, 43500],
  2: [45750],
  3: [47250, 49750],
  4: [51750],
  5: [61750],
  6: [69000],
  7: [78000],
  8: [92000],
  9: [112250, 122250, 132500],
  10: [147750, 162500, 177500],
  11: [207750, 228000],
};

/** Année de référence de cette grille — à afficher à côté du montant suggéré côté UI. */
export const BTP_GRID_YEAR = 1990;

export function btpEmployeCollege(categorie: number): 'Exécution' | 'Maîtrise' | 'Cadre' {
  if (categorie <= 8) return 'Exécution';
  return 'Cadre'; // catégories 9-11 = encadrement (Chef de chantier → Ingénieur, Annexe 3)
}

/** Salaire suggéré (filière Employé) — jamais un plancher imposé. */
export function getBtpEmployeBaseSalary(categorie: number, echelonIndex = 1): number {
  const row = BTP_EMPLOYE_GRID[categorie];
  if (!row) return 0;
  const idx = Math.min(Math.max(echelonIndex, 1), row.length) - 1;
  return row[idx];
}

/** Salaire suggéré (filière Ouvrier), par code de niveau (O1..O10). */
export function getBtpOuvrierBaseSalary(code: string): number {
  return BTP_OUVRIER_GRID.find(o => o.code === code)?.monthlyEquivalent ?? 0;
}

export function buildBtpCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];

  // Filière Ouvrier
  for (const level of BTP_OUVRIER_GRID) {
    out.push({
      code: level.code,
      label: `${level.label} (Ouvrier, ${level.hourlyRate} FCFA/h) — grille ${BTP_GRID_YEAR}`,
      minSalary: level.monthlyEquivalent,
    });
  }

  // Filière Employé + encadrement
  for (let cat = 1; cat <= 11; cat++) {
    const row = BTP_EMPLOYE_GRID[cat];
    row.forEach((minSalary, i) => {
      out.push({
        code: `E${cat}-E${i + 1}`,
        label: `Cat.${cat} Éch.${i + 1} (${btpEmployeCollege(cat)}) — grille ${BTP_GRID_YEAR}`,
        minSalary,
      });
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art.51.
// "2% après 2 ans ; 1% par année à partir de la 3ème année avec un maximum
// de 28%."
// → année 2 : 2% ; +1%/an de l'année 3 à l'année 28 (28%, plafond, reste
//   flat au-delà — pas de second palier comme Commerce/Pétrole/Pharmacie).
// ============================================================================

export function buildBtpAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];

  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 2e année",
    bonusPercentage: 2,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: 24,
    maxMonthsOfService: 35,
    description: "2% du salaire minimum de l'échelon (Art.51) — 2 ans de présence",
  });

  for (let year = 3; year <= 28; year++) {
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: year,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year < 28 ? year * 12 + 11 : undefined,
      description: `${year}% du salaire minimum de l'échelon (Art.51) — ${year} ans complets${year === 28 ? ' (plafond)' : ''}`,
    });
  }

  return rules;
}