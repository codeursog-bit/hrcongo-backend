// ============================================================================
// convention.interface.ts — Contrat commun toutes conventions Congo
// Mis à jour avec tous les barèmes réels lus dans les conventions officielles
// ============================================================================

// ─── Format barème ───────────────────────────────────────────────────────────
// Trois formats existent selon la convention :
//   'POURCENTAGE'  → taux% × avg12 × années  (Commerce, Industrie, Pétrole, BTP, Pharmacie, Hôtellerie)
//   'MOIS_PAR_AN'  → N mois × avg12 × années  (Presse, NTIC)
//   'FORFAIT'      → montant forfaitaire par tranche (Transport)
export type FormatBareme = 'POURCENTAGE' | 'MOIS_PAR_AN' | 'FORFAIT';

export interface PalierLicenciement {
  anneeMin: number; // début tranche (inclus)
  anneeMax: number; // fin tranche (exclus — 999 = illimité)
  valeur: number; // taux (0.30) OU mois (1.5) OU montant forfait
}

export interface ConventionBaremeLicenciement {
  format: FormatBareme;
  seuilMoisAnciennete: number; // ancienneté min pour y avoir droit
  paliers: PalierLicenciement[];
  palierEconomique?: PalierLicenciement[]; // si taux éco différent du perso
  seuilMoisEconomique?: number; // ancienneté min licenc. éco (parfois < normal)
  baseCalcul: 'avg12' | 'base';
  exclusionsBase?: string[]; // ex BTP : exclut aussi les primes diverses
  fractionsMinJours: number; // 0=toutes, 30=≥30 jours, 31=≥1 mois
  plafondMois?: number; // ex Presse: 33 mois, NTIC: 36 mois
}

export interface ConventionBaremeRetraite {
  // Paliers fixes en mois de salaire
  paliers: Array<{
    anneeMin: number;
    anneeMax: number;
    moisSalaire: number;
    // Transport : montant varie par catégorie
    parCategorie?: Record<string, number>; // 'execution'|'maitrise'|'cadre' → mois
  }>;
  // NTIC : % du salaire annuel brut
  paliersPourcent?: Array<{
    anneeMin: number;
    anneeMax: number;
    pourcent: number; // ex: 0.10 = 10% du salaire annuel
  }>;
  baseCalcul: 'avg12' | 'base' | 'base_anciennete' | 'annuel';
  // Prime spéciale retraite forfaitaire (Transport)
  primeSpeciale?: Record<string, number>; // 'execution'|'maitrise'|'cadre' → FCFA
  // Bonus majoration (Hôtellerie : +1 mois tous les 2 ans après 20 ans)
  bonusMajoration?: {
    anneeDepart: number;
    moisParPeriode: number;
    periodeMois: number;
  };
}

export interface ConventionPreavis {
  // Durée par catégorie en jours calendaires (ou ouvrables pour BTP)
  dureeParCategorie: Record<number, number>;
  dureeDefaut: number;
  // BTP utilise des jours ouvrables (pas calendaires)
  uniteJours: 'calendaires' | 'ouvrables';
  // Cas particuliers : préavis doublé si rupture pendant congé
  doubleementSiRupturePendantConge: boolean;
  baseIndemCompensatrice: 'avg12'; // toujours avg12 (CT art. 86)
  // Heures de recherche d'emploi pendant préavis
  heuresRechercheEmploi:
    | { type: 'jours_semaine'; valeur: number }
    | { type: 'heures_jour'; valeur: number };
}

export interface ConventionConges {
  joursParAn: number; // 26 (CT art. 119) — peut varier par convention
  baseCalcul: 'avg12'; // toujours
}

export interface ConventionFiscalite {
  // ITS — barème progressif LF 2026 (art. 116 CGI)
  // Plus de taux flat — le service calcule le barème progressif
  indemLicenciementExonereITS: boolean; // true
  indemPreavisImposableITS: boolean; // true
  indemCongesImposableITS: boolean; // true
  indemGratificationImposable: boolean; // true
  // CNSS
  TAUX_CNSS_SALARIE: number; // 0.04 (4%) — textes en vigueur Congo
  indemLicenciementExonereCNSS: boolean; // true
  preavisAssietteCNSS: boolean; // true
  congesAssietteCNSS: boolean; // true
  dernierSalaireAssietteCNSS: boolean; // true
  gratificationAssietteCNSS: boolean; // true
}

export interface ConventionDecesConfig {
  ancienneteMinMois: number; // seuil pour l'indemnité décès
  // Soit = indemnité licenciement, soit montant progressif
  type: 'EGAL_LICENCIEMENT' | 'PROGRESSIF' | 'FORFAIT_PLUS_LICENCIEMENT';
  // Pour type PROGRESSIF : paliers en mois de salaire selon ancienneté
  paliers?: Array<{ anneeMin: number; anneeMax: number; moisSalaire: number }>;
  // Pour type FORFAIT_PLUS_LICENCIEMENT (Pétrole : 2 mois brut + indem lic.)
  moisForfait?: number;
  // Majoration par enfant à charge (Presse : +15 jours)
  majorationJoursParEnfant?: number;
}

export interface GrilleSalariale {
  categories: Record<number, Record<number, number>>;
}

// ─── Interface principale ────────────────────────────────────────────────────
export interface IConvention {
  code: string;
  nom: string;
  secteurs: string[];

  baremeLicenciement: ConventionBaremeLicenciement;
  baremeRetraite: ConventionBaremeRetraite;
  preavis: ConventionPreavis;
  conges: ConventionConges;
  fiscalite: ConventionFiscalite;
  decesConfig: ConventionDecesConfig;
  grilleSalariale: GrilleSalariale;

  getPreavisDays(categorie: number): number;
  getSalaireMinimum(categorie: number, echelon?: number): number;
  getCategorieFromPoste(poste: string): number | null;

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
    isEco?: boolean,
    salaireBase?: number,
    categorieLabel?: string,
  ): { montant: number; detail: string };

  calcIndemRetraite(
    yearsExact: number,
    avg12: number,
    categorieLabel?: string,
  ): { montant: number; detail: string };

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
    nbEnfantsCharge?: number,
  ): { montant: number; detail: string };
}

// ─── Données de migration (employés avant Konza) ─────────────────────────────
export interface MigrationData {
  // Salaires des mois manquants (du plus récent au plus ancien)
  salairesHistoriques?: Array<{
    mois: number;
    annee: number;
    brutTotal: number;
  }>;
  // Congés avant migration
  soldeCongesAMigration?: number; // solde restant à la date de migration
  congesPrisAvantKonza?: number; // ou jours déjà pris
  // Indemnités antérieures (multi-embauches compression)
  indemnitesAnterieures?: number;
}

// ─── Données gratification (module externe — optionnel) ──────────────────────
export interface GratifData {
  montantAnnuelBrut: number; // 13e mois complet calculé par le module gratif
  dejaPaye: boolean; // déjà versé cette année ?
  datePaiement?: Date;
  baseCalcul: number; // salaire de référence utilisé
}
