// ============================================================================
// 📁 src/approvals/core/approval-circuits.service.ts — LOT B
// Circuits d'avis configurables par l'admin, par type de demande.
// Règle d'or : AUCUN circuit actif (ou circuit sans étape) = comportement
// historique strictement inchangé.
// ============================================================================

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalContextService } from './approval-context.service';
import {
  APPROVAL_FUNCTIONS,
  APPROVAL_REQUEST_TYPES,
  ApprovalRequestType,
  DECIDER_ROLES,
  FUNCTION_ADMIN_ROLES,
  approvalFunctionLabel,
} from '../approvals.constants';
import { SaveCircuitDto } from '../dto/save-circuit.dto';

export interface ActiveCircuit {
  id: string;
  steps: string[]; // codes de fonctions, dans l'ordre
}

export interface FunctionHolder {
  userId: string;
  code: string;
  canSign: boolean;
  name: string;
  role: string;
}

@Injectable()
export class ApprovalCircuitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: ApprovalContextService,
  ) {}

  // ── Circuit actif (null si absent / désactivé / vide) ────────────────────
  async getActiveCircuit(
    companyId: string,
    type: ApprovalRequestType,
  ): Promise<ActiveCircuit | null> {
    const circuit = await this.prisma.approvalCircuit.findUnique({
      where: { companyId_requestType: { companyId, requestType: type } },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    if (!circuit || !circuit.isActive || circuit.steps.length === 0) return null;
    return { id: circuit.id, steps: circuit.steps.map((s) => s.functionCode) };
  }

  // ── Titulaires ACTIFS des fonctions données ──────────────────────────────
  async getHolders(companyId: string, codes: string[]): Promise<FunctionHolder[]> {
    if (codes.length === 0) return [];
    const rows = await this.prisma.userApprovalFunction.findMany({
      where: { companyId, code: { in: codes }, user: { isActive: true } },
      select: {
        code: true,
        canSign: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, role: true } },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      code: r.code,
      canSign: r.canSign,
      name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      role: r.user.role as string,
    }));
  }

  // ── Lecture de la configuration complète (écran admin) ───────────────────
  async getConfig(userId: string, requestedCompanyId?: string) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);
    if (![...FUNCTION_ADMIN_ROLES, 'HR_MANAGER'].includes(ctx.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour consulter les circuits.",
      );
    }

    const circuits = await this.prisma.approvalCircuit.findMany({
      where: { companyId: ctx.companyId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    const holders = await this.getHolders(
      ctx.companyId,
      APPROVAL_FUNCTIONS.map((f) => f.code),
    );
    const holdersByCode: Record<string, string[]> = {};
    for (const h of holders) (holdersByCode[h.code] ??= []).push(h.name);

    const byType: Record<string, { isActive: boolean; steps: string[] }> = {};
    for (const t of APPROVAL_REQUEST_TYPES) {
      const c = circuits.find((x) => x.requestType === t);
      byType[t] = {
        isActive: c?.isActive ?? false,
        steps: c ? c.steps.map((s) => s.functionCode) : [],
      };
    }

    return {
      circuits: byType,
      catalog: APPROVAL_FUNCTIONS,
      holdersByCode,
      canEdit: FUNCTION_ADMIN_ROLES.includes(ctx.role),
    };
  }

  // ── Enregistrement (admin uniquement) ────────────────────────────────────
  async saveCircuit(
    adminId: string,
    type: ApprovalRequestType,
    dto: SaveCircuitDto,
    requestedCompanyId?: string,
  ) {
    const ctx = await this.context.getContextUser(adminId, requestedCompanyId);
    if (!FUNCTION_ADMIN_ROLES.includes(ctx.role)) {
      throw new ForbiddenException(
        "Seul l'administrateur peut configurer les circuits de validation.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const circuit = await tx.approvalCircuit.upsert({
        where: {
          companyId_requestType: { companyId: ctx.companyId, requestType: type },
        },
        create: {
          companyId: ctx.companyId,
          requestType: type,
          isActive: dto.isActive,
        },
        update: { isActive: dto.isActive },
      });
      await tx.approvalCircuitStep.deleteMany({ where: { circuitId: circuit.id } });
      if (dto.steps.length > 0) {
        await tx.approvalCircuitStep.createMany({
          data: dto.steps.map((code, index) => ({
            circuitId: circuit.id,
            position: index,
            functionCode: code,
          })),
        });
      }
    });

    return {
      requestType: type,
      isActive: dto.isActive,
      steps: dto.steps.map((code) => ({ code, label: approvalFunctionLabel(code) })),
    };
  }

  /** Utilitaire : une casquette de décision (rôle) n'est pas une fonction d'avis. */
  isDeciderRole(role: string): boolean {
    return DECIDER_ROLES.includes(role);
  }
}
