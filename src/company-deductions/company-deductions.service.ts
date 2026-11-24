// ============================================================================
// 📁 src/company-deductions/company-deductions.service.ts
// ✅ Retenues diverses liées à l'entreprise (pharmacie, cantine, casse
//    matériel, etc.) — saisie directe RH/Admin, aucune demande employé,
//    aucun circuit d'approbation (le RH a déjà l'autorité).
// ✅ Même restriction de rôle que le module prêts/avances : ADMIN et
//    HR_MANAGER uniquement, pas de MANAGER.
// ============================================================================

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDeductionDto } from './dto/create-company-deduction.dto';

const FINANCE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

@Injectable()
export class CompanyDeductionsService {
  constructor(private prisma: PrismaService) {}

  private async getVerifiedUser(userId: string): Promise<{
    id: string;
    companyId: string;
    role: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true },
    });
    if (!user || !user.companyId)
      throw new ForbiddenException(
        'Utilisateur non rattaché à une entreprise.',
      );
    if (!FINANCE_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        "La gestion des retenues est réservée à l'administration et aux RH.",
      );
    }
    return { ...user, companyId: user.companyId };
  }

  async create(dto: CreateCompanyDeductionDto, userId: string) {
    const user = await this.getVerifiedUser(userId);

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId: user.companyId },
    });
    if (!employee)
      throw new NotFoundException('Employé introuvable dans cette entreprise.');

    return this.prisma.companyDeduction.create({
      data: {
        employeeId: dto.employeeId,
        companyId: user.companyId,
        label: dto.label,
        amount: dto.amount,
        // ✅ FIX : remainingBalance est maintenant requis en base (solde
        // restant réellement dû) — initialisé au montant total à la création.
        remainingBalance: dto.amount,
        // ✅ Montant prélevé à CHAQUE paie tant qu'il reste un solde. Si non
        // fourni (DTO pas encore mis à jour côté front), tout le solde part
        // en une fois à la prochaine paie (comportement historique).
        monthlyDeduction: (dto as any).monthlyDeduction ?? null,
        month: dto.month,
        year: dto.year,
        recoverViaPayroll: dto.recoverViaPayroll ?? true,
        recordedBy: userId,
      },
    });
  }

  async findAll(
    userId: string,
    month?: number,
    year?: number,
    status?: string,
  ) {
    const user = await this.getVerifiedUser(userId);
    const where: any = { companyId: user.companyId };
    if (month) where.month = Number(month);
    if (year) where.year = Number(year);
    if (status) where.status = status;

    return this.prisma.companyDeduction.findMany({
      where,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
            photoUrl: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    dto: Partial<CreateCompanyDeductionDto>,
    userId: string,
  ) {
    const user = await this.getVerifiedUser(userId);
    const deduction = await this.getOwnedOrThrow(id, user.companyId);
    if (deduction.status !== 'PENDING')
      throw new BadRequestException(
        'Cette retenue a déjà été déduite — impossible de la modifier.',
      );

    return this.prisma.companyDeduction.update({
      where: { id },
      data: {
        label: dto.label,
        amount: dto.amount,
        month: dto.month,
        year: dto.year,
        ...(dto.recoverViaPayroll != null && { recoverViaPayroll: dto.recoverViaPayroll }),
        ...((dto as any).monthlyDeduction !== undefined && {
          monthlyDeduction: (dto as any).monthlyDeduction,
        }),
      },
    });
  }

  async delete(id: string, userId: string) {
    const user = await this.getVerifiedUser(userId);
    const deduction = await this.getOwnedOrThrow(id, user.companyId);
    if (deduction.status === 'DEDUCTED')
      throw new BadRequestException(
        'Cette retenue a déjà été déduite sur une paie — impossible de la supprimer.',
      );

    await this.prisma.companyDeduction.delete({ where: { id } });
    return { success: true };
  }

  async cancel(id: string, userId: string) {
    const user = await this.getVerifiedUser(userId);
    const deduction = await this.getOwnedOrThrow(id, user.companyId);
    if (deduction.status === 'DEDUCTED')
      throw new BadRequestException(
        'Cette retenue a déjà été déduite sur une paie.',
      );

    return this.prisma.companyDeduction.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * 💵 RÈGLEMENT MANUEL EN ESPÈCES
   * Pour une retenue PENDING — que recoverViaPayroll soit true ou false —
   * le RH peut la solder directement en espèces au lieu d'attendre la paie,
   * même si un `monthlyDeduction` était prévu (règlement intégral du solde
   * restant, peu importe le nombre de tranches restantes).
   * ✅ FIX : remet remainingBalance à 0 (avant : seul le statut changeait,
   * la dette restait affichée comme due) et journalise le montant réellement
   * réglé dans CompanyDeductionRepaymentLog (méthode CASH) — même principe
   * que le règlement cash des prêts. Passe le statut à PAID, jamais
   * retouchée par la génération de paie ensuite.
   */
  async markAsPaidCash(id: string, userId: string) {
    const user = await this.getVerifiedUser(userId);
    const deduction = await this.getOwnedOrThrow(id, user.companyId);
    if (deduction.status !== 'PENDING')
      throw new BadRequestException(
        'Cette retenue n\'est plus en attente — impossible de la régler.',
      );

    const settledAmount = Number(deduction.remainingBalance);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.companyDeduction.update({
        where: { id },
        data: { status: 'PAID', remainingBalance: 0 },
      });

      if (settledAmount > 0) {
        await tx.companyDeductionRepaymentLog.create({
          data: {
            companyDeductionId: id,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            amount: settledAmount,
            method: 'CASH',
            recordedBy: userId,
          },
        });
      }

      return updated;
    });
  }

  /**
   * 💵 RÈGLEMENT EN ESPÈCES — MONTANT LIBRE (complémentaire à markAsPaidCash
   * qui solde tout d'un coup) : "il a réglé 2 000 FCFA, il reste 8 000 FCFA".
   * Plafonné à ce qui reste réellement dû — un montant saisi trop haut est
   * automatiquement plafonné plutôt que de rejeter la requête. Fonctionne
   * que la retenue soit en mode "Sur la paie" ou "En espèces" : le RH peut
   * toujours accélérer un règlement en espèces avant la prochaine paie, qui
   * ne retirera alors que ce qu'il reste.
   */
  async recordCashRepayment(id: string, amount: number, userId: string) {
    const user = await this.getVerifiedUser(userId);
    const deduction = await this.getOwnedOrThrow(id, user.companyId);
    if (deduction.status !== 'PENDING')
      throw new BadRequestException(
        'Cette retenue est déjà soldée ou annulée.',
      );
    if (!amount || amount <= 0)
      throw new BadRequestException('Le montant réglé doit être supérieur à 0.');

    const remaining = Number(deduction.remainingBalance);
    const applied = Math.min(amount, remaining);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const newBalance = Math.max(0, remaining - applied);
      const updated = await tx.companyDeduction.update({
        where: { id },
        data: {
          remainingBalance: newBalance,
          status: newBalance === 0 ? 'PAID' : 'PENDING',
        },
      });

      await tx.companyDeductionRepaymentLog.create({
        data: {
          companyDeductionId: id,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          amount: applied,
          method: 'CASH',
          recordedBy: userId,
        },
      });

      return updated;
    });
  }

  private async getOwnedOrThrow(id: string, companyId: string) {
    const deduction = await this.prisma.companyDeduction.findUnique({
      where: { id },
    });
    if (!deduction) throw new NotFoundException('Retenue introuvable');
    if (deduction.companyId !== companyId)
      throw new ForbiddenException('Accès refusé');
    return deduction;
  }

  // ============================================================================
  // 📊 Utilisé par la paie (mêmes conventions que payroll-deductions.service.ts)
  // ============================================================================

  /**
   * 🔍 RÉCUPÉRER LES RETENUES DIVERSES EN ATTENTE — un seul employé.
   * ✅ v2 : plus de filtre mois/année (month/year ne sont plus qu'une
   * référence de création, voir schema.prisma) — une retenue PENDING avec
   * recoverViaPayroll: true et un solde restant est reprise à CHAQUE
   * génération de paie, exactement comme un prêt actif.
   */
  async getPendingForEmployee(employeeId: string) {
    return this.prisma.companyDeduction.findMany({
      where: {
        employeeId,
        status: 'PENDING',
        recoverViaPayroll: true,
        remainingBalance: { gt: 0 },
      },
    });
  }

  /**
   * 🔍 RÉCUPÉRER LES RETENUES DIVERSES EN ATTENTE — plusieurs employés
   * (génération en masse). Même logique v2 que getPendingForEmployee.
   */
  async getPendingForEmployees(employeeIds: string[]) {
    const deductions = await this.prisma.companyDeduction.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'PENDING',
        recoverViaPayroll: true,
        remainingBalance: { gt: 0 },
      },
    });
    return deductions.reduce(
      (acc, d) => {
        if (!acc[d.employeeId]) acc[d.employeeId] = [];
        acc[d.employeeId].push(d);
        return acc;
      },
      {} as Record<string, typeof deductions>,
    );
  }

  /**
   * 💾 APPLIQUER UNE DÉDUCTION PAIE SUR UNE RETENUE DIVERSE (dans une
   * transaction) — même principe que PayrollDeductionsService.updateLoan() :
   * décrémente remainingBalance, journalise dans
   * CompanyDeductionRepaymentLog (méthode PAYROLL), passe le statut à
   * DEDUCTED quand le solde atteint 0 (sinon reste PENDING pour la
   * prochaine paie).
   * ⚠️ montant réellement retiré = monthlyDeduction s'il est défini, sinon
   * tout le solde restant — jamais plus que ce qui reste dû. Recalculé ici
   * (et non repris tel quel de prepareCompanyDeductionsForCalc) pour rester
   * correct même si le solde a bougé entre la préparation et l'écriture.
   * ✅ Idempotent si la génération de paie est relancée pour le même mois
   * (une seule ligne PAYROLL par retenue/mois), comme pour les prêts.
   */
  async applyPayrollDeduction(
    tx: any,
    deductionId: string,
    remainingBalance: number,
    monthlyDeduction: number | null,
    month: number,
    year: number,
  ) {
    const deductionAmount = Math.min(
      monthlyDeduction != null ? monthlyDeduction : remainingBalance,
      remainingBalance,
    );
    const newBalance = Math.max(0, remainingBalance - deductionAmount);
    const status = newBalance === 0 ? 'DEDUCTED' : 'PENDING';

    const updated = await tx.companyDeduction.update({
      where: { id: deductionId },
      data: { remainingBalance: newBalance, status },
    });

    const existingPayrollLog = await tx.companyDeductionRepaymentLog.findFirst({
      where: { companyDeductionId: deductionId, month, year, method: 'PAYROLL' },
      select: { id: true },
    });
    if (!existingPayrollLog) {
      await tx.companyDeductionRepaymentLog.create({
        data: {
          companyDeductionId: deductionId,
          month,
          year,
          amount: deductionAmount,
          method: 'PAYROLL',
          recordedBy: null,
        },
      });
    }

    return updated;
  }

  /**
   * @deprecated conservé pour compat éventuelle avec un ancien appelant —
   * la paie utilise désormais applyPayrollDeduction (solde décrémenté,
   * pas un solde-tout-en-un).
   */
  async markAsDeducted(tx: any, ids: string[]) {
    if (ids.length === 0) return;
    return tx.companyDeduction.updateMany({
      where: { id: { in: ids } },
      data: { status: 'DEDUCTED' },
    });
  }

  /**
   * 🔍 MONTANTS DÉJÀ PRÉLEVÉS SUR LA PAIE — pour un mois précis (LECTURE
   * SEULE, ne touche jamais remainingBalance).
   * ⚠️ Utilisé uniquement par recalculatePayroll() (édition d'un bulletin
   * déjà généré) : "modifier ≠ rembourser" — on ne doit JAMAIS relire le
   * solde ACTUEL (qui a pu bouger depuis, via les paies suivantes ou un
   * règlement cash) pour recalculer un "nouveau" montant. On relit
   * uniquement ce qui a réellement été journalisé dans
   * CompanyDeductionRepaymentLog pour CE mois précis, lors de la
   * génération initiale du bulletin.
   * Une retenue sans ligne PAYROLL pour ce mois n'apparaît pas ici — elle
   * n'a jamais été appliquée à ce bulletin et l'édition ne doit pas
   * commencer à la prélever.
   */
  async getAppliedForEmployeeAndPeriod(
    employeeId: string,
    month: number,
    year: number,
  ) {
    const logs = await this.prisma.companyDeductionRepaymentLog.findMany({
      where: {
        method: 'PAYROLL',
        month,
        year,
        companyDeduction: { employeeId },
      },
      include: { companyDeduction: { select: { id: true, label: true } } },
    });
    return logs.map((log) => ({
      id: log.companyDeduction.id,
      amount: Number(log.amount),
      label: log.companyDeduction.label,
    }));
  }
}