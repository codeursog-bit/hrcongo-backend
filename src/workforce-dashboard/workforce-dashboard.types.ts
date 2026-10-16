// ============================================================================
// 📁 src/workforce-dashboard/workforce-dashboard.types.ts
// Types partagés : calcul (app + Excel), export ORCA et export POWERMAN.
// ============================================================================

export type WorkforceModel = 'ORCA' | 'POWERMAN';
export type PeriodMode = 'MOIS' | 'PLAGE' | 'ANNEE';

export type ContractGroup = 'PERMANENT' | 'EXPATRIE' | 'STAGIAIRE' | 'PRESTATAIRE';

/** Une ligne employé, déjà "à plat" (aucune règle métier dans les builders). */
export interface WfEmployee {
  id: string;
  companyId: string;
  companyName: string;
  matricule: string;
  lastName: string;
  firstName: string;
  fullName: string; // "NOM Prénom"
  position: string;
  department: string;
  contractType: string; // CDI | CDD | STAGE | CONSULTANT | INTERIM | PRESTATAIRE
  contractGroup: ContractGroup; // modèle ORCA
  contractLabelOrca: string;
  contractLabelPowerman: string;
  gender: 'M' | 'F' | 'O';
  genderLabel: string; // Masculin | Féminin | Autre
  nationalityLabel: string; // "Congolaise" pour les nationaux, sinon libellé canonique
  isNational: boolean;
  maritalLabel: string;
  children: number;
  phone: string;
  cnss: string;
  birthDate: Date | null;
  originCity: string;
  hireDate: Date; // date seule (UTC minuit)
  exitDate: Date | null;
  csp: string; // CADRES | AGENT DE MAITRISE | EXECUTANT | NON CLASSÉ
  grade: string; // catégorie/échelon brut
  /** clé "AAAA-MM" → net payé du mois (uniquement si l'utilisateur a le droit) */
  netByMonth: Record<string, number>;
}

export interface WfMonth {
  month: number; // 1-12
  year: number;
  label: string; // "SEPTEMBRE 2026"
  short: string; // "SEPT 26"
  eom: Date; // dernier jour du mois (UTC minuit)
  bom: Date; // premier jour du mois (UTC minuit)
  key: string; // "2026-09"
}

export interface WfPeriod {
  mode: PeriodMode;
  months: WfMonth[]; // au moins 1, ordre chronologique
  label: string; // "SEPTEMBRE 2026" | "JANVIER → OCTOBRE 2026"
  first: WfMonth;
  last: WfMonth;
}

export interface CountRow {
  label: string;
  count: number;
}

export interface AgeBucket {
  label: string;
  lo: number;
  hi: number;
  M: number;
  F: number;
}

export interface WfIndicators {
  hasAttendance: boolean; // false = pas de synthèse de présence pour ce mois (valeurs d'absence à 0)
  absenceDays: number; // jours d'absence (payée + non payée)
  theoreticalDays: number; // jours à travailler (présent + télétravail + absences)
  absenceCount: number; // nombre de salariés ayant au moins 1 jour d'absence
  absenteeismRate: number; // 0..1
  avgAbsenceDuration: number; // jours par salarié absent
  presenceRate: number; // 0..1
  departuresYtd: number; // départs de l'année civile jusqu'à fin du mois
  avgHeadcountYtd: number; // effectif moyen (fins de mois de janvier au mois courant)
  turnover: number; // départs / effectif moyen
}

export interface WfSnapshot {
  month: WfMonth;
  total: number;
  gender: { M: number; F: number; O: number };
  contract: { PERMANENT: number; EXPATRIE: number; STAGIAIRE: number; PRESTATAIRE: number };
  nationality: { nat: number; etr: number; natM: number; natF: number; etrM: number; etrF: number };
  functions: CountRow[]; // trié décroissant
  departments: CountRow[];
  csp: CountRow[];
  contractPowerman: CountRow[];
  cities: CountRow[];
  ageBuckets: AgeBucket[];
  hires: number;
  departures: number;
  indicators: WfIndicators;
}

export interface WfScope {
  companyIds: string[];
  companyName: string; // nom de l'entreprise, ou libellé du portefeuille
  city: string; // ville de l'entreprise (ou "" si plusieurs)
  multi: boolean;
  logo?: Buffer | null; // logo (une seule entreprise)
  logoExt?: 'png' | 'jpeg';
}

/** Tout ce qu'il faut pour dessiner l'écran ET générer l'Excel. */
export interface WorkforceDashboardData {
  model: WorkforceModel;
  scope: WfScope;
  period: WfPeriod;
  employees: WfEmployee[]; // tous ceux présents au moins un jour de la période
  snapshots: WfSnapshot[]; // un par mois de la période
  canSeeNet: boolean;
  generatedAt: Date;
  /** Points d'attention (ex. salariés sortis sans date de sortie, exclus du calcul). */
  warnings: string[];
}

/** Version allégée pour l'écran (pas de liste d'employés, pas de Buffer). */
export interface WorkforceDashboardView {
  model: WorkforceModel;
  companyName: string;
  city: string;
  multi: boolean;
  companies: { id: string; name: string }[];
  canSeeNet: boolean;
  warnings: string[];
  period: {
    mode: PeriodMode;
    label: string;
    months: { month: number; year: number; label: string; short: string }[];
  };
  current: Omit<WfSnapshot, 'month'> & { month: { month: number; year: number; label: string; short: string } };
  evolution: {
    month: number;
    year: number;
    label: string;
    short: string;
    total: number;
    M: number;
    F: number;
    hires: number;
    departures: number;
  }[];
}