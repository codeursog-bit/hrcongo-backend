// ============================================================================
// 📁 loans-decision.service.ts
// ✅ v3 — Décision PARALLÈLE : la demande part en même temps vers tous les
//    rôles habilités (DRH_ROLES, qui contient déjà DG_ROLES) et le premier
//    présent valide ou refuse en un seul geste. Fini le circuit séquentiel
//    DRH → DG.
// ✅ Protection anti-course : la mise à jour est conditionnée à
//    `status: 'PENDING'` via updateMany — si deux personnes décident au
//    même instant, seule la première passe ; la seconde reçoit une erreur
//    claire au lieu d'écraser silencieusement la décision.
// ✅ drhDecision/dgDecision restent renseignés ENSEMBLE avec la même valeur
//    (la fiche imprimable a 2 cases de signature physiques) ; decidedByRole
//    retient la casquette réelle de la personne qui a tranché.
// ============================================================================

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import { LoansCommonService } from './loans-common.service';
import { DRH_ROLES, DG_ROLES } from './loans.constants';

@Injectable()
export class LoansDecisionService {
  constructor(
    private prisma: PrismaService,
    private common: LoansCommonService,
    private notificationsService: NotificationsService,
  ) {}

  // ── Prêts ────────────────────────────────────────────────────────────────

  async decideLoan(
    id: string,
    decision: 'OUI' | 'NON',
    userId: string,
    rejectionReason?: string,
    recoverViaPayroll = true,
  ) {
    const user = await this.common.getVerifiedUser(userId);
    if (!DRH_ROLES.includes(user.role))
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour valider un prêt",
      );

    const loan = await this.common.getOwnedLoanOrThrow(id, user.companyId);
    if (decision === 'NON' && !rejectionReason?.trim())
      throw new BadRequestException('Un motif de refus est requis');

    const decidedByRole = DG_ROLES.includes(user.role) ? 'DG' : 'DRH';
    const now = new Date();

    // updateMany conditionné à PENDING : garantit qu'une seule décision passe
    // même si deux personnes valident au même instant.
    const result = await this.prisma.loan.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        drhDecision: decision,
        drhDecidedBy: userId,
        drhDecidedAt: now,
        dgDecision: decision,
        dgDecidedBy: userId,
        dgDecidedAt: now,
        decidedByRole,
        status: decision === 'OUI' ? 'ACTIVE' : 'REJECTED',
        rejectionReason: decision === 'NON' ? rejectionReason : undefined,
        recoverViaPayroll: decision === 'OUI' ? recoverViaPayroll : undefined,
        approvedBy: decision === 'OUI' ? userId : undefined,
        approvedAt: decision === 'OUI' ? now : undefined,
      },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        loan.status === 'PENDING'
          ? 'Ce prêt n\u2019est plus en attente de validation'
          : 'Ce prêt a déjà été traité par quelqu\u2019un d\u2019autre entre-temps',
      );
    }

    await this.notifyEmployeeLoanDecision(
      loan.employeeId,
      user.companyId,
      decision === 'OUI' ? 'ACTIVE' : 'REJECTED',
      rejectionReason,
    );

    return this.prisma.loan.findUnique({
      where: { id },
      include: { employee: { select: this.common.employeeSelect } },
    });
  }

  private async notifyEmployeeLoanDecision(
    employeeId: string,
    companyId: string,
    result: 'ACTIVE' | 'REJECTED',
    rejectionReason?: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { email: true },
    });
    if (!employee?.email) return; // employé sans compte app — rien à notifier, RH informe hors-app
    const employeeUser = await this.prisma.user.findFirst({
      where: { email: employee.email, companyId },
      select: { id: true },
    });
    if (!employeeUser) return;

    await this.notificationsService.create({
      userId: employeeUser.id,
      type: result === 'ACTIVE' ? 'LOAN_APPROVED' : 'LOAN_REJECTED',
      title: result === 'ACTIVE' ? '✅ Prêt accordé' : '❌ Prêt refusé',
      message:
        result === 'ACTIVE'
          ? 'Votre demande de prêt a été accordée'
          : `Votre demande de prêt a été refusée${rejectionReason ? ` : ${rejectionReason}` : ''}`,
      link: '/finances/prets-avances/mon-espace',
      metadata: {},
    });
  }

  // ── Avances ──────────────────────────────────────────────────────────────

  /** Décision RH (ADMIN/SUPER_ADMIN/HR_MANAGER) — avec choix "récupérer sur la paie ou non". Même protection anti-course que les prêts. */
  async decideAdvance(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    userId: string,
    rejectionReason?: string,
    recoverViaPayroll = true,
  ) {
    const user = await this.common.getVerifiedUser(userId);
    if (!DRH_ROLES.includes(user.role))
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour valider une avance",
      );

    const advance = await this.common.getOwnedAdvanceOrThrow(
      id,
      user.companyId,
    );
    if (decision === 'REJECTED' && !rejectionReason?.trim())
      throw new BadRequestException('Un motif de refus est requis');

    const now = new Date();
    const result = await this.prisma.advance.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: decision,
        approvedBy: decision === 'APPROVED' ? userId : undefined,
        approvedAt: decision === 'APPROVED' ? now : undefined,
        recoverViaPayroll:
          decision === 'APPROVED' ? recoverViaPayroll : undefined,
        rejectedBy: decision === 'REJECTED' ? userId : undefined,
        rejectedAt: decision === 'REJECTED' ? now : undefined,
        rejectionReason: decision === 'REJECTED' ? rejectionReason : undefined,
      },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        advance.status === 'PENDING'
          ? 'Cette avance n\u2019est plus en attente de validation'
          : 'Cette avance a déjà été traitée par quelqu\u2019un d\u2019autre entre-temps',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: advance.employeeId },
      select: { email: true },
    });
    if (employee?.email) {
      const employeeUser = await this.prisma.user.findFirst({
        where: { email: employee.email, companyId: user.companyId },
        select: { id: true },
      });
      if (employeeUser) {
        await this.notificationsService.create({
          userId: employeeUser.id,
          type:
            decision === 'APPROVED' ? 'ADVANCE_APPROVED' : 'ADVANCE_REJECTED',
          title:
            decision === 'APPROVED'
              ? '✅ Avance accordée'
              : '❌ Avance refusée',
          message:
            decision === 'APPROVED'
              ? 'Votre demande d\u2019avance a été accordée'
              : `Votre demande d'avance a été refusée${rejectionReason ? ` : ${rejectionReason}` : ''}`,
          link: '/finances/prets-avances/mon-espace',
          metadata: {},
        });
      }
    }

    return this.prisma.advance.findUnique({
      where: { id },
      include: { employee: { select: this.common.employeeSelect } },
    });
  }
}
