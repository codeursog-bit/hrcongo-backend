// ============================================================================
// 📁 src/approvals/core/approval-context.service.ts — LOT B
// Contexte utilisateur vérifié (entreprise résolue sans faire confiance au
// client — même util que le reste de l'app).
// ============================================================================

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveVerifiedCompanyId } from '../../common/resolve-verified-company.util';

export interface ApprovalContextUser {
  id: string;
  role: string;
  companyId: string;
  fullName: string;
  signatureUrl: string | null;
}

@Injectable()
export class ApprovalContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getContextUser(
    userId: string,
    requestedCompanyId?: string,
  ): Promise<ApprovalContextUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        companyId: true,
        isActive: true,
        manageMultipleCompanies: true,
        firstName: true,
        lastName: true,
        signatureUrl: true,
      },
    });
    if (!user || !user.isActive) {
      throw new ForbiddenException('Utilisateur inactif ou introuvable');
    }
    const companyId = await resolveVerifiedCompanyId(
      this.prisma,
      user,
      requestedCompanyId,
    );
    if (!companyId) throw new ForbiddenException('Aucune entreprise associée');
    return {
      id: user.id,
      role: user.role as string,
      companyId,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      signatureUrl: user.signatureUrl ?? null,
    };
  }
}
