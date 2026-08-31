// ============================================================================
// 📁 src/leaves/config/leave-seniority-conventions.ts
// ✅ Registre des barèmes "jours de congé supplémentaires liés à l'ancienneté"
//    par convention collective. Chaque entreprise choisit SA convention
//    (Company.leaveConventionKey) et décide si elle applique ce bonus ou non
//    (Company.appliesSeniorityLeaveBonus) — si non applicable, on ignore
//    purement et simplement (beaucoup d'entreprises n'accordent pas ce bonus,
//    ou leurs employés n'ont pas encore atteint le seuil).
//
// ⚠️ IMPORTANT — "GENERALE" reprend EXACTEMENT le barème déjà en production
//    dans getSeniorityExtraDays() (3/5/10/15/20 ans → 3/5/10/8/9 jours).
//    Non corrigé même si le palier 15 ans (8j) semble inférieur au palier
//    10 ans (10j) — possible erreur de saisie à l'origine, à confirmer avant
//    de toucher un calcul déjà utilisé en production.
// ============================================================================

export interface SeniorityBracket {
  minYears: number; // ancienneté minimale (en années) pour ce palier
  days: number; // jours ouvrables supplémentaires accordés à ce palier
}

export interface LeaveConventionDefinition {
  key: string;
  label: string;
  brackets: SeniorityBracket[]; // triés par minYears croissant
}

export const LEAVE_SENIORITY_CONVENTIONS: LeaveConventionDefinition[] = [
  {
    key: 'GENERALE',
    label:
      'Convention Collective Interprofessionnelle (barème actuel — inchangé)',
    brackets: [
      { minYears: 3, days: 3 },
      { minYears: 5, days: 5 },
      { minYears: 10, days: 10 },
      { minYears: 15, days: 8 },
      { minYears: 20, days: 9 },
    ],
  },
  {
    key: 'COMMERCE',
    label: 'Convention Collective du Commerce (Art.35)',
    brackets: [
      { minYears: 3, days: 3 },
      { minYears: 5, days: 5 },
      { minYears: 10, days: 6 },
      { minYears: 15, days: 8 },
      { minYears: 20, days: 9 }, // 🆕 palier manquant, ajouté (Art.35)
      { minYears: 25, days: 10 },
      { minYears: 30, days: 15 },
    ],
  },
  {
    key: 'TRANSPORT',
    label:
      'Convention Collective des Auxiliaires de Transport, Terminaux à Conteneurs et Assimilés (Art.51)',
    brackets: [
      { minYears: 3, days: 3 },
      { minYears: 5, days: 5 },
      { minYears: 10, days: 9 },
      { minYears: 15, days: 10 },
      { minYears: 20, days: 12 },
      { minYears: 25, days: 14 },
    ],
  },
  {
    key: 'PETROLE',
    label: 'Convention Collective des Entreprises de Services Pétroliers (Art.49)',
    brackets: [
      { minYears: 5, days: 4 },
      { minYears: 10, days: 7 },
      { minYears: 15, days: 10 },
      { minYears: 20, days: 12 },
      { minYears: 25, days: 14 },
      { minYears: 30, days: 16 },
    ],
  },
  {
    key: 'INDUSTRIE',
    label: "Convention Collective de l'Industrie et Métallurgie (Art.47)",
    brackets: [
      { minYears: 3, days: 2 },
      { minYears: 5, days: 4 },
      { minYears: 10, days: 5 },
      { minYears: 15, days: 7 },
      { minYears: 20, days: 8 },
      { minYears: 25, days: 10 },
    ],
  },
  {
    key: 'PHARMACIE',
    label: 'Convention Collective des Officines de Pharmacie (Art.29)',
    brackets: [
      { minYears: 3, days: 3 },
      { minYears: 5, days: 5 },
      { minYears: 10, days: 7 },
      { minYears: 15, days: 8 },
      { minYears: 20, days: 9 },
      { minYears: 25, days: 10 },
    ],
  },
  {
    key: 'BTP',
    label:
      'Convention Collective du Bâtiment, TP et Activités Connexes (Art.41)',
    // ✅ Vrai barème confirmé (le texte source a été fourni) — remplace le
    //    placeholder provisoire précédent (copie de COMMERCE).
    brackets: [
      { minYears: 2, days: 3 }, // premier palier à 2 ans, pas 3 — fidèle au texte
      { minYears: 5, days: 6 },
      { minYears: 10, days: 7 },
      { minYears: 15, days: 8 },
      { minYears: 20, days: 9 },
      { minYears: 25, days: 10 },
    ],
  },
];

export const DEFAULT_LEAVE_CONVENTION_KEY = 'GENERALE';

/** Jours supplémentaires pour une ancienneté donnée, selon la convention choisie. */
export function getSeniorityDaysForConvention(
  conventionKey: string | null | undefined,
  yearsOfService: number,
): number {
  const convention = LEAVE_SENIORITY_CONVENTIONS.find(
    (c) => c.key === (conventionKey || DEFAULT_LEAVE_CONVENTION_KEY),
  );
  if (!convention) return 0;

  let days = 0;
  for (const bracket of convention.brackets) {
    if (yearsOfService >= bracket.minYears) days = bracket.days;
  }
  return days;
}