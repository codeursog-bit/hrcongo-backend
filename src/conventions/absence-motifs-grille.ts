// ============================================================================
// 📁 src/conventions/absence-motifs-grille.ts
// ✅ Table de référence "Permissions exceptionnelles (événements familiaux)"
//    par convention collective — sert UNIQUEMENT à préremplir le catalogue
//    de motifs d'une entreprise (AbsenceMotif) au clic sur "Importer depuis
//    la convention". Une fois importées, les lignes sont des données
//    normales de l'entreprise, modifiables librement — cette table n'est
//    jamais lue en dehors de l'import.
//
// Où une case du tableau d'origine était "—" (non prévu par la convention),
// le motif est simplement absent des rows de ce secteur. Où plusieurs motifs
// partageaient la même ligne/valeur dans la convention (ex: Pétrole —
// "décès conjoint OU enfant" = 6 jours), on ne crée qu'UNE ligne dont le
// libellé couvre les deux cas, plutôt que deux lignes avec la même valeur —
// pour rester fidèle au texte de la convention (c'est UN seul droit, pas
// deux droits cumulables).
// ============================================================================

export type GrilleSubType =
  | 'MARIAGE' | 'DECES' | 'NAISSANCE' | 'RETRAIT_DEUIL' | 'DEMENAGEMENT' | 'AUTRE';

export interface AbsenceMotifGrilleRow {
  label: string;
  subType: GrilleSubType;
  days: number;
}

export interface AbsenceMotifGrille {
  annualCeiling: number;
  rows: AbsenceMotifGrilleRow[];
}

/** Identifiant stable et calculable pour une ligne (pas de clé étrangère,
 *  juste un slug du libellé) — sert à référencer un choix côté frontend
 *  sans avoir besoin d'une table en base. */
export function slugifyMotifLabel(label: string): string {
  return label
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const ABSENCE_MOTIFS_GRILLE: Record<string, AbsenceMotifGrille> = {
  TRANSPORT: {
    annualCeiling: 16,
    rows: [
      { label: 'Mariage du travailleur', subType: 'MARIAGE', days: 7 },
      { label: "Mariage d'un enfant", subType: 'MARIAGE', days: 3 },
      { label: 'Mariage frère/sœur', subType: 'MARIAGE', days: 3 },
      { label: 'Décès du conjoint(e)', subType: 'DECES', days: 10 },
      { label: "Décès d'un enfant", subType: 'DECES', days: 4 },
      { label: 'Décès père/mère (ascendant)', subType: 'DECES', days: 4 },
      { label: "Naissance d'un enfant", subType: 'NAISSANCE', days: 4 },
      { label: "Baptême d'un enfant", subType: 'AUTRE', days: 1 },
      { label: 'Circoncision', subType: 'AUTRE', days: 1 },
      { label: 'Retrait de deuil', subType: 'RETRAIT_DEUIL', days: 2 },
      { label: 'Construction pierre tombale', subType: 'AUTRE', days: 2 },
      { label: 'Déménagement', subType: 'DEMENAGEMENT', days: 3 },
    ],
  },
  COMMERCE: {
    annualCeiling: 10,
    rows: [
      { label: 'Mariage du travailleur', subType: 'MARIAGE', days: 4 },
      { label: "Mariage d'un enfant", subType: 'MARIAGE', days: 4 },
      { label: 'Mariage frère/sœur', subType: 'MARIAGE', days: 3 },
      { label: "Décès du conjoint(e) ou d'un enfant", subType: 'DECES', days: 10 },
      { label: 'Décès père/mère (ascendant)', subType: 'DECES', days: 3 },
      { label: 'Décès frère/sœur', subType: 'DECES', days: 3 },
      { label: "Accouchement de l'épouse", subType: 'NAISSANCE', days: 2 },
      { label: 'Déménagement', subType: 'DEMENAGEMENT', days: 1 },
    ],
  },
  PETROLE: {
    annualCeiling: 22,
    rows: [
      { label: 'Mariage du travailleur', subType: 'MARIAGE', days: 4 },
      { label: "Mariage d'un enfant", subType: 'MARIAGE', days: 2 },
      { label: 'Mariage frère/sœur', subType: 'MARIAGE', days: 2 },
      { label: "Décès du conjoint(e) légitime ou d'un enfant", subType: 'DECES', days: 6 },
      { label: "Décès d'un frère/sœur ou d'un ascendant (père/mère)", subType: 'DECES', days: 5 },
      { label: "Accouchement de l'épouse", subType: 'NAISSANCE', days: 3 },
      { label: 'Retrait de deuil (conjoint, frère/sœur, descendant ou ascendant)', subType: 'RETRAIT_DEUIL', days: 2 },
    ],
  },
  INDUSTRIE: {
    annualCeiling: 15,
    rows: [
      { label: 'Mariage du travailleur', subType: 'MARIAGE', days: 4 },
      { label: "Mariage d'un enfant", subType: 'MARIAGE', days: 2 },
      { label: 'Mariage frère/sœur', subType: 'MARIAGE', days: 1 },
      { label: 'Décès du conjoint(e)', subType: 'DECES', days: 7 },
      { label: "Décès d'un enfant, du père ou de la mère", subType: 'DECES', days: 4 },
      { label: 'Décès frère/sœur', subType: 'DECES', days: 2 },
      { label: "Accouchement de l'épouse", subType: 'NAISSANCE', days: 2 },
      { label: 'Déménagement', subType: 'DEMENAGEMENT', days: 2 },
    ],
  },
  PHARMACIE: {
    annualCeiling: 10,
    rows: [
      { label: 'Mariage du travailleur', subType: 'MARIAGE', days: 3 },
      { label: "Mariage d'un enfant", subType: 'MARIAGE', days: 2 },
      { label: 'Décès du conjoint(e)', subType: 'DECES', days: 10 },
      { label: "Décès d'un descendant direct ou d'un ascendant (père/mère)", subType: 'DECES', days: 4 },
      { label: "Naissance d'un enfant", subType: 'NAISSANCE', days: 2 },
      { label: "Baptême d'un enfant", subType: 'AUTRE', days: 1 },
      { label: 'Retrait de deuil', subType: 'RETRAIT_DEUIL', days: 2 },
      { label: 'Déménagement', subType: 'DEMENAGEMENT', days: 2 },
    ],
  },
  BTP: {
    annualCeiling: 15,
    rows: [
      { label: 'Mariage du travailleur', subType: 'MARIAGE', days: 4 },
      { label: "Mariage d'un enfant", subType: 'MARIAGE', days: 3 },
      { label: 'Décès du conjoint(e)', subType: 'DECES', days: 7 },
      { label: "Décès d'un enfant", subType: 'DECES', days: 4 },
      { label: 'Décès père/mère (ascendant)', subType: 'DECES', days: 6 },
      { label: "Accouchement de l'épouse", subType: 'NAISSANCE', days: 4 },
      { label: 'Déménagement', subType: 'DEMENAGEMENT', days: 2 },
    ],
  },
};

/** Catalogue calculé pour une entreprise — chaque ligne porte un `key`
 *  stable (slug du libellé) que le frontend renvoie tel quel au moment de
 *  la demande. Retourne un tableau vide si aucune convention/grille. */
export function getMotifsForCompany(collectiveAgreement: string | null | undefined) {
  const grille = collectiveAgreement ? ABSENCE_MOTIFS_GRILLE[collectiveAgreement] : null;
  if (!grille) return [];
  return grille.rows.map((r) => ({ key: slugifyMotifLabel(r.label), ...r }));
}

/** Retrouve une ligne précise par sa clé, pour la convention de l'entreprise. */
export function findMotifByKey(collectiveAgreement: string | null | undefined, key: string) {
  return getMotifsForCompany(collectiveAgreement).find((r) => r.key === key) ?? null;
}

/** Plafond annuel de la convention de l'entreprise, ou null si aucune grille. */
export function getAnnualCeiling(collectiveAgreement: string | null | undefined): number | null {
  const grille = collectiveAgreement ? ABSENCE_MOTIFS_GRILLE[collectiveAgreement] : null;
  return grille?.annualCeiling ?? null;
}