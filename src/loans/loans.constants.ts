// ============================================================================
// 📁 loans.constants.ts
// ✅ Constantes partagées entre les services du domaine prêts/avances.
//    Isolées ici pour qu'un changement de seuil (ex: plafond mensuel de
//    prêt) ou de rôle n'oblige pas à toucher plusieurs fichiers.
// ============================================================================

export const SMIC_CONGO = 91000;
export const MAX_LOAN_RATIO = 0.3;
export const MAX_ADVANCE_RATIO = 0.5;

// Domaine finance : ADMIN + SUPER_ADMIN + HR_MANAGER uniquement. Pas de
// MANAGER — les chefs de département ne gèrent pas les fonds.
export const FULL_ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']; // CRUD complet, sans restriction d'état

// Validation PARALLÈLE : DRH_ROLES et DG_ROLES reçoivent la demande en même
// temps, le premier présent (peu importe sa casquette) valide ou refuse.
// DG_ROLES est un sous-ensemble de DRH_ROLES — la notification à DRH_ROLES
// atteint donc déjà tout le monde.
export const DRH_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER']; // rôles habilités à décider
export const DG_ROLES = ['ADMIN', 'SUPER_ADMIN']; // sous-ensemble : utilisé uniquement pour le libellé "casquette DG" dans l'historique
export const FINANCE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER']; // qui peut voir/gérer ce module

export const employeeSelect = {
  firstName: true,
  lastName: true,
  employeeNumber: true,
  photoUrl: true,
  baseSalary: true,
  position: true,
  department: { select: { name: true } },
} as const;
