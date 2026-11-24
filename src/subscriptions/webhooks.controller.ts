// src/subscriptions/webhooks.controller.ts
// ============================================================================
// 🔒 CORRECTIF SÉCURITÉ (audit) — deux failles corrigées :
//
// 1. SIGNATURE CONTOURNABLE : avant, `if (this.webhookSecret && signature)`
//    sautait complètement la vérification si le header était juste absent
//    — un attaquant n'avait qu'à ne PAS envoyer x-yabetoo-signature. La
//    signature est désormais OBLIGATOIRE : header absent, secret non
//    configuré, ou signature invalide → rejet (400) dans tous les cas.
//
// 2. CONFIANCE AVEUGLE AU PAYLOAD : avant, `activatePaymentByWebhook` et
//    `handleWebhookSuccess` marquaient le paiement SUCCEEDED directement
//    depuis `charge.status` du payload, sans jamais revérifier auprès de
//    Yabetoo. Pire, si l'intentId ne matchait aucun paiement, un fallback
//    cherchait un paiement PENDING par MONTANT + DEVISE — donc un
//    attaquant pouvait créer un checkout à bas prix (PENDING) puis envoyer
//    un webhook forgé avec juste le bon montant pour l'activer gratuitement
//    (et déclencher une vraie commission affilié en argent réel).
//
//    Le webhook ne sert plus QUE de déclencheur : `intentId`/`disbursementId`
//    servent uniquement à savoir LEQUEL paiement re-vérifier. Le statut réel
//    est toujours redemandé server-to-server à Yabetoo (authentifié avec
//    notre propre clé secrète), exactement le même principe que
//    checkAndActivateChariowSale / checkAndActivateMotekiOrder déjà en place
//    pour les 2 autres prestataires. Plus AUCUN fallback par montant.
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
import { YabetooPayService } from '../payments/yabetoopay.service';

@Controller('webhooks/yabetoopay')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly cabinetSubscriptionService: CabinetSubscriptionService,
    private readonly yabetooPayService: YabetooPayService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret =
      this.configService.get<string>('YABETOOPAY_WEBHOOK_SECRET') ?? '';
    if (!this.webhookSecret) {
      // ⚠️ Ce n'est plus un simple avertissement dégradé : sans secret
      // configuré, TOUS les webhooks seront désormais rejetés (voir
      // handleWebhook ci-dessous) — voulu, pour ne jamais traiter un
      // webhook qu'on ne peut pas authentifier.
      this.logger.error(
        '🚨 YABETOOPAY_WEBHOOK_SECRET non défini — TOUS les webhooks entrants seront rejetés jusqu\'à configuration.',
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

    // ── Vérification signature — OBLIGATOIRE, plus jamais optionnelle ──────
    if (!this.webhookSecret) {
      this.logger.error('❌ Webhook rejeté — YABETOOPAY_WEBHOOK_SECRET non configuré');
      throw new BadRequestException('Webhook non configuré côté serveur');
    }
    if (!signature) {
      this.logger.error('❌ Webhook rejeté — header x-yabetoo-signature absent');
      throw new BadRequestException('Signature manquante');
    }
    if (!this._verifySignature(request.rawBody, signature)) {
      this.logger.error('❌ Webhook rejeté — signature invalide');
      throw new BadRequestException('Invalid signature');
    }
    this.logger.log('✅ Signature vérifiée');

    const eventType = payload.type;
    this.logger.log(`📋 Event: ${eventType} (utilisé uniquement comme déclencheur — voir note en tête de fichier)`);

    try {
      switch (eventType) {
        // ── Paiements entrants — succeeded ET failed traités PAREIL : le
        // payload ne sert qu'à identifier le paiement, jamais son statut.
        case 'intent.succeeded':
        case 'intent.failed': {
          const intentId = payload.data?.charge?.intentId;
          if (!intentId) {
            this.logger.warn(`⚠️ ${eventType} sans intentId exploitable — ignoré`);
            break;
          }
          await this._reverifyIntentPayment(intentId);
          break;
        }

        // ── Disbursement affilié — re-vérifié via l'API, jamais depuis le payload
        case 'disbursement.completed': {
          const disbursement = payload.data ?? payload;
          const disbursementId = disbursement?.id;

          if (!disbursementId) {
            this.logger.warn('⚠️  disbursement.completed sans id — ignoré');
            break;
          }

          await this._reverifyDisbursement(disbursementId);
          break;
        }

        default:
          this.logger.warn(`⚠️  Event non géré: ${eventType}`);
      }
    } catch (err: any) {
      // Toujours retourner 200 après ce point — évite les re-envois en
      // boucle Yabetoo. Le rejet pour signature invalide/absente, lui,
      // reste un vrai code d'erreur (voir plus haut, avant le try).
      this.logger.error(
        `❌ Erreur traitement webhook [${eventType}]: ${err.message}`,
      );
    }

    return { received: true };
  }

  // ==========================================================================
  // 🔒 RE-VÉRIFICATION SERVEUR-À-SERVEUR D'UN PAIEMENT (intent.succeeded/failed)
  // ==========================================================================
  // intentId ne sert qu'à retrouver LEQUEL paiement re-vérifier — jamais son
  // statut, qui vient toujours de GET /payment-intents/{id} via notre clé.
  // Aucun fallback par montant : si l'intentId ne matche rien, on ignore.
  // ==========================================================================

  private async _reverifyIntentPayment(intentId: string) {
    const cabinetPayment = await this.prisma.cabinetPayment.findFirst({
      where: { yabetopayIntentId: intentId },
    });

    if (cabinetPayment) {
      this.logger.log(`🏛️  CABINET — paiement ${cabinetPayment.id} (intentId: ${intentId})`);
      const result = await this.cabinetSubscriptionService.checkAndActivateCabinetPayment(
        cabinetPayment.id,
      );
      this.logger.log(`🏛️  Résultat re-vérification: ${result.status}`);
      return;
    }

    const enterprisePayment = await this.prisma.payment.findFirst({
      where: { yabetooIntentId: intentId },
    });

    if (enterprisePayment) {
      this.logger.log(`🏢 ENTREPRISE — paiement ${enterprisePayment.id} (intentId: ${intentId})`);
      const result = await this.subscriptionsService.checkAndActivateYabetooPayment(
        enterprisePayment.id,
      );
      this.logger.log(`🏢 Résultat re-vérification: ${result.status}`);
      return;
    }

    // ⚠️ Plus AUCUN fallback par montant ici — voir note en tête de fichier.
    // Si l'intentId ne matche rien, on n'active RIEN, on log et on s'arrête.
    this.logger.error(`❌ Aucun paiement trouvé pour intentId: ${intentId} — ignoré (aucune action)`);
  }

  // ==========================================================================
  // 🔒 RE-VÉRIFICATION SERVEUR-À-SERVEUR D'UN DISBURSEMENT
  // ==========================================================================

  private async _reverifyDisbursement(disbursementId: string) {
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

    if (withdrawalRequest.status === 'PAID') {
      this.logger.log(`ℹ️  Déjà PAID — idempotence OK (disbursementId: ${disbursementId})`);
      return;
    }

    // 🔒 On redemande le statut réel à Yabetoo plutôt que de faire confiance
    // au payload webhook.
    const realStatus = await this.yabetooPayService.getDisbursement(disbursementId);

    const affiliateId = withdrawalRequest.affiliateId;
    const now = new Date();

    if (realStatus.status === 'succeeded') {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.affiliateCommission.updateMany({
          where: { affiliateId, status: 'PENDING' },
          data: { status: 'PAID', paidAt: now, paymentRef: disbursementId },
        });
        await tx.affiliateCabinetCommission.updateMany({
          where: { affiliateId, status: 'PENDING' },
          data: { status: 'PAID', paidAt: now, paymentRef: disbursementId },
        });
        await tx.affiliateWithdrawalRequest.update({
          where: { id: withdrawalRequest.id },
          data: { status: 'PAID', disbursementStatus: 'succeeded', paidAt: now },
        });
      });

      this.logger.log(
        `✅ Affilié ${affiliateId} — commissions PAID via disbursement ${disbursementId} (re-vérifié serveur)`,
      );
    } else if (realStatus.status === 'failed') {
      this.logger.warn(
        `❌ Disbursement ${disbursementId} échoué (re-vérifié serveur) — remise en PENDING`,
      );
      await (this.prisma as any).affiliateWithdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: {
          status: 'PENDING',
          disbursementId: null,
          disbursementStatus: 'failed',
          processedAt: null,
        },
      });
    } else {
      this.logger.log(
        `ℹ️  Disbursement ${disbursementId} toujours en cours (status: ${realStatus.status}) — rien à faire`,
      );
    }
  }

  // ==========================================================================
  // Signature HMAC-SHA256 — inchangé
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
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }
}