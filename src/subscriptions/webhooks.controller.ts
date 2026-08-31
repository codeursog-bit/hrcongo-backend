// src/subscriptions/webhooks.controller.ts
// ============================================================================
// AJOUT : handler disbursement.completed
// Tout le reste (intent.succeeded, intent.failed) est INCHANGÉ.
// ============================================================================
// Events gérés :
//   intent.succeeded       → paiement cabinet ou entreprise réussi
//   intent.failed          → paiement échoué
//   disbursement.completed → versement affilié confirmé par Yabetoo
//                            → commissions PME + Cabinet → PAID
// ============================================================================

import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';
import { CabinetSubscriptionService } from '../cabinet/services/cabinet-subscription.service';

@Controller('webhooks/yabetoopay')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly cabinetSubscriptionService: CabinetSubscriptionService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret =
      this.configService.get<string>('YABETOOPAY_WEBHOOK_SECRET') ?? '';
    if (!this.webhookSecret) {
      this.logger.warn(
        '⚠️  YABETOOPAY_WEBHOOK_SECRET non défini — vérification signature désactivée',
      );
    }
  }

  // ==========================================================================
  // POST /webhooks/yabetoopay
  // ==========================================================================

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-yabetoo-signature') signature: string,
    @Body() payload: any,
  ) {
    this.logger.log('🔔 Webhook YaBetooPay reçu');
    this.logger.log(`📦 Payload: ${JSON.stringify(payload, null, 2)}`);

    // ── Vérification signature ───────────────────────────────────────────
    if (this.webhookSecret && signature) {
      const valid = this._verifySignature(request.rawBody, signature);
      if (!valid) {
        this.logger.error('❌ Signature invalide — webhook rejeté');
        throw new BadRequestException('Invalid signature');
      }
      this.logger.log('✅ Signature vérifiée');
    }

    const eventType = payload.type;
    this.logger.log(`📋 Event: ${eventType}`);

    try {
      switch (eventType) {
        // ── Paiements entrants — INCHANGÉS ──────────────────────────────
        case 'intent.succeeded': {
          const charge = payload.data?.charge;
          const intentId = charge?.intentId;
          if (charge?.status === 'succeeded' && intentId) {
            await this._routeSucceededPayment(charge, intentId);
          }
          break;
        }

        case 'intent.failed': {
          const charge = payload.data?.charge;
          const intentId = charge?.intentId;
          if (intentId) await this._routeFailedPayment(intentId);
          break;
        }

        // ── Disbursement affilié — NOUVEAU ──────────────────────────────
        // Yabetoo envoie l'objet disbursement directement dans le payload
        // (ou dans payload.data selon la version). On tente les deux.
        // L'objet disbursement contient : id, status ("succeeded" ou "failed"),
        // financialTransactionId, firstName, lastName, phone, etc.
        case 'disbursement.completed': {
          const disbursement = payload.data ?? payload;
          const disbursementId = disbursement?.id;

          if (!disbursementId) {
            this.logger.warn('⚠️  disbursement.completed sans id — ignoré');
            break;
          }

          this.logger.log(
            `💸 disbursement.completed — id: ${disbursementId} — status: ${disbursement.status}`,
          );
          await this._handleDisbursementCompleted(disbursementId, disbursement);
          break;
        }

        default:
          this.logger.warn(`⚠️  Event non géré: ${eventType}`);
      }
    } catch (err: any) {
      // Toujours retourner 200 — évite les re-envois en boucle Yabetoo
      this.logger.error(
        `❌ Erreur traitement webhook [${eventType}]: ${err.message}`,
      );
    }

    return { received: true };
  }

  // ==========================================================================
  // disbursement.completed — NOUVEAU
  // ==========================================================================

  private async _handleDisbursementCompleted(disbursementId: string, raw: any) {
    // Retrouver la demande de retrait liée à ce disbursementId
    const withdrawalRequest = await (
      this.prisma as any
    ).affiliateWithdrawalRequest.findFirst({
      where: { disbursementId },
    });

    if (!withdrawalRequest) {
      this.logger.warn(
        `⚠️  Aucune demande de retrait pour disbursementId: ${disbursementId}`,
      );
      return;
    }

    // Idempotence
    if (withdrawalRequest.status === 'PAID') {
      this.logger.log(
        `ℹ️  Déjà PAID — idempotence OK (disbursementId: ${disbursementId})`,
      );
      return;
    }

    const affiliateId = withdrawalRequest.affiliateId;
    const now = new Date();
    const yabetooStatus = raw?.status ?? 'succeeded'; // "succeeded" ou "failed"

    if (yabetooStatus === 'succeeded') {
      // Transaction atomique : toutes les commissions PENDING → PAID
      await this.prisma.$transaction(async (tx: any) => {
        // Commissions PME
        await tx.affiliateCommission.updateMany({
          where: { affiliateId, status: 'PENDING' },
          data: { status: 'PAID', paidAt: now, paymentRef: disbursementId },
        });

        // Commissions Cabinet
        await tx.affiliateCabinetCommission.updateMany({
          where: { affiliateId, status: 'PENDING' },
          data: { status: 'PAID', paidAt: now, paymentRef: disbursementId },
        });

        // Demande de retrait
        await tx.affiliateWithdrawalRequest.update({
          where: { id: withdrawalRequest.id },
          data: {
            status: 'PAID',
            disbursementStatus: 'succeeded',
            paidAt: now,
          },
        });
      });

      this.logger.log(
        `✅ Affilié ${affiliateId} — toutes les commissions PAID via disbursement ${disbursementId}`,
      );
    } else {
      // Disbursement échoué — remettre en PENDING pour permettre un réessai
      this.logger.warn(
        `❌ Disbursement ${disbursementId} échoué (status: ${yabetooStatus}) — remise en PENDING`,
      );

      await (this.prisma as any).affiliateWithdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: {
          status: 'PENDING', // l'affilié peut re-demander
          disbursementId: null, // reset pour permettre un nouvel essai
          disbursementStatus: 'failed',
          processedAt: null,
        },
      });
    }
  }

  // ==========================================================================
  // Paiement entrant réussi — INCHANGÉ
  // ==========================================================================

  private async _routeSucceededPayment(charge: any, intentId: string) {
    // 1. Cabinet
    const cabinetPayment = await this.prisma.cabinetPayment.findFirst({
      where: { yabetopayIntentId: intentId },
      include: { subscription: { select: { cabinetId: true } } },
    });

    if (cabinetPayment) {
      this.logger.log(
        `🏛️  CABINET — cabinetId: ${cabinetPayment.subscription.cabinetId}`,
      );
      if (cabinetPayment.status === 'SUCCEEDED') {
        this.logger.log('ℹ️  Déjà traité — idempotence OK');
        return;
      }
      await this.cabinetSubscriptionService.handleWebhookSuccess(
        cabinetPayment.id,
      );
      this.logger.log('✅ Plan cabinet activé + commission affilié traitée');
      return;
    }

    // 2. Entreprise
    const enterprisePayment = await this.prisma.payment.findFirst({
      where: { yabetooIntentId: intentId },
    });

    if (enterprisePayment) {
      this.logger.log(
        `🏢 ENTREPRISE — companyId: ${enterprisePayment.companyId}`,
      );
      if (enterprisePayment.status === 'SUCCEEDED') {
        this.logger.log('ℹ️  Déjà traité — idempotence OK');
        return;
      }
      await this.subscriptionsService.activatePaymentByWebhook({
        intentId,
        chargeId: charge.id,
        transactionId: charge.transactionId,
        financialTransactionId: charge.financialTransactionId,
        amount: charge.amount,
        currency: charge.currency,
        status: charge.status,
      });
      this.logger.log(
        '✅ Abonnement entreprise activé + commission affilié traitée',
      );
      return;
    }

    this.logger.error(`❌ Aucun paiement trouvé pour intentId: ${intentId}`);
  }

  // ==========================================================================
  // Paiement échoué — INCHANGÉ
  // ==========================================================================

  private async _routeFailedPayment(intentId: string) {
    const [cab, ent] = await Promise.all([
      this.prisma.cabinetPayment.findFirst({
        where: { yabetopayIntentId: intentId },
      }),
      this.prisma.payment.findFirst({ where: { yabetooIntentId: intentId } }),
    ]);
    if (cab) {
      await this.prisma.cabinetPayment.update({
        where: { id: cab.id },
        data: { status: 'FAILED' },
      });
      this.logger.warn(`⚠️  Paiement cabinet FAILED — ${intentId}`);
    }
    if (ent) {
      await this.prisma.payment.update({
        where: { id: ent.id },
        data: { status: 'FAILED' },
      });
      this.logger.warn(`⚠️  Paiement entreprise FAILED — ${intentId}`);
    }
    if (!cab && !ent) {
      this.logger.warn(`⚠️  Aucun paiement trouvé pour FAILED — ${intentId}`);
    }
  }

  // ==========================================================================
  // Signature HMAC-SHA256 — INCHANGÉ
  // ==========================================================================

  private _verifySignature(
    rawBody: Buffer | undefined,
    signature: string,
  ): boolean {
    if (!rawBody || !this.webhookSecret) return false;
    try {
      const crypto = require('crypto');
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }
}
