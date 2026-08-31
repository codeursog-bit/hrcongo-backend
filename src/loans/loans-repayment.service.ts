// ============================================================================
// 📁 loans-repayment.service.ts
// ✅ v2 — Tout ce qui touche au REMBOURSEMENT : déduction paie, remboursement
//    en espèces (montant libre, prêts ET avances), suppression d'une saisie
//    erronée (recalcule automatiquement le solde), historique des mouvements.
// ✅ Les avances ont maintenant le même système que les prêts : remboursement
//    PARTIEL possible (au lieu du seul "tout rembourser d'un coup" d'avant),
//    grâce à `remainingBalance` + `AdvanceRepaymentLog`.
// ============================================================================

import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoansCommonService } from './loans-common.service';

@Injectable()
export class LoansRepaymentService {
  constructor(
    private prisma: PrismaService,
    private common: LoansCommonService,
  ) {}

  // ── Prêts ────────────────────────────────────────────────────────────────

  /** Déduction manuelle ponctuelle (déclenchement isolé, hors cycle de paie normal). */
  async processMonthlyDeduction(loanId: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan || loan.status !== 'ACTIVE') return;

    const newBalance = Math.max(0, Number(loan.remainingBalance) - Number(loan.monthlyRepayment));

    return this.prisma.loan.update({
      where: { id: loanId },
      data: { remainingBalance: newBalance, status: newBalance === 0 ? 'PAID' : 'ACTIVE' },
    });
  }

  /**
   * L'employé a remboursé en espèces (présentiel) — montant LIBRE (pas
   * forcément la mensualité), ex : "il a remboursé 2 000 FCFA, il reste
   * 10 000 FCFA". Le solde restant et le statut se recalculent aussitôt.
   */
  async recordCashRepayment(loanId: string, amount: number, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);

    const loan = await this.common.getOwnedLoanOrThrow(loanId, user.companyId);
    if (loan.status !== 'ACTIVE') throw new BadRequestException('Seul un prêt actif peut recevoir un remboursement en espèces');
    if (!amount || amount <= 0) throw new BadRequestException('Le montant remboursé doit être supérieur à 0');

    const remaining = Number(loan.remainingBalance);
    const applied = Math.min(amount, remaining); // ne peut pas rembourser plus que ce qui reste dû
    const now = new Date();

    await this.prisma.loanRepaymentLog.create({
      data: { loanId, month: now.getMonth() + 1, year: now.getFullYear(), amount: applied, method: 'CASH', recordedBy: userId },
    });

    const newBalance = Math.max(0, remaining - applied);
    await this.prisma.loan.update({
      where: { id: loanId },
      data: { remainingBalance: newBalance, status: newBalance === 0 ? 'PAID' : 'ACTIVE' },
    });

    return { success: true, applied, remainingBalance: newBalance };
  }

  /**
   * Supprime une saisie de remboursement erronée (ex : saisie deux fois par
   * erreur) — remet automatiquement le montant sur le solde restant et
   * repasse le prêt en ACTIF si besoin (il ne peut plus être "soldé" si de
   * l'argent lui est reversé). C'est la façon de "corriger" une saisie :
   * supprimer la mauvaise entrée puis, si besoin, en resaisir une bonne.
   */
  async deleteCashRepayment(loanId: string, logId: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const loan = await this.common.getOwnedLoanOrThrow(loanId, user.companyId);

    const log = await this.prisma.loanRepaymentLog.findUnique({ where: { id: logId } });
    if (!log || log.loanId !== loanId) throw new BadRequestException('Remboursement introuvable pour ce prêt');

    const restoredBalance = Math.min(Number(loan.amount), Number(loan.remainingBalance) + Number(log.amount));

    await this.prisma.$transaction([
      this.prisma.loanRepaymentLog.delete({ where: { id: logId } }),
      this.prisma.loan.update({
        where: { id: loanId },
        data: { remainingBalance: restoredBalance, status: restoredBalance > 0 ? 'ACTIVE' : 'PAID' },
      }),
    ]);

    return { success: true, remainingBalance: restoredBalance };
  }

  async getLoanHistory(loanId: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    await this.common.getOwnedLoanOrThrow(loanId, user.companyId);
    return this.prisma.loanRepaymentLog.findMany({ where: { loanId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  // ── Avances (même système que les prêts : remboursement partiel) ────────

  /**
   * L'employé a remboursé son avance en espèces — montant LIBRE, comme pour
   * les prêts. Remplace l'ancien "tout rembourser d'un coup" par un
   * remboursement partiel possible.
   */
  async recordAdvanceCashRepayment(advanceId: string, amount: number, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);

    const advance = await this.common.getOwnedAdvanceOrThrow(advanceId, user.companyId);
    if (advance.status !== 'APPROVED') throw new BadRequestException('Seule une avance approuvée peut recevoir un remboursement en espèces');
    if (!amount || amount <= 0) throw new BadRequestException('Le montant remboursé doit être supérieur à 0');

    const remaining = Number(advance.remainingBalance);
    const applied = Math.min(amount, remaining);
    const now = new Date();

    await this.prisma.advanceRepaymentLog.create({
      data: { advanceId, month: now.getMonth() + 1, year: now.getFullYear(), amount: applied, method: 'CASH', recordedBy: userId },
    });

    const newBalance = Math.max(0, remaining - applied);
    await this.prisma.advance.update({
      where: { id: advanceId },
      data: { remainingBalance: newBalance, status: newBalance === 0 ? 'PAID' : 'APPROVED', recoverViaPayroll: newBalance === 0 ? false : advance.recoverViaPayroll },
    });

    return { success: true, applied, remainingBalance: newBalance };
  }

  /** Supprime une saisie de remboursement d'avance erronée — même logique que pour les prêts. */
  async deleteAdvanceCashRepayment(advanceId: string, logId: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const advance = await this.common.getOwnedAdvanceOrThrow(advanceId, user.companyId);

    const log = await this.prisma.advanceRepaymentLog.findUnique({ where: { id: logId } });
    if (!log || log.advanceId !== advanceId) throw new BadRequestException('Remboursement introuvable pour cette avance');

    const restoredBalance = Math.min(Number(advance.amount), Number(advance.remainingBalance) + Number(log.amount));

    await this.prisma.$transaction([
      this.prisma.advanceRepaymentLog.delete({ where: { id: logId } }),
      this.prisma.advance.update({
        where: { id: advanceId },
        data: { remainingBalance: restoredBalance, status: restoredBalance > 0 ? 'APPROVED' : 'PAID' },
      }),
    ]);

    return { success: true, remainingBalance: restoredBalance };
  }

  async getAdvanceHistory(advanceId: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    await this.common.getOwnedAdvanceOrThrow(advanceId, user.companyId);
    return this.prisma.advanceRepaymentLog.findMany({ where: { advanceId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  /**
   * Solde tout d'un coup en espèces (raccourci) — équivalent à un
   * remboursement du solde restant en une fois. Journalise dans
   * AdvanceRepaymentLog comme recordAdvanceCashRepayment, sinon ce
   * remboursement resterait invisible dans l'historique/traçabilité.
   */
  async markAdvancePaidInCash(id: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const advance = await this.common.getOwnedAdvanceOrThrow(id, user.companyId);
    if (advance.status !== 'APPROVED') throw new BadRequestException('Seule une avance approuvée peut être marquée remboursée');

    const remaining = Number(advance.remainingBalance ?? advance.amount);
    const now = new Date();

    const [, updated] = await this.prisma.$transaction([
      this.prisma.advanceRepaymentLog.create({
        data: { advanceId: id, month: now.getMonth() + 1, year: now.getFullYear(), amount: remaining, method: 'CASH', recordedBy: userId },
      }),
      this.prisma.advance.update({ where: { id }, data: { status: 'PAID', remainingBalance: 0, recoverViaPayroll: false } }),
    ]);

    return updated;
  }

  async markAdvanceAsDeducted(advanceId: string) {
    return this.prisma.advance.update({ where: { id: advanceId }, data: { status: 'DEDUCTED', deducted: true, remainingBalance: 0 } });
  }
}