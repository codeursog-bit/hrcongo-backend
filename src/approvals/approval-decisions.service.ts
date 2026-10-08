// ============================================================================
// 📁 src/approvals/approval-decisions.service.ts — LOT B
// ✅ Orchestrateur de décision. Il n'AJOUTE rien aux règles de décision
//    existantes : pour approuver / refuser, il appelle tes fonctions
//    `LoansService.decideLoan` / `decideAdvance` (donc loans-decision.service.ts,
//    inchangé : contrôle des rôles, protection anti-course `status: PENDING`,
//    notification de l'employé, etc.).
//
// Règles (cadrage validé) :
//   - Seul un ADMIN / SUPER_ADMIN / HR_MANAGER décide (les fonctions = avis).
//   - Sans circuit actif pour ce type de demande → décision immédiate, comme avant.
//   - REFUS : toujours immédiat (rien à comptabiliser, donc rien à attendre).
//   - APPROBATION avec circuit et des avis manquants :
//        ASK  → on renvoie la liste des avis manquants (l'écran propose le choix)
//        WAIT → décision ENREGISTRÉE À PART, la demande reste PENDING (donc rien
//               n'est comptabilisé : pas de prêt actif, pas de déduction en paie)
//        NOW  → validation immédiate "sans attendre les avis" (urgence), tracée
//   - Quand le dernier avis arrive : tous favorables → finalisation automatique
//     au nom du décideur d'origine ; au moins un défavorable → "à confirmer".
//   - Étapes sans titulaire actif = ignorées (jamais bloquantes).
// ============================================================================

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoansService } from '../loans/loans.service';
import { AbsenceRequestsService } from '../absence-requests/absence-requests.service';
import { LeavesService } from '../leaves/leaves.service';
import { ApprovalContextService } from './core/approval-context.service';
import { ApprovalRequestsService, RequestSummary } from './core/approval-requests.service';
import { ApprovalCircuitsService } from './core/approval-circuits.service';
import { ApprovalNotifierService } from './core/approval-notifier.service';
import {
  ACTIVE_PENDING_STATES,
  APPROVAL_REQUEST_TYPES,
  ApprovalRequestType,
  DECIDER_ROLES,
  PENDING_STATES,
  approvalFunctionLabel,
} from './approvals.constants';
import { DecisionRequestDto } from './dto/decision-request.dto';

type DecisionPayload = {
  rejectionReason?: string;
  recoverViaPayroll?: boolean;
  isPaid?: boolean;
  extraDaysGranted?: number;
  resumptionNote?: string;
};

@Injectable()
export class ApprovalDecisionsService {
  private readonly logger = new Logger(ApprovalDecisionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: ApprovalContextService,
    private readonly requests: ApprovalRequestsService,
    private readonly circuits: ApprovalCircuitsService,
    private readonly notifier: ApprovalNotifierService,
    private readonly loans: LoansService,
    private readonly absences: AbsenceRequestsService, // ✅ LOT C
    private readonly leaves: LeavesService, // ✅ LOT E
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════

  private ensureDecider(role: string) {
    if (!DECIDER_ROLES.includes(role)) {
      throw new ForbiddenException(
        "Seuls l'administrateur et le manager RH peuvent approuver ou refuser une demande.",
      );
    }
  }

  private notifyArgs(req: RequestSummary) {
    return {
      companyId: req.companyId,
      type: req.type,
      requestId: req.id,
      employeeName: req.employeeName,
      detail: req.detail,
    };
  }

  /** Avis manquants = étapes du circuit AYANT au moins un titulaire actif et sans avis. */
  async computeMissing(
    companyId: string,
    type: ApprovalRequestType,
    requestId: string,
    steps: string[],
  ): Promise<string[]> {
    if (steps.length === 0) return [];
    const holders = await this.circuits.getHolders(companyId, steps);
    const withHolders = new Set(holders.map((h) => h.code));
    const opinions = await this.prisma.approvalOpinion.findMany({
      where: { requestType: type, requestId, functionCode: { in: steps } },
      select: { functionCode: true },
    });
    const given = new Set(opinions.map((o) => o.functionCode));
    return steps.filter((code) => withHolders.has(code) && !given.has(code));
  }

  private async describeMissing(companyId: string, codes: string[]) {
    const holders = await this.circuits.getHolders(companyId, codes);
    return codes.map((code) => ({
      code,
      label: approvalFunctionLabel(code),
      holders: holders.filter((h) => h.code === code).map((h) => h.name),
    }));
  }

  /** Appelle les décisions EXISTANTES (aucune règle réécrite ici). */
  private applyDecision(
    type: ApprovalRequestType,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    userId: string,
    payload: DecisionPayload,
  ) {
    const recover = payload.recoverViaPayroll ?? true;
    // ✅ LOT E — congés : on appelle l'updateStatus EXISTANT (solde, cycle, notification,
    // e-mail : tout reste dans leaves.service.ts). Plus aucune indemnité n'y est
    // programmée : elle ne dépend que du planning RH.
    if (type === 'LEAVE') {
      return this.leaves.updateStatus(
        id,
        decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        userId,
        payload.rejectionReason,
        undefined,
        payload.extraDaysGranted,
        payload.resumptionNote,
      );
    }
    // ✅ LOT C — absences : on appelle l'updateStatus EXISTANT (rôles, motif de refus,
    // notification de l'employé : tout reste dans absence-requests.service.ts).
    if (type === 'ABSENCE') {
      return this.absences.updateStatus(
        id,
        decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        userId,
        payload.rejectionReason,
        payload.isPaid,
      );
    }
    if (type === 'LOAN') {
      return this.loans.decideLoan(
        id,
        decision === 'APPROVE' ? 'OUI' : 'NON',
        userId,
        payload.rejectionReason,
        recover,
      );
    }
    return this.loans.decideAdvance(
      id,
      decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      userId,
      payload.rejectionReason,
      recover,
    );
  }

  private async getDeciderIds(companyId: string): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { companyId, isActive: true, role: { in: DECIDER_ROLES as any } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async markSuperseded(type: ApprovalRequestType, id: string) {
    await this.prisma.approvalPendingDecision.updateMany({
      where: { requestType: type, requestId: id, state: { in: ACTIVE_PENDING_STATES } },
      data: { state: PENDING_STATES.SUPERSEDED },
    });
  }

  private pendingView(p: any, missing?: string[]) {
    if (!p) return null;
    return {
      state: p.state as string,
      decidedByName: p.decidedByName as string,
      decidedAt: p.createdAt as Date,
      forced: !!p.forced,
      forcedMissing: ((p.missingAtDecision as string[] | null) ?? []).map((c) => ({
        code: c,
        label: approvalFunctionLabel(c),
      })),
      missing: (missing ?? []).map((c) => ({ code: c, label: approvalFunctionLabel(c) })),
      finalizedAt: (p.finalizedAt as Date | null) ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1) DÉCIDER (point d'entrée de l'écran)
  // ══════════════════════════════════════════════════════════════════════════
  async requestDecision(
    userId: string,
    type: ApprovalRequestType,
    id: string,
    dto: DecisionRequestDto,
    requestedCompanyId?: string,
  ) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);
    this.ensureDecider(ctx.role);

    const req = await this.requests.getRequestOrThrow(type, id, ctx.companyId);
    if (!this.requests.isPending(req)) {
      throw new BadRequestException('Cette demande n’est plus en attente de validation');
    }

    const payload: DecisionPayload = {
      rejectionReason: dto.rejectionReason,
      recoverViaPayroll: dto.recoverViaPayroll ?? true,
      isPaid: dto.isPaid,
      extraDaysGranted: dto.extraDaysGranted,
      resumptionNote: dto.resumptionNote,
    };
    const mode = dto.mode ?? 'ASK';

    // REFUS : immédiat. Les règles (motif obligatoire…) sont celles de l'existant.
    if (dto.decision === 'REJECT') {
      const result = await this.applyDecision(type, id, 'REJECT', ctx.id, payload);
      await this.prisma.approvalPendingDecision.updateMany({
        where: { requestType: type, requestId: id, state: { in: ACTIVE_PENDING_STATES } },
        data: { state: PENDING_STATES.CANCELLED },
      });
      return { status: 'FINALIZED' as const, request: result };
    }

    // Pas de circuit → comportement historique, strictement.
    const circuit = await this.circuits.getActiveCircuit(ctx.companyId, type);
    if (!circuit) {
      const result = await this.applyDecision(type, id, 'APPROVE', ctx.id, payload);
      return { status: 'FINALIZED' as const, request: result };
    }

    // Une validation attend déjà ?
    const existing = await this.prisma.approvalPendingDecision.findUnique({
      where: { requestType_requestId: { requestType: type, requestId: id } },
    });
    if (existing && ACTIVE_PENDING_STATES.includes(existing.state)) {
      throw new ConflictException(
        `Une validation est déjà en attente d'avis (par ${existing.decidedByName}). Utilisez « Finaliser maintenant » ou annulez-la.`,
      );
    }

    const missing = await this.computeMissing(ctx.companyId, type, id, circuit.steps);

    // Tous les avis sont là → on décide tout de suite (le décideur les a sous les yeux).
    if (missing.length === 0) {
      const result = await this.applyDecision(type, id, 'APPROVE', ctx.id, payload);
      return { status: 'FINALIZED' as const, request: result };
    }

    if (mode === 'ASK') {
      return {
        status: 'NEEDS_CHOICE' as const,
        missing: await this.describeMissing(ctx.companyId, missing),
      };
    }

    if (mode === 'NOW') {
      const result = await this.applyDecision(type, id, 'APPROVE', ctx.id, payload);
      await this.savePending({
        type,
        id,
        companyId: ctx.companyId,
        state: PENDING_STATES.FINALIZED,
        decidedByUserId: ctx.id,
        decidedByName: ctx.fullName,
        payload,
        forced: true,
        missing,
        finalizedByUserId: ctx.id,
        finalizedAt: new Date(),
      });
      return { status: 'FINALIZED' as const, request: result, forced: true };
    }

    // WAIT : la décision est mise de côté, la demande reste PENDING.
    const saved = await this.savePending({
      type,
      id,
      companyId: ctx.companyId,
      state: PENDING_STATES.WAITING_OPINIONS,
      decidedByUserId: ctx.id,
      decidedByName: ctx.fullName,
      payload,
      forced: false,
      missing,
    });

    void this.notifier.notifyWaitingForOpinions(
      this.notifyArgs(req),
      missing,
      ctx.id,
      ctx.fullName,
    );

    return {
      status: 'WAITING_OPINIONS' as const,
      pending: this.pendingView(saved, missing),
    };
  }

  private async savePending(args: {
    type: ApprovalRequestType;
    id: string;
    companyId: string;
    state: string;
    decidedByUserId: string;
    decidedByName: string;
    payload: DecisionPayload;
    forced: boolean;
    missing: string[];
    finalizedByUserId?: string;
    finalizedAt?: Date;
  }) {
    const data = {
      companyId: args.companyId,
      decision: 'APPROVE',
      state: args.state,
      decidedByUserId: args.decidedByUserId,
      decidedByName: args.decidedByName,
      payload: args.payload as any,
      forced: args.forced,
      missingAtDecision: args.missing as any,
      finalizedByUserId: args.finalizedByUserId ?? null,
      finalizedAt: args.finalizedAt ?? null,
    };
    try {
      return await this.prisma.approvalPendingDecision.upsert({
        where: {
          requestType_requestId: { requestType: args.type, requestId: args.id },
        },
        create: { requestType: args.type, requestId: args.id, ...data },
        update: data,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'Une validation vient d’être enregistrée par quelqu’un d’autre pour cette demande.',
        );
      }
      throw e;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2) FINALISER MAINTENANT (bouton "Finaliser maintenant" / "Confirmer")
  // ══════════════════════════════════════════════════════════════════════════
  async finalizeNow(
    userId: string,
    type: ApprovalRequestType,
    id: string,
    requestedCompanyId?: string,
  ) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);
    this.ensureDecider(ctx.role);

    const req = await this.requests.getRequestOrThrow(type, id, ctx.companyId);
    const pending = await this.prisma.approvalPendingDecision.findUnique({
      where: { requestType_requestId: { requestType: type, requestId: id } },
    });
    if (!pending || !ACTIVE_PENDING_STATES.includes(pending.state)) {
      throw new NotFoundException('Aucune validation en attente pour cette demande.');
    }
    if (!this.requests.isPending(req)) {
      await this.markSuperseded(type, id);
      throw new BadRequestException('Cette demande a déjà été traitée entre-temps.');
    }

    // Verrou anti double finalisation
    const gate = await this.prisma.approvalPendingDecision.updateMany({
      where: { id: pending.id, state: { in: ACTIVE_PENDING_STATES } },
      data: { state: PENDING_STATES.FINALIZING },
    });
    if (gate.count === 0) {
      throw new ConflictException('Cette validation est déjà en cours de finalisation.');
    }

    try {
      const circuit = await this.circuits.getActiveCircuit(ctx.companyId, type);
      const missing = circuit
        ? await this.computeMissing(ctx.companyId, type, id, circuit.steps)
        : [];
      const result = await this.applyDecision(
        type,
        id,
        'APPROVE',
        ctx.id,
        (pending.payload as DecisionPayload) ?? {},
      );
      await this.prisma.approvalPendingDecision.update({
        where: { id: pending.id },
        data: {
          state: PENDING_STATES.FINALIZED,
          finalizedByUserId: ctx.id,
          finalizedAt: new Date(),
          forced: missing.length > 0,
          missingAtDecision: (missing.length > 0
            ? missing
            : (pending.missingAtDecision as any)) as any,
        },
      });
      return { status: 'FINALIZED' as const, request: result };
    } catch (e) {
      // On remet l'état d'origine : rien n'a été appliqué.
      await this.prisma.approvalPendingDecision.updateMany({
        where: { id: pending.id, state: PENDING_STATES.FINALIZING },
        data: { state: pending.state },
      });
      throw e;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3) ANNULER la validation en attente (la demande reste PENDING)
  // ══════════════════════════════════════════════════════════════════════════
  async cancelPending(
    userId: string,
    type: ApprovalRequestType,
    id: string,
    requestedCompanyId?: string,
  ) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);
    this.ensureDecider(ctx.role);
    await this.requests.getRequestOrThrow(type, id, ctx.companyId);

    const res = await this.prisma.approvalPendingDecision.updateMany({
      where: {
        requestType: type,
        requestId: id,
        companyId: ctx.companyId,
        state: { in: ACTIVE_PENDING_STATES },
      },
      data: { state: PENDING_STATES.CANCELLED },
    });
    if (res.count === 0) {
      throw new NotFoundException('Aucune validation en attente à annuler.');
    }
    return { status: 'CANCELLED' as const };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4) Appelé après CHAQUE avis : finalisation automatique si tout est reçu
  // ══════════════════════════════════════════════════════════════════════════
  async autoFinalizeIfComplete(
    type: ApprovalRequestType,
    id: string,
    companyId: string,
  ): Promise<void> {
    try {
      const pending = await this.prisma.approvalPendingDecision.findUnique({
        where: { requestType_requestId: { requestType: type, requestId: id } },
      });
      if (!pending || pending.state !== PENDING_STATES.WAITING_OPINIONS) return;

      const circuit = await this.circuits.getActiveCircuit(companyId, type);
      const steps = circuit?.steps ?? [];
      const missing = await this.computeMissing(companyId, type, id, steps);
      if (missing.length > 0) return; // il en reste : on attend

      const req = await this.requests.getRequestOrThrow(type, id, companyId);
      if (!this.requests.isPending(req)) {
        await this.markSuperseded(type, id);
        return;
      }

      const opinions = await this.prisma.approvalOpinion.findMany({
        where: { requestType: type, requestId: id, functionCode: { in: steps } },
        select: { opinion: true },
      });
      const hasUnfavorable = opinions.some((o) => o.opinion === 'UNFAVORABLE');

      const targets = await this.resolveConfirmationTargets(pending.decidedByUserId, companyId);

      if (hasUnfavorable) {
        const g = await this.prisma.approvalPendingDecision.updateMany({
          where: { id: pending.id, state: PENDING_STATES.WAITING_OPINIONS },
          data: { state: PENDING_STATES.NEEDS_CONFIRMATION },
        });
        if (g.count > 0) {
          await this.notifier.notifyNeedsConfirmation(
            targets,
            this.notifyArgs(req),
            'tous les avis sont reçus, mais au moins un est défavorable. Confirmez ou annulez votre validation.',
          );
        }
        return;
      }

      // Tous favorables → finalisation automatique au nom du décideur d'origine.
      const gate = await this.prisma.approvalPendingDecision.updateMany({
        where: { id: pending.id, state: PENDING_STATES.WAITING_OPINIONS },
        data: { state: PENDING_STATES.FINALIZING },
      });
      if (gate.count === 0) return;

      try {
        if (!pending.decidedByUserId) throw new Error('Décideur introuvable');
        await this.applyDecision(
          type,
          id,
          'APPROVE',
          pending.decidedByUserId,
          (pending.payload as DecisionPayload) ?? {},
        );
        await this.prisma.approvalPendingDecision.update({
          where: { id: pending.id },
          data: {
            state: PENDING_STATES.FINALIZED,
            finalizedByUserId: pending.decidedByUserId,
            finalizedAt: new Date(),
            forced: false,
          },
        });
      } catch (e) {
        // Décideur désactivé / sans droits, ou demande traitée autrement entre-temps.
        const fresh = await this.requests.getRequestOrThrow(type, id, companyId).catch(() => null);
        if (!fresh || !this.requests.isPending(fresh)) {
          await this.prisma.approvalPendingDecision.updateMany({
            where: { id: pending.id, state: PENDING_STATES.FINALIZING },
            data: { state: PENDING_STATES.SUPERSEDED },
          });
          return;
        }
        await this.prisma.approvalPendingDecision.updateMany({
          where: { id: pending.id, state: PENDING_STATES.FINALIZING },
          data: { state: PENDING_STATES.NEEDS_CONFIRMATION },
        });
        await this.notifier.notifyNeedsConfirmation(
          await this.getDeciderIds(companyId),
          this.notifyArgs(req),
          'tous les avis favorables sont reçus, mais la validation n’a pas pu être appliquée automatiquement. Merci de la confirmer.',
        );
        this.logger.warn(`Finalisation auto impossible (${type}/${id}) : ${e}`);
      }
    } catch (e) {
      // Ne jamais faire échouer l'enregistrement d'un avis à cause de la finalisation.
      this.logger.error(`autoFinalizeIfComplete a échoué (${type}/${id}) : ${e}`);
    }
  }

  private async resolveConfirmationTargets(
    deciderUserId: string | null,
    companyId: string,
  ): Promise<string[]> {
    if (deciderUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: deciderUserId },
        select: { isActive: true, companyId: true },
      });
      if (u?.isActive && u.companyId === companyId) return [deciderUserId];
    }
    return this.getDeciderIds(companyId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5) ÉTAT / HISTORIQUE d'une demande (panneau "Avis")
  // ══════════════════════════════════════════════════════════════════════════
  async getState(
    userId: string,
    type: ApprovalRequestType,
    id: string,
    requestedCompanyId?: string,
  ) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);
    const req = await this.requests.getRequestOrThrow(type, id, ctx.companyId);

    const isDecider = DECIDER_ROLES.includes(ctx.role);
    const circuit = await this.circuits.getActiveCircuit(ctx.companyId, type);

    const myFns = await this.prisma.userApprovalFunction.findMany({
      where: { userId: ctx.id, companyId: ctx.companyId },
      select: { code: true },
    });
    const myCodes = myFns.map((f) => f.code);
    const myCodesInCircuit = circuit ? myCodes.filter((c) => circuit.steps.includes(c)) : [];

    if (!isDecider && myCodesInCircuit.length === 0) {
      throw new ForbiddenException("Vous n'avez pas accès aux avis de cette demande.");
    }

    const opinions = await this.prisma.approvalOpinion.findMany({
      where: { requestType: type, requestId: id },
      orderBy: { createdAt: 'asc' },
    });

    let pending = await this.prisma.approvalPendingDecision.findUnique({
      where: { requestType_requestId: { requestType: type, requestId: id } },
    });
    const requestIsPending = this.requests.isPending(req);
    if (pending && ACTIVE_PENDING_STATES.includes(pending.state) && !requestIsPending) {
      await this.markSuperseded(type, id);
      pending = { ...pending, state: PENDING_STATES.SUPERSEDED } as any;
    }

    const holders = circuit ? await this.circuits.getHolders(ctx.companyId, circuit.steps) : [];
    const steps = (circuit?.steps ?? []).map((code, position) => {
      const op = opinions.find((o) => o.functionCode === code) ?? null;
      const stepHolders = holders.filter((h) => h.code === code);
      return {
        position,
        code,
        label: approvalFunctionLabel(code),
        holders: stepHolders.map((h) => h.name),
        hasHolder: stepHolders.length > 0,
        opinion: op ? this.mapOpinion(op) : null,
      };
    });

    const missing = circuit
      ? await this.computeMissing(ctx.companyId, type, id, circuit.steps)
      : [];

    return {
      requestType: type,
      requestId: id,
      requestStatus: req.status,
      circuitActive: !!circuit,
      steps,
      opinions: opinions.map((o) => this.mapOpinion(o)),
      missing: missing.map((c) => ({ code: c, label: approvalFunctionLabel(c) })),
      pending: this.pendingView(pending, missing),
      me: {
        canDecide: isDecider && requestIsPending,
        canGiveOpinionAs: requestIsPending
          ? myCodesInCircuit.map((c) => ({ code: c, label: approvalFunctionLabel(c) }))
          : [],
      },
    };
  }

  private mapOpinion(o: any) {
    return {
      functionCode: o.functionCode as string,
      label: approvalFunctionLabel(o.functionCode),
      opinion: o.opinion as string,
      comment: (o.comment as string | null) ?? null,
      authorName: o.authorName as string,
      signatureUrl: (o.signatureUrl as string | null) ?? null,
      createdAt: o.createdAt as Date,
      updatedAt: o.updatedAt as Date,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5bis) SIGNATURES POUR LES DOCUMENTS IMPRIMABLES (LOT D)
  // Les avis (avec la signature figée au moment de l'avis) servent à remplir les
  // cases de signature des documents. Lecture seule. Accès : décideurs, titulaires
  // de fonctions, et l'employé auteur de la demande (il imprime son propre document).
  // Sans avis → liste vide → les documents restent EXACTEMENT comme avant.
  // ══════════════════════════════════════════════════════════════════════════
  async getDocumentSignatures(
    userId: string,
    type: ApprovalRequestType,
    id: string,
    requestedCompanyId?: string,
  ) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);
    const req = await this.requests.getRequestOrThrow(type, id, ctx.companyId);

    let allowed = DECIDER_ROLES.includes(ctx.role);
    if (!allowed) {
      const fn = await this.prisma.userApprovalFunction.count({
        where: { userId: ctx.id, companyId: ctx.companyId },
      });
      allowed = fn > 0;
    }
    if (!allowed) {
      // L'employé auteur de la demande (même rapprochement e-mail que le reste de l'app)
      const [me, emp] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: ctx.id }, select: { email: true } }),
        this.prisma.employee.findUnique({ where: { id: req.employeeId }, select: { email: true } }),
      ]);
      allowed = !!me?.email && !!emp?.email && me.email.toLowerCase() === emp.email.toLowerCase();
    }
    if (!allowed) {
      throw new ForbiddenException("Vous n'avez pas accès aux signatures de cette demande.");
    }

    const opinions = await this.prisma.approvalOpinion.findMany({
      where: { requestType: type, requestId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      signatures: opinions.map((o) => ({
        functionCode: o.functionCode,
        label: approvalFunctionLabel(o.functionCode),
        opinion: o.opinion as string,
        authorName: o.authorName,
        signatureUrl: o.signatureUrl ?? null,
        date: o.updatedAt,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6) BOÎTE "AVIS À DONNER" (pour les titulaires de fonctions)
  // ══════════════════════════════════════════════════════════════════════════
  async getInbox(userId: string, requestedCompanyId?: string) {
    const ctx = await this.context.getContextUser(userId, requestedCompanyId);

    const myFns = await this.prisma.userApprovalFunction.findMany({
      where: { userId: ctx.id, companyId: ctx.companyId },
      select: { code: true },
    });
    const myCodes = myFns.map((f) => f.code);
    if (myCodes.length === 0) return { items: [] };

    const items: any[] = [];
    for (const type of APPROVAL_REQUEST_TYPES) {
      const circuit = await this.circuits.getActiveCircuit(ctx.companyId, type);
      if (!circuit) continue;
      const mine = myCodes.filter((c) => circuit.steps.includes(c));
      if (mine.length === 0) continue;

      const pendingReqs = await this.requests.listPending(type, ctx.companyId);
      if (pendingReqs.length === 0) continue;

      const ids = pendingReqs.map((r) => r.id);
      const given = await this.prisma.approvalOpinion.findMany({
        where: { requestType: type, requestId: { in: ids }, functionCode: { in: mine } },
        select: { requestId: true, functionCode: true },
      });
      const givenSet = new Set(given.map((g) => `${g.requestId}:${g.functionCode}`));

      const pendings = await this.prisma.approvalPendingDecision.findMany({
        where: { requestType: type, requestId: { in: ids }, state: { in: ACTIVE_PENDING_STATES } },
        select: { requestId: true, decidedByName: true },
      });
      const pendingMap = new Map(pendings.map((p) => [p.requestId, p.decidedByName]));

      for (const r of pendingReqs) {
        const myMissing = mine.filter((c) => !givenSet.has(`${r.id}:${c}`));
        if (myMissing.length === 0) continue;
        items.push({
          requestType: type,
          requestId: r.id,
          employeeName: r.employeeName,
          amount: r.amount,
          detail: r.detail,
          reason: r.reason,
          createdAt: r.createdAt,
          myMissing: myMissing.map((c) => ({ code: c, label: approvalFunctionLabel(c) })),
          awaitingDecisionBy: pendingMap.get(r.id) ?? null,
        });
      }
    }

    items.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return { items };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6bis) BOÎTE D'AVIS TOUTES ENTREPRISES
  // Sa propre entreprise + chaque entreprise où l'admin lui a donné une fonction d'avis.
  // Chaque élément porte companyId / companyName / external pour que l'écran sache
  // sur quelle entreprise donner l'avis (paramètre ?companyId=).
  // ══════════════════════════════════════════════════════════════════════════
  async getInboxAll(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, isActive: true },
    });
    if (!me || !me.isActive) throw new ForbiddenException('Utilisateur inactif ou introuvable');

    const extRows = await this.prisma.userApprovalFunction.findMany({
      where: me.companyId ? { userId, companyId: { not: me.companyId } } : { userId },
      select: { companyId: true, company: { select: { legalName: true, tradeName: true } } },
    });
    const externals = new Map<string, string>();
    for (const r of extRows) externals.set(r.companyId, r.company.tradeName || r.company.legalName);

    const out: any[] = [];

    if (me.companyId) {
      const own = await this.prisma.company.findUnique({
        where: { id: me.companyId },
        select: { legalName: true, tradeName: true },
      });
      const { items } = await this.getInbox(userId);
      for (const it of items) {
        out.push({ ...it, companyId: me.companyId, companyName: own ? own.tradeName || own.legalName : '', external: false });
      }
    }

    for (const [companyId, companyName] of externals) {
      try {
        const { items } = await this.getInbox(userId, companyId);
        for (const it of items) out.push({ ...it, companyId, companyName, external: true });
      } catch {
        // Une entreprise inaccessible ne doit jamais masquer les autres.
      }
    }

    out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { items: out };
  }
}