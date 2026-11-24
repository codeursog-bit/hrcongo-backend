// // ============================================================================
// // 📁 src/payrolls/constants/payroll.constants.ts
// // ============================================================================

// export const LEGAL_WORK_HOURS_PER_MONTH = 173.33;
// export const SMIC_CONGO    = 50_000; // Décret 2026 — SMIG Congo-Brazzaville
// export const SAFETY_MARGIN = 10000;

// export enum SmicProtectionMode {
//   STRICT   = 'STRICT',
//   WARNING  = 'WARNING',
//   DISABLED = 'DISABLED'
// }

// export interface CalculatedPayroll {
//   grossSalary:         number;
//   netSalary:           number;
//   cnssSalarial:        number;
//   its:                 number;
//   totalDeductions:     number;
//   cnssEmployer:        number;   // total CNSS patronale (somme des 3 branches)
//   totalEmployerCost:   number;   // brut + cnssEmployer + tusTotal
//   totalBonuses:        number;
//   totalOvertimeAmount: number;
//   absenceDeduction:    number;
//   adjustedBaseSalary:  number;

//   // Heures supplémentaires — Décret N°78-360
//   overtimeAmount10:    number;
//   overtimeAmount25:    number;
//   overtimeAmount50:    number;
//   overtimeAmount100:   number;

//   // ✅ Détail CNSS Patronale — 3 branches séparées (Décret n°99-284)
//   cnssEmployerPension:  number;  // min(brut, 1 200 000) × 8,00%
//   cnssEmployerFamily:   number;  // min(brut,   600 000) × 10,03%
//   cnssEmployerAccident: number;  // min(brut,   600 000) × 2,25%

//   // ✅ TUS — Taxe Unique sur Salaires (100% patronal, déplafonné)
//   // Validé sur bulletin réel PEN & PROCESS
//   tusDgiAmount:  number;  // 4,13% → versé à la DGI
//   tusCnssAmount: number;  // 3,38% → versé à la CNSS
//   tusTotal:      number;  // 7,51% = tusDgiAmount + tusCnssAmount

//   irppDetails?: any;
// }

// ============================================================================
// 📁 src/payrolls/constants/payroll.constants.ts
// ✅ Taxes custom ajoutées dans CalculatedPayroll
// ✅ Champs contractType / BNC / régimes ajoutés
// ============================================================================

export const LEGAL_WORK_HOURS_PER_MONTH = 173.33;
export const SMIC_CONGO = 50_000; // Décret 2026 — SMIG Congo-Brazzaville
export const SAFETY_MARGIN = 10000;

export enum SmicProtectionMode {
  STRICT = 'STRICT',
  WARNING = 'WARNING',
  DISABLED = 'DISABLED',
}

export interface CalculatedPayroll {
  grossSalary: number;
  netSalary: number;
  cnssSalarial: number;
  its: number;
  totalDeductions: number;
  cnssEmployer: number; // total CNSS patronale (somme des 3 branches)
  totalEmployerCost: number; // brut + cnssEmployer + tusTotal + employerCustomTaxTotal
  totalBonuses: number;
  totalOvertimeAmount: number;
  absenceDeduction: number;
  adjustedBaseSalary: number;

  // Heures supplémentaires — Décret N°78-360
  overtimeAmount10: number;
  overtimeAmount25: number;
  overtimeAmount50: number;
  overtimeAmount100: number;

  // ✅ Détail CNSS Patronale — 3 branches séparées (Décret n°99-284)
  cnssEmployerPension: number; // min(brut, 1 200 000) × 8,00%
  cnssEmployerFamily: number; // min(brut,   600 000) × 10,03%
  cnssEmployerAccident: number; // min(brut,   600 000) × 2,25%

  // ✅ TUS — Taxe Unique sur Salaires (100% patronal, déplafonné)
  tusDgiAmount: number; // 2,025% → versé à la DGI
  tusCnssAmount: number; // 5,475% → versé à la CNSS
  tusTotal: number; // 7,5%   = tusDgiAmount + tusCnssAmount

  // ✅ Type de contrat et régime fiscal/social
  contractType: string; // 'CDI' | 'CDD' | 'STAGE' | 'CONSULTANT' | 'PRESTATAIRE' | 'INTERIM'
  isSalaried: boolean; // CDI / CDD / STAGE
  isStagiaire: boolean; // STAGE uniquement
  isBncWorker: boolean; // CONSULTANT / PRESTATAIRE → BNC retenu à la source
  isInterim: boolean; // INTERIM → géré par agence

  // ✅ BNC — Retenue à la source (Consultant / Prestataire — CGI Congo art. 44 / 47 ter)
  bncAmount: number; // montant BNC retenu
  bncTaux: number; // 0.10 (résident) ou 0.20 (non-résident)
  bncLabel: string; // description du régime BNC appliqué

  // ✅ Taxes custom (CompanyTax — CAMU, TOL, taxe apprentissage, etc.)
  employeeCustomTaxTotal: number; // part salarié → déduit du net
  employerCustomTaxTotal: number; // part patronal → ajouté au coût employeur
  customTaxDetails: Array<{
    id: string;
    name: string;
    code: string;
    employeeAmount: number;
    employerAmount: number;
    base: number;
  }>;

  irppDetails?: any;
}
