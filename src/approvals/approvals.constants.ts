// ============================================================================
// 📁 src/approvals/approvals.constants.ts
// ✅ Catalogue des "fonctions" de validation (avis) — LOT A.
//
// Principe (cadrage validé) :
//   - Le RÔLE (ADMIN / HR_MANAGER) donne le droit de DÉCIDER. Inchangé.
//   - La FONCTION (comptable, RH, DG, ...) donne le droit de DONNER UN AVIS,
//     plus (case séparée) le droit de SIGNER. Elle s'attribue explicitement à
//     n'importe quel utilisateur de l'entreprise, y compris un admin.
//   - Les codes sont des chaînes validées par cette constante (pas un enum
//     Postgres) : ajouter une fonction plus tard = ajouter une ligne ici,
//     sans migration.
// ============================================================================

export const APPROVAL_FUNCTIONS = [
  {
    code: 'ACCOUNTANT',
    label: 'Comptable',
    description: 'Donne son avis sur la disponibilité des fonds (prêts, avances…).',
  },
  {
    code: 'HR',
    label: 'Ressources Humaines',
    description: 'Donne l’avis de la Direction des Ressources Humaines.',
  },
  {
    code: 'DG',
    label: 'Direction Générale',
    description: 'Donne l’avis de la Direction Générale.',
  },
  {
    code: 'HIERARCHY_HEAD',
    label: 'Supérieur hiérarchique',
    description: 'Donne l’avis du supérieur hiérarchique de l’employé.',
  },
  {
    code: 'TEAM_LEAD',
    label: 'Chef d’équipe',
    description: 'Donne l’avis du chef d’équipe.',
  },
] as const;

export type ApprovalFunctionCode = (typeof APPROVAL_FUNCTIONS)[number]['code'];

export const APPROVAL_FUNCTION_CODES: string[] = APPROVAL_FUNCTIONS.map(
  (f) => f.code,
);

export const approvalFunctionLabel = (code: string): string =>
  APPROVAL_FUNCTIONS.find((f) => f.code === code)?.label ?? code;

// Qui peut ATTRIBUER / retirer des fonctions et le droit de signer :
// l'admin (créateur du compte) uniquement.
export const FUNCTION_ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

// Qui peut CONSULTER qui a quelle fonction (utile pour comprendre un circuit).
export const FUNCTION_READ_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

// Signature : image seulement, 2 Mo max (même limite que le cachet entreprise).
export const SIGNATURE_ALLOWED_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];
export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;

// ============================================================================
// ✅ LOT B — Circuits d'avis, avis, décisions orchestrées
// ============================================================================

// Types de demandes couverts par le circuit.
// ✅ LOT E — les DEMANDES de congé (repos) y sont ajoutées. Elles n'ont plus aucun lien
// avec la paie : l'indemnité ne dépend que du planning RH.
export const APPROVAL_REQUEST_TYPES = ['LOAN', 'ADVANCE', 'ABSENCE', 'LEAVE'] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export const REQUEST_TYPE_LABEL: Record<ApprovalRequestType, string> = {
  LOAN: 'Prêts',
  ADVANCE: 'Avances',
  ABSENCE: 'Absences',
  LEAVE: 'Congés',
};

// Qui peut DÉCIDER (approuver / refuser) — miroir exact de DRH_ROLES
// (loans.constants.ts). Le rôle décide, la fonction donne seulement un avis.
export const DECIDER_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

// Avis
export const OPINION_VALUES = ['FAVORABLE', 'UNFAVORABLE'] as const;
export type OpinionValue = (typeof OPINION_VALUES)[number];

// États d'une décision "validée, en attente d'avis"
export const PENDING_STATES = {
  WAITING_OPINIONS: 'WAITING_OPINIONS', // décideur a validé, on attend les avis
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION', // avis défavorable / décideur indisponible → à confirmer
  FINALIZING: 'FINALIZING', // état transitoire (verrou anti double finalisation)
  FINALIZED: 'FINALIZED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED', // la demande a été traitée autrement entre-temps
} as const;

export const ACTIVE_PENDING_STATES: string[] = [
  PENDING_STATES.WAITING_OPINIONS,
  PENDING_STATES.NEEDS_CONFIRMATION,
];

// Nombre max d'étapes dans un circuit (cohérent avec le catalogue).
export const MAX_CIRCUIT_STEPS = 5;
