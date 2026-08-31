// ============================================================================
// 3️⃣ services/payroll-smic-protection.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import {
  SmicProtectionMode,
  SMIC_CONGO,
  SAFETY_MARGIN,
} from '../constants/payroll.constants';
import type { CalculatedPayroll } from '../constants/payroll.constants';

@Injectable()
export class PayrollSmicProtectionService {
  private readonly logger = new Logger(PayrollSmicProtectionService.name);

  /**
   * 🛡️ DÉTERMINER LE MODE DE PROTECTION
   */
  determineMode(
    baseSalary: number,
    hasVoluntaryDeductions: boolean,
  ): SmicProtectionMode {
    if (baseSalary < SMIC_CONGO) {
      return SmicProtectionMode.DISABLED;
    }
    if (hasVoluntaryDeductions) {
      return SmicProtectionMode.WARNING;
    }
    return SmicProtectionMode.STRICT;
  }

  /**
   * 🔒 GÉRER LES DÉDUCTIONS INTELLIGEMMENT
   */
  handleDeductions(
    emp: any,
    calc: CalculatedPayroll,
    loans: any[],
    advances: any[],
    protectionMode: SmicProtectionMode = SmicProtectionMode.WARNING,
  ) {
    const warnings: string[] = [];

    if (loans.length === 0 && advances.length === 0) {
      return {
        adjustedDeductions: [],
        loansToUpdate: [],
        advancesToDeduct: [],
        deferredAmount: 0,
        canProceed: true,
        warnings: [],
      };
    }

    const totalLoanDeductions = loans.reduce(
      (sum, l) => sum + Number(l.monthlyRepayment),
      0,
    );
    const totalAdvances = advances.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );
    const netBeforeLoansAdvances =
      calc.grossSalary - calc.cnssSalarial - calc.its;
    const netAfterAllDeductions =
      netBeforeLoansAdvances - totalLoanDeductions - totalAdvances;

    // MODE DISABLED
    if (protectionMode === SmicProtectionMode.DISABLED) {
      this.logger.log(
        `💡 Protection SMIC désactivée pour ${emp.firstName} ${emp.lastName}`,
      );
      return {
        adjustedDeductions: [
          ...loans.map((l) => ({
            type: 'Remboursement Prêt',
            amount: Number(l.monthlyRepayment),
            loanId: l.id,
          })),
          ...advances.map((a) => ({
            type: 'Avance sur Salaire',
            amount: Number(a.amount),
            advanceId: a.id,
          })),
        ],
        loansToUpdate: loans.map((l) => ({
          id: l.id,
          deduction: Number(l.monthlyRepayment),
        })),
        advancesToDeduct: advances.map((a) => a.id),
        deferredAmount: 0,
        canProceed: true,
        warnings: [`Protection SMIC désactivée (salaire < ${SMIC_CONGO} FCFA)`],
      };
    }

    // MODE WARNING
    if (protectionMode === SmicProtectionMode.WARNING) {
      if (netAfterAllDeductions < SMIC_CONGO) {
        warnings.push(
          `⚠️ Net après déductions (${netAfterAllDeductions.toLocaleString()} FCFA) < SMIC`,
        );
        warnings.push(`Remboursement volontaire accepté par l'employé`);
      }
      return {
        adjustedDeductions: [
          ...loans.map((l) => ({
            type: 'Remboursement Prêt',
            amount: Number(l.monthlyRepayment),
            loanId: l.id,
          })),
          ...advances.map((a) => ({
            type: 'Avance sur Salaire',
            amount: Number(a.amount),
            advanceId: a.id,
          })),
        ],
        loansToUpdate: loans.map((l) => ({
          id: l.id,
          deduction: Number(l.monthlyRepayment),
        })),
        advancesToDeduct: advances.map((a) => a.id),
        deferredAmount: 0,
        canProceed: true,
        warnings,
      };
    }

    // MODE STRICT
    if (netAfterAllDeductions >= SMIC_CONGO) {
      return {
        adjustedDeductions: [
          ...loans.map((l) => ({
            type: 'Remboursement Prêt',
            amount: Number(l.monthlyRepayment),
            loanId: l.id,
          })),
          ...advances.map((a) => ({
            type: 'Avance sur Salaire',
            amount: Number(a.amount),
            advanceId: a.id,
          })),
        ],
        loansToUpdate: loans.map((l) => ({
          id: l.id,
          deduction: Number(l.monthlyRepayment),
        })),
        advancesToDeduct: advances.map((a) => a.id),
        deferredAmount: 0,
        canProceed: true,
        warnings: [],
      };
    }

    // Ajustement intelligent (logique existante...)
    const maxDeduction = netBeforeLoansAdvances - SMIC_CONGO - SAFETY_MARGIN;

    if (maxDeduction <= 0) {
      return {
        adjustedDeductions: [],
        loansToUpdate: [],
        advancesToDeduct: [],
        deferredAmount: totalLoanDeductions + totalAdvances,
        canProceed: false,
        warnings: [
          'Impossible de déduire sans passer sous le SMIC (mode STRICT)',
        ],
      };
    }

    // ... reste de la logique d'ajustement ...
    return this.adjustDeductionsIntelligently(
      maxDeduction,
      loans,
      advances,
      warnings,
    );
  }

  private adjustDeductionsIntelligently(
    maxDeduction: number,
    loans: any[],
    advances: any[],
    warnings: string[],
  ) {
    const adjustedDeductions: any[] = [];
    const loansToUpdate: any[] = [];
    const advancesToDeduct: string[] = [];
    let remainingBudget = maxDeduction;
    let totalDeferred = 0;

    // Avances en priorité
    for (const advance of advances) {
      if (remainingBudget >= Number(advance.amount)) {
        adjustedDeductions.push({
          type: 'Avance sur Salaire',
          amount: Number(advance.amount),
          advanceId: advance.id,
        });
        advancesToDeduct.push(advance.id);
        remainingBudget -= Number(advance.amount);
      } else {
        totalDeferred += Number(advance.amount);
        warnings.push(`Avance reportée : ${advance.amount} FCFA`);
      }
    }

    // Prêts
    for (const loan of loans) {
      if (remainingBudget >= Number(loan.monthlyRepayment)) {
        adjustedDeductions.push({
          type: 'Remboursement Prêt',
          amount: Number(loan.monthlyRepayment),
          loanId: loan.id,
        });
        loansToUpdate.push({
          id: loan.id,
          deduction: Number(loan.monthlyRepayment),
        });
        remainingBudget -= Number(loan.monthlyRepayment);
      } else if (remainingBudget > 0) {
        adjustedDeductions.push({
          type: 'Remboursement Prêt (Partiel)',
          amount: remainingBudget,
          loanId: loan.id,
        });
        loansToUpdate.push({ id: loan.id, deduction: remainingBudget });
        totalDeferred += Number(loan.monthlyRepayment) - remainingBudget;
        warnings.push(`Prêt partiel : ${remainingBudget} FCFA`);
        remainingBudget = 0;
      } else {
        totalDeferred += Number(loan.monthlyRepayment);
        warnings.push(`Prêt reporté : ${loan.monthlyRepayment} FCFA`);
      }
    }

    return {
      adjustedDeductions,
      loansToUpdate,
      advancesToDeduct,
      deferredAmount: totalDeferred,
      canProceed: true,
      warnings,
    };
  }
}
