// ============================================================================
// 📁 src/approvals/core/approval-notifier.service.ts — LOT B + LOT C + LOT E
// Notifications du circuit d'avis (cloche + push via NotificationsService).
// Une notification qui échoue ne casse JAMAIS le flux métier : tout est
// encapsulé en try/catch.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { ApprovalCircuitsService } from './approval-circuits.service';
import {
  ApprovalRequestType,
  DECIDER_ROLES,
  approvalFunctionLabel,
} from '../approvals.constants';

const fmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

// "prêt de 120 000 FCFA" · "avance de 50 000 FCFA" · "absence (3 jour(s) du … au …)" · "congé (…)"
const describe = (t: ApprovalRequestType, detail: string) =>
  t === 'LOAN'
    ? `prêt de ${detail}`
    : t === 'ADVANCE'
      ? `avance de ${detail}`
      : t === 'LEAVE'
        ? `congé (${detail})`
        : `absence (${detail})`;

// "le prêt" · "l’avance" · "l’absence" · "le congé"
const definite = (t: ApprovalRequestType) =>
  t === 'LOAN' ? 'le prêt' : t === 'ADVANCE' ? 'l’avance' : t === 'LEAVE' ? 'le congé' : 'l’absence';

// Où le décideur traite la demande
const decisionLink = (t: ApprovalRequestType) =>
  t === 'ABSENCE' ? '/presences/absences' : t === 'LEAVE' ? '/conges' : '/loans/validations';

export interface NotifyRequestArgs {
  companyId: string;
  type: ApprovalRequestType;
  requestId: string;
  employeeName: string;
  // Résumé lisible (prioritaire) ; `amount` reste accepté pour compatibilité (lot B).
  detail?: string;
  amount?: number;
}

const detailOf = (a: NotifyRequestArgs) =>
  a.detail ?? (typeof a.amount === 'number' ? fmt(a.amount) : '');

@Injectable()
export class ApprovalNotifierService {
  private readonly logger = new Logger(ApprovalNotifierService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly circuits: ApprovalCircuitsService,
  ) {}

  // ── 1) À la création d'une demande : avis demandé aux titulaires ─────────
  // Les décideurs (ADMIN / SUPER_ADMIN / HR_MANAGER) reçoivent DÉJÀ la
  // notification historique de la demande → on les exclut ici (pas de doublon).
  async notifyOpinionRequested(args: NotifyRequestArgs): Promise<void> {
    try {
      const circuit = await this.circuits.getActiveCircuit(args.companyId, args.type);
      if (!circuit) return;

      const holders = await this.circuits.getHolders(args.companyId, circuit.steps);
      const recipients = new Map<string, string[]>();
      for (const h of holders) {
        if (DECIDER_ROLES.includes(h.role)) continue;
        const list = recipients.get(h.userId) ?? [];
        list.push(approvalFunctionLabel(h.code));
        recipients.set(h.userId, list);
      }

      await Promise.all(
        Array.from(recipients.entries()).map(([userId, labels]) =>
          this.safeCreate({
            userId,
            type: 'OPINION_REQUEST' as NotificationType,
            title: '🗳️ Votre avis est demandé',
            message: `${args.employeeName} — ${describe(args.type, detailOf(args))} (${labels.join(', ')})`,
            link: '/avis',
            metadata: { requestType: args.type, requestId: args.requestId },
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(`notifyOpinionRequested a échoué : ${e}`);
    }
  }

  // ── 2) Le décideur a validé "en attente d'avis" : relance des manquants ──
  async notifyWaitingForOpinions(
    args: NotifyRequestArgs,
    missingCodes: string[],
    deciderUserId: string,
    deciderName: string,
  ): Promise<void> {
    try {
      const holders = await this.circuits.getHolders(args.companyId, missingCodes);
      const recipients = new Map<string, string[]>();
      for (const h of holders) {
        if (h.userId === deciderUserId) continue;
        const list = recipients.get(h.userId) ?? [];
        list.push(approvalFunctionLabel(h.code));
        recipients.set(h.userId, list);
      }
      await Promise.all(
        Array.from(recipients.entries()).map(([userId, labels]) =>
          this.safeCreate({
            userId,
            type: 'OPINION_REQUEST' as NotificationType,
            title: '⏳ Validation en attente de votre avis',
            message: `${deciderName} a validé ${definite(args.type)} de ${args.employeeName} (${detailOf(args)}). Il n'attend plus que votre avis (${labels.join(', ')}).`,
            link: '/avis',
            metadata: { requestType: args.type, requestId: args.requestId, waiting: true },
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(`notifyWaitingForOpinions a échoué : ${e}`);
    }
  }

  // ── 3) Un avis vient d'être donné → le décideur en attente est informé ──
  async notifyOpinionGiven(
    deciderUserId: string,
    args: NotifyRequestArgs,
    authorName: string,
    functionCode: string,
    opinion: string,
    remainingCount: number,
  ): Promise<void> {
    try {
      const fav = opinion === 'FAVORABLE';
      await this.safeCreate({
        userId: deciderUserId,
        type: 'OPINION_GIVEN' as NotificationType,
        title: fav ? '👍 Avis favorable reçu' : '👎 Avis défavorable reçu',
        message: `${authorName} (${approvalFunctionLabel(functionCode)}) — ${definite(args.type)} de ${args.employeeName}. ${remainingCount > 0 ? `Il reste ${remainingCount} avis à recevoir.` : 'Tous les avis sont reçus.'}`,
        link: decisionLink(args.type),
        metadata: {
          requestType: args.type,
          requestId: args.requestId,
          event: `opinion-${functionCode}`,
        },
      });
    } catch (e) {
      this.logger.warn(`notifyOpinionGiven a échoué : ${e}`);
    }
  }

  // ── 4) Décision à confirmer (avis défavorable ou décideur indisponible) ─
  async notifyNeedsConfirmation(
    targetUserIds: string[],
    args: NotifyRequestArgs,
    reason: string,
  ): Promise<void> {
    try {
      await Promise.all(
        targetUserIds.map((userId) =>
          this.safeCreate({
            userId,
            type: 'DECISION_NEEDS_CONFIRMATION' as NotificationType,
            title: '⚠️ Décision à confirmer',
            message: `${args.employeeName} — ${describe(args.type, detailOf(args))} : ${reason}`,
            link: decisionLink(args.type),
            metadata: { requestType: args.type, requestId: args.requestId },
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(`notifyNeedsConfirmation a échoué : ${e}`);
    }
  }

  private async safeCreate(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: any;
  }) {
    try {
      await this.notifications.create(data);
    } catch (e) {
      this.logger.warn(`Notification non créée pour ${data.userId} : ${e}`);
    }
  }
}
