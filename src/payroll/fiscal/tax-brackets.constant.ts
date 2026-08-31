// ============================================================================
// 📁 src/payroll/fiscal/tax-brackets.constant.ts
// 🇨🇬 FISCALITÉ CONGO-BRAZZAVILLE 2026 — CONFORME CGI
// ============================================================================
//
// RÉFORME 2026 (Ordonnance n°2025-44 du 31 décembre 2025) :
//   - L'IRPP est remplacé par l'ITS (Impôt sur les Traitements et Salaires)
//   - Le quotient familial (parts fiscales) est MAINTENU en ITS 2026
//   - L'abattement forfaitaire de 20% est maintenu
//   - Le barème progressif a CHANGÉ (nouveau barème officiel)
//   - Source confirmée : PaySpace Congo Annual Amendments 2026 (13 fév. 2026)
//
// BARÈME ITS 2026 (annuel, sur quotient par part) :
//   Tranche 1 : 0 – 615 000           → 1 200 FCFA fixe
//   Tranche 2 : 615 001 – 1 500 000   → 10%
//   Tranche 3 : 1 500 001 – 3 500 000 → 15%
//   Tranche 4 : 3 500 001 – 5 000 000 → 20%
//   Tranche 5 : > 5 000 000           → 30%
//
// BARÈME IRPP LEGACY (avant 2026, conservé pour mode configurable) :
//   Tranche 1 : 0 – 464 000           → 1%
//   Tranche 2 : 464 001 – 1 000 000   → 10%
//   Tranche 3 : 1 000 001 – 3 000 000 → 25%
//   Tranche 4 : > 3 000 000           → 40%
//
// TUS 2026 (répartition révisée — Article 8 Tome II Ordonnance 2025-44) :
//   Taux total : 7,5% du brut (inchangé)
//   Part État (DGI)  : 27% × 7,5% = 2,025%
//   Part CNSS        : 73% × 7,5% = 5,475%
//
// CNSS :
//   Salarié : 4% plafonné à 1 200 000 FCFA
//   Employeur : 3 branches sur deux assiettes distinctes
//
// ============================================================================

export interface TaxBracket {
  min: number;
  max: number;
  rate: number; // Taux en décimal (0.10 = 10%) — ou null si montant fixe
  fixed: number; // Montant fixe FCFA (0 si calcul en %)
  label: string;
}

// ============================================================================
// 📊 BARÈME ITS 2026 — OFFICIEL
// Source : Ordonnance n°2025-44 / PaySpace Congo Annual Amendments 2026
// Barème ANNUEL — appliqué sur le quotient (RNI annuel / parts fiscales)
// Les parts fiscales SONT maintenues en ITS 2026
// ============================================================================
export const ITS_BRACKETS_CONGO_2026: TaxBracket[] = [
  {
    min: 0,
    max: 615_000,
    rate: 0,
    fixed: 1_200,
    label: '0 – 615 000 FCFA (1 200 F fixe)',
  },
  {
    min: 615_000,
    max: 1_500_000,
    rate: 0.1,
    fixed: 0,
    label: '615 001 – 1 500 000 FCFA (10%)',
  },
  {
    min: 1_500_000,
    max: 3_500_000,
    rate: 0.15,
    fixed: 0,
    label: '1 500 001 – 3 500 000 FCFA (15%)',
  },
  {
    min: 3_500_000,
    max: 5_000_000,
    rate: 0.2,
    fixed: 0,
    label: '3 500 001 – 5 000 000 FCFA (20%)',
  },
  {
    min: 5_000_000,
    max: Infinity,
    rate: 0.3,
    fixed: 0,
    label: '> 5 000 000 FCFA (30%)',
  },
];

// ============================================================================
// 📊 BARÈME IRPP LEGACY — avant 2026
// Conservé pour le mode IRPP_LEGACY (entreprises/employés sur ancien régime)
// ============================================================================
export const IRPP_BRACKETS_CONGO_LEGACY: TaxBracket[] = [
  {
    min: 0,
    max: 464_000,
    rate: 0.01,
    fixed: 0,
    label: '0 – 464 000 FCFA (1%)',
  },
  {
    min: 464_000,
    max: 1_000_000,
    rate: 0.1,
    fixed: 0,
    label: '464 001 – 1 000 000 FCFA (10%)',
  },
  {
    min: 1_000_000,
    max: 3_000_000,
    rate: 0.25,
    fixed: 0,
    label: '1 000 001 – 3 000 000 FCFA (25%)',
  },
  {
    min: 3_000_000,
    max: Infinity,
    rate: 0.4,
    fixed: 0,
    label: '> 3 000 000 FCFA (40%)',
  },
];

// Alias pour compatibilité avec l'ancien nom dans le code existant
export const IRPP_BRACKETS_CONGO = IRPP_BRACKETS_CONGO_LEGACY;

// ============================================================================
// 💸 ABATTEMENT FORFAITAIRE
// 20% du revenu brut après déduction CNSS — identique IRPP et ITS
// ============================================================================
export const ABATTEMENT_FORFAITAIRE = 0.2;

// ============================================================================
// 👨‍👩‍👧 PARTS FISCALES — MAINTENUES en ITS 2026
// Source : PaySpace Congo Annual Amendments 2026
// "Family quotient system applies, based on marital status and dependants.
//  Family shares range from 1 part to a maximum of 6.5 parts"
// ============================================================================
export const MAX_FISCAL_PARTS = 6.5;

export const FISCAL_PARTS_RULES = {
  SINGLE_BASE: 1.0,
  MARRIED_BASE: 2.0,
  FIRST_CHILD_SINGLE: 1.0, // 1er enfant célibataire/divorcé/veuf = +1 part
  ADDITIONAL_CHILD: 0.5, // Enfants suivants = +0.5 part
  MARRIED_CHILD: 0.5, // Enfants d'un marié = +0.5 part chacun
};

// ============================================================================
// 🏥 CNSS — COTISATIONS SOCIALES CONGO
// Source : Décret n°2009-392 — INCHANGÉ en 2026
// ============================================================================
export const CNSS_PENSION_CEILING = 1_200_000;
export const CNSS_SOCIAL_CEILING = 600_000;

export const CNSS_SALARIAL_RATE = 0.04;
export const CNSS_EMPLOYER_PENSION_RATE = 0.08;
export const CNSS_EMPLOYER_FAMILY_RATE = 0.1; // 10% famille (+ 0.03% maternité → 10.03% en pratique)
export const CNSS_EMPLOYER_ACCIDENT_RATE = 0.0225;

// ============================================================================
// 🏭 TUS — TAXE UNIQUE SUR LES SALAIRES 2026
// Source : Article 8 Tome II Ordonnance n°2025-44 du 31 décembre 2025
// Taux total : 7,5% (inchangé)
// Répartition RÉVISÉE :
//   27% → État/DGI  = 7,5% × 27% = 2,025%
//   73% → CNSS      = 7,5% × 73% = 5,475%
// ============================================================================
export const TUS_TOTAL_RATE = 0.075; // 7,5% total
export const TUS_RATE_DGI = 0.02025; // 2,025% → État
export const TUS_RATE_CNSS = 0.05475; // 5,475% → CNSS

// ============================================================================
// ⚙️ CONFIGURATION DU MODE FISCAL
// ITS_2026   → mode actuel (barème 2026, parts fiscales maintenues)
// IRPP_LEGACY → mode legacy (barème avant 2026, parts fiscales)
// ============================================================================
export const FISCAL_MODE = {
  ITS_2026: 'ITS_2026',
  IRPP_LEGACY: 'IRPP_LEGACY',
} as const;

export type FiscalMode = (typeof FISCAL_MODE)[keyof typeof FISCAL_MODE];
