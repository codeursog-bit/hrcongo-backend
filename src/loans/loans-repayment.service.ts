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

  // ── Période de remboursement ────────────────────────────────────────────

  /**
   * Résout la période (mois/année) d'un remboursement saisi à la main.
   * - Sans période fournie → mois courant (comportement historique).
   * - Avec période → elle est ENREGISTRÉE telle quelle dans le log, donc tout
   *   ce qui lit les logs (relevé, suivi employé, courbe, paie : skip du mois
   *   déjà couvert en espèces) suit CETTE période, pas la date du jour.
   * - Garde-fous : seulement mois 1-12 et année plausible. Aucune contrainte
   *   sur le mois choisi (ni "pas dans le futur", ni "pas avant le début de la
   *   dette") : ces règles bloquaient des cas réels, ex. un prêt programmé pour
   *   novembre qu'on rembourse déjà en octobre. `notBefore` est conservé en
   *   paramètre pour ne pas changer les appels, mais n'est plus utilisé.
   */
  private resolvePeriod(month?: number, year?: number, notBefore?: { month: number; year: number }) {
    const now = new Date();
    const curM = now.getMonth() + 1;
    const curY = now.getFullYear();
    if (month == null && year == null) return { month: curM, year: curY };

    const m = Number(month ?? curM);
    const y = Number(year ?? curY);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new BadRequestException('Mois de remboursement invalide (1 à 12)');
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('Année de remboursement invalide');
    return { month: m, year: y };
  }

  // ── Prêts ────────────────────────────────────────────────────────────────

  /**
   * Déduction manuelle ponctuelle (déclenchement isolé, hors cycle de paie
   * normal — le cycle de paie automatique passe par deductionsService, pas
   * par ici). Réservée RH/Admin (FINANCE_ROLES), jamais l'employé lui-même,
   * sinon n'importe qui pouvait remettre son propre solde à 0 sans qu'un
   * centime ait réellement été retenu sur sa paie.
   */
  async processMonthlyDeduction(loanId: string, userId: string, overrideCompanyId?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
    this.common.requireFinanceAccess(user.role);
    const loan = await this.common.getOwnedLoanOrThrow(loanId, user.companyId);
    if (loan.status !== 'ACTIVE') return;

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
  async recordCashRepayment(loanId: string, amount: number, userId: string, overrideCompanyId?: string, month?: number, year?: number) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
    this.common.requireFinanceAccess(user.role);

    const loan = await this.common.getOwnedLoanOrThrow(loanId, user.companyId);
    const remaining = Number(loan.remainingBalance);
    // 🔒 Dette entièrement remboursée → plus aucune saisie possible (même si
    // le statut n'a pas encore été mis à jour, le solde à 0 fait foi).
    if (loan.status === 'PAID' || remaining <= 0) throw new BadRequestException('Ce prêt est entièrement remboursé : aucun nouveau remboursement ne peut être saisi');
    if (loan.status !== 'ACTIVE') throw new BadRequestException('Seul un prêt actif peut recevoir un remboursement en espèces');
    if (!amount || amount <= 0) throw new BadRequestException('Le montant remboursé doit être supérieur à 0');
    if (amount > remaining) throw new BadRequestException(`Le montant dépasse le reste dû (${remaining} FCFA)`);

    const period = this.resolvePeriod(month, year, { month: new Date(loan.startDate).getUTCMonth() + 1, year: new Date(loan.startDate).getUTCFullYear() });
    const applied = amount;

    await this.prisma.loanRepaymentLog.create({
      data: { loanId, month: period.month, year: period.year, amount: applied, method: 'CASH', recordedBy: userId },
    });

    const newBalance = Math.max(0, remaining - applied);
    await this.prisma.loan.update({
      where: { id: loanId },
      data: { remainingBalance: newBalance, status: newBalance === 0 ? 'PAID' : 'ACTIVE' },
    });

    return { success: true, applied, remainingBalance: newBalance, month: period.month, year: period.year };
  }

  /**
   * Supprime une saisie de remboursement erronée (ex : saisie deux fois par
   * erreur) — remet automatiquement le montant sur le solde restant et
   * repasse le prêt en ACTIF si besoin (il ne peut plus être "soldé" si de
   * l'argent lui est reversé). C'est la façon de "corriger" une saisie :
   * supprimer la mauvaise entrée puis, si besoin, en resaisir une bonne.
   */
  async deleteCashRepayment(loanId: string, logId: string, userId: string, overrideCompanyId?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
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

  async getLoanHistory(loanId: string, userId: string, overrideCompanyId?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
    await this.common.getOwnedLoanOrThrow(loanId, user.companyId);
    return this.prisma.loanRepaymentLog.findMany({ where: { loanId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  // ── Avances (même système que les prêts : remboursement partiel) ────────

  /**
   * L'employé a remboursé son avance en espèces — montant LIBRE, comme pour
   * les prêts. Remplace l'ancien "tout rembourser d'un coup" par un
   * remboursement partiel possible.
   */
  async recordAdvanceCashRepayment(advanceId: string, amount: number, userId: string, overrideCompanyId?: string, month?: number, year?: number) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
    this.common.requireFinanceAccess(user.role);

    const advance = await this.common.getOwnedAdvanceOrThrow(advanceId, user.companyId);
    const remaining = Number(advance.remainingBalance);
    if (['PAID', 'DEDUCTED'].includes(advance.status) || remaining <= 0) throw new BadRequestException('Cette avance est entièrement remboursée : aucun nouveau remboursement ne peut être saisi');
    if (advance.status !== 'APPROVED') throw new BadRequestException('Seule une avance approuvée peut recevoir un remboursement en espèces');
    if (!amount || amount <= 0) throw new BadRequestException('Le montant remboursé doit être supérieur à 0');
    if (amount > remaining) throw new BadRequestException(`Le montant dépasse le reste dû (${remaining} FCFA)`);

    const period = this.resolvePeriod(month, year, { month: advance.month, year: advance.year });
    const applied = amount;

    await this.prisma.advanceRepaymentLog.create({
      data: { advanceId, month: period.month, year: period.year, amount: applied, method: 'CASH', recordedBy: userId },
    });

    const newBalance = Math.max(0, remaining - applied);
    await this.prisma.advance.update({
      where: { id: advanceId },
      data: { remainingBalance: newBalance, status: newBalance === 0 ? 'PAID' : 'APPROVED', recoverViaPayroll: newBalance === 0 ? false : advance.recoverViaPayroll },
    });

    return { success: true, applied, remainingBalance: newBalance, month: period.month, year: period.year };
  }

  /** Supprime une saisie de remboursement d'avance erronée — même logique que pour les prêts. */
  async deleteAdvanceCashRepayment(advanceId: string, logId: string, userId: string, overrideCompanyId?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
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

  async getAdvanceHistory(advanceId: string, userId: string, overrideCompanyId?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
    await this.common.getOwnedAdvanceOrThrow(advanceId, user.companyId);
    return this.prisma.advanceRepaymentLog.findMany({ where: { advanceId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  /**
   * Solde tout d'un coup en espèces (raccourci) — équivalent à un
   * remboursement du solde restant en une fois. Journalise dans
   * AdvanceRepaymentLog comme recordAdvanceCashRepayment, sinon ce
   * remboursement resterait invisible dans l'historique/traçabilité.
   */
  async markAdvancePaidInCash(id: string, userId: string, overrideCompanyId?: string, month?: number, year?: number) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
    this.common.requireFinanceAccess(user.role);
    const advance = await this.common.getOwnedAdvanceOrThrow(id, user.companyId);
    if (advance.status !== 'APPROVED') throw new BadRequestException('Seule une avance approuvée peut être marquée remboursée');

    const remaining = Number(advance.remainingBalance ?? advance.amount);
    if (remaining <= 0) throw new BadRequestException('Cette avance est entièrement remboursée');
    const period = this.resolvePeriod(month, year, { month: advance.month, year: advance.year });

    const [, updated] = await this.prisma.$transaction([
      this.prisma.advanceRepaymentLog.create({
        data: { advanceId: id, month: period.month, year: period.year, amount: remaining, method: 'CASH', recordedBy: userId },
      }),
      this.prisma.advance.update({ where: { id }, data: { status: 'PAID', remainingBalance: 0, recoverViaPayroll: false } }),
    ]);

    return updated;
  }

  /** Réservée RH/Admin — même raison que processMonthlyDeduction : un employé ne doit jamais pouvoir marquer sa propre avance comme déduite. */
  async markAdvanceAsDeducted(advanceId: string, userId: string, overrideCompanyId?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.applyCompanyOverride(user, overrideCompanyId);
    this.common.requireFinanceAccess(user.role);
    await this.common.getOwnedAdvanceOrThrow(advanceId, user.companyId);

    return this.prisma.advance.update({ where: { id: advanceId }, data: { status: 'DEDUCTED', deducted: true, remainingBalance: 0 } });
  }
}