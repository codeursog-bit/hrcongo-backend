// ============================================================================
// 📁 src/conventions/banque-grille.ts
//
// Convention Collective des travailleurs des Banques, Assurances et
// Assureur-conseils (Congo, juin 2011, effet au 01/06/2011) — code "BANQUE".
//
// Annexe 2 "Grille de salaire" : la convention ne donne pas des francs mais
// des INDICES. Salaire de base minimum = indice × valeur du point d'indice.
// Procès-verbal du 07/06/2011 : le point passe de 700 à 805 FCFA (+15 %).
//
// Structure de la classification (Annexe 1 + Annexe 2) :
//   Catégories 3 à 9  : personnel de service / travailleurs (même barème pour
//                       le "personnel de service" et le "personnel des banques")
//                       cat.3-7 = 2 échelons, cat.8-9 = 5 échelons
//   Classes 1 à 5     : gradés (3 échelons)
//   Classes 6 à 10    : cadres (3 échelons)
//   Hors classe       : 5 échelons
//
// ⚠️ NUMÉROTATION INTERNE DES CODES — la convention a deux numérotations qui se
// chevauchent (catégorie 3 ET classe 3). Le reste de l'application déduit un
// numéro de catégorie depuis les chiffres du code (préavis, salaire min.,
// import Excel). Pour qu'une classe ne soit jamais confondue avec une
// catégorie de même chiffre, les CLASSES portent le numéro interne 10 + n :
//     Catégorie 3..9   → codes BA3-E1 … BA9-E5
//     Classe 1..10     → codes BA11-E1 … BA20-E3   (classe n = numéro 10 + n)
//     Hors classe      → codes BA21-E1 … BA21-E5
// Les libellés affichés restent ceux de la convention ("Classe 3 Éch.2").
//
// ⚠️ Import Excel : un "3" tout seul désigne la catégorie 3 ; pour une classe,
// utiliser le libellé exact ("Classe 3 Éch.1") ou le code.
//
// Source : texte OCR du PDF (indices simples, pas d'image fournie). Contrôle
// d'intégrité : +10 points par échelon dans les catégories 3 à 9, +15 points
// par échelon dans les classes et la hors classe, +45 points entre deux classes
// consécutives (échelon 1) — vérifié ligne par ligne, 0 écart.
// ============================================================================

import type { ConventionRule } from './conventions.service';

/** Valeur du point d'indice (FCFA) — PV du 07/06/2011 : 700 → 805. */
export const BANQUE_POINT_VALUE = 805;

export type BanqueKind = 'categorie' | 'classe' | 'hors-classe';
export type BanqueCollege = 'Exécution' | 'Maîtrise' | 'Cadre';

interface BanqueGridRow {
  kind: BanqueKind;
  /** Libellé de la convention : "3".."9", "1".."10", "HC" */
  key: string;
  /** Numéro interne utilisé dans le code (voir en-tête) */
  num: number;
  college: BanqueCollege | null; // null = hors classe
  /** Indices échelon 1..N (salaire = indice × BANQUE_POINT_VALUE) */
  indices: number[];
}

const cat = (n: number, college: BanqueCollege, indices: number[]): BanqueGridRow => ({
  kind: 'categorie', key: String(n), num: n, college, indices,
});
const classe = (n: number, college: BanqueCollege, indices: number[]): BanqueGridRow => ({
  kind: 'classe', key: String(n), num: 10 + n, college, indices,
});

export const BANQUE_GRID: BanqueGridRow[] = [
  // Catégories 3 à 9 — Annexe 2 A (service) et B (banques/assurances) : barème identique
  cat(3, 'Exécution', [95, 105]),
  cat(4, 'Exécution', [115, 125]),
  cat(5, 'Exécution', [135, 145]),
  cat(6, 'Exécution', [155, 165]),
  cat(7, 'Exécution', [175, 185]),
  cat(8, 'Maîtrise', [195, 205, 215, 225, 235]), // "Travailleurs de maîtrise" (Annexe 1)
  cat(9, 'Maîtrise', [245, 255, 265, 275, 285]),
  // Classes 1 à 5 : gradés
  classe(1, 'Maîtrise', [200, 215, 230]),
  classe(2, 'Maîtrise', [245, 260, 275]),
  classe(3, 'Maîtrise', [290, 305, 320]),
  classe(4, 'Maîtrise', [335, 350, 365]),
  classe(5, 'Maîtrise', [380, 395, 410]),
  // Classes 6 à 10 : cadres
  classe(6, 'Cadre', [425, 440, 455]),
  classe(7, 'Cadre', [470, 485, 500]),
  classe(8, 'Cadre', [515, 530, 545]),
  classe(9, 'Cadre', [560, 575, 590]),
  classe(10, 'Cadre', [605, 620, 635]),
  // Hors classe (hors catégorie) : 5 échelons
  { kind: 'hors-classe', key: 'HC', num: 21, college: null, indices: [650, 665, 680, 695, 710] },
];

/** Salaire de base minimum (FCFA) d'une ligne de la grille à un échelon donné. */
export function banqueSalaire(indice: number): number {
  return indice * BANQUE_POINT_VALUE;
}

/**
 * Génère catégories/échelons pour le picker de convention et le contrôle de
 * salaire minimum. Les libellés contiennent le mot du collège (Exécution /
 * Maîtrise / Cadre) ou "Hors classe" : reports.service.ts → classifyCsp() s'en
 * sert pour classer les effectifs.
 */
export function buildBanqueCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  for (const row of BANQUE_GRID) {
    row.indices.forEach((indice, i) => {
      const ech = i + 1;
      const label =
        row.kind === 'categorie'
          ? `Cat.${row.key} Éch.${ech} (${row.college})`
          : row.kind === 'classe'
            ? `Classe ${row.key} Éch.${ech} (${row.college})`
            : `Hors classe Éch.${ech}`;
      out.push({
        code: `BA${row.num}-E${ech}`,
        label,
        minSalary: banqueSalaire(indice),
      });
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art. 50 (fidèle au texte).
//
//   • 7 % du salaire de base minimum après 2 ans de présence
//   • +1 % par année de présence en sus, jusqu'à 15 ans de présence
//   • 2 % (par année) à partir de la 16e année
//   • total plafonné à 40 %
//
// → an 2 : 7 %, an 3 : 8 %, … an 15 : 20 %, an 16 : 22 %, … an 25 : 40 % (plafond).
//
// Lecture retenue pour "2 % à partir de la 16e année" : +2 points par année
// au-delà de 15 ans (le texte ne dit pas explicitement "par année", mais
// c'est la seule lecture qui progresse vers le plafond de 40 %).
// Le texte précise que la base est le salaire de base MINIMUM de la catégorie
// ou classe ; le moteur utilise le salaire de base de l'employé (BASE_SALARY).
// ─────────────────────────────────────────────────────────────────────────
export function banqueAnciennetePct(years: number): number {
  if (years < 2) return 0;
  const pct = years <= 15 ? years + 5 : 20 + 2 * (years - 15);
  return Math.min(40, pct);
}

export function buildBanqueAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [];
  const CAP_YEAR = 25; // 40 % atteint à 25 ans

  for (let year = 2; year < CAP_YEAR; year++) {
    const pct = banqueAnciennetePct(year);
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year}e année`,
      bonusPercentage: pct,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${pct}% du salaire de base (Art.50) — ${year} ans de présence`,
    });
  }

  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 25 ans et plus",
    bonusPercentage: 40,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: CAP_YEAR * 12,
    // palier ouvert : plafond de 40 % atteint, la prime reste due
    description: '40% du salaire de base (Art.50) — 25 ans et plus (plafond)',
  });

  return rules;
}

// ─────────────────────────────────────────────────────────────────────────
// ⚠️ Progression d'échelon (Art.37 "Avancement") — VOLONTAIREMENT NON ajoutée
// à echelon-progression.config.ts : l'avancement a lieu "sur appréciation de
// la commission d'avancement" (Art.38, "en fonction de leur performance"),
// donc décision de mérite, pas règle d'ancienneté automatique.
// À noter : dans le texte extrait, l'Art.37 dit "tous les mois" avec un "24"
// isolé juste après — probablement "tous les 24 mois" mal océrisé. À confirmer
// sur le PDF (sans effet sur le code : pas de suggestion automatique).
// ─────────────────────────────────────────────────────────────────────────