// ============================================================================
// calcul.helper.ts — Couche 1 : fonctions de base pour tous les calculs
// Conformes CT Congo art. 86, 119, 122 + LF 2026 art. 116
// ============================================================================

import { MigrationData, GratifData } from '../conventions/convention.interface';
import { calculateMonthsWorkedInYear } from '../../common/months-worked.util';

// ─── Constantes légales ──────────────────────────────────────────────────────
export const TAUX_CNSS_SALARIE = 0.04; // 4% — textes en vigueur Congo
export const CONGES_JOURS_PAR_AN = 26; // CT art. 119
export const JOURS_MOIS_CALENDAIRES = 30; // base préavis
export const JOURS_MOIS_CONGES = 26; // base calcul journalier congés

// ─── ITS / IRPP — LF 2026 art. 116 avec quotient familial ───────────────────
//
// ARCHITECTURE :
// Le module rupture N'IMPLÉMENTE PAS son propre calcul ITS.
// Il délègue à calcITSAvecParts() qui suit exactement la même logique
// que le service IRPP/Payroll existant dans Konza.
//
// Si le service IRPP est injecté dans ContractRuptureService,
// remplacer l'appel à calcITSAvecParts() par irppService.calculer(...).
//
// Barème LF 2026 art. 116 — base annuelle par part :
//   ≤ 615 000 × 12 / nbParts : 1 200 FCFA fixe / part
//   Tranche 2 : 10%
//   Tranche 3 : 15%
//   Tranche 4 : 20%
//   > 5 000 000 / part : 30%

/**
 * Calcule l'ITS mensuel avec quotient familial (nbParts)
 * LF 2026 art. 116
 *
 * @param baseImposableMensuelle  base brute imposable du mois
 * @param nbParts                 nombre de parts fiscales du salarié (défaut 1)
 */
export function calcITSAvecParts(
  baseImposableMensuelle: number,
  nbParts: number = 1,
): number {
  if (baseImposableMensuelle <= 0) return 0;

  // 1. Base annuelle
  const baseAnnuelle = baseImposableMensuelle * 12;

  // 2. Quotient familial = base annuelle / nbParts
  const quotient = baseAnnuelle / Math.max(nbParts, 1);

  // 3. ITS annuel par part — barème progressif LF 2026
  const itsParPart = _itsBaremeAnnuel(quotient);

  // 4. ITS annuel total = ITS/part × nbParts
  const itsAnnuel = itsParPart * nbParts;

  // 5. ITS mensuel = ITS annuel / 12
  return Math.round(itsAnnuel / 12);
}

function _itsBaremeAnnuel(quotientAnnuel: number): number {
  // Barème sur base annuelle par part — LF 2026 art. 116
  const seuilFixe = 615_000 * 12; // 7 380 000 /an
  if (quotientAnnuel <= seuilFixe) return 1_200 * 12; // 14 400 /an

  let its = 1_200 * 12; // tranche 1 fixe
  const bornes = [1_500_000 * 12, 3_500_000 * 12, 5_000_000 * 12];
  const taux = [0.1, 0.15, 0.2];
  let precedent = seuilFixe;

  for (let i = 0; i < bornes.length; i++) {
    if (quotientAnnuel <= bornes[i]) {
      its += (quotientAnnuel - precedent) * taux[i];
      return Math.round(its);
    }
    its += (bornes[i] - precedent) * taux[i];
    precedent = bornes[i];
  }
  // > 5 000 000 × 12 par part → 30%
  its += (quotientAnnuel - 5_000_000 * 12) * 0.3;
  return Math.round(its);
}

/**
 * Alias sans parts — pour compatibilité et tests unitaires simples
 * Utilise 1 part (célibataire sans enfant)
 */
export function calcITSMensuel(baseImposable: number): number {
  return calcITSAvecParts(baseImposable, 1);
}

// ─── ANCIENNETÉ ──────────────────────────────────────────────────────────────

export interface AncienneteResult {
  totalMois: number;
  annees: number;
  moisRestant: number;
  joursRestant: number;
  detail: string;
}

/**
 * Calcule l'ancienneté exacte entre date d'embauche et date de fin
 */
export function calcAnciennete(
  dateEmbauche: Date,
  dateFin: Date,
): AncienneteResult {
  const d1 = new Date(dateEmbauche);
  const d2 = new Date(dateFin);

  let annees = d2.getFullYear() - d1.getFullYear();
  let mois = d2.getMonth() - d1.getMonth();
  let jours = d2.getDate() - d1.getDate();

  if (jours < 0) {
    mois--;
    const dernierMois = new Date(d2.getFullYear(), d2.getMonth(), 0);
    jours += dernierMois.getDate();
  }
  if (mois < 0) {
    annees--;
    mois += 12;
  }

  const totalMois = annees * 12 + mois;

  return {
    totalMois,
    annees,
    moisRestant: mois,
    joursRestant: jours,
    detail:
      `${annees} an${annees > 1 ? 's' : ''} ${mois > 0 ? mois + ' mois' : ''} ${jours > 0 ? jours + ' jours' : ''}`.trim(),
  };
}

/**
 * Convertit l'ancienneté en années décimales pour le barème
 * Tient compte du seuil de fractions (fractionsMinJours)
 *   0  → toutes les fractions comptent
 *   30 → fractions ≥ 30 jours comptent (Industrie, BTP, Hôtellerie, Pharmacie)
 *   31 → fractions ≥ 1 mois comptent (Commerce — ≥ 1 mois = ≥ 31j par convention)
 */
export function ancienneteEnAnneesPourBareme(
  anc: AncienneteResult,
  fractionsMinJours: number = 30,
): number {
  const fracsCompte =
    anc.moisRestant > 0 || anc.joursRestant >= fractionsMinJours;

  if (!fracsCompte) return anc.annees;

  // Prorata de la fraction en mois
  const fracMois = anc.moisRestant + anc.joursRestant / 30;
  return anc.annees + fracMois / 12;
}

// ─── AVG12 ───────────────────────────────────────────────────────────────────

export interface Avg12Result {
  montant: number;
  source: 'konza' | 'partiel' | 'fallback';
  moisKonza: number;
  moisFallback: number;
  detail: string;
}

/**
 * Calcule la moyenne des 12 derniers mois de salaire global
 * CT art. 86 + art. 122
 *
 * @param bulletinsKonza  tableau des bruts totaux dans Konza (du plus récent)
 * @param dateFin         date de fin du contrat
 * @param migrationData   données historiques saisies par le RH
 * @param salaireActuel   salaire brut actuel (fallback si données manquantes)
 */
export function calcAvg12(
  bulletinsKonza: number[],
  dateFin: Date,
  salaireActuel: number,
  migrationData?: MigrationData,
): Avg12Result {
  const moisNecessaires = 12;
  const bulletins12 = bulletinsKonza.slice(0, moisNecessaires);
  const moisKonza = bulletins12.length;
  const moisManquants = moisNecessaires - moisKonza;

  // Cas A — Konza a tout
  if (moisManquants <= 0) {
    const montant = Math.round(bulletins12.reduce((s, v) => s + v, 0) / 12);
    return {
      montant,
      source: 'konza',
      moisKonza: 12,
      moisFallback: 0,
      detail: `Moyenne 12 bulletins Konza : ${_fmt(montant)} FCFA`,
    };
  }

  // Cas B — données historiques saisies par le RH
  let totalHisto = 0;
  let moisHisto = 0;
  if (migrationData?.salairesHistoriques?.length) {
    const histo = migrationData.salairesHistoriques.slice(0, moisManquants);
    totalHisto = histo.reduce((s, m) => s + m.brutTotal, 0);
    moisHisto = histo.length;
  }

  const moisRestantsFallback = moisManquants - moisHisto;
  const totalFallback = moisRestantsFallback * salaireActuel;
  const totalKonza = bulletins12.reduce((s, v) => s + v, 0);
  const montant = Math.round((totalKonza + totalHisto + totalFallback) / 12);

  const source: Avg12Result['source'] =
    moisRestantsFallback > 0 ? 'fallback' : 'partiel';

  let detail = `${moisKonza} bulletins Konza`;
  if (moisHisto > 0) detail += ` + ${moisHisto} mois historiques saisis`;
  if (moisRestantsFallback > 0)
    detail += ` + ${moisRestantsFallback} mois estimés (salaire actuel)`;
  detail += ` → ${_fmt(montant)} FCFA`;

  return {
    montant,
    source,
    moisKonza,
    moisFallback: moisRestantsFallback,
    detail,
  };
}

// ─── SOLDE CONGÉS ────────────────────────────────────────────────────────────

export interface SoldeCongesResult {
  acquis: number;
  prisAvantKonza: number;
  prisKonza: number;
  solde: number;
  source: 'exact' | 'estime';
  detail: string;
}

/**
 * Calcule le solde de congés à la rupture
 * CT art. 119 — 26 jours ouvrables par an minimum
 *
 * @param dateEmbauche      date d'entrée dans l'entreprise
 * @param dateFin           date de fin du contrat
 * @param congesPrisKonza   jours posés et validés dans Konza
 * @param joursParAn        selon convention (défaut 26)
 * @param migrationData     données historiques RH
 */
export function calcSoldeConges(
  dateEmbauche: Date,
  dateFin: Date,
  congesPrisKonza: number,
  joursParAn: number = CONGES_JOURS_PAR_AN,
  migrationData?: MigrationData,
): SoldeCongesResult {
  // Ancienneté totale en mois
  const anc = calcAnciennete(dateEmbauche, dateFin);
  const moisEffectifs = anc.totalMois + (anc.joursRestant >= 15 ? 0.5 : 0);
  const acquis = Math.floor((moisEffectifs * joursParAn) / 12);

  // Congés pris avant Konza
  let prisAvantKonza = 0;
  let source: SoldeCongesResult['source'] = 'exact';

  if (migrationData?.congesPrisAvantKonza !== undefined) {
    prisAvantKonza = migrationData.congesPrisAvantKonza;
  } else if (migrationData?.soldeCongesAMigration !== undefined) {
    // RH a donné le solde à la migration — on déduit les acquis jusqu'à cette date
    const ancMigration = 0; // calculé séparément si besoin
    prisAvantKonza = Math.max(
      0,
      acquis - congesPrisKonza - migrationData.soldeCongesAMigration,
    );
  } else {
    // Pas de données → on part de 0 pris avant Konza (favorable au salarié)
    source = 'estime';
  }

  const solde = Math.max(0, acquis - prisAvantKonza - congesPrisKonza);

  return {
    acquis,
    prisAvantKonza,
    prisKonza: congesPrisKonza,
    solde,
    source,
    detail: `Acquis: ${acquis}j — Pris avant Konza: ${prisAvantKonza}j — Pris Konza: ${congesPrisKonza}j — Solde: ${solde}j${source === 'estime' ? ' (estimé)' : ''}`,
  };
}

// ─── INDEMNITÉ COMPENSATRICE DE CONGÉS ───────────────────────────────────────

/**
 * CT art. 120 + art. 122
 * Base journalière = avg12 / 26 (26 jours ouvrables par an)
 */
export function calcIndemConges(
  soldeJours: number,
  avg12: number,
): { montant: number; detail: string } {
  if (soldeJours <= 0)
    return { montant: 0, detail: 'Aucun congé à indemniser' };
  const tauxJournalier = Math.round(avg12 / JOURS_MOIS_CONGES);
  const montant = Math.round(soldeJours * tauxJournalier);
  return {
    montant,
    detail: `${soldeJours} j × (${_fmt(avg12)} / 26) = ${_fmt(montant)} FCFA`,
  };
}

// ─── DERNIER SALAIRE PRORATISÉ ───────────────────────────────────────────────

/**
 * Proratise le salaire du dernier mois partiel
 * Base : avg12 / 26 × jours travaillés
 * CT Congo + pratique : base /26 (jours ouvrables) pour toute indemnisation journalière
 */
export function calcDernierSalaireProrata(
  joursTravailles: number,
  avg12: number,
): { montant: number; detail: string } {
  if (joursTravailles <= 0 || joursTravailles >= 26)
    return { montant: avg12, detail: `Mois complet : ${_fmt(avg12)} FCFA` };
  const montant = Math.round((avg12 / JOURS_MOIS_CONGES) * joursTravailles);
  return {
    montant,
    detail: `${joursTravailles} j × (${_fmt(avg12)} / 26) = ${_fmt(montant)} FCFA`,
  };
}

// ─── PRÉAVIS ─────────────────────────────────────────────────────────────────

export type PayeurPreavis = 'EMPLOYEUR' | 'EMPLOYE' | 'AUCUN';

export interface IndemPreavisResult {
  montant: number;
  payeur: PayeurPreavis;
  dureeJours: number;
  detail: string;
}

/**
 * Calcule l'indemnité compensatrice de préavis
 * CT art. 41 — base = rémunération + avantages de toute nature
 *
 * @param avg12             salaire moyen 12 mois
 * @param dureeJours        durée conventionnelle du préavis en jours
 * @param noticeWorked      préavis effectué ?
 * @param payeur            EMPLOYEUR si dispensé, EMPLOYE si refus
 * @param unitJours         calendaires ou ouvrables (BTP)
 * @param double            si rupture pendant congé (certaines conventions)
 */
export function calcIndemPreavis(
  avg12: number,
  dureeJours: number,
  noticeWorked: boolean,
  payeur: PayeurPreavis,
  double: boolean = false,
): IndemPreavisResult {
  if (noticeWorked || payeur === 'AUCUN') {
    return {
      montant: 0,
      payeur: 'AUCUN',
      dureeJours,
      detail: 'Préavis effectué — aucune indemnité',
    };
  }

  const multiplicateur = double ? 2 : 1;
  const montant = Math.round(
    (avg12 / JOURS_MOIS_CALENDAIRES) * dureeJours * multiplicateur,
  );

  return {
    montant,
    payeur,
    dureeJours,
    detail: `(${_fmt(avg12)} / 30) × ${dureeJours}j${double ? ' × 2 (doublé)' : ''} = ${_fmt(montant)} FCFA — à charge ${payeur}`,
  };
}

// ─── GRATIFICATION PRORATA ───────────────────────────────────────────────────

/**
 * Proratise le 13e mois/gratification à la rupture
 * - Retourne 0 si module gratification non configuré
 * - Retourne 0 si déjà versé cette année
 * - Retourne 0 si faute grave ou lourde (pas de droit)
 * - Retourne 0 si ancienneté < 12 mois (condition standard)
 */
export function calcGratifProrata(
  ruptureDate: Date,
  hireDate: Date,
  gratifData?: GratifData,
  motif?: string,
  ancienneteMois: number = 12,
): { montant: number; detail: string } {
  // Faute grave ou lourde → pas de droit
  if (
    motif === 'LICENCIEMENT_FAUTE_GRAVE' ||
    motif === 'LICENCIEMENT_FAUTE_LOURDE'
  ) {
    return {
      montant: 0,
      detail: 'Faute grave/lourde : aucun droit à la gratification',
    };
  }

  if (!gratifData)
    return { montant: 0, detail: 'Module gratification non configuré' };
  if (gratifData.dejaPaye)
    return { montant: 0, detail: '13e mois déjà versé cette année' };

  // Ancienneté insuffisante (12 mois minimum standard)
  if (ancienneteMois < 12) {
    return {
      montant: 0,
      detail: `Ancienneté insuffisante pour le 13e mois (${ancienneteMois}m / 12m requis)`,
    };
  }

  // ✅ Mois travaillés dans l'année civile jusqu'à la rupture — même fonction
  // que celle utilisée en paie pour le prorata du 13e mois (src/common/
  // months-worked.util.ts), pour que rupture et paie normale donnent
  // toujours le même résultat. Un mois entamé = mois plein.
  // (L'ancien calcul `ruptureDate.getMonth() + 1` supposait toujours une
  // embauche avant le 1er janvier de l'année en cours — correct tant que le
  // seuil des 12 mois d'ancienneté ci-dessus tient, mais faux si ce seuil
  // change un jour ou pour une éventuelle gratification sans condition
  // d'ancienneté.)
  const moisTravailles = calculateMonthsWorkedInYear(
    hireDate,
    ruptureDate,
    ruptureDate.getFullYear(),
  );
  const montant = Math.round(
    (gratifData.montantAnnuelBrut * moisTravailles) / 12,
  );

  return {
    montant,
    detail: `13e mois prorata : ${_fmt(gratifData.montantAnnuelBrut)} × ${moisTravailles}/12 = ${_fmt(montant)} FCFA`,
  };
}

// ─── FISCALITÉ STC ───────────────────────────────────────────────────────────

export interface FiscaliteResult {
  brutImposableITS: number;
  brutCotisableCNSS: number;
  its: number;
  cnss: number;
  exoLicenciement: number; // part exonérée
  detail: string;
}

/**
 * Calcule ITS + CNSS sur le solde de tout compte
 * LF 2026 art. 116 (ITS progressif) + textes en vigueur CNSS
 *
 * Éléments imposables ITS  : dernier salaire, préavis, congés, gratif
 * Éléments cotisables CNSS : dernier salaire, préavis, congés, gratif
 * Exonéré ITS + CNSS       : indemnité de licenciement dans la limite du barème légal
 */
export function calcFiscaliteSTC(params: {
  dernierSalairePro: number;
  indemConges: number;
  indemPreavis: number;
  indemLicenciement: number;
  gratifProrata: number;
  autresSommes?: number;
  nbParts?: number; // parts fiscales du salarié — depuis le profil employé
}): FiscaliteResult {
  const {
    dernierSalairePro,
    indemConges,
    indemPreavis,
    indemLicenciement,
    gratifProrata,
    autresSommes = 0,
    nbParts = 1,
  } = params;

  // Base imposable ITS (hors indemnité légale de licenciement exonérée)
  const brutImposableITS =
    dernierSalairePro +
    indemConges +
    indemPreavis +
    gratifProrata +
    autresSommes;

  // Base cotisable CNSS (idem)
  const brutCotisableCNSS =
    dernierSalairePro +
    indemConges +
    indemPreavis +
    gratifProrata +
    autresSommes;

  // ITS avec quotient familial — même logique que le service IRPP de Konza
  const its = calcITSAvecParts(brutImposableITS, nbParts);
  const cnss = Math.round(brutCotisableCNSS * TAUX_CNSS_SALARIE);

  return {
    brutImposableITS,
    brutCotisableCNSS,
    its,
    cnss,
    exoLicenciement: indemLicenciement,
    detail: [
      `Base imposable ITS : ${_fmt(brutImposableITS)} FCFA (${nbParts} part${nbParts > 1 ? 's' : ''}) → ITS : ${_fmt(its)} FCFA`,
      `Base cotisable CNSS : ${_fmt(brutCotisableCNSS)} FCFA → CNSS : ${_fmt(cnss)} FCFA (4%)`,
      `Indemnité licenciement exonérée : ${_fmt(indemLicenciement)} FCFA`,
    ].join(' | '),
  };
}

// ─── Utilitaire formatage ─────────────────────────────────────────────────────
export function _fmt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}