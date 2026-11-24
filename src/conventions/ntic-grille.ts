// ============================================================================
// 📁 src/conventions/ntic-grille.ts
//
// Convention Collective des Entreprises de Télécommunication et des
// Technologies Associées en République du Congo (signée à Brazzaville le
// 10/07/2003) — code interne "NTIC" (remplace l'ancien placeholder NTIC aux
// catégories N1-N11 et à 0 FCFA partout, qui ne correspondait pas au texte).
//
// Annexe 2 "Grille salariale" : 13 catégories + 2 sous-catégories (9D et
// 11D, Art.98), 10 échelons chacune, salaire brut mensuel en FCFA.
//
//   Collège Exécution (Ouvriers/Employés) : catégories 1 à 8
//   Collège Maîtrise                      : catégories 9D, 9, 10
//   Collège Cadres                        : catégories 11D, 11, 12
//   Hors classification                   : catégorie 13 (échelon 1 chiffré à
//                                           1 162 367 ; échelons 2 à 10 = "HC",
//                                           non chiffrés, négociés de gré à gré)
//
// Source de la transcription : texte OCR du PDF, puis relecture ligne par
// ligne contre l'image de l'Annexe 2 (page 81) : 14 lignes × 10 échelons
// identiques. Contrôle d'intégrité : dans le barème d'origine chaque échelon
// = échelon précédent × 1,05 (arrondi), 0 écart sur les 14 lignes.
//
// ⚠️ Barème de 2003, sans clause de révision automatique dans le texte :
// à vérifier s'il existe un avenant salarial plus récent avant usage en paie.
// ============================================================================

import type { ConventionRule } from './conventions.service';

export type NticCollege = 'Exécution' | 'Maîtrise' | 'Cadre';

interface NticGridRow {
  /** Libellé de catégorie tel qu'écrit dans la convention ("9D" = sous-catégorie) */
  key: string;
  college: NticCollege;
  /** Salaire brut mensuel FCFA, échelons 1 à 10 */
  salaries: number[];
}

// ⚠️ Ordre volontaire : la catégorie principale (9, 11) AVANT sa sous-catégorie
// (9D, 11D). Deux mécanismes existants résolvent "catégorie 9 échelon 1" au
// premier code qui correspond (import Excel + repli numérique de
// ConventionsService) — avec 9D en premier, un simple "9" tomberait sur le
// salaire de 9D (plus bas). La sous-catégorie reste sélectionnable
// exactement par son code (NT9D-E1…).
export const NTIC_GRID: NticGridRow[] = [
  { key: '1', college: 'Exécution', salaries: [104916, 110162, 115670, 121453, 127526, 133902, 140597, 147627, 155009, 162759] },
  { key: '2', college: 'Exécution', salaries: [125719, 132005, 138605, 145535, 152812, 160452, 168475, 176899, 185744, 195031] },
  { key: '3', college: 'Exécution', salaries: [143257, 150420, 157941, 165838, 174129, 182836, 191978, 201577, 211655, 222238] },
  { key: '4', college: 'Exécution', salaries: [177953, 186851, 196193, 206003, 216303, 227118, 238474, 250398, 262918, 276063] },
  { key: '5', college: 'Exécution', salaries: [200914, 210960, 221508, 232583, 244213, 256423, 269244, 282707, 296842, 311684] },
  { key: '6', college: 'Exécution', salaries: [234123, 245829, 258120, 271026, 284578, 298806, 313747, 329434, 345906, 363201] },
  { key: '7', college: 'Exécution', salaries: [269823, 283314, 297480, 312354, 327971, 344370, 361588, 379668, 398651, 418584] },
  { key: '8', college: 'Exécution', salaries: [322327, 338443, 355365, 373134, 391790, 411380, 431949, 453546, 476224, 500035] },
  { key: '9', college: 'Maîtrise', salaries: [380388, 399407, 419377, 440346, 462364, 485482, 509756, 535244, 562006, 590106] },
  { key: '9D', college: 'Maîtrise', salaries: [346500, 363825, 382016, 401117, 421173, 442232, 464343, 487560, 511938, 537535] },
  { key: '10', college: 'Maîtrise', salaries: [454857, 477600, 501480, 526554, 552881, 580525, 609552, 640029, 672031, 705632] },
  { key: '11', college: 'Cadre', salaries: [608325, 638741, 670678, 704212, 739423, 776394, 815213, 855974, 898773, 943712] },
  { key: '11D', college: 'Cadre', salaries: [521688, 547773, 575161, 603919, 634115, 665821, 699112, 734068, 770771, 809310] },
  { key: '12', college: 'Cadre', salaries: [912476, 958100, 1006005, 1056305, 1109121, 1164577, 1222805, 1283946, 1348143, 1415550] },
];

/** Catégorie 13 (hors classification) — seul échelon chiffré de la grille. */
export const NTIC_CAT13_ECH1 = 1162367;

/**
 * Génère les catégories/échelons pour le picker de convention et le contrôle
 * de salaire minimum. Codes : "NT9-E3", "NT9D-E3", "NT11D-E1"… — les chiffres
 * restent lisibles par ConventionsService._parseCategorieNum (9D → 9, 11D → 11,
 * même préavis que leur catégorie principale).
 *
 * Le libellé contient volontairement le mot du collège (Exécution / Maîtrise /
 * Cadre / Hors classification) : reports.service.ts → classifyCsp() s'en sert
 * pour classer les effectifs.
 */
export function buildNticCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  for (const row of NTIC_GRID) {
    row.salaries.forEach((minSalary, i) => {
      out.push({
        code: `NT${row.key}-E${i + 1}`,
        label: `Cat.${row.key} Éch.${i + 1} (${row.college})`,
        minSalary,
      });
    });
  }
  // Catégorie 13 — Hors classification (Annexe 2, image p.81) : seul l'échelon 1
  // est chiffré (1 162 367 FCFA) ; les échelons 2 à 10 portent la mention "HC"
  // et sont négociés de gré à gré (Art.98 / Annexe 2).
  out.push({
    code: 'NT13-E1',
    label: 'Cat.13 Éch.1 (Hors classification)',
    minSalary: NTIC_CAT13_ECH1,
  });
  // Échelons 2 à 10 ("HC") : aucun montant dans la grille → aucun minimum
  // contrôlé (0 = contrôle de conformité ignoré).
  out.push({
    code: 'NT13-HC',
    label: 'Cat.13 Éch.2-10 HC (Hors classification)',
    minSalary: 0,
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art. 64 (fidèle au texte).
//
// Texte : "2% du salaire de base après deux (2) années de présence ; 1% du
// salaire de base en sus, par année de service au delà de la 2ème année avec
// un maximum de 25%."
//
// → 2% à 2 ans, 3% à 3 ans, … , +1% par année, plafonné à 25% (atteint à
//   25 ans de présence). Le taux ne monte plus au-delà, mais la prime reste
//   due (rien dans le texte ne la supprime).
//
// (L'ancien placeholder "3% après 24 mois" ne correspondait pas au texte.)
// ─────────────────────────────────────────────────────────────────────────
export function buildNticAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];
  const MAX_YEAR = 25; // plafond 25 %

  for (let year = 2; year < MAX_YEAR; year++) {
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: year,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${year}% du salaire de base (Art.64) — ${year} ans de présence`,
    });
  }

  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 25 ans et plus",
    bonusPercentage: MAX_YEAR,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: MAX_YEAR * 12,
    // pas de maxMonthsOfService → palier ouvert jusqu'à fin de carrière
    description: `${MAX_YEAR}% du salaire de base (Art.64) — 25 ans et plus (taux plafonné)`,
  });

  return rules;
}

// ─────────────────────────────────────────────────────────────────────────
// ⚠️ Progression d'échelon (Art.34 "Avancement") — VOLONTAIREMENT NON ajoutée
// à echelon-progression.config.ts.
//
// Le texte prévoit que l'avancement est "envisagé par l'employeur une fois
// tous les deux (2) ans" mais "obtenu à la suite d'une évaluation de
// performances" en commission paritaire d'avancement : décision de mérite,
// pas une règle d'ancienneté automatique (contrairement à Transport).
// Une convention absente de ECHELON_PROGRESSION_BY_CONVENTION = aucune
// suggestion générée, comportement sûr par défaut.
// ─────────────────────────────────────────────────────────────────────────