// ============================================================================
// 📁 loans-common.service.ts
// ✅ Helpers partagés par tous les services du domaine prêts/avances :
//    résolution utilisateur, garde d'accès finance, résolution de l'employé
//    cible (self-service vs saisie RH pour un tiers), et ownership des
//    entités (prêt/avance appartient bien à l'entreprise de l'appelant).
//    Un seul endroit à toucher si la logique de résolution change.
// ============================================================================

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FINANCE_ROLES, employeeSelect } from './loans.constants';

export type VerifiedUser = {
  id: string;
  companyId: string;
  role: string;
  email: string | null;
};

@Injectable()
export class LoansCommonService {
  constructor(private prisma: PrismaService) {}

  readonly employeeSelect = employeeSelect;

  async getVerifiedUser(userId: string): Promise<VerifiedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, email: true },
    });
    if (!user || !user.companyId)
      throw new ForbiddenException(
        'Utilisateur non rattaché à une entreprise.',
      );
    return { ...user, companyId: user.companyId };
  }

  requireFinanceAccess(role: string) {
    if (!FINANCE_ROLES.includes(role)) {
      throw new ForbiddenException(
        "La gestion des prêts et avances est réservée à l'administration et aux RH.",
      );
    }
  }

  /** Résout l'employé cible : soit celui désigné par un ADMIN/RH (`employeeId`), soit l'utilisateur connecté lui-même (self-service employé, si l'app leur est ouverte). */
  async resolveTargetEmployee(
    employeeId: string | undefined,
    user: VerifiedUser,
  ) {
    if (employeeId && FINANCE_ROLES.includes(user.role)) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
      });
      if (!emp || emp.companyId !== user.companyId)
        throw new NotFoundException(
          'Employé introuvable dans cette entreprise.',
        );
      return { employee: emp, isOnBehalf: true };
    }
    const emp = await this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
    });
    if (!emp)
      throw new NotFoundException('Aucun dossier employé associé à ce compte.');
    return { employee: emp, isOnBehalf: false };
  }

  async getOwnedLoanOrThrow(id: string, companyId: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { employee: { select: { companyId: true } } },
    });
    if (!loan) throw new NotFoundException('Prêt introuvable');
    if (loan.employee.companyId !== companyId)
      throw new ForbiddenException('Accès refusé');
    return loan;
  }

  async getOwnedAdvanceOrThrow(id: string, companyId: string) {
    const advance = await this.prisma.advance.findUnique({ where: { id } });
    if (!advance) throw new NotFoundException('Avance introuvable');
    const emp = await this.prisma.employee.findUnique({
      where: { id: advance.employeeId },
      select: { companyId: true },
    });
    if (emp?.companyId !== companyId)
      throw new ForbiddenException('Accès refusé');
    return advance;
  }
}
