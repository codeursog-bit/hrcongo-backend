// ============================================================================
// 📁 src/company-taxes/custom-tax.calculator.ts
//
// Calcul PUR (sans accès base de données) des taxes de l'entreprise
// (CAMU, taxe d'apprentissage, TOL configurée…) + TOL native.
//
// Source UNIQUE de vérité : utilisé par
//   - le calculateur de paie (bulletin réel),
//   - l'estimation du salaire (fiche employé / page primes),
//   - la génération de contrat,
// afin que ces trois écrans donnent exactement les mêmes retenues.
// ============================================================================

/** TOL : réservée aux CDI/CDD (jamais stagiaire, consultant, prestataire, intérim). */
export const TOL_CONTRACTS = ['CDI', 'CDD'];

/** Montant TOL selon la zone : VILLE (centre-ville) = 5 000 ; PERIPHERIE = 1 000. */
export const tolAmountForZone = (zone?: string | null): number =>
  zone === 'PERIPHERIE' ? 1000 : 5000;

export interface CustomTaxContext {
  contractType: string;
  grossSalary: number;
  /** CNSS salariale retenue (arrondie) — sert de base « brut − CNSS ». */
  cnssSalarial: number;
  /** Revenu net imposable (résultat ITS) ; défaut : brut. */
  revenuNetImposable?: number | null;
  isSubjectToIrpp?: boolean | null;
  tolZone?: string | null;
}

export interface CustomTaxDetail {
  id: string;
  name: string;
  code: string;
  employeeAmount: number;
  employerAmount: number;
  base: number;
  baseType: string;
  employeeRate: number | null;
  employerRate: number | null;
}

export interface CustomTaxResult {
  employeeTotal: number;
  employerTotal: number;
  details: CustomTaxDetail[];
}

/**
 * @param taxes taxes actives de l'entreprise, DÉJÀ filtrées par période
 *              (récurrentes + mois ciblé) par l'appelant.
 */
export function computeCustomTaxes(
  taxes: any[],
  ctx: CustomTaxContext,
  log: (msg: string) => void = () => undefined,
): CustomTaxResult {
  const { contractType, grossSalary, cnssSalarial } = ctx;
  let employeeTotal = 0;
  let employerTotal = 0;
  const details: CustomTaxDetail[] = [];

  for (const tax of taxes ?? []) {
    // Types de contrat concernés, configurables par taxe (défaut : CDI + CDD).
    const allowedContracts: string[] = tax.applicableContractTypes?.length
      ? tax.applicableContractTypes
      : ['CDI', 'CDD'];
    if (!allowedContracts.includes(contractType)) {
      log(
        `⏭️ ${tax.code} ignorée — contrat ${contractType} non concerné (${allowedContracts.join('/')})`,
      );
      continue;
    }
    // TOL : réservée aux CDI/CDD, même si l'admin coche un autre contrat.
    if (tax.code === 'TOL' && !TOL_CONTRACTS.includes(contractType)) {
      log(`⏭️ TOL ignorée — contrat ${contractType} non éligible (CDI/CDD uniquement)`);
      continue;
    }
    // Seuil minimum de salaire (mode ELIGIBILITY)
    if (tax.minSalaryThreshold && grossSalary < Number(tax.minSalaryThreshold)) {
      log(`⏭️ ${tax.code} ignorée — brut ${grossSalary} < seuil ${tax.minSalaryThreshold}`);
      continue;
    }

    // Base NET_IMPOSABLE dépend de l'ITS → ignorée si l'employé est exonéré ITS.
    const isExemptIts = ctx.isSubjectToIrpp === false;
    if (tax.baseType === 'NET_IMPOSABLE' && isExemptIts) {
      log(`⏭️ ${tax.code} ignorée — employé exonéré ITS (base NET_IMPOSABLE)`);
      continue;
    }

    const taxableBase = grossSalary - cnssSalarial;
    const netImposable = ctx.revenuNetImposable ?? grossSalary;

    let base = 0;
    if (tax.baseType === 'GROSS') base = grossSalary;
    else if (tax.baseType === 'TAXABLE') base = taxableBase;
    else if (tax.baseType === 'NET_IMPOSABLE') base = netImposable;
    // FIXED → on utilise directement fixedEmployee / fixedEmployer

    // EXCESS_ONLY : taxe sur l'excédent au-dessus du seuil (ex. CAMU solidarité)
    if (tax.thresholdType === 'EXCESS_ONLY' && tax.minSalaryThreshold) {
      base = Math.max(0, base - Number(tax.minSalaryThreshold));
      log(`📐 ${tax.code} EXCESS_ONLY : base excédent = ${base} F`);
    }

    if (tax.hasCeiling && tax.ceiling) base = Math.min(base, Number(tax.ceiling));

    let employeeAmount = 0;
    let employerAmount = 0;

    if (tax.baseType === 'FIXED') {
      if (tax.code === 'TOL') {
        employeeAmount = tolAmountForZone(ctx.tolZone);
        log(`📍 TOL zone=${ctx.tolZone ?? 'VILLE'} → ${employeeAmount} F`);
      } else {
        employeeAmount = Number(tax.fixedEmployee ?? 0);
      }
      employerAmount = Number(tax.fixedEmployer ?? 0);
    } else {
      // Taux stockés en décimal (0.0227 = 2,27 %)
      employeeAmount =
        Math.round(base * Number(tax.employeeRate ?? 0)) + Number(tax.fixedEmployee ?? 0);
      employerAmount =
        Math.round(base * Number(tax.employerRate ?? 0)) + Number(tax.fixedEmployer ?? 0);
    }

    employeeTotal += employeeAmount;
    employerTotal += employerAmount;
    details.push({
      id: tax.id,
      name: tax.name,
      code: tax.code,
      employeeAmount,
      employerAmount,
      base,
      baseType: tax.baseType,
      employeeRate: tax.baseType === 'FIXED' ? null : Number(tax.employeeRate ?? 0),
      employerRate: tax.baseType === 'FIXED' ? null : Number(tax.employerRate ?? 0),
    });
    log(`💼 ${tax.code} : sal=${employeeAmount} F | pat=${employerAmount} F`);
  }

  // TOL NATIVE — taxe fixe obligatoire, sauf si déjà configurée dans les taxes
  const hasTolInCompanyTaxes = (taxes ?? []).some((t: any) => t.code === 'TOL');
  if (!hasTolInCompanyTaxes && TOL_CONTRACTS.includes(contractType)) {
    const tolAmount = tolAmountForZone(ctx.tolZone);
    employeeTotal += tolAmount;
    details.push({
      id: 'TOL_NATIVE',
      name: "Taxe d'Occupation des Locaux (TOL)",
      code: 'TOL',
      employeeAmount: tolAmount,
      employerAmount: 0,
      base: tolAmount,
      baseType: 'FIXED',
      employeeRate: null,
      employerRate: null,
    });
    log(`📍 TOL NATIVE zone=${ctx.tolZone ?? 'VILLE'} → ${tolAmount} F`);
  }

  return { employeeTotal, employerTotal, details };
}