// ============================================================================
// 📁 src/common/utils/echelon.util.ts
//
// Conversion échelon "lettre" (A, B, C… K — utilisé par la convention
// Transport et d'autres conventions à grille alphabétique) <-> index
// numérique (1-11) — le format que Employee.echelon stocke réellement
// (aligné sur le pattern déjà utilisé par Commerce/Industrie/Pharmacie,
// où echelon est un nombre en string : "1", "2"…).
//
// Ne PAS stocker la lettre en base : Employee.echelon reste numérique pour
// rester compatible avec ConventionsService._parseCategorieNum() et tout le
// reste du moteur qui fait Number(echelonStr). La lettre n'est qu'un
// affichage / label côté conventions à grille alphabétique.
// ============================================================================

export const ECHELON_LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
] as const;

export type EchelonLetter = (typeof ECHELON_LETTERS)[number];

/** Index numérique (1-11) → lettre ("A".."K"). Hors bornes → null. */
export function echelonIndexToLetter(index: number): EchelonLetter | null {
  if (index < 1 || index > ECHELON_LETTERS.length) return null;
  return ECHELON_LETTERS[index - 1];
}

/** Lettre ("A".."K", insensible à la casse) → index numérique (1-11). */
export function echelonLetterToIndex(letter: string): number | null {
  const idx = ECHELON_LETTERS.indexOf(
    letter?.toUpperCase().trim() as EchelonLetter,
  );
  return idx === -1 ? null : idx + 1;
}

/**
 * Lit Employee.echelon (stocké en string numérique, ex "3") et retourne
 * l'index numérique. Tolère aussi une lettre au cas où une saisie manuelle
 * l'aurait stockée ainsi. Défaut = 1 (échelon A) si vide/invalide.
 */
export function parseEchelonIndex(raw: string | null | undefined): number {
  if (!raw) return 1;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && asNumber >= 1) return Math.round(asNumber);
  const asLetter = echelonLetterToIndex(raw);
  return asLetter ?? 1;
}

/** Label lisible pour affichage/notifications, ex: "Éch. C (4 ans)". */
export function formatEchelonLabel(
  index: number,
  yearsForStep?: number,
): string {
  const letter = echelonIndexToLetter(index) ?? '?';
  return yearsForStep != null
    ? `Éch. ${letter} (${yearsForStep} ans)`
    : `Éch. ${letter}`;
}