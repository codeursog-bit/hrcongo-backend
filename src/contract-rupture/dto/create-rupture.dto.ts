// ============================================================================
// create-rupture.dto.ts — DTO complet pour tous les types de rupture
// Couche 3 : validation des données d'entrée
// ============================================================================

import { MigrationData, GratifData } from '../conventions/convention.interface';

// ─── Types de motif ──────────────────────────────────────────────────────────
export type MotifRupture =
  | 'LICENCIEMENT_MOTIF_PERSONNEL' // insuffisance, inaptitude
  | 'LICENCIEMENT_FAUTE_GRAVE' // vol, violence, abandon de poste
  | 'LICENCIEMENT_FAUTE_LOURDE' // intention de nuire, détournement
  | 'LICENCIEMENT_ECONOMIQUE' // compression, réorganisation
  | 'DEMISSION' // initiative salarié
  | 'RUPTURE_CONVENTIONNELLE' // accord mutuel
  | 'RETRAITE_EMPLOYEUR' // mise à la retraite par l'employeur
  | 'RETRAITE_SALARIE' // départ volontaire à la retraite
  | 'DECES' // décès du salarié
  | 'INVALIDITE' // inaptitude définitive après maladie
  | 'FIN_CDD' // fin normale CDD
  | 'RUPTURE_ANTICIPEE_CDD_EMPLOYEUR'
  | 'RUPTURE_ANTICIPEE_CDD_SALARIE';

// ─── Statut du préavis ───────────────────────────────────────────────────────
export type StatutPreavis =
  | 'EFFECTUE' // salarié travaille pendant tout le préavis
  | 'DISPENSE_EMPLOYEUR' // employeur dispense — il paie l'indemnité
  | 'REFUSE_SALARIE' // salarié refuse — il paie l'indemnité à l'employeur
  | 'NON_APPLICABLE'; // faute lourde/grave, démission femme allaitante, etc.

// ─── Catégorie de préavis (pour transport) ───────────────────────────────────
export type CategoriePrestaireTransport = 'execution' | 'maitrise' | 'cadre';

// ─── DTO principal ───────────────────────────────────────────────────────────
export interface CreateRuptureDto {
  // ── Identifiants ────────────────────────────────────────────────────────
  employeeId: string;
  entrepriseId: string;
  conventionCode: string; // 'COMMERCE' | 'INDUSTRIE' | etc.

  // ── Informations contractuelles ─────────────────────────────────────────
  dateEmbauche: Date;
  dateRupture: Date; // date de notification
  dateFinEffective: Date; // date de fin réelle (après préavis si effectué)
  typeContrat: 'CDI' | 'CDD';
  dateTermeCDD?: Date; // si CDD : date prévue du terme

  // ── Motif ────────────────────────────────────────────────────────────────
  motif: MotifRupture;
  motifDetail?: string; // précision libre (ex: "insuffisance professionnelle constatée le...")

  // ── Catégorie professionnelle ────────────────────────────────────────────
  categorie: number; // numéro de catégorie conventionnelle
  echelon?: number;
  categorieLabel?: string; // 'execution' | 'maitrise' | 'cadre' (transport, petrole)
  poste: string;

  // ── Salaire et rémunération ──────────────────────────────────────────────
  salaireBase: number; // salaire de base contractuel
  salaireActuel: number; // salaire brut actuel (fallback avg12)
  // Bulletins Konza — du plus récent au plus ancien
  bulletinsKonza: number[]; // brutTotal de chaque mois

  // ── Congés ──────────────────────────────────────────────────────────────
  congesPrisKonza: number; // jours de congés tracés dans Konza
  joursParAn?: number; // si convention prévoit plus que 26

  // ── Préavis ──────────────────────────────────────────────────────────────
  statutPreavis: StatutPreavis;
  dureePreavjours?: number; // override si durée négociée différente
  // Si rupture intervient pendant le congé (préavis doublé dans certaines conventions)
  rupturePendantConge?: boolean;

  // ── Jours travaillés dernier mois ────────────────────────────────────────
  joursTravaillesDernierMois: number;

  // ── Cas CDD rupture anticipée ────────────────────────────────────────────
  // Salaires restants jusqu'au terme (calculé externe ou saisi)
  salaireRestantsJusquTerme?: number;

  // ── Décès ────────────────────────────────────────────────────────────────
  nbEnfantsCharge?: number; // pour majoration Presse (+15j/enfant)

  // ── Données de migration (employés avant Konza) ──────────────────────────
  migrationData?: MigrationData;

  // ── Gratification (module externe — optionnel) ───────────────────────────
  gratifData?: GratifData;

  // ── Autres sommes dues ───────────────────────────────────────────────────
  autresSommes?: Array<{
    libelle: string;
    montant: number;
    imposable: boolean;
    cotisable: boolean;
  }>;

  // ── Fiscal ───────────────────────────────────────────────────────────────
  // Parts fiscales du salarié (quotient familial) — depuis le profil employé
  // 1 = célibataire sans enfant, 2 = marié ou 1 enfant, etc.
  nbParts?: number; // défaut 1 si non renseigné
  // Si true, certains champs calculés peuvent être overridés
  modeSaisieManuelle?: boolean;
  overrides?: {
    indemLicenciement?: number;
    indemPreavis?: number;
    indemConges?: number;
    gratifProrata?: number;
    avg12?: number;
  };

  // ── Informations administratives ─────────────────────────────────────────
  redacteurId: string;
  dateCreation?: Date;
  notes?: string;
}

// ─── Résultat du calcul ──────────────────────────────────────────────────────
export interface RuptureResult {
  // Données de base
  employeeId: string;
  conventionCode: string;
  motif: MotifRupture;
  dateRupture: Date;
  dateFinEffective: Date;

  // Ancienneté
  anciennete: {
    annees: number;
    mois: number;
    jours: number;
    totalMois: number;
    detail: string;
  };

  // Avg12
  avg12: {
    montant: number;
    source: string;
    moisKonza: number;
    moisFallback: number;
    detail: string;
  };

  // Composantes du STC
  composantes: {
    dernierSalairePro: { montant: number; detail: string };
    indemConges: { montant: number; detail: string; soldeJours: number };
    indemPreavis: {
      montant: number;
      detail: string;
      payeur: string;
      dureeJours: number;
    };
    indemLicenciement: { montant: number; detail: string };
    indemRetraite?: { montant: number; detail: string };
    indemDeces?: { montant: number; detail: string };
    gratifProrata: { montant: number; detail: string };
    autresSommes: Array<{ libelle: string; montant: number }>;
  };

  // Fiscalité
  fiscalite: {
    brutImposableITS: number;
    brutCotisableCNSS: number;
    its: number;
    cnss: number;
    exoLicenciement: number;
    detail: string;
  };

  // Totaux
  totaux: {
    brutTotal: number;
    totalRetenues: number;
    netAPayer: number;
  };

  // Alertes procédurales (non bloquantes — Konza conseille)
  alertes: RuptureAlerte[];

  // Checklist procédurale
  checklist: ChecklistItem[];

  // Données de migration
  donneesManquantes: string[];
}

// ─── Alertes ─────────────────────────────────────────────────────────────────
export type NiveauAlerte = 'INFO' | 'ATTENTION' | 'CRITIQUE';

export interface RuptureAlerte {
  niveau: NiveauAlerte;
  code: string;
  message: string;
  article?: string; // référence légale
}

// ─── Checklist procédurale ───────────────────────────────────────────────────
export type StatutEtape = 'A_FAIRE' | 'EN_COURS' | 'FAIT' | 'N_A';

export interface ChecklistItem {
  id: string;
  etape: string;
  description: string;
  statut: StatutEtape;
  dateEcheance?: Date;
  documentGenere?: string; // nom du document si applicable
  obligatoire: boolean;
  articleRef?: string;
}
