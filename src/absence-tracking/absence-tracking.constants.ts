// ============================================================================
// 📁 src/absence-tracking/absence-tracking.constants.ts
// ✅ Table de correspondance UNIQUE pour le module "Traçabilité des absences"
//    Regroupe les deux sources existantes (Leave + AbsenceRequest) sous une
//    même taxonomie de codes, utilisée par la grille calendrier, le tableau
//    de bord, les alertes RH et le journal. Ne modifie rien dans /leaves ni
//    dans /absence-requests — lecture seule, recodage uniquement.
//
// 🔧 REFONTE — objectif traçabilité fine (vs. l'ancienne version qui
//    fusionnait Maladie/Maternité/Paternité sous un seul code "CV") :
//    - Congé annuel / anticipé (CP/CA) = DROIT du salarié après 12 mois de
//      travail. Ce n'est pas un sujet RH à surveiller : affiché pour le
//      contexte, mais exclu du taux d'absentéisme et des alertes.
//    - Conventionnelle (maladie, maternité, paternité) et Exceptionnelle
//      (mariage, décès, naissance) = chaque sous-motif a désormais SON
//      PROPRE code, pour pouvoir répondre à "qui a le plus de maladie ?",
//      "quel département est le plus touché par la maternité ?", etc.
//    - `trackable` marque les catégories qui entrent dans le taux
//      d'absentéisme et le système d'alertes (tout sauf CP/CA/JF/présence).
// ============================================================================

export type AbsenceSource = 'LEAVE' | 'ABSENCE_REQUEST' | 'ATTENDANCE' | 'PUBLIC_HOLIDAY';

/** Filtre de périmètre — 'leave' sert à la page dédiée "congés uniquement" */
export type AbsenceScope = 'all' | 'leave' | 'absence_request';

export function sourceAllowedForScope(source: AbsenceSource, scope: AbsenceScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'leave') return source === 'LEAVE';
  if (scope === 'absence_request') return source === 'ABSENCE_REQUEST' || source === 'ATTENDANCE';
  return true;
}

/**
 * Famille RH — regroupement de haut niveau utilisé pour les vues "vue
 * d'ensemble" (donut par famille) alors que `code` reste le niveau fin
 * (donut par motif précis).
 * - CONGE_STATUTAIRE : droit acquis (congé annuel / anticipé) — pas un
 *   sujet de suivi RH, juste un repère de contexte.
 * - CONVENTIONNELLE : maladie, maternité, paternité — santé du salarié.
 * - EXCEPTIONNELLE : mariage, décès, naissance, autre événement familial.
 * - INJUSTIFIEE : absence non couverte par une demande approuvée.
 * - FERIE / PRESENCE : jamais comptées comme absence, usage calendrier only.
 */
export type AbsenceFamily =
  | 'CONGE_STATUTAIRE'
  | 'CONVENTIONNELLE'
  | 'EXCEPTIONNELLE'
  | 'INJUSTIFIEE'
  | 'FERIE'
  | 'PRESENCE';

export interface AbsenceCodeDef {
  code: string;          // code court affiché dans la grille (ex: "MAL")
  label: string;         // libellé complet (ex: "Maladie")
  family: AbsenceFamily;
  colorKey: string;       // clé de couleur logique — le FRONT décide la couleur réelle
  countsAsAbsenceDay: boolean; // exclut JF des totaux "jours d'absence"
  isPaidByDefault: boolean;    // ⚠️ déduit du type — pas un champ de paie réel (AbsenceRequest.isPaid prime)
  /**
   * true = ce motif entre dans le taux d'absentéisme, les classements
   * "top employé/département" et les alertes RH. false = affiché pour le
   * contexte uniquement (droit acquis, présence, férié).
   */
  trackable: boolean;
}

// 👉 Le "colorKey" n'est PAS une couleur — c'est un identifiant sémantique
//    que le front mappe vers sa propre palette (design system Konza RH).
export const ABSENCE_CODES: Record<string, AbsenceCodeDef> = {
  // ---- Congé statutaire — droit acquis, hors suivi RH ------------------
  CP: {
    code: 'CP', label: 'Congé annuel', family: 'CONGE_STATUTAIRE',
    colorKey: 'success', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: false,
  },
  CA: {
    code: 'CA', label: 'Congé anticipé', family: 'CONGE_STATUTAIRE',
    colorKey: 'success-light', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: false,
  },
  // ⚠️ CPT ≠ CP. Le salarié est officiellement en congé annuel/anticipé (son
  // indemnité de congé est déjà versée) mais un pointage réel existe ce
  // jour-là (source ATTENDANCE) : il a choisi de venir travailler plutôt que
  // de se reposer. On ne l'affiche donc jamais "Présent" ce jour-là (son
  // congé court toujours), mais pas non plus "Congé annuel" classique (il
  // n'était pas au repos) — d'où ce 3e code distinct. Résolu automatiquement
  // par recoupement Leave × pointage dans getUnifiedEntries, jamais saisi
  // manuellement. Compte comme une présence (pas une absence) dans les
  // totaux : c'est juste l'étiquette qui doit rester honnête.
  CPT: {
    code: 'CPT', label: 'Congé payé (travaillé)', family: 'PRESENCE',
    colorKey: 'teal', countsAsAbsenceDay: false, isPaidByDefault: true, trackable: false,
  },
  // ⚠️ CSS n'est PAS un droit acquis comme CP/CA : l'employé le choisit
  // volontairement (convenance personnelle), sans lien avec la santé ou un
  // événement familial. Trackable = un usage fréquent est un signal RH
  // (désengagement, difficultés perso récurrentes) — à distinguer d'une
  // absence Conventionnelle/Exceptionnelle non payée (AbsenceRequest avec
  // isPaid=false), qui elle a une cause réelle (maladie, décès...) mais où
  // la RH a choisi de ne pas payer. Même impact sur la paie, mais raison
  // RH totalement différente : on ne les mélange jamais.
  CSS: {
    code: 'CSS', label: 'Congé sans solde', family: 'CONGE_STATUTAIRE',
    colorKey: 'neutral', countsAsAbsenceDay: true, isPaidByDefault: false, trackable: true,
  },

  // ---- Conventionnelle — santé du salarié, à tracer finement ------------
  MAL: {
    code: 'MAL', label: 'Maladie', family: 'CONVENTIONNELLE',
    colorKey: 'purple', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },
  MAT: {
    code: 'MAT', label: 'Maternité', family: 'CONVENTIONNELLE',
    colorKey: 'pink', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },
  PAT: {
    code: 'PAT', label: 'Paternité', family: 'CONVENTIONNELLE',
    colorKey: 'indigo', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },
  CONV_AUTRE: {
    code: 'CONV_AUTRE', label: 'Conventionnelle — autre', family: 'CONVENTIONNELLE',
    colorKey: 'violet', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },

  // ---- Exceptionnelle — événement familial, à tracer finement -----------
  MAR: {
    code: 'MAR', label: 'Mariage', family: 'EXCEPTIONNELLE',
    colorKey: 'amber', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },
  DEC: {
    code: 'DEC', label: 'Décès', family: 'EXCEPTIONNELLE',
    colorKey: 'slate-dark', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },
  NAI: {
    code: 'NAI', label: 'Naissance', family: 'EXCEPTIONNELLE',
    colorKey: 'sky', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },
  EXC_AUTRE: {
    code: 'EXC_AUTRE', label: 'Exceptionnelle — autre', family: 'EXCEPTIONNELLE',
    colorKey: 'orange', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  },

  // ---- Injustifiée --------------------------------------------------------
  ABS: {
    code: 'ABS', label: 'Absence non justifiée', family: 'INJUSTIFIEE',
    colorKey: 'rose', countsAsAbsenceDay: true, isPaidByDefault: false, trackable: true,
  },

  // ---- Hors suivi (contexte calendrier uniquement) -----------------------
  JF: {
    code: 'JF', label: 'Jour férié', family: 'FERIE',
    colorKey: 'holiday', countsAsAbsenceDay: false, isPaidByDefault: true, trackable: false,
  },
  PRESENT: {
    code: 'PRESENT', label: 'Présent', family: 'PRESENCE',
    colorKey: 'presence', countsAsAbsenceDay: false, isPaidByDefault: true, trackable: false,
  },
  REMOTE: {
    code: 'REMOTE', label: 'Télétravail', family: 'PRESENCE',
    colorKey: 'remote', countsAsAbsenceDay: false, isPaidByDefault: true, trackable: false,
  },
  LATE: {
    code: 'LATE', label: 'Retard', family: 'PRESENCE',
    colorKey: 'late', countsAsAbsenceDay: false, isPaidByDefault: true, trackable: false,
  },
};

export const FAMILY_LABELS: Record<AbsenceFamily, string> = {
  CONGE_STATUTAIRE: 'Congé statutaire',
  CONVENTIONNELLE: 'Conventionnelle',
  EXCEPTIONNELLE: 'Exceptionnelle',
  INJUSTIFIEE: 'Non justifiée',
  FERIE: 'Jour férié',
  PRESENCE: 'Présence',
};

/** Attendance.status (présence) -> code unifié — affichage calendrier uniquement */
export const PRESENCE_STATUS_TO_CODE: Record<string, string> = {
  PRESENT: 'PRESENT',
  REMOTE: 'REMOTE',
  LATE: 'LATE',
};

/** Attendance.status -> code unifié (source: pointage, calculé par le cron existant) */
export const ATTENDANCE_STATUS_TO_CODE: Record<string, string> = {
  ABSENT_UNPAID: 'ABS',
};

/**
 * Résout un Leave.type vers notre code unifié fin.
 * Filet de sécurité par mots-clés si l'enum backend est renommé.
 */
export function resolveLeaveEntry(type: string): { code: string; subLabel?: string } {
  const exact: Record<string, { code: string }> = {
    ANNUAL: { code: 'CP' },
    ANNUAL_ANTICIPATED: { code: 'CA' },
    UNPAID: { code: 'CSS' },
    MATERNITY: { code: 'MAT' },
    PATERNITY: { code: 'PAT' },
    SICK: { code: 'MAL' },
    COMPENSATORY: { code: 'CA' },
  };
  if (exact[type]) return exact[type];

  const t = type.toUpperCase();
  if (t.includes('ANTICIPATED')) return { code: 'CA' };
  if (t.includes('MATERNITY')) return { code: 'MAT' };
  if (t.includes('PATERNITY')) return { code: 'PAT' };
  if (t.includes('UNPAID')) return { code: 'CSS' };
  if (t.includes('SICK')) return { code: 'MAL' };
  if (t.includes('ANNUAL')) return { code: 'CP' };
  return { code: type }; // dernier recours — au moins visible tel quel
}

/**
 * Résout un AbsenceRequest (type + subType) vers notre code unifié fin.
 * Chaque sous-motif garde désormais son propre code — plus de fusion.
 */
export function resolveAbsenceRequestCode(type: string, subType?: string | null): { code: string; subLabel?: string } {
  if (type === 'CONVENTIONNELLE') {
    const map: Record<string, string> = { MALADIE: 'MAL', MATERNITE: 'MAT', PATERNITE: 'PAT' };
    return { code: subType && map[subType] ? map[subType] : 'CONV_AUTRE' };
  }
  if (type === 'EXCEPTIONNELLE') {
    const map: Record<string, string> = { MARIAGE: 'MAR', DECES: 'DEC', NAISSANCE: 'NAI' };
    return { code: subType && map[subType] ? map[subType] : 'EXC_AUTRE' };
  }
  // Compatibilité avec l'historique : l'ancien type de premier niveau MALADIE
  // existe peut-être encore sur de vieux enregistrements.
  if (type === 'MALADIE') return { code: 'MAL' };
  return { code: type };
}

export function getCodeDef(code: string): AbsenceCodeDef {
  return ABSENCE_CODES[code] ?? {
    code, label: code, family: 'INJUSTIFIEE',
    colorKey: 'neutral', countsAsAbsenceDay: true, isPaidByDefault: true, trackable: true,
  };
}

export function isTrackable(code: string): boolean {
  return getCodeDef(code).trackable;
}

// ============================================================================
// 🚨 SEUILS D'ALERTE RH — réglages simples et centralisés, ajustables sans
//    toucher à la logique. Basés sur des repères RH usuels (à affiner avec
//    des données réelles au fil du temps).
// ============================================================================
export const ALERT_THRESHOLDS = {
  /** Jours de maladie cumulés sur 1 an -> alerte individuelle "à surveiller" */
  employeeSickDaysPerYear: 15,
  /** Nombre d'épisodes de maladie distincts sur une fenêtre glissante de 90 jours -> pattern répétitif */
  employeeSickEpisodesRolling90d: 3,
  /** Jours d'absence "trackable" cumulés sur 1 an, toutes causes hors congé statutaire -> alerte individuelle */
  employeeTrackableDaysPerYear: 25,
  /** Taux d'absentéisme département (%) au-delà duquel on signale le département */
  departmentAbsenteeismRatePercent: 8,
} as const;