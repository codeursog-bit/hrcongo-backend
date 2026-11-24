// ============================================================================
// 📁 src/contract-templates/contract-breakdown.service.ts
//
// Calcul Brut / CNSS / ITS / TOL / taxes d'entreprise / Net d'un contrat.
// Extrait À L'IDENTIQUE de l'ancien ContractGenerationService (supprimé) :
// même plafond et taux CNSS (lus dans les paramètres légaux), même moteur ITS
// (IrppCalculatorService) et mêmes taxes d'entreprise que la paie — le contrat
// reflète donc exactement ce que l'employé retrouvera sur son bulletin.
// ============================================================================
import { Injectable, Optional } from '@nestjs/common';
import { LegalParametersService } from '../legal-parameters/legal-parameters.service';
import { DEFAULT_LEGAL_PARAMS } from '../legal-parameters/legal-parameters.core';
import { IrppCalculatorService } from '../payroll/fiscal/irpp-calculator.service';
import { MaritalStatus } from '../payroll/fiscal/fiscal-parts.service';
import { computeCustomTaxes } from '../company-taxes/custom-tax.calculator';

@Injectable()
export class ContractBreakdownService {
  constructor(
    private irppCalculator: IrppCalculatorService,
    @Optional() private legalParameters?: LegalParametersService,
  ) {}

  /**
   * 🧮 Calcule Brut / CNSS / ITS / TOL / Net à partir des composantes saisies.
   * Reproduit exactement les règles utilisées en paie (voir
   * payroll-calculator.service.ts) pour que le document généré corresponde
   * à ce que l'employé retrouvera sur son futur bulletin.
   */
  computeBreakdown(input: {
    salaireBase: number;
    sursalaire?: number;
    heuresSupplementaires?: number;
    primes?: { label: string; amount: number }[];
    transport?: number;
    indemniteTransport?: number;
    tolZone?: 'VILLE' | 'PERIPHERIE';
    maritalStatus?: MaritalStatus;
    numberOfChildren?: number;
    applyDeductions: boolean; // false pour STAGE / PRESTATION (pas de salarié CNSS/ITS)
    // ── Taxes configurées par l'entreprise (CAMU, etc.) — même moteur que la paie
    companyTaxes?: any[]; // taxes actives RÉCURRENTES de l'entreprise
    contractType?: 'CDI' | 'CDD'; // pour filtrer les taxes par type de contrat
    isSubjectToIrpp?: boolean | null;
    isSubjectToCnss?: boolean | null; // exonéré CNSS → pas de TOL
  }) {
    const sursalaire = input.sursalaire || 0;
    const heuresSupplementaires = input.heuresSupplementaires || 0;
    const transport = input.transport || 0;
    const indemniteTransport = input.indemniteTransport || 0;
    const primesTotal = (input.primes || []).reduce((s, p) => s + (p.amount || 0), 0);

    // ✅ Brut = base + sursalaire + heures sup forfaitaires + primes (qui
    // "entrent dans le brut") + transport (dans ce document, la ligne
    // "Transport" fait partie de la décomposition du brut — comme le modèle
    // fourni le montre : elle est comptée avant le NET, jamais retenue).
    const totalGross =
      input.salaireBase + sursalaire + heuresSupplementaires + primesTotal + transport;

    let cnssDeduction = 0;
    let itsDeduction = 0;
    let tolDeduction = 0;
    // Autres taxes configurées (hors TOL) : détail + total
    let taxes: { code: string; label: string; amount: number }[] = [];
    let otherTaxesTotal = 0;

    if (input.applyDeductions) {
      const legal = this.legalParameters?.getAt() ?? DEFAULT_LEGAL_PARAMS;
      const CNSS_PENSION_CEILING = legal.cnss.pensionCeiling;
      const CNSS_SALARIAL_RATE = legal.cnss.salarialRate;
      const cnssBase = Math.min(totalGross, CNSS_PENSION_CEILING);
      // CNSS non arrondie pour l'ITS (comme Excel), arrondie pour la retenue
      const cnssExact = cnssBase * CNSS_SALARIAL_RATE;
      cnssDeduction = Math.round(cnssExact);

      const irppResult = this.irppCalculator.calculateIRPP(
        totalGross,
        cnssExact,
        input.maritalStatus ?? MaritalStatus.SINGLE,
        input.numberOfChildren ?? 0,
      );
      itsDeduction = irppResult.irppTotal;

      // TOL + taxes de l'entreprise : même moteur que le bulletin réel
      const custom = computeCustomTaxes(input.companyTaxes ?? [], {
        contractType: input.contractType ?? 'CDI',
        grossSalary: totalGross,
        cnssSalarial: cnssDeduction,
        revenuNetImposable: irppResult.revenuNetImposable,
        isSubjectToIrpp: input.isSubjectToIrpp,
        isSubjectToCnss: input.isSubjectToCnss,
        tolZone: input.tolZone,
      });
      for (const d of custom.details) {
        if (d.employeeAmount <= 0) continue;
        if (d.code === 'TOL') {
          tolDeduction += d.employeeAmount;
        } else {
          otherTaxesTotal += d.employeeAmount;
          taxes.push({ code: d.code, label: d.name, amount: d.employeeAmount });
        }
      }
    }

    return {
      totalGross,
      cnssDeduction,
      itsDeduction,
      tolDeduction,
      primesTotal,
      taxes,
      otherTaxesTotal,
    };
  }
}