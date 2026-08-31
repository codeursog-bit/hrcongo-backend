// ============================================================================
// 📁 src/employees/salary-estimate.service.ts
//
// Calcul autonome du "brut / net" contractuel d'un employé, volontairement
// indépendant du simulateur de paie complet (/payrolls/simulate) :
//   - Brut = salaire de base + primes MENSUELLES imposables actives
//     (transport, sursalaire... — jamais le 13e mois ni une prime à mois
//     ciblé, qui sont temporaires par nature)
//   - Net  = Brut − CNSS − ITS − TOL uniquement
//
// Volontairement AUCUNE autre retenue (prêts, avances, taxes custom,
// pointage réel) : le but est un montant stable représentant ce que le
// contrat de l'employé donne "en théorie", pas une simulation de bulletin.
// Réutilise le même service ITS (IrppCalculatorService) et les mêmes
// constantes CNSS/TOL que le vrai calculateur de paie, pour ne jamais
// diverger du barème réel.
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IrppCalculatorService } from '../payroll/fiscal/irpp-calculator.service';
import { FISCAL_MODE } from '../payroll/fiscal/tax-brackets.constant';

const CNSS_PENSION_CEILING = 1_200_000;
const CNSS_SALARIAL_RATE = 0.04;
const SALARIED_CONTRACTS = ['CDI', 'CDD', 'STAGE'];
const TOL_CONTRACTS = ['CDI', 'CDD'];
const SMIG_CONGO = 50_400;

export interface SalaryEstimateResult {
  grossSalary: number;
  netSalary: number;
  breakdown: {
    baseSalary: number;
    monthlyTaxableBonuses: number;
    cnss: number;
    its: number;
    tol: number;
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
}

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
      baseSalary: number | string;
      contractType?: string | null;
      maritalStatus?: string | null;
      numberOfChildren?: number | null;
      isSubjectToCnss?: boolean | null;
      isSubjectToIrpp?: boolean | null;
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

    // ── Primes MENSUELLES actives et imposables uniquement ──────────────────
    // (jamais ANNUAL/ONE_TIME — 13e mois et primes à mois ciblé sont
    // temporaires, ils ne représentent pas le salaire contractuel stable)
    const bonuses = await this.prisma.employeeBonus.findMany({
      where: { employeeId: employee.id, isActive: true, frequency: 'MONTHLY' },
    });

    let monthlyTaxableBonuses = 0;
    let monthlyTaxableCnssBonuses = 0;
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
      if (amount <= 0 || !b.isTaxable) continue;

      monthlyTaxableBonuses += amount;
      if (b.isCnss) monthlyTaxableCnssBonuses += amount;
    }

    // ── Prime en cours de création (pas encore enregistrée) ────────────────
    // Ajoutée à son montant plein mois, exactement comme les autres — jamais
    // proratisée, pour rester cohérent avec le principe "contractuel".
    if (previewBonus && previewBonus.amount > 0 && previewBonus.isTaxable) {
      monthlyTaxableBonuses += previewBonus.amount;
      if (previewBonus.isCnss) monthlyTaxableCnssBonuses += previewBonus.amount;
    }

    const grossSalary = Math.round(baseSalary + monthlyTaxableBonuses);
    const grossSalaryCnss = Math.round(baseSalary + monthlyTaxableCnssBonuses);

    // ── CNSS salarié — 4%, plafonné à 1 200 000, CDI/CDD uniquement ─────────
    let cnss = 0;
    if (isSalaried && !isStagiaire && employee.isSubjectToCnss !== false) {
      const base = Math.min(Math.max(0, grossSalaryCnss), CNSS_PENSION_CEILING);
      cnss = Math.round(base * CNSS_SALARIAL_RATE);
    }

    // ── ITS — même service que la paie réelle (barème ITS 2026 / legacy) ───
    let its = 0;
    const canApplyIts =
      isSalaried &&
      !isBncWorker &&
      !isInterim &&
      employee.isSubjectToIrpp !== false &&
      (!isStagiaire || grossSalary > SMIG_CONGO);
    if (canApplyIts) {
      const fiscalMode =
        new Date().getFullYear() < 2026
          ? FISCAL_MODE.IRPP_LEGACY
          : FISCAL_MODE.ITS_2026;
      const result = this.irppCalculator.calculateIRPP(
        grossSalary,
        cnss,
        (employee.maritalStatus ?? 'SINGLE') as any,
        employee.numberOfChildren ?? 0,
        fiscalMode as any,
      );
      its = result.irppTotal;
    }

    // ── TOL — montant fixe selon la zone, CDI/CDD uniquement ────────────────
    let tol = 0;
    if (TOL_CONTRACTS.includes(contractType)) {
      const zone = employee.tolZone ?? 'VILLE';
      tol = zone === 'PERIPHERIE' ? 1000 : 5000;
    }

    const netSalary = Math.max(0, grossSalary - cnss - its - tol);

    return {
      grossSalary,
      netSalary,
      breakdown: { baseSalary, monthlyTaxableBonuses, cnss, its, tol },
    };
  }
}