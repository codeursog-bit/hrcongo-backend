// ============================================================================
// 📁 src/approvals/approval-opinions.service.ts — LOT B
// Donner / modifier un avis. Un avis ne décide JAMAIS rien : il éclaire la
// décision de l'admin / RH manager. Commentaire recommandé mais optionnel.
// ============================================================================

import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalContextService } from './core/approval-context.service';
import { ApprovalRequestsService } from './core/approval-requests.service';
import { ApprovalCircuitsService } from './core/approval-circuits.service';
import { ApprovalNotifierService } from './core/approval-notifier.service';
import { ApprovalDecisionsService } from './approval-decisions.service';
import {
  ACTIVE_PENDING_STATES,
  ApprovalRequestType,
  PENDING_STATES,
  approvalFunctionLabel,
} from './approvals.constants';
import { GiveOpinionDto } from './dto/give-opinion.dto';

@Injectable()
export class ApprovalOpinionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: ApprovalContextService,
    private readonly requests: ApprovalRequestsService,
    private readonly circuits: ApprovalCircuitsService,
    private readonly notifier: ApprovalNotifierService,
    private readonly decisions: ApprovalDecisionsService,
  ) {}

  async giveOpinion(
    userId: string,
    type: ApprovalRequestType,
    id: string,
    dto: GiveOpinionDto,
    requestedCompanyId?: string,
  ) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);

    const req = await this.requests.getRequestOrThrow(type, id, ctx.companyId);
    if (!this.requests.isPending(req)) {
      throw new BadRequestException('Cette demande n’est plus en attente : l’avis n’est plus possible.');
    }

    const circuit = await this.circuits.getActiveCircuit(ctx.companyId, type);
    if (!circuit || !circuit.steps.includes(dto.functionCode)) {
      throw new BadRequestException(
        'Cette fonction n’est pas sollicitée pour ce type de demande.',
      );
    }

    // La personne doit réellement détenir cette fonction (attribuée par l'admin).
    const fn = await this.prisma.userApprovalFunction.findUnique({
      where: {
        userId_companyId_code: {
          userId: ctx.id,
          companyId: ctx.companyId,
          code: dto.functionCode,
        },
      },
      select: { canSign: true },
    });
    if (!fn) {
      throw new ForbiddenException("Vous n'avez pas cette fonction.");
    }

    const pending = await this.prisma.approvalPendingDecision.findUnique({
      where: { requestType_requestId: { requestType: type, requestId: id } },
    });
    if (pending?.state === PENDING_STATES.FINALIZING) {
      throw new BadRequestException('La décision est en cours de finalisation.');
    }

    // Un collègue qui a la même fonction a déjà répondu : on ne l'écrase pas.
    const existing = await this.prisma.approvalOpinion.findUnique({
      where: {
        requestType_requestId_functionCode: {
          requestType: type,
          requestId: id,
          functionCode: dto.functionCode,
        },
      },
    });
    if (existing?.userId && existing.userId !== ctx.id) {
      throw new BadRequestException(
        `L’avis « ${approvalFunctionLabel(dto.functionCode)} » a déjà été donné par ${existing.authorName}.`,
      );
    }

    // Signature figée au moment de l'avis — seulement si le droit est accordé.
    const signatureUrl = fn.canSign ? ctx.signatureUrl : null;
    const comment = dto.comment?.trim() ? dto.comment.trim() : null;

    const saved = await this.prisma.approvalOpinion.upsert({
      where: {
        requestType_requestId_functionCode: {
          requestType: type,
          requestId: id,
          functionCode: dto.functionCode,
        },
      },
      create: {
        companyId: ctx.companyId,
        requestType: type,
        requestId: id,
        functionCode: dto.functionCode,
        userId: ctx.id,
        authorName: ctx.fullName,
        opinion: dto.opinion,
        comment,
        signatureUrl,
      },
      update: {
        userId: ctx.id,
        authorName: ctx.fullName,
        opinion: dto.opinion,
        comment,
        signatureUrl,
      },
    });

    // Le décideur qui attend est prévenu à chaque avis.
    if (
      pending &&
      ACTIVE_PENDING_STATES.includes(pending.state) &&
      pending.decidedByUserId &&
      pending.decidedByUserId !== ctx.id
    ) {
      const missing = await this.decisions.computeMissing(
        ctx.companyId,
        type,
        id,
        circuit.steps,
      );
      void this.notifier.notifyOpinionGiven(
        pending.decidedByUserId,
        {
          companyId: ctx.companyId,
          type,
          requestId: id,
          employeeName: req.employeeName,
          detail: req.detail,
        },
        ctx.fullName,
        dto.functionCode,
        dto.opinion,
        missing.length,
      );
    }

    // Si c'était le dernier avis attendu : finalisation automatique (sans jamais
    // faire échouer l'enregistrement de l'avis).
    await this.decisions.autoFinalizeIfComplete(type, id, ctx.companyId);

    return {
      functionCode: saved.functionCode,
      label: approvalFunctionLabel(saved.functionCode),
      opinion: saved.opinion,
      comment: saved.comment,
      authorName: saved.authorName,
      signatureUrl: saved.signatureUrl,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }
}
