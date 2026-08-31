// ============================================================================
// services/payroll-deductions.service.ts
// 📊 GESTION DES PRÊTS ET AVANCES
// ✅ Patch v2 (INTEGRATION-prets-avances.md §7) :
//    - recoverViaPayroll: true respecté (sinon suivi 100% manuel/espèces)
//    - skip mensuel si un remboursement CASH existe déjà pour ce mois
//    - journalisation PAYROLL dans LoanRepaymentLog à chaque déduction
//    - branchement des retenues diverses (CompanyDeduction)
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyDeductionsService } from '../../company-deductions/company-deductions.service';

@Injectable()
export class PayrollDeductionsService {
  private readonly logger = new Logger(PayrollDeductionsService.name);

  constructor(
    private prisma: PrismaService,
    private companyDeductionsService: CompanyDeductionsService,
  ) {}

  /**
   * 🔍 RÉCUPÉRER LES PRÊTS ACTIFS POUR UN EMPLOYÉ
   * - Ne renvoie que les prêts recoverViaPayroll: true (les autres sont
   *   suivis 100% manuellement / remboursés en espèces).
   * - Si month/year fournis, exclut les prêts déjà couverts par un
   *   remboursement CASH ce mois-là (voir recordCashRepayment).
   */
  async getActiveLoans(employeeId: string, month?: number, year?: number) {
    const loans = await this.prisma.loan.findMany({
      where: {
        employeeId,
        status: 'ACTIVE',
        recoverViaPayroll: true,
      },
    });
    if (!month || !year) return loans; // rétro-compatible si appelé sans période

    const cashLogs = await this.prisma.loanRepaymentLog.findMany({
      where: { loanId: { in: loans.map(l => l.id) }, month, year, method: 'CASH' },
    });
    const skipIds = new Set(cashLogs.map(l => l.loanId));
    return loans.filter(l => !skipIds.has(l.id));
  }

  /**
   * 🔍 RÉCUPÉRER LES AVANCES APPROUVÉES POUR UN MOIS
   * - recoverViaPayroll: true uniquement (sinon marquée payée en espèces
   *   via markAdvancePaidInCash, ne doit jamais être déduite ici).
   */
  async getApprovedAdvances(employeeId: string, month: number, year: number) {
    return this.prisma.advance.findMany({
      where: {
        employeeId,
        deductMonth: month,
        deductYear: year,
        status: 'APPROVED',
        recoverViaPayroll: true,
      },
    });
  }

  /**
   * 🔍 RÉCUPÉRER LES PRÊTS POUR PLUSIEURS EMPLOYÉS (génération en masse)
   * - Même logique que getActiveLoans : recoverViaPayroll: true + skip
   *   des prêts déjà couverts en espèces ce mois-ci.
   */
  async getLoansByEmployees(employeeIds: string[], month?: number, year?: number) {
    let loans = await this.prisma.loan.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'ACTIVE',
        recoverViaPayroll: true,
      },
    });

    if (month && year) {
      const cashLogs = await this.prisma.loanRepaymentLog.findMany({
        where: { loanId: { in: loans.map(l => l.id) }, month, year, method: 'CASH' },
      });
      const skipIds = new Set(cashLogs.map(l => l.loanId));
      loans = loans.filter(l => !skipIds.has(l.id));
    }

    // Regrouper par employé
    return loans.reduce((acc, loan) => {
      if (!acc[loan.employeeId]) acc[loan.employeeId] = [];
      acc[loan.employeeId].push(loan);
      return acc;
    }, {} as Record<string, typeof loans>);
  }

  /**
   * 🔍 RÉCUPÉRER LES AVANCES POUR PLUSIEURS EMPLOYÉS (génération en masse)
   */
  async getAdvancesByEmployees(employeeIds: string[], month: number, year: number) {
    const advances = await this.prisma.advance.findMany({
      where: {
        employeeId: { in: employeeIds },
        deductMonth: month,
        deductYear: year,
        status: 'APPROVED',
        recoverViaPayroll: true,
      },
    });

    // Regrouper par employé
    return advances.reduce((acc, adv) => {
      if (!acc[adv.employeeId]) acc[adv.employeeId] = [];
      acc[adv.employeeId].push(adv);
      return acc;
    }, {} as Record<string, typeof advances>);
  }

  /**
   * 💾 METTRE À JOUR UN PRÊT (dans une transaction)
   * ✅ Journalise systématiquement la déduction dans LoanRepaymentLog
   *    (méthode PAYROLL) — permet à recordCashRepayment de savoir plus
   *    tard que ce mois est déjà couvert, et donne un historique complet.
   */
  async updateLoan(
    tx: any,
    loanId: string,
    deduction: number,
    remainingBalance: number,
    month: number,
    year: number,
    isPartial: boolean = false
  ) {
    const newBalance = Math.max(0, remainingBalance - deduction);
    const status = newBalance === 0 ? 'PAID' : 'ACTIVE';

    const updateData: any = {
      remainingBalance: newBalance,
      status
    };

    // Ajouter une note si déduction partielle
    if (isPartial) {
      const loan = await tx.loan.findUnique({ 
        where: { id: loanId },
        select: { notes: true }
      });
      
      updateData.notes = `${loan?.notes || ''}\n[${month}/${year}] Déduction partielle : ${deduction} FCFA`.trim();
    }

    const updated = await tx.loan.update({
      where: { id: loanId },
      data: updateData
    });

    // ✅ Journal de la déduction payroll — idempotent si la génération de
    // paie est relancée pour le même mois (une seule ligne PAYROLL par
    // prêt/mois). On ne s'appuie plus sur un upsert avec clé composite
    // `loanId_month_year` : cette contrainte unique n'existe pas en base
    // (et ne doit pas être ajoutée globalement, car elle empêcherait les
    // remboursements CASH multiples dans le même mois, qui restent
    // autorisés). On vérifie donc manuellement, en ne ciblant que la
    // méthode PAYROLL.
    const existingPayrollLog = await tx.loanRepaymentLog.findFirst({
      where: { loanId, month, year, method: 'PAYROLL' },
      select: { id: true },
    });
    if (!existingPayrollLog) {
      await tx.loanRepaymentLog.create({
        data: { loanId, month, year, amount: deduction, method: 'PAYROLL', recordedBy: null },
      });
    }

    return updated;
  }

  /**
   * 💾 MARQUER LES AVANCES COMME DÉDUITES (dans une transaction)
   * ✅ Journalise chaque avance dans AdvanceRepaymentLog (méthode PAYROLL) —
   *    sans ça, la fiche "Relevé de compte" de l'employé n'a aucune trace du
   *    mouvement (elle se base uniquement sur l'historique des logs) et
   *    affiche 0 FCFA remboursé même quand l'avance a bien été déduite.
   *    Même logique que updateLoan() pour les prêts.
   */
  async markAdvancesAsDeducted(tx: any, advanceIds: string[], month: number, year: number) {
    if (advanceIds.length === 0) return;

    const advances = await tx.advance.findMany({
      where: { id: { in: advanceIds } },
      select: { id: true, remainingBalance: true, amount: true },
    });

    await tx.advance.updateMany({
      where: { id: { in: advanceIds } },
      data: { 
        status: 'DEDUCTED', 
        deducted: true,
        remainingBalance: 0,
      }
    });

    for (const advance of advances) {
      const deducted = Number(advance.remainingBalance ?? advance.amount);
      if (deducted <= 0) continue;
      await tx.advanceRepaymentLog.create({
        data: { advanceId: advance.id, month, year, amount: deducted, method: 'PAYROLL', recordedBy: null },
      });
    }
  }

  /**
   * 🔍 RÉCUPÉRER LES RETENUES DIVERSES EN ATTENTE — un seul employé
   * (génération unique / paie manuelle). Même logique que getActiveLoans /
   * getApprovedAdvances : pas de filtre mois/année, reprise tant qu'il
   * reste un solde.
   * ⚠️ RÉSERVÉ À LA GÉNÉRATION — voir getAppliedCompanyDeductionsForEmployee
   * pour l'édition d'un bulletin déjà généré.
   */
  async getPendingCompanyDeductionsForEmployee(employeeId: string) {
    return this.companyDeductionsService.getPendingForEmployee(employeeId);
  }

  /**
   * 🔍 RÉCUPÉRER LES RETENUES DIVERSES (pharmacie, cantine, casse matériel...)
   * en attente pour plusieurs employés — génération en masse.
   * ✅ v2 : plus de filtre mois/année — une retenue éligible à la paie est
   *    reprise à chaque génération tant qu'il reste un solde (comme un prêt).
   */
  async getPendingCompanyDeductions(employeeIds: string[]) {
    return this.companyDeductionsService.getPendingForEmployees(employeeIds);
  }

  /**
   * 🔍 MONTANTS DÉJÀ PRÉLEVÉS (retenues diverses) — pour un bulletin déjà
   * généré, un mois précis (LECTURE SEULE).
   * ⚠️ À utiliser UNIQUEMENT dans recalculatePayroll() (édition d'un
   * bulletin existant) — jamais dans un flux de génération. "Modifier ≠
   * rembourser" : contrairement à prepareCompanyDeductionsForCalc() (qui
   * recalcule un NOUVEAU montant depuis le solde actuel), cette méthode
   * relit ce qui a réellement été journalisé pour CE mois lors de la
   * génération initiale — le solde a pu bouger depuis (paies suivantes,
   * règlement cash), et l'édition ne doit ni le re-décrémenter ni changer
   * le montant affiché rétroactivement.
   * Voir CompanyDeductionsService.getAppliedForEmployeeAndPeriod.
   */
  async getAppliedCompanyDeductionsForEmployee(
    employeeId: string,
    month: number,
    year: number,
  ) {
    return this.companyDeductionsService.getAppliedForEmployeeAndPeriod(
      employeeId,
      month,
      year,
    );
  }

  /**
   * 🔍 MONTANTS DÉJÀ PRÉLEVÉS SUR LA PAIE (prêts) — pour un bulletin déjà
   * généré, un mois précis (LECTURE SEULE).
   * ⚠️ À utiliser UNIQUEMENT dans recalculatePayroll() (édition d'un
   * bulletin existant) — jamais en génération. Même principe "modifier ≠
   * rembourser" que pour les retenues diverses (voir
   * getAppliedCompanyDeductionsForEmployee) : getActiveLoans() reflète
   * l'état ACTUEL du prêt (status ACTIVE, remainingBalance courant), qui a
   * pu changer depuis la génération initiale de ce bulletin précis — un
   * prêt soldé entre-temps n'apparaîtrait même plus du tout. On relit donc
   * LoanRepaymentLog (méthode PAYROLL) pour CE mois exact.
   * ⚠️ Suppose que le modèle LoanRepaymentLog expose une relation `loan`
   * vers Loan (comme CompanyDeductionRepaymentLog → companyDeduction) —
   * à vérifier contre schema.prisma si la compilation échoue ici.
   */
  async getAppliedLoanDeductionsForEmployee(
    employeeId: string,
    month: number,
    year: number,
  ) {
    const logs = await this.prisma.loanRepaymentLog.findMany({
      where: {
        method: 'PAYROLL',
        month,
        year,
        loan: { employeeId },
      },
      select: { loanId: true, amount: true },
    });
    return logs.map((log) => ({ id: log.loanId, amount: Number(log.amount) }));
  }

  /**
   * 🔍 MONTANTS DÉJÀ PRÉLEVÉS SUR LA PAIE (avances) — même principe que
   * getAppliedLoanDeductionsForEmployee ci-dessus, via AdvanceRepaymentLog.
   * ⚠️ Particulièrement important ici : une avance passe à DEDUCTED dès sa
   * première déduction (jamais plus APPROVED ensuite) — sans ce fix,
   * getApprovedAdvances() ne la retrouverait plus JAMAIS après coup, et sa
   * ligne disparaîtrait à chaque réédition du bulletin.
   */
  async getAppliedAdvanceDeductionsForEmployee(
    employeeId: string,
    month: number,
    year: number,
  ) {
    const logs = await this.prisma.advanceRepaymentLog.findMany({
      where: {
        method: 'PAYROLL',
        month,
        year,
        advance: { employeeId },
      },
      select: { advanceId: true, amount: true },
    });
    return logs.map((log) => ({ id: log.advanceId, amount: Number(log.amount) }));
  }

  /**
   * 📐 PRÉPARER LES RETENUES DIVERSES POUR LE CALCUL DE PAIE
   * Pour chaque retenue éligible : combien retirer CE mois (monthlyDeduction
   * si défini, sinon tout le solde restant — jamais plus que ce qui reste dû).
   * Retourne à la fois les entrées à passer au calculateur (même forme que
   * les autres déductions : { amount, label }) et la liste à appliquer après
   * coup (via applyPayrollDeduction) pour journaliser + décrémenter le solde.
   * ⚠️ Ne passe PAS par smicProtection (qui ne connaît que prêts/avances) —
   *    le RH reste seul juge du montant mensuel via `monthlyDeduction` à la
   *    création/modification de la retenue.
   * ⚠️ RÉSERVÉ À LA GÉNÉRATION (create / manual save / generate en masse).
   *    Ne JAMAIS appeler ceci dans recalculatePayroll() — voir
   *    getAppliedCompanyDeductionsForEmployee() ci-dessus pour l'édition
   *    d'un bulletin déjà généré.
   */
  prepareCompanyDeductionsForCalc(companyDeductions: any[]) {
    const entries = companyDeductions.map((d) => {
      const remaining = Number(d.remainingBalance);
      const toDeduct = Math.min(
        d.monthlyDeduction != null ? Number(d.monthlyDeduction) : remaining,
        remaining,
      );
      return { id: d.id, amount: toDeduct, label: d.label };
    }).filter((e) => e.amount > 0);

    return {
      calcEntries: entries.map((e) => ({ amount: e.amount, label: e.label, type: 'COMPANY_DEDUCTION' })),
      toApply: entries,
    };
  }

  /**
   * 💾 APPLIQUER UNE DÉDUCTION PAIE SUR UNE RETENUE DIVERSE (passthrough)
   * Voir CompanyDeductionsService.applyPayrollDeduction — décrémente le
   * solde restant et journalise dans CompanyDeductionRepaymentLog.
   */
  async applyCompanyDeduction(
    tx: any,
    deductionId: string,
    remainingBalance: number,
    monthlyDeduction: number | null,
    month: number,
    year: number,
  ) {
    return this.companyDeductionsService.applyPayrollDeduction(
      tx,
      deductionId,
      remainingBalance,
      monthlyDeduction,
      month,
      year,
    );
  }

  /**
   * 📊 CALCULER LE TOTAL DES DÉDUCTIONS
   */
  calculateTotalDeductions(loans: any[], advances: any[]) {
    const totalLoans = loans.reduce((sum, l) => sum + Number(l.monthlyRepayment), 0);
    const totalAdvances = advances.reduce((sum, a) => sum + Number(a.amount), 0);
    
    return {
      totalLoans,
      totalAdvances,
      total: totalLoans + totalAdvances
    };
  }
}