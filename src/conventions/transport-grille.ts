// ============================================================================
// 📁 src/conventions/transport-grille.ts
//
// Données officielles de la Convention Collective des Auxiliaires de
// Transports, Terminaux à Conteneurs et Assimilés (Congo, signée 19/01/2024,
// effet rétroactif 01/01/2024) — Annexe 2 "Salaires de base".
//
// Grille : 15 catégories × 11 échelons (A à K, +2 ans par échelon, K = 0-20
// ans et plus, échelon plafond — Art.22).
// Collèges (Annexe 1 — Classification professionnelle) :
//   Exécution : catégories 1-7 | Maîtrise : catégories 8-11 | Cadre : 12-15
// ============================================================================

// Import de type uniquement (erasé à la compilation) — évite tout risque de
// dépendance circulaire runtime avec conventions.service.ts, qui importe ce
// fichier pour construire la grille Transport.
import type { ConventionRule } from './conventions.service';

/** categories[catégorie 1-15][échelon 1-11 (A=1..K=11)] = salaire de base FCFA */
export const TRANSPORT_SALARY_GRID: Record<number, number[]> = {
  1: [80895, 82108, 83340, 84590, 85436, 86290, 87153, 88025, 88905, 89794, 90692],
  2: [81836, 83064, 84310, 85574, 86430, 87294, 88167, 89049, 89940, 90839, 91747],
  3: [84446, 85713, 86998, 88303, 89186, 90078, 90979, 91889, 92808, 93736, 94673],
  4: [91089, 92455, 93842, 95250, 96202, 97164, 98136, 99117, 100108, 101110, 102121],
  5: [95837, 97274, 98733, 100214, 101217, 102229, 103251, 104283, 105326, 106380, 107443],
  6: [114014, 115724, 117460, 119222, 120414, 121618, 122834, 124062, 125303, 126556, 127822],
  7: [116370, 118116, 119887, 121686, 122902, 124131, 125373, 126626, 127893, 129172, 130463],
  8: [125605, 127489, 129401, 131342, 132656, 133982, 135322, 136675, 138042, 139423, 140817],
  9: [136915, 138969, 141053, 143169, 144601, 146047, 147507, 148982, 150472, 151977, 153497],
  10: [176743, 179394, 182085, 184816, 186664, 188531, 190416, 192320, 194244, 196186, 198148],
  11: [182820, 185563, 188346, 191171, 193083, 195014, 196964, 198934, 200923, 202932, 204961],
  12: [182899, 185643, 188427, 191254, 193166, 195098, 197049, 199019, 201010, 203020, 205050],
  13: [189707, 192553, 195441, 198373, 200356, 202360, 204383, 206427, 208491, 210576, 212682],
  14: [196990, 199944, 202944, 205988, 208048, 210128, 212229, 214352, 216495, 218660, 220847],
  15: [261507, 265430, 269411, 273452, 276187, 278949, 281738, 284556, 287401, 290275, 293178],
};

/** Collège d'une catégorie (Annexe 1). */
export function transportCollege(
  categorie: number,
): 'Exécution' | 'Maîtrise' | 'Cadre' {
  if (categorie <= 7) return 'Exécution';
  if (categorie <= 11) return 'Maîtrise';
  return 'Cadre';
}

/** Salaire de base pour une catégorie (1-15) et un échelon (index 1-11, A=1..K=11). */
export function getTransportBaseSalary(
  categorie: number,
  echelonIndex = 1,
): number {
  const row = TRANSPORT_SALARY_GRID[categorie];
  if (!row) return 0;
  const idx = Math.min(Math.max(echelonIndex, 1), row.length) - 1;
  return row[idx];
}

/**
 * Génère les codes catégorie/échelon au format déjà utilisé ailleurs dans
 * ConventionsService ("Cat.X Éch.Y" — Pharmacie/Commerce/Industrie), pour
 * remplacer les 10 placeholders `minSalary: 0` actuels dans conventions.service.ts.
 * Échelon exposé en index numérique 1-11 (voir common/utils/echelon.util.ts
 * pour la conversion en lettre A-K côté affichage).
 */
export function buildTransportCategories(): {
  code: string;
  label: string;
  minSalary: number;
}[] {
  const out: { code: string; label: string; minSalary: number }[] = [];
  for (let cat = 1; cat <= 15; cat++) {
    const row = TRANSPORT_SALARY_GRID[cat];
    for (let e = 1; e <= row.length; e++) {
      out.push({
        code: `T${cat}-E${e}`,
        label: `Cat.${cat} Éch.${e} (${transportCollege(cat)})`,
        minSalary: row[e - 1],
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prime d'ancienneté — Art. 58 (fidèle au texte, pas la règle générique
// "3% après 24 mois" qui était utilisée par erreur).
//
// Texte : "5% du début de la 3ème à la fin de la 4ème année ; 2% par année
// de présence en plus au taux ci-dessus du début de la 5ème année jusqu'à
// la fin de la carrière."
// → années 2-3 complètes : 5% plat
// → à partir de 4 ans complets (début 5e année) : +2%/an, sans plafond
//
// Représenté en paliers CollectiveAgreementRule mensuels explicites (le
// même mécanisme déjà utilisé pour BTP/Industrie/Pharmacie) plutôt que
// Company.seniorityLinearConfig, car ce dernier est purement linéaire dès
// startYear — il ne peut pas représenter le plateau à 5% des années 2-3
// avant que l'incrément ne démarre à l'année 4.
//
// Bornée à 40 ans de présence (2400 mois) — au-delà, le dernier palier
// reste ouvert (maxMonthsOfService: null) et continue de s'appliquer.
// ============================================================================

export function buildTransportAncienneteRules(): ConventionRule[] {
  const rules: ConventionRule[] = [
    {
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: "Prime d'ancienneté — 3e-4e année",
      bonusPercentage: 5,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: 24, // début 3e année (2 ans complets)
      maxMonthsOfService: 47, // fin 4e année (avant 4 ans complets)
      description: '5% du salaire de base (Art.58) — 3e et 4e année',
    },
  ];

  // À partir de 4 ans complets (48 mois = début 5e année) : 5% + 2%/an.
  // Un palier annuel par tranche de 12 mois jusqu'à 40 ans, dernier ouvert.
  const MAX_YEARS = 40;
  for (let year = 4; year < MAX_YEARS; year++) {
    const percent = 5 + 2 * (year - 3); // année 4 → 7%, année 5 → 9%, ...
    rules.push({
      ruleType: 'AUTOMATIC_BONUS',
      bonusType: `Prime d'ancienneté — ${year + 1}e année`,
      bonusPercentage: percent,
      bonusBaseCalculation: 'BASE_SALARY',
      minMonthsOfService: year * 12,
      maxMonthsOfService: year * 12 + 11,
      description: `${percent}% du salaire de base (Art.58) — ${year} ans complets`,
    });
  }
  // Dernier palier ouvert (40 ans et plus) — pas de plafond dans le texte.
  const lastPercent = 5 + 2 * (MAX_YEARS - 3);
  rules.push({
    ruleType: 'AUTOMATIC_BONUS',
    bonusType: "Prime d'ancienneté — 40 ans et plus",
    bonusPercentage: lastPercent,
    bonusBaseCalculation: 'BASE_SALARY',
    minMonthsOfService: MAX_YEARS * 12,
    // pas de maxMonthsOfService → palier ouvert, s'applique jusqu'à la fin de carrière
    description: `${lastPercent}% du salaire de base (Art.58) — 40 ans et plus`,
  });

  return rules;
}