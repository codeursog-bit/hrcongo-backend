// ============================================================================
// 📁 loans-requests.service.ts
// ✅ Cycle de vie des demandes : création (SANS restriction de montant —
//    plus de plafond SMIC/ratio/durée, demande explicite), listing, édition,
//    suppression, annulation. Ne contient PAS la logique de décision
//    (→ loans-decision.service.ts) ni le remboursement
//    (→ loans-repayment.service.ts).
// ============================================================================

import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { UpdateAdvanceDto } from './dto/update-advance.dto';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import { LoansCommonService } from './loans-common.service';
import { FULL_ADMIN_ROLES, DRH_ROLES, FINANCE_ROLES } from './loans.constants';

@Injectable()
export class LoansRequestsService {
  private readonly logger = new Logger(LoansRequestsService.name);

  constructor(
    private prisma: PrismaService,
    private common: LoansCommonService,
    private subscriptionGuard: SubscriptionGuard,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================================================
  // 💳 PRÊTS (argent / marchandise / autre)
  // ============================================================================

  async createLoan(data: CreateLoanDto, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasLoansAndAdvances');

    const { employee, isOnBehalf } = await this.common.resolveTargetEmployee(data.employeeId, user);

    // ── Workflow (validation PARALLÈLE) ─────────────────────────────────────
    // - Employé (self-service, si l'app lui est ouverte) → PENDING, la demande
    //   part en même temps vers DRH_ROLES (ADMIN/SUPER_ADMIN/HR_MANAGER) ;
    //   le premier présent tranche, plus de circuit séquentiel.
    // - ADMIN / SUPER_ADMIN / HR_MANAGER qui crée pour un employé → cette
    //   personne EST déjà une autorité de décision valide (elle est présente
    //   et signe l'opération) → prêt directement ACTIVE, les deux cases de
    //   la fiche imprimable (DRH/DG) sont cochées avec sa décision.
    const autoApprove = isOnBehalf && DRH_ROLES.includes(user.role);
    const status = autoApprove ? 'ACTIVE' : 'PENDING';

    const loan = await this.prisma.loan.create({
      data: {
        employeeId: employee.id,
        type: data.type ?? 'ARGENT',
        amount: data.amount,
        monthlyRepayment: data.monthlyRepayment,
        remainingBalance: data.amount,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        status,
        reason: data.reason,
        requestedByUserId: userId,
        drhDecision: autoApprove ? 'OUI' : undefined,
        drhDecidedBy: autoApprove ? userId : undefined,
        drhDecidedAt: autoApprove ? new Date() : undefined,
        dgDecision: autoApprove ? 'OUI' : undefined,
        dgDecidedBy: autoApprove ? userId : undefined,
        dgDecidedAt: autoApprove ? new Date() : undefined,
        decidedByRole: autoApprove ? (user.role === 'HR_MANAGER' ? 'DRH' : 'DG') : undefined,
        recoverViaPayroll: autoApprove ? (data.recoverViaPayroll ?? true) : undefined,
        approvedBy: autoApprove ? userId : undefined,
        approvedAt: autoApprove ? new Date() : undefined,
      },
    });

    this.logger.log(`📝 ${autoApprove ? 'Prêt créé et finalisé directement' : 'Demande de prêt créée'} : ${data.amount.toLocaleString()} FCFA (${loan.status})`);

    if (!autoApprove) {
      // Parallèle : tout le groupe habilité à décider est notifié en même temps.
      await this.notificationsService.createForGroup(employee.companyId, DRH_ROLES, {
        type: 'LOAN_REQUEST' as NotificationType,
        title: '💳 Nouvelle demande de prêt',
        message: `${employee.firstName} ${employee.lastName} demande un prêt (${(data.type ?? 'ARGENT').toLowerCase()}) de ${data.amount.toLocaleString()} FCFA`,
        link: '/finances/prets-avances',
        metadata: { loanId: loan.id, employeeId: employee.id },
      });
    }

    return loan;
  }

  async findAllLoans(userId: string, status?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);

    const whereClause: any = { employee: { companyId: user.companyId } };
    if (status) whereClause.status = status;

    return this.prisma.loan.findMany({
      where: whereClause,
      include: {
        employee: { select: this.common.employeeSelect },
        // ✅ Sans ça, le frontend (Suivi des dettes, Relevé, Vue d'ensemble)
        // ne peut jamais calculer "remboursé ce mois-ci" — repaymentLogs
        // restait toujours vide côté client, donc le total tombait à 0 peu
        // importe les vrais remboursements en base.
        repaymentLogs: { orderBy: [{ year: 'desc' }, { month: 'desc' }] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMyLoans(userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    const employee = await this.prisma.employee.findFirst({ where: { email: user.email ?? undefined, companyId: user.companyId } });
    if (!employee) throw new NotFoundException("Aucun dossier employé associé à ce compte.");

    return this.prisma.loan.findMany({
      where: { employeeId: employee.id },
      include: { repaymentLogs: { orderBy: [{ year: 'desc' }, { month: 'desc' }] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneLoan(id: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: {
        employee: { select: { ...this.common.employeeSelect, hireDate: true } },
        repaymentLogs: { orderBy: [{ year: 'desc' }, { month: 'desc' }] },
      },
    });
    if (!loan) throw new NotFoundException('Prêt introuvable');

    const empCompany = await this.prisma.employee.findUnique({ where: { id: loan.employeeId }, select: { companyId: true } });
    if (empCompany?.companyId !== user.companyId) throw new ForbiddenException('Accès refusé');
    if (!FINANCE_ROLES.includes(user.role)) {
      const selfEmployee = await this.prisma.employee.findFirst({ where: { email: user.email ?? undefined, companyId: user.companyId } });
      if (!selfEmployee || selfEmployee.id !== loan.employeeId) throw new ForbiddenException('Accès refusé');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { legalName: true, tradeName: true, logo: true, rccmNumber: true, taxNumber: true, address: true, phone: true },
    });

    return { ...loan, company };
  }

  /**
   * Édition — l'ADMIN/SUPER_ADMIN peut modifier à tout moment (CRUD complet).
   * Le HR_MANAGER ne peut modifier que tant qu'aucune décision n'a été prise.
   */
  async updateLoan(id: string, dto: UpdateLoanDto, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const loan = await this.common.getOwnedLoanOrThrow(id, user.companyId);

    if (!FULL_ADMIN_ROLES.includes(user.role) && loan.status !== 'PENDING') {
      throw new BadRequestException('Ce prêt ne peut plus être modifié (une décision a déjà été prise). Seul un administrateur peut modifier un prêt à ce stade.');
    }

    // ⚠️ Ne jamais écraser remainingBalance par le nouveau montant brut : ça
    // effacerait les remboursements déjà enregistrés (ex: prêt à 400 000,
    // 100 000 déjà remboursés → correction du montant à 200 000 doit laisser
    // 100 000 restant, pas remettre 200 000). On ajuste par le delta.
    let remainingBalance: number | undefined = undefined;
    let newStatus: 'ACTIVE' | 'PAID' | undefined = undefined;
    if (dto.amount !== undefined && dto.amount !== Number(loan.amount)) {
      const alreadyRepaid = Number(loan.amount) - Number(loan.remainingBalance);
      remainingBalance = Math.max(0, dto.amount - alreadyRepaid);
      // Ne recalculer le statut que si le prêt a déjà été décaissé (ACTIVE/PAID) —
      // ne jamais faire passer un prêt encore PENDING/REJECTED à ACTIVE via une simple édition de montant.
      if (['ACTIVE', 'PAID'].includes(loan.status)) {
        newStatus = remainingBalance === 0 ? 'PAID' : 'ACTIVE';
      }
    }

    return this.prisma.loan.update({
      where: { id },
      data: {
        amount: dto.amount,
        monthlyRepayment: dto.monthlyRepayment,
        remainingBalance,
        status: newStatus,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        reason: dto.reason,
      },
    });
  }

  /**
   * Suppression — l'ADMIN/SUPER_ADMIN peut supprimer à tout moment (CRUD complet).
   * Le HR_MANAGER est limité aux statuts qui n'ont jamais touché la paie
   * (pour un prêt actif/soldé, utiliser `cancelLoan` à la place).
   */
  async deleteLoan(id: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const loan = await this.common.getOwnedLoanOrThrow(id, user.companyId);

    if (!FULL_ADMIN_ROLES.includes(user.role) && !['PENDING', 'PENDING_DG', 'REJECTED', 'CANCELLED'].includes(loan.status)) {
      throw new BadRequestException("Ce prêt est actif ou soldé — utilisez plutôt l'annulation pour préserver l'historique de paie, ou demandez à un administrateur.");
    }

    await this.prisma.loan.delete({ where: { id } });
    return { success: true };
  }

  /** Annulation d'un prêt ACTIF — conserve l'historique de remboursement déjà effectué, arrête les futures déductions. */
  async cancelLoan(id: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const loan = await this.common.getOwnedLoanOrThrow(id, user.companyId);
    if (loan.status === 'PAID' && !FULL_ADMIN_ROLES.includes(user.role)) throw new BadRequestException('Ce prêt est déjà soldé');

    return this.prisma.loan.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /**
   * 🔧 Bascule directe de statut — réservée ADMIN/SUPER_ADMIN. Permet de tout
   * corriger/forcer manuellement (ex : entreprise sans employés sur l'app,
   * ou correction d'une erreur de saisie), sans repasser par le circuit normal.
   */
  async forceLoanStatus(id: string, userId: string, status: string, recoverViaPayroll?: boolean) {
    const user = await this.common.getVerifiedUser(userId);
    if (!FULL_ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux administrateurs');
    await this.common.getOwnedLoanOrThrow(id, user.companyId);

    return this.prisma.loan.update({
      where: { id },
      data: {
        status: status as any,
        recoverViaPayroll: recoverViaPayroll,
        approvedBy: status === 'ACTIVE' ? userId : undefined,
        approvedAt: status === 'ACTIVE' ? new Date() : undefined,
      },
    });
  }

  // ============================================================================
  // 💵 AVANCES SUR SALAIRE
  // ============================================================================

  async createAdvance(data: CreateAdvanceDto, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasLoansAndAdvances');

    const { employee, isOnBehalf } = await this.common.resolveTargetEmployee(data.employeeId, user);

    // ADMIN/SUPER_ADMIN/HR_MANAGER qui crée pour un employé = déjà décidé (autorité RH complète sur les avances, un seul niveau).
    const autoApprove = isOnBehalf && DRH_ROLES.includes(user.role);

    const advance = await this.prisma.advance.create({
      data: {
        employeeId: employee.id,
        amount: data.amount,
        remainingBalance: data.amount,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        deductMonth: data.deductMonth,
        deductYear: data.deductYear,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        recoverViaPayroll: autoApprove ? (data.recoverViaPayroll ?? true) : undefined,
        approvedBy: autoApprove ? userId : undefined,
        approvedAt: autoApprove ? new Date() : undefined,
        requestedByUserId: userId,
        reason: data.reason,
      },
    });

    if (!autoApprove) {
      await this.notificationsService.createForGroup(employee.companyId, DRH_ROLES, {
        type: 'ADVANCE_REQUEST' as NotificationType,
        title: '💵 Nouvelle demande d\u2019avance',
        message: `${employee.firstName} ${employee.lastName} demande une avance de ${data.amount.toLocaleString()} FCFA`,
        link: '/finances/prets-avances',
        metadata: { advanceId: advance.id, employeeId: employee.id },
      });
    }

    return advance;
  }

  async findAllAdvances(userId: string, status?: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);

    const whereClause: any = { employee: { companyId: user.companyId } };
    if (status) whereClause.status = status;

    return this.prisma.advance.findMany({
      where: whereClause,
      include: {
        employee: { select: this.common.employeeSelect },
        repaymentLogs: { orderBy: [{ year: 'desc' }, { month: 'desc' }] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMyAdvances(userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    const employee = await this.prisma.employee.findFirst({ where: { email: user.email ?? undefined, companyId: user.companyId } });
    if (!employee) throw new NotFoundException("Aucun dossier employé associé à ce compte.");
    return this.prisma.advance.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' } });
  }

  async findOneAdvance(id: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    const advance = await this.prisma.advance.findUnique({
      where: { id },
      include: { employee: { select: { ...this.common.employeeSelect, hireDate: true } } },
    });
    if (!advance) throw new NotFoundException('Avance introuvable');

    const empCompany = await this.prisma.employee.findUnique({ where: { id: advance.employeeId }, select: { companyId: true } });
    if (empCompany?.companyId !== user.companyId) throw new ForbiddenException('Accès refusé');
    if (!FINANCE_ROLES.includes(user.role)) {
      const selfEmployee = await this.prisma.employee.findFirst({ where: { email: user.email ?? undefined, companyId: user.companyId } });
      if (!selfEmployee || selfEmployee.id !== advance.employeeId) throw new ForbiddenException('Accès refusé');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { legalName: true, tradeName: true, logo: true, rccmNumber: true, taxNumber: true, address: true, phone: true },
    });

    return { ...advance, company };
  }

  /** ADMIN/SUPER_ADMIN : CRUD complet, à tout moment. HR_MANAGER : uniquement tant que PENDING. */
  async updateAdvance(id: string, dto: UpdateAdvanceDto, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const advance = await this.common.getOwnedAdvanceOrThrow(id, user.companyId);

    if (!FULL_ADMIN_ROLES.includes(user.role) && advance.status !== 'PENDING') {
      throw new BadRequestException('Cette avance ne peut plus être modifiée (demandez à un administrateur).');
    }

    // Même principe que pour les prêts : ajuster remainingBalance par delta,
    // jamais l'écraser, pour préserver les remboursements déjà enregistrés.
    let remainingBalance: number | undefined = undefined;
    let newStatus: 'APPROVED' | 'PAID' | undefined = undefined;
    if (dto.amount !== undefined && dto.amount !== Number(advance.amount)) {
      const currentRemaining = Number(advance.remainingBalance ?? advance.amount);
      const alreadyRepaid = Number(advance.amount) - currentRemaining;
      remainingBalance = Math.max(0, dto.amount - alreadyRepaid);
      if (['APPROVED', 'PAID'].includes(advance.status)) {
        newStatus = remainingBalance === 0 ? 'PAID' : 'APPROVED';
      }
    }

    return this.prisma.advance.update({
      where: { id },
      data: {
        amount: dto.amount,
        deductMonth: dto.deductMonth,
        deductYear: dto.deductYear,
        reason: dto.reason,
        remainingBalance,
        status: newStatus,
      },
    });
  }

  async deleteAdvance(id: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const advance = await this.common.getOwnedAdvanceOrThrow(id, user.companyId);

    if (!FULL_ADMIN_ROLES.includes(user.role) && !['PENDING', 'REJECTED', 'CANCELLED'].includes(advance.status)) {
      throw new BadRequestException("Cette avance est déjà validée ou déduite — utilisez plutôt l'annulation, ou demandez à un administrateur.");
    }
    await this.prisma.advance.delete({ where: { id } });
    return { success: true };
  }

  async cancelAdvance(id: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);
    const advance = await this.common.getOwnedAdvanceOrThrow(id, user.companyId);
    if (['DEDUCTED', 'PAID'].includes(advance.status) && !FULL_ADMIN_ROLES.includes(user.role)) {
      throw new BadRequestException('Cette avance a déjà été traitée sur la paie');
    }
    return this.prisma.advance.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}