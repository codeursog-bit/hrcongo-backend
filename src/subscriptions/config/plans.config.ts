// ============================================================================
// 📊 PLANS D'ABONNEMENT - AVEC ESSAI GRATUIT 30 JOURS PRO
// ============================================================================
// Fichier: src/subscriptions/config/plans.config.ts

export interface PlanLimits {
  // Limites numériques (-1 = illimité)
  maxEmployees: number;
  maxUsers: number;
  maxDepartments: number;
  maxJobOffers: number;
  maxStorageMB: number;

  // Features EMPLOYÉS
  hasEmployeeManualCreate: boolean;
  hasEmployeeImportExcel: boolean;
  hasEmployeeExport: boolean;

  // Features POINTAGE
  hasAttendanceManual: boolean;
  hasAttendanceGPS: boolean;
  hasAttendanceCorrections: boolean;

  // Features PAIE
  hasPayrollIndividual: boolean;
  hasPayrollBulk: boolean;
  hasPayrollExport: boolean;
  hasPayrollAccountingExport: boolean;

  // Features CONGÉS
  hasLeaveManagement: boolean;

  // Features RECRUTEMENT
  hasRecruitmentManual: boolean;
  hasRecruitmentAI: boolean;

  // Features DOCUMENTS
  hasDocumentManagement: boolean;
  hasDocumentUnlimited: boolean;

  // Features AVANCÉES
  hasAssetManagement: boolean;
  hasPerformanceReviews: boolean;
  hasTraining: boolean;
  hasOnboarding: boolean; // 🆕 AJOUTÉ - Workflow onboarding automatisé
  hasLoansAndAdvances: boolean; // 🆕 AJOUTÉ - Gestion prêts et avances

  // Features RAPPORTS
  hasReportsBasic: boolean;
  hasReportsAnalytics: boolean;

  // Features NOTIFICATIONS
  hasEmailNotifications: boolean;
  hasEmailAutomation: boolean;

  // Features PREMIUM
  hasAPIAccess: boolean;
  hasMultiCompany: boolean;
  hasWhiteLabel: boolean;
  hasPrioritySupport: boolean;
}

export interface Plan {
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  popular: boolean;
  limits: PlanLimits;
}

// ============================================================================
// 🎯 PLANS DISPONIBLES
// ============================================================================

// Les prix sont stockés dans plan_prices et résolus par PricingService.
export const PLANS: Record<string, Omit<Plan, 'priceMonthly' | 'priceYearly'>> = {
  // ============================================================================
  // 🆓 FREE - PLAN DE BASE APRÈS ESSAI
  // ============================================================================
  FREE: {
    name: 'Gratuit',
    description: 'Pour tester les fonctionnalités de base',
    currency: 'XAF',
    popular: false,
    limits: {
      // Limites strictes
      maxEmployees: 2,
      maxUsers: 1,
      maxDepartments: 1,
      maxJobOffers: 0,
      maxStorageMB: 500,

      // Employés : Création manuelle uniquement
      hasEmployeeManualCreate: true,
      hasEmployeeImportExcel: false,
      hasEmployeeExport: false,

      // Pointage : Manuel uniquement
      hasAttendanceManual: true,
      hasAttendanceGPS: false,
      hasAttendanceCorrections: false,

      // Paie : Individuelle uniquement
      hasPayrollIndividual: true,
      hasPayrollBulk: false,
      hasPayrollExport: false,
      hasPayrollAccountingExport: false,

      // Pas de congés
      hasLeaveManagement: false,

      // Pas de recrutement
      hasRecruitmentManual: false,
      hasRecruitmentAI: false,

      // Pas de documents
      hasDocumentManagement: false,
      hasDocumentUnlimited: false,

      // Pas de features avancées
      hasAssetManagement: false,
      hasPerformanceReviews: false,
      hasTraining: false,
      hasOnboarding: false, // 🆕
      hasLoansAndAdvances: false, // 🆕

      // Rapports basiques uniquement
      hasReportsBasic: true,
      hasReportsAnalytics: false,

      // Pas de notifications
      hasEmailNotifications: false,
      hasEmailAutomation: false,

      // Pas de premium
      hasAPIAccess: false,
      hasMultiCompany: false,
      hasWhiteLabel: false,
      hasPrioritySupport: false,
    },
  },

  // ============================================================================
  // BASIC — prix configuré par le superadmin.
  // ============================================================================
  BASIC: {
    name: 'Jusqu’à 50 employés',
    description: 'Effectifs, présence, paie, congés et absences ; CNSS, matériel, prêts et avances avec quotas mensuels.',
    currency: 'XAF',
    popular: false,
    limits: {
      maxEmployees: 50,
      maxUsers: 2,
      maxDepartments: 10,
      maxJobOffers: 0,
      maxStorageMB: 2000, // 2 GB

      // Employés : + Import Excel
      hasEmployeeManualCreate: true,
      hasEmployeeImportExcel: true,
      hasEmployeeExport: false,

      // Pointage : Manuel uniquement sur BASIC
      hasAttendanceManual: true,
      hasAttendanceGPS: true,
      hasAttendanceCorrections: true,

      // Paie : + Bulk
      hasPayrollIndividual: true,
      hasPayrollBulk: true,
      hasPayrollExport: true,
      hasPayrollAccountingExport: false,

      // + Congés
      hasLeaveManagement: true,

      // Recrutement manuel
      hasRecruitmentManual: false,
      hasRecruitmentAI: false,

      // + Documents
      hasDocumentManagement: true,
      hasDocumentUnlimited: false,

      // Pas encore de features avancées
      hasAssetManagement: false,
      hasPerformanceReviews: false,
      hasTraining: false,
      hasOnboarding: false, // Workflow automatisé = PRO+
      hasLoansAndAdvances: true,

      // Rapports basiques
      hasReportsBasic: true,
      hasReportsAnalytics: false,

      // + Notifications email
      hasEmailNotifications: true,
      hasEmailAutomation: false,

      // Pas de premium
      hasAPIAccess: false,
      hasMultiCompany: false,
      hasWhiteLabel: false,
      hasPrioritySupport: false,
    },
  },

  // ============================================================================
  // PRO — prix configuré par le superadmin.
  // ============================================================================
  PRO: {
    name: 'Jusqu’à 100 employés',
    description: 'Le plan précédent, plus avances et prêts, rapports détaillés, exports Excel, messagerie interne, contrats, 4 administrateurs et 2 offres d’emploi par mois.',
    currency: 'XAF',
    popular: true, // ⭐ Plan populaire
    limits: {
      maxEmployees: 100,
      maxUsers: 4,
      maxDepartments: 30,
      maxJobOffers: 2, // Offres créées par mois civil.
      maxStorageMB: 20000, // 20 GB

      // Employés : Tout
      hasEmployeeManualCreate: true,
      hasEmployeeImportExcel: true,
      hasEmployeeExport: true,

      // Pointage : Tout
      hasAttendanceManual: true,
      hasAttendanceGPS: true,
      hasAttendanceCorrections: true,

      // Paie : Tout + Export compta
      hasPayrollIndividual: true,
      hasPayrollBulk: true,
      hasPayrollExport: true,
      hasPayrollAccountingExport: true,

      // Congés
      hasLeaveManagement: true,

      // Recrutement : + IA
      hasRecruitmentManual: true,
      hasRecruitmentAI: true,

      // Documents illimités
      hasDocumentManagement: true,
      hasDocumentUnlimited: true,

      // + Features avancées
      hasAssetManagement: true,
      hasPerformanceReviews: false,
      hasTraining: false,
      hasOnboarding: true, // 🆕 Workflow onboarding activé
      hasLoansAndAdvances: true, // 🆕 Gestion prêts/avances activée

      // + Analytics
      hasReportsBasic: true,
      hasReportsAnalytics: true,

      // + Automation
      hasEmailNotifications: true,
      hasEmailAutomation: true,

      // Pas encore de premium
      hasAPIAccess: false,
      hasMultiCompany: false,
      hasWhiteLabel: false,
      hasPrioritySupport: false,
    },
  },

  // ============================================================================
  // ENTERPRISE — prix configuré par le superadmin.
  // ============================================================================
  ENTERPRISE: {
    name: 'Plus de 100 employés',
    description: 'Tous modules inclus : recrutement illimité, formations, déclarations CNSS, DAS et bulletins annuels.',
    currency: 'XAF',
    popular: false,
    limits: {
      // Tout illimité
      maxEmployees: -1,
      maxUsers: 20,
      maxDepartments: 100,
      maxJobOffers: -1,
      maxStorageMB: 100000,

      // Toutes les features activées
      hasEmployeeManualCreate: true,
      hasEmployeeImportExcel: true,
      hasEmployeeExport: true,

      hasAttendanceManual: true,
      hasAttendanceGPS: true,
      hasAttendanceCorrections: true,

      hasPayrollIndividual: true,
      hasPayrollBulk: true,
      hasPayrollExport: true,
      hasPayrollAccountingExport: true,

      hasLeaveManagement: true,

      hasRecruitmentManual: true,
      hasRecruitmentAI: true,

      hasDocumentManagement: true,
      hasDocumentUnlimited: true,

      hasAssetManagement: true,
      hasPerformanceReviews: true,
      hasTraining: true,
      hasOnboarding: true, // 🆕
      hasLoansAndAdvances: true, // 🆕

      hasReportsBasic: true,
      hasReportsAnalytics: true,

      hasEmailNotifications: true,
      hasEmailAutomation: true,

      // + Features premium
      hasAPIAccess: true,
      hasMultiCompany: true,
      hasWhiteLabel: true,
      hasPrioritySupport: true,
    },
  },
};

// Quatrième offre commerciale ; FREE reste réservé aux comptes historiques.
PLANS.STARTER = {
  ...PLANS.BASIC, name: 'Jusqu’à 25 employés',
  description: 'Effectifs, présence, paie et demandes du quotidien ; alertes de fin de contrat et prêts/avances avec quotas adaptés.',
  limits: {...PLANS.BASIC.limits,maxEmployees:25,maxUsers:1,maxDepartments:5,maxStorageMB:500,
    hasEmployeeImportExcel:false,hasAssetManagement:false,hasReportsBasic:true,hasLoansAndAdvances:true},
};

// ============================================================================
// 🔧 FONCTIONS UTILITAIRES
// ============================================================================

export function getPlanLimits(plan: string): PlanLimits {
  return PLANS[plan]?.limits || PLANS.FREE.limits;
}

export function canUseFeature(
  plan: string,
  feature: keyof PlanLimits,
): boolean {
  const limits = getPlanLimits(plan);
  return !!limits[feature];
}

export function isWithinLimit(
  plan: string,
  limitType: keyof PlanLimits,
  currentCount: number,
): boolean {
  const limits = getPlanLimits(plan);
  const maxLimit = limits[limitType] as number;

  if (maxLimit === -1) return true; // Illimité
  return currentCount < maxLimit;
}
