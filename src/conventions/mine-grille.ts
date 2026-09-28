// ============================================================================
// 📁 src/conventions/mine-grille.ts
//
// Convention Collective des Entreprises de Prospection, de Recherche et
// d'Exploitation Minières (Congo, signée à Pointe-Noire le 22/02/2013) —
// Annexe 2 "Grille salariale". Transcrit depuis une image nette du tableau
// signé (plus fiable que l'OCR du PDF, cf. petrole-grille.ts qui suit le
// même principe).
//
// Grille : 21 catégories (+ Hors Catégorie, non chiffrée — négociée
// individuellement) × jusqu'à 6 échelons.
// Étiquettes d'échelon (ligne "Echelons" du tableau, Annexe 2) :
//   Catégories 1-9   → E1 à E9  (collège Exécution, Art.68)
//   Catégories 10-14 → M1 à M5  (collège Maîtrise, Art.68)
//   Catégories 15-21 → C1 à C7  (collège Cadres, Art.68)
//   > 21 (HC)         → Hors Catégories, non chiffré dans la grille
//
// ⚠️ Les catégories 1, 2 et 3 (E1-E3) ne comptent que 3 échelons chiffrés
// dans le tableau source (cases 4-6 vides) — fidèle au texte, pas une
// donnée manquante. Toutes les autres catégories (4 à 21) vont jusqu'à
// l'échelon 6.
//
// La grille "fera l'objet d'une révision en commission mixte paritaire deux
// (2) ans après son dépôt au greffe du tribunal du travail de Pointe-Noire"
// (note de bas de tableau, Annexe 2) — barème initial 02/2013, à vérifier
// s'il existe un protocole de révision plus récent avant usage en paie.
// ============================================================================

import type { ConventionRule } from './conventions.service';

/** categories[catégorie 1-21][échelon 1..N, N variable] = salaire de base FCFA (Annexe 2, barème 02/2013) */
export const MINE_SALARY_GRID: Record<number, number[]> = {
  1: [68000, 74000, 79000], // E1
  2: [75000, 81000, 87000], // E2
  3: [83000, 89000, 96000], // E3
  4: [92000, 99000, 106000, 114000, 121000, 129000], // E4
  5: [106000, 114000, 122000, 131000, 139000, 148000], // E5
  6: [121000, 131000, 141000, 151000, 160000, 170000], // E6
  7: [140000, 151000, 162000, 173000, 184000, 195000], // E7
  8: [161000, 173000, 186000, 199000, 212000, 225000], // E8
  9: [185000, 199000, 214000, 229000, 244000, 258000], // E9
  10: [212000, 229000, 246000, 263000, 280000, 297000], // M1
  11: [244000, 264000, 283000, 303000, 322000, 342000], // M2
  12: [281000, 303000, 326000, 348000, 371000, 393000], // M3
  13: [337000, 364000, 391000, 418000, 445000, 472000], // M4
  14: [404000, 437000, 469000, 501000, 534000, 566000], // M5
  15: [485000, 524000, 563000, 602000, 641000, 679000], // C1
  16: [582000, 629000, 675000, 722000, 769000, 815000], // C2
  17: [699000, 755000, 811000, 866000, 922000, 978000], // C3
  18: [839000, 906000, 973000, 1040000, 1107000, 1174000], // C4
  19: [1048000, 1132000, 1216000, 1300000, 1384000, 1467000], // C5
  20: [1310000, 1415000, 1520000, 1625000, 1729000, 1834000], // C6
  21: [1638000, 1769000, 1900000, 2031000, 2162000, 2293000], // C7
};

/** Étiquette d'échelon du tableau (E1-E9 / M1-M5 / C1-C7), Annexe 2. */
export function mineEchelonLabel(categorie: number): string {
  if (categorie <= 9) return `E${categorie}`;
  if (categorie <= 14) return `M${categorie - 9}`;
  if (categorie <= 21) return `C${categorie - 14}`;
  return 'HC';
}

/** Collège d'une catégorie (Art.68 — Exécution 1-9, Maîtrise 10-14, Cadres 15-21). */
export function mineCollege(
  categorie: number,
): 'Exécution' | 'Maîtrise' | 'Cadre' {
  if (categorie <= 9) return 'Exécution';
  if (categorie <= 14) return 'Maîtrise';
  return 'Cadre';
}

/** Salaire de base pour une catégorie (1-21) et un échelon (index 1-6, borné à la longueur réelle de la ligne). */
export function getMineBaseSalary(
  categorie: number,
  echelonIndex = 1,
): number {
  const row = MINE_SALARY_GRID[categorie];
  if (!row) return 0;
  const idx = Math.min(Math.max(echelonIndex, 1), row.length) - 1;
  return row[idx];
}

/**
 * Génère les codes catégorie/échelon au format "Cat.X Éch.Y" déjà utilisé
 * ailleurs (Transport/Pétrole/Pharmacie...), pour peupler le picker de
 * convention côté front et le contrôle de salaire minimum.
 */
export function buildMineCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  for (let cat = 1; cat <= 21; cat++) {
    const row = MINE_SALARY_GRID[cat];
    row.forEach((minSalary, i) => {
      out.push({
        code: `MI${cat}-E${i + 1}`,
        label: `Cat.${cat} (${mineEchelonLabel(cat)}) Éch.${i + 1} (${mineCollege(cat)})`,
        minSalary,
      });
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art. 74 (fidèle au texte).
//
// Texte : "Une prime d'ancienneté concernant tous les salariés permanents
// est calculée et attribuée après deux (2) ans de présence effective, à
// raison de un pour cent (1%) du salaire de base par année de présence
// effective et jusqu'à la 30ème année."
//
// → formule linéaire simple : taux = 1% × nombre d'années de présence,
//   à partir de 2 ans complets (donc 2% à l'année 2, 3% à l'année 3, ...),
//   plafonnée à 30% à partir de la 30ème année (le taux n'augmente plus
//   au-delà, mais la prime continue de s'appliquer — rien dans le texte
//   n'indique qu'elle s'arrête).
//
// Représentée en paliers CollectiveAgreementRule mensuels explicites (même
// mécanisme que Transport/Pétrole/Industrie/BTP/Pharmacie) plutôt que
// Company.seniorityLinearConfig — pour rester cohérent avec le reste du
// registre de conventions, même si la formule ici est purement linéaire.
// ============================================================================

export function buildMineAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];
  const MAX_YEAR = 30;

  for (let year = 2; year < MAX_YEAR; year++) {
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: year, // 1%/an
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${year}% du salaire de base (Art.74) — ${year} ans de présence effective`,
    });
  }

  // Palier ouvert à partir de 30 ans (taux plafonné à 30%, prime toujours due).
  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 30 ans et plus",
    bonusPercentage: MAX_YEAR,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: MAX_YEAR * 12,
    // pas de maxMonthsOfService → palier ouvert jusqu'à fin de carrière
    description: `${MAX_YEAR}% du salaire de base (Art.74) — 30 ans et plus (taux plafonné)`,
  });

  return rules;
}

// ─────────────────────────────────────────────────────────────────────────
// ⚠️ Progression d'échelon (Art.27 "Avancement") — VOLONTAIREMENT NON
// ajoutée à echelon-progression.config.ts.
//
// Contrairement à Transport (Art.22 : montée automatique tous les 2 ans),
// le texte de cette convention dit explicitement (Art.26/Art.27) que le
// changement d'échelon/catégorie "n'est en aucun cas lié à l'ancienneté,
// elle n'est pas un droit acquis" et dépend d'un examen de mérite mené
// "tous les deux (2) ans" par la direction — donc pas une règle temporelle
// automatique qu'on peut suggérer de façon fiable. Laisser cette convention
// absente de ECHELON_PROGRESSION_BY_CONVENTION est le comportement sûr par
// défaut déjà documenté dans ce fichier de config.
// ============================================================================