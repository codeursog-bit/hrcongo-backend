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

export const PLANS: Record<string, Plan> = {
  // ============================================================================
  // 🆓 FREE - PLAN DE BASE APRÈS ESSAI
  // ============================================================================
  FREE: {
    name: 'Gratuit',
    description: 'Pour tester les fonctionnalités de base',
    priceMonthly: 0,
    priceYearly: 0,
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
  // 💼 BASIC - 25,000 FCFA/mois
  // ============================================================================
  BASIC: {
    name: 'Basique',
    description: 'Pour les petites entreprises en croissance',
    priceMonthly: 25000,
    priceYearly: 250000, // 10 mois pour le prix de 12
    currency: 'XAF',
    popular: false,
    limits: {
      maxEmployees: 20,
      maxUsers: 3,
      maxDepartments: 5,
      maxJobOffers: 5,
      maxStorageMB: 2000, // 2 GB

      // Employés : + Import Excel
      hasEmployeeManualCreate: true,
      hasEmployeeImportExcel: true,
      hasEmployeeExport: true,

      // Pointage : Manuel uniquement sur BASIC
      hasAttendanceManual: true,
      hasAttendanceGPS: false, // ✅ GPS = PRO+ uniquement
      hasAttendanceCorrections: true,

      // Paie : + Bulk
      hasPayrollIndividual: true,
      hasPayrollBulk: true,
      hasPayrollExport: true,
      hasPayrollAccountingExport: false,

      // + Congés
      hasLeaveManagement: true,

      // Recrutement manuel
      hasRecruitmentManual: true,
      hasRecruitmentAI: false,

      // + Documents
      hasDocumentManagement: true,
      hasDocumentUnlimited: false,

      // Pas encore de features avancées
      hasAssetManagement: false,
      hasPerformanceReviews: false,
      hasTraining: false,
      hasOnboarding: false, // Workflow automatisé = PRO+
      hasLoansAndAdvances: true, // ✅ ACTIVÉ DÈS BASIC (gestion prêts/avances)

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
  // 💎 PRO - 75,000 FCFA/mois (POPULAIRE + ESSAI GRATUIT)
  // ============================================================================
  PRO: {
    name: 'Pro',
    description: 'Pour les entreprises qui veulent tout automatiser',
    priceMonthly: 75000,
    priceYearly: 750000, // 10 mois pour le prix de 12
    currency: 'XAF',
    popular: true, // ⭐ Plan populaire
    limits: {
      maxEmployees: 100,
      maxUsers: 10,
      maxDepartments: -1, // Illimité
      maxJobOffers: -1, // Illimité
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
      hasPerformanceReviews: true,
      hasTraining: true,
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
  // 👑 ENTERPRISE - 200,000 FCFA/mois
  // ============================================================================
  ENTERPRISE: {
    name: 'Enterprise',
    description: 'Pour les grandes entreprises avec besoins spécifiques',
    priceMonthly: 200000,
    priceYearly: 2000000, // 10 mois pour le prix de 12
    currency: 'XAF',
    popular: false,
    limits: {
      // Tout illimité
      maxEmployees: -1,
      maxUsers: -1,
      maxDepartments: -1,
      maxJobOffers: -1,
      maxStorageMB: -1,

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

// ============================================================================
// 🔧 FONCTIONS UTILITAIRES
// ============================================================================

export function getPlanLimits(plan: string): PlanLimits {
  return PLANS[plan]?.limits || PLANS.FREE.limits;
}

export function getPlanPrice(
  plan: string,
  billingPeriod: 'monthly' | 'yearly',
): number {
  const planConfig = PLANS[plan];
  if (!planConfig) return 0;
  return billingPeriod === 'yearly'
    ? planConfig.priceYearly
    : planConfig.priceMonthly;
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
