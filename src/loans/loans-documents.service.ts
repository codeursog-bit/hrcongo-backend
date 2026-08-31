// ============================================================================
// 📁 loans-documents.service.ts
// ✅ Tout ce qui touche au document imprimable : données résolues pour le
//    rendu (prêt/avance) et autorisation d'impression donnée à l'employé.
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoansCommonService } from './loans-common.service';

@Injectable()
export class LoansDocumentsService {
  constructor(
    private prisma: PrismaService,
    private common: LoansCommonService,
  ) {}

  /** Données résolues pour le rendu du document imprimable (prêt argent/marchandise). */
  async getLoanDocumentData(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            phone: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    if (!loan) throw new NotFoundException('Prêt introuvable.');

    const company = await this.prisma.company.findFirst({
      where: { employees: { some: { id: loan.employeeId } } },
      select: {
        legalName: true,
        tradeName: true,
        rccmNumber: true,
        taxNumber: true,
        address: true,
        city: true,
        phone: true,
        logo: true,
        cachetUrl: true,
        documentTemplate: true,
        documentFooterText: true,
      },
    });

    return {
      id: loan.id,
      loanType: loan.type,
      amount: loan.amount,
      monthlyRepayment: loan.monthlyRepayment,
      startDate: loan.startDate,
      status: loan.status,
      drhDecision: loan.drhDecision,
      dgDecision: loan.dgDecision,
      decidedByRole: loan.decidedByRole,
      printAuthorized: loan.printAuthorized,
      employee: {
        firstName: loan.employee.firstName,
        lastName: loan.employee.lastName,
        position: loan.employee.position,
        phone: loan.employee.phone,
        departmentName: loan.employee.department?.name ?? '',
      },
      company,
    };
  }

  /** Données résolues pour le rendu du document imprimable (avance sur salaire). */
  async getAdvanceDocumentData(id: string) {
    const advance = await this.prisma.advance.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            phone: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    if (!advance) throw new NotFoundException('Avance introuvable.');

    const company = await this.prisma.company.findFirst({
      where: { employees: { some: { id: advance.employeeId } } },
      select: {
        legalName: true,
        tradeName: true,
        rccmNumber: true,
        taxNumber: true,
        address: true,
        city: true,
        phone: true,
        logo: true,
        cachetUrl: true,
        documentTemplate: true,
        documentFooterText: true,
      },
    });

    return {
      id: advance.id,
      amount: advance.amount,
      status: advance.status,
      printAuthorized: advance.printAuthorized,
      employee: {
        firstName: advance.employee.firstName,
        lastName: advance.employee.lastName,
        position: advance.employee.position,
        phone: advance.employee.phone,
        departmentName: advance.employee.department?.name ?? '',
      },
      company,
    };
  }

  /**
   * Autorise (ou retire l'autorisation) l'impression du document de prêt
   * par l'employé. Réservé RH/Admin (FINANCE_ROLES), uniquement une fois
   * le prêt approuvé (ACTIVE/PAID).
   */
  async setLoanPrintAuthorization(
    id: string,
    authorized: boolean,
    userId: string,
  ) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);

    const loan = await this.common.getOwnedLoanOrThrow(id, user.companyId);
    if (!['ACTIVE', 'PAID'].includes(loan.status)) {
      throw new BadRequestException(
        "Le prêt doit être approuvé avant d'autoriser l'impression.",
      );
    }

    return this.prisma.loan.update({
      where: { id },
      data: {
        printAuthorized: authorized,
        printAuthorizedBy: userId,
        printAuthorizedAt: new Date(),
      },
    });
  }

  /**
   * Autorise (ou retire l'autorisation) l'impression du document d'avance
   * par l'employé. Réservé RH/Admin (FINANCE_ROLES), uniquement une fois
   * l'avance approuvée.
   */
  async setAdvancePrintAuthorization(
    id: string,
    authorized: boolean,
    userId: string,
  ) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);

    const advance = await this.common.getOwnedAdvanceOrThrow(
      id,
      user.companyId,
    );
    if (advance.status !== 'APPROVED') {
      throw new BadRequestException(
        "L'avance doit être approuvée avant d'autoriser l'impression.",
      );
    }

    return this.prisma.advance.update({
      where: { id },
      data: {
        printAuthorized: authorized,
        printAuthorizedBy: userId,
        printAuthorizedAt: new Date(),
      },
    });
  }
}
