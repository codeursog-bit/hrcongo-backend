// ============================================================================
// 📁 src/payroll/settings/constants/settings.constants.ts
// 🇨🇬 CONSTANTS FISCALES CONGO-BRAZZAVILLE 2026
// ============================================================================

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Lundi–Vendredi
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_TOLERANCE_MINUTES = 60;
export const DEFAULT_WORK_HOURS_PER_DAY = 8;
export const DEFAULT_WORK_DAYS_PER_MONTH = 26;

// ============================================================================
// 🏥 CNSS — DEUX PLAFONDS DISTINCTS (Décret n°2009-392)
// ============================================================================
//
//  SALARIÉ (4%) :
//    base = min(brut, 1 200 000)  →  CNSS salarié = base × 4%
//
//  EMPLOYEUR :
//    base pension = min(brut, 1 200 000)  →  8%    (retraite)
//    base sociale = min(brut,   600 000)  →  10%   (famille)
//                                         →  2,25% (accidents)
//
// ============================================================================

// Plafonds
export const DEFAULT_CNSS_PENSION_CEILING = 1_200_000; // Retraite
export const DEFAULT_CNSS_SOCIAL_CEILING = 600_000; // Famille + AT

// Taux salarié
export const DEFAULT_CNSS_SALARIAL_RATE = 4; // 4% — en pourcentage entier

// Taux patronaux — en pourcentage entier
export const DEFAULT_CNSS_EMPLOYER_PENSION_RATE = 8; // 8%    Retraite
export const DEFAULT_CNSS_EMPLOYER_FAMILY_RATE = 10.03; // 10%   Famille
export const DEFAULT_CNSS_EMPLOYER_ACCIDENT_RATE = 2.25; // 2,25% Accidents du travail

// Taux total indicatif
export const DEFAULT_CNSS_EMPLOYER_RATE_TOTAL = 20.28;

/** @deprecated Utiliser DEFAULT_CNSS_EMPLOYER_PENSION_RATE / FAMILY / ACCIDENT */
export const DEFAULT_CNSS_EMPLOYER_RATE = 20.28;
/** @deprecated Utiliser DEFAULT_CNSS_PENSION_CEILING ou DEFAULT_CNSS_SOCIAL_CEILING */
export const DEFAULT_CNSS_CEILING = 600_000;

// ============================================================================
// 💸 ITS / IRPP — IMPÔT SUR LES TRAITEMENTS ET SALAIRES
// ============================================================================
export const DEFAULT_USE_FISCAL_PARTS = false;
export const DEFAULT_FISCAL_MODE = 'ITS_2026';

// ============================================================================
// 🏭 TUS — TAXE UNIQUE SUR LES SALAIRES
// ✅ Validé sur bulletin réel PEN & PROCESS
// 100% patronal, déplafonné sur brut total
// ============================================================================

export const TUS_RATE_DGI = 0.02025; // 2,025% → État (révisé 2026 : 27% × 7,5%)
export const TUS_RATE_CNSS = 0.05475; // 5,475% → CNSS (révisé 2026 : 73% × 7,5%)
export const TUS_RATE_TOTAL = 0.075; // 7,51% total

/** @deprecated — remplacé par TUS_RATE_DGI + TUS_RATE_CNSS */
export const DEFAULT_TUS_RATE = 0.075;

// ============================================================================
// ⏰ HEURES SUPPLÉMENTAIRES — DÉCRET N°78-360 DU 12 MAI 1978
// ============================================================================
export const DEFAULT_OVERTIME_RATE_10 = 10; // 5 premières heures (jours normaux)
export const DEFAULT_OVERTIME_RATE_25 = 25; // Heures suivantes (jours normaux)
export const DEFAULT_OVERTIME_RATE_50 = 50; // Nuit, repos hebdo, jour férié
export const DEFAULT_OVERTIME_RATE_100 = 100; // Nuit de dimanche ou jour férié
