// ============================================================================
// 📁 src/conventions/industrie-grille.ts
//
// Convention Collective de l'Industrie et Métallurgie (30/03/2010).
//
// ⚠️ GRILLE SALARIALE NON INCLUSE — voir explication ci-dessous. Ne pas
// déployer `buildIndustrieCategories()` en l'état pour de la vraie paie
// tant que la grille n'a pas été fournie proprement (photo nette, comme
// pour Pétrole) : elle retourne actuellement un tableau VIDE plutôt que des
// chiffres devinés.
//
// Le tableau "Annexe I - Grille des salaires" du document source était trop
// dégradé par l'OCR pour être transcrit sans risque d'erreur de paie :
// - Catégories 3, 4, 5 : 4 nombres (67088, 70507, 79107, 87383) apparaissent
//   dans un ordre visiblement mélangé par l'extraction — impossible de
//   savoir avec certitude lequel appartient à quelle catégorie/échelon.
// - Catégories 8 et 9 : le texte OCR confond les deux libellés ("8ème" lu
//   comme "gème" aux deux endroits) — ambiguïté sur laquelle des deux paires
//   de chiffres (140657/158301 vs 164337/173098) correspond à laquelle.
// - Catégories 1 et 2 : seulement 2 puis 1 valeur lisible sur les 3
//   échelons attendus — le reste manque purement et simplement.
// Contrairement à Pétrole (où une photo nette du même tableau a permis de
// tout corriger en quelques minutes), il n'y a pas encore d'image propre
// pour cette convention — à fournir avant de considérer cette grille comme
// fiable.
// ============================================================================

import type { ConventionRule } from './conventions.service';

/**
 * ⚠️ VIDE INTENTIONNELLEMENT — voir avertissement en haut de fichier.
 * Remplir une fois qu'une version lisible de l'Annexe I aura été fournie
 * (même format que Transport/Commerce/Pétrole : categories[cat][échelon]).
 */
export const INDUSTRIE_SALARY_GRID: Record<number, number[]> = {};

export function industrieCollege(categorie: number): 'Exécution' | 'Maîtrise' | 'Cadre' {
  // Art.17 (période d'essai) confirme ce découpage : catégories 1-7 =
  // ouvriers/employés, 8-9 = maîtrise, 10-11 = cadres.
  if (categorie <= 7) return 'Exécution';
  if (categorie <= 9) return 'Maîtrise';
  return 'Cadre';
}

export function getIndustrieBaseSalary(categorie: number, echelonIndex = 1): number {
  const row = INDUSTRIE_SALARY_GRID[categorie];
  if (!row) return 0; // grille non renseignée — voir avertissement
  const idx = Math.min(Math.max(echelonIndex, 1), row.length) - 1;
  return row[idx];
}

/** Retourne un tableau VIDE tant que INDUSTRIE_SALARY_GRID n'est pas rempli. */
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