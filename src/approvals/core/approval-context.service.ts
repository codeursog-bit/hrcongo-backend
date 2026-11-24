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
  // true = l'utilisateur agit sur une entreprise qui N'EST PAS la sienne, uniquement
  // parce que l'admin lui a donné une fonction d'avis là-bas. Son rôle est alors
  // neutralisé (EXTERNAL_ADVISOR) : il peut donner un avis, jamais décider ni configurer.
  external?: boolean;
}

// Rôle fictif du contexte « avis seulement » — absent de DECIDER_ROLES et FUNCTION_ADMIN_ROLES.
export const EXTERNAL_ADVISOR_ROLE = 'EXTERNAL_ADVISOR';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    // ── Avis inter-entreprises ───────────────────────────────────────────────
    // Une autre entreprise que la sienne est demandée : si l'admin a donné à cette
    // personne une fonction d'avis LÀ-BAS, elle agit en « avis seulement » sur cette
    // entreprise (aucun accès à la paie, aux employés, etc. — ces routes ne passent
    // pas par ce contexte). Les admins multi-entreprises gardent leur chemin habituel.
    if (
      typeof requestedCompanyId === 'string' &&
      UUID_RE.test(requestedCompanyId) &&
      requestedCompanyId !== user.companyId
    ) {
      let verified: string | null = null;
      try {
        verified = await resolveVerifiedCompanyId(this.prisma, user, requestedCompanyId);
      } catch {
        verified = null;
      }
      if (verified !== requestedCompanyId) {
        const grant = await this.prisma.userApprovalFunction.findFirst({
          where: { userId: user.id, companyId: requestedCompanyId },
          select: { id: true },
        });
        if (grant) {
          return {
            id: user.id,
            role: EXTERNAL_ADVISOR_ROLE,
            companyId: requestedCompanyId,
            fullName: `${user.firstName} ${user.lastName}`.trim(),
            signatureUrl: user.signatureUrl ?? null,
            external: true,
          };
        }
        // Pas de fonction là-bas : on refuse explicitement plutôt que de retomber en silence sur sa propre entreprise.
        throw new ForbiddenException("Vous n'avez pas accès à cette entreprise.");
      }
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