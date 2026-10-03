// ============================================================================
// 📁 src/employees/salary-estimate.service.ts
//
// Calcul autonome du "brut / net" CONTRACTUEL d'un employé, indépendant du
// pointage réel (aucun prorata, aucun prêt/avance) :
//   - Brut      = salaire de base + primes MENSUELLES imposables actives
//                 (transport imposable, sursalaire… — jamais le 13e mois ni une
//                 prime à mois ciblé, qui sont temporaires par nature)
//   - Indemnités non imposables (transport, panier, logement…) : n'entrent
//                 ni dans l'ITS ni dans la CNSS, mais s'ajoutent au NET
//                 (exactement comme sur le bulletin réel)
//   - Retenues  = CNSS + ITS (ou BNC consultant/prestataire) + TOL + toutes les
//                 taxes configurées par l'entreprise (CAMU solidarité, etc.)
//
// ✅ Les taxes de l'entreprise passent par le MÊME moteur que le bulletin réel
//    (company-taxes/custom-tax.calculator.ts) : types de contrat concernés,
//    seuils, bases, TOL par zone → mêmes montants que la paie.
// ✅ Seules les taxes RÉCURRENTES (chaque mois) sont retenues : une taxe à
//    "mois précis" est temporaire, comme un 13e mois — elle n'entre pas dans
//    un montant contractuel stable.
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IrppCalculatorService } from '../payroll/fiscal/irpp-calculator.service';
import { FISCAL_MODE } from '../payroll/fiscal/tax-brackets.constant';
import {
  computeCustomTaxes,
  CustomTaxDetail,
} from '../company-taxes/custom-tax.calculator';

const CNSS_PENSION_CEILING = 1_200_000;
const CNSS_SALARIAL_RATE = 0.04;
const SALARIED_CONTRACTS = ['CDI', 'CDD', 'STAGE'];
const BNC_RATE_CONGOLAIS = 0.1; // 10 % — personne physique résidente
const BNC_RATE_ETRANGER = 0.2; // 20 % — non domicilié

/** Une ligne de retenue détaillée (CNSS, ITS/BNC, TOL, taxes configurées). */
export interface SalaryDeductionLine {
  kind: 'CNSS' | 'ITS' | 'BNC' | 'TAX';
  code: string;
  label: string;
  amount: number;
  /** Taux décimal (0.005 = 0,5 %) ; null pour un montant fixe. */
  rate?: number | null;
  /** Base de calcul affichable (ex. excédent au-dessus du seuil). */
  base?: number | null;
}

export interface SalaryEstimateResult {
  /** Brut imposable (même définition que le bulletin : sans indemnités non imposables). */
  grossSalary: number;
  /** Indemnités mensuelles non soumises à l'ITS ni à la CNSS. */
  nonTaxableBonuses: number;
  /** Brut + indemnités non imposables (= "Total gains" du bulletin). */
  totalGains: number;
  totalDeductions: number;
  netSalary: number;
  /** Détail de chaque retenue, dans l'ordre d'affichage. */
  deductions: SalaryDeductionLine[];
  breakdown: {
    baseSalary: number;
    monthlyTaxableBonuses: number;
    monthlyNonTaxableBonuses: number;
    cnss: number;
    its: number;
    tol: number;
    /** Somme des taxes configurées (hors TOL). */
    otherTaxes: number;
  };
}

/** Prime hypothétique pas encore enregistrée — pour prévisualiser son impact
 * avant validation, sans jamais casser l'aspect "contractuel" du calcul :
 * cette prime est ajoutée à son montant plein mois, jamais proratisée,
 * exactement comme les primes déjà enregistrées. */
export interface PreviewBonusInput {
  amount: number;
  isTaxable: boolean;
  isCnss: boolean;
  /** Catégorie fiscale explicite du modèle de prime (prioritaire sur isTaxable/isCnss). */
  fiscalType?: string | null;
}

/** Même classification fiscale que le calculateur de paie (3 catégories). */
const getTaxType = (b: {
  fiscalType?: string | null;
  isTaxable?: boolean | null;
  isCnss?: boolean | null;
}): 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE' => {
  if (b.fiscalType === 'NON_TAXABLE') return 'NON_TAXABLE';
  if (b.fiscalType === 'TAXABLE_NO_CNSS') return 'TAXABLE_NO_CNSS';
  if (b.fiscalType === 'TAXABLE_CNSS') return 'TAXABLE_CNSS';
  if (b.isTaxable === false) return 'NON_TAXABLE';
  if (b.isCnss === false) return 'TAXABLE_NO_CNSS';
  return 'TAXABLE_CNSS';
};

@Injectable()
export class SalaryEstimateService {
  constructor(
    private prisma: PrismaService,
    private irppCalculator: IrppCalculatorService,
  ) {}

  /**
   * @param employee Objet employé déjà chargé et dont l'accès a déjà été
   *   vérifié par l'appelant (ex: résultat de EmployeesService.findOne) —
   *   ce service ne fait aucun contrôle d'accès lui-même.
   * @param previewBonus Prime pas encore enregistrée à inclure dans le calcul
   *   (aperçu avant validation, cf. page primes employé) — optionnel.
   */
  async estimate(
    employee: {
      id: string;
      companyId?: string | null;
      baseSalary: number | string;
      contractType?: string | null;
      maritalStatus?: string | null;
      numberOfChildren?: number | null;
      isSubjectToCnss?: boolean | null;
      isSubjectToIrpp?: boolean | null;
      isResident?: boolean | string | null;
      tolZone?: string | null;
    },
    previewBonus?: PreviewBonusInput,
  ): Promise<SalaryEstimateResult> {
    const baseSalary = Number(employee.baseSalary ?? 0);
    const contractType = employee.contractType ?? 'CDI';
    const isStagiaire = contractType === 'STAGE';
    const isSalaried = SALARIED_CONTRACTS.includes(contractType);
    const isBncWorker =
      contractType === 'CONSULTANT' || contractType === 'PRESTATAIRE';
    const isInterim = contractType === 'INTERIM';

    // ── Primes MENSUELLES actives ───────────────────────────────────────────
    // (jamais ANNUAL/ONE_TIME — 13e mois et primes à mois ciblé sont
    // temporaires, ils ne représentent pas le salaire contractuel stable)
    const bonuses = await this.prisma.employeeBonus.findMany({
      where: { employeeId: employee.id, isActive: true, frequency: 'MONTHLY' },
    });

    let taxableCnssBonuses = 0; // → brut ITS + brut CNSS
    let taxableNoCnssBonuses = 0; // → brut ITS seulement
    let nonTaxableBonuses = 0; // → ni ITS ni CNSS (indemnités)

    const addBonus = (amount: number, type: ReturnType<typeof getTaxType>) => {
      if (type === 'NON_TAXABLE') nonTaxableBonuses += amount;
      else if (type === 'TAXABLE_NO_CNSS') taxableNoCnssBonuses += amount;
      else taxableCnssBonuses += amount;
    };

    for (const b of bonuses) {
      // Mode quantité libre (FREE) : montant variable par nature (garde,
      // panier ajusté chaque mois) — exclu d'une estimation "contractuelle"
      if ((b as any).quantityMode === 'FREE') continue;

      let amount = 0;
      if (b.calculationType === 'FIXED_AMOUNT' && b.fixedAmount != null) {
        amount = Number(b.fixedAmount);
      } else if (b.calculationType === 'PERCENTAGE' && b.percentage != null) {
        amount = Math.round((Number(b.percentage) / 100) * baseSalary);
      }
      if (amount <= 0) continue;

      addBonus(amount, getTaxType(b as any));
    }

    // ── Prime en cours de création (pas encore enregistrée) ────────────────
    // Ajoutée à son montant plein mois, exactement comme les autres — jamais
    // proratisée, pour rester cohérent avec le principe "contractuel".
    if (previewBonus && previewBonus.amount > 0) {
      addBonus(
        previewBonus.amount,
        getTaxType({
          fiscalType: previewBonus.fiscalType,
          isTaxable: previewBonus.isTaxable,
          isCnss: previewBonus.isCnss,
        }),
      );
    }

    const monthlyTaxableBonuses = taxableCnssBonuses + taxableNoCnssBonuses;
    const grossSalary = Math.round(baseSalary + monthlyTaxableBonuses);
    const grossSalaryCnss = Math.round(baseSalary + taxableCnssBonuses);

    const deductions: SalaryDeductionLine[] = [];

    // ── CNSS salarié — 4%, plafonné à 1 200 000, CDI/CDD uniquement ─────────
    let cnss = 0;
    // Valeur non arrondie : sert uniquement au calcul de l'ITS (comme Excel).
    let cnssExact = 0;
    if (isSalaried && !isStagiaire && employee.isSubjectToCnss !== false) {
      const base = Math.min(Math.max(0, grossSalaryCnss), CNSS_PENSION_CEILING);
      cnssExact = base * CNSS_SALARIAL_RATE;
      cnss = Math.round(cnssExact);
    }
    if (cnss > 0) {
      deductions.push({
        kind: 'CNSS',
        code: 'CNSS',
        label: 'CNSS (PVID 4 %)',
        amount: cnss,
        rate: CNSS_SALARIAL_RATE,
        base: Math.min(Math.max(0, grossSalaryCnss), CNSS_PENSION_CEILING),
      });
    }

    // ── ITS — même service que la paie réelle (barème ITS 2026 / legacy) ───
    let its = 0;
    let revenuNetImposable: number | null = null;
    const canApplyIts =
      isSalaried &&
      !isStagiaire &&
      !isBncWorker &&
      !isInterim &&
      employee.isSubjectToIrpp !== false;
    if (canApplyIts) {
      const fiscalMode =
        new Date().getFullYear() < 2026
          ? FISCAL_MODE.IRPP_LEGACY
          : FISCAL_MODE.ITS_2026;
      const result = this.irppCalculator.calculateIRPP(
        grossSalary,
        cnssExact,
        (employee.maritalStatus ?? 'SINGLE') as any,
        employee.numberOfChildren ?? 0,
        fiscalMode as any,
      );
      its = result.irppTotal;
      revenuNetImposable = result.revenuNetImposable;
      deductions.push({
        kind: 'ITS',
        code: 'ITS',
        label: `ITS (${result.fiscalParts} part${result.fiscalParts > 1 ? 's' : ''})`,
        amount: its,
        rate: null,
        base: result.revenuNetImposable,
      });
    }

    // ── BNC — consultant / prestataire (remplace l'ITS, comme la paie) ──────
    if (isBncWorker) {
      const isResident =
        employee.isResident !== false && employee.isResident !== 'false';
      const bncTaux = isResident ? BNC_RATE_CONGOLAIS : BNC_RATE_ETRANGER;
      its = Math.round(grossSalary * bncTaux);
      deductions.push({
        kind: 'BNC',
        code: 'BNC',
        label: `BNC ${bncTaux * 100} % retenu à la source`,
        amount: its,
        rate: bncTaux,
        base: grossSalary,
      });
    }

    // ── Taxes de l'entreprise (CAMU, TOL, apprentissage…) + TOL native ──────
    const companyId =
      employee.companyId ??
      (
        await this.prisma.employee.findUnique({
          where: { id: employee.id },
          select: { companyId: true },
        })
      )?.companyId;

    const companyTaxes = companyId
      ? await this.prisma.companyTax.findMany({
          where: { companyId, isActive: true, isRecurring: true },
          orderBy: { name: 'asc' },
        })
      : [];

    const custom = computeCustomTaxes(companyTaxes, {
      contractType,
      grossSalary,
      cnssSalarial: cnss,
      revenuNetImposable,
      isSubjectToIrpp: employee.isSubjectToIrpp,
      tolZone: employee.tolZone,
    });

    let tol = 0;
    let otherTaxes = 0;
    custom.details.forEach((d: CustomTaxDetail) => {
      if (d.employeeAmount <= 0) return;
      if (d.code === 'TOL') tol += d.employeeAmount;
      else otherTaxes += d.employeeAmount;
      deductions.push({
        kind: 'TAX',
        code: d.code,
        label: d.name,
        amount: d.employeeAmount,
        rate: d.employeeRate,
        base: d.baseType === 'FIXED' ? null : d.base,
      });
    });

    const totalDeductions = cnss + its + custom.employeeTotal;
    // Même formule que le bulletin : brut − retenues + indemnités non imposables
    const netSalary = Math.max(
      0,
      Math.floor(grossSalary - totalDeductions + nonTaxableBonuses),
    );

    return {
      grossSalary,
      nonTaxableBonuses,
      totalGains: grossSalary + nonTaxableBonuses,
      totalDeductions,
      netSalary,
      deductions,
      breakdown: {
        baseSalary,
        monthlyTaxableBonuses,
        monthlyNonTaxableBonuses: nonTaxableBonuses,
        cnss,
        its,
        tol,
        otherTaxes,
      },
    };
  }
}