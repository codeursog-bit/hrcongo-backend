// ============================================================================
// 📁 src/common/months-worked.util.ts
//
// Calcule le nombre de mois travaillés par un employé dans une année civile,
// selon la règle "un mois entamé compte comme un mois plein" (pas de prorata
// au jour près).
//
// Utilisé pour :
//   - le 13e mois / prime de fin d'année (prorata si embauche en cours d'année)
//   - plus tard : la rupture de contrat (prorata du 13e mois à la date de
//     rupture, cf. contract-rupture module — même fonction, juste une
//     referenceDate différente : la date de rupture au lieu du 31/12)
// ============================================================================

/**
 * Nombre de mois travaillés dans l'année `year`, entre la date d'embauche
 * (ou le 1er janvier si l'embauche est antérieure) et `referenceDate`
 * (ou le 31 décembre si `referenceDate` dépasse l'année).
 *
 * Règle métier (cf. usages Congo) : un mois entamé = un mois plein.
 * Ex: embauché le 25 mars → mars compte comme un mois entier.
 *
 * @param hireDate      Date d'embauche de l'employé
 * @param referenceDate Date de référence pour le calcul (fin d'année pour le
 *                       13e mois classique ; date de rupture de contrat le
 *                       cas échéant)
 * @param year           Année civile sur laquelle on calcule le prorata
 * @returns Nombre de mois travaillés, entre 0 et 12
 */
export function calculateMonthsWorkedInYear(
  hireDate: Date | string,
  referenceDate: Date | string,
  year: number,
): number {
  const hire = new Date(hireDate);
  const ref = new Date(referenceDate);

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const effectiveStart = hire > yearStart ? hire : yearStart;
  const effectiveEnd = ref < yearEnd ? ref : yearEnd;

  if (effectiveStart > effectiveEnd) return 0;

  // "Mois entamé = mois plein" → on compte le nombre de mois calendaires
  // distincts touchés, pas les jours.
  const startMonthIndex =
    effectiveStart.getFullYear() * 12 + effectiveStart.getMonth();
  const endMonthIndex =
    effectiveEnd.getFullYear() * 12 + effectiveEnd.getMonth();

  return Math.min(12, Math.max(0, endMonthIndex - startMonthIndex + 1));
}