// ============================================================================
// 🔔 WEBHOOK MOTEKI — POST /webhooks/moteki
// ============================================================================
// ⚠️ CE WEBHOOK N'EST PAS LA SOURCE DE VÉRITÉ (confirmé par le développeur
// Moteki lui-même) :
//   - le système de webhooks est encore en construction côté Moteki, et
//     n'est pas garanti fiable pour l'instant ;
//   - Moteki NE prélève PAS automatiquement le client à chaque échéance —
//     chaque paiement est un acte volontaire, comme avec YabetooPay avant.
//     Le payload reflète donc un CHANGEMENT D'ÉTAT, pas une décision
//     d'activation à prendre.
//
// La vraie source de vérité est le POLLING (voir
// SubscriptionsService.checkAndActivateMotekiOrder /
// checkPendingMotekiOrders, appelé par un cron toutes les 5 min ET à la
// demande depuis la page /success) : on interroge nous-mêmes le statut de
// CHAQUE commande via son order_id, qu'on connaît déjà depuis notre propre
// appel à /subscribe — donc la corrélation entreprise↔commande ne dépend
// jamais du webhook.
//
// Ce fichier reste branché en best-effort : s'il retrouve le paiement
// correspondant, il déclenche une activation quasi-instantanée ; sinon, le
// polling prend le relais dans les minutes qui suivent — aucun paiement
// n'est perdu dans les deux cas.
//
// Événements gérés :
//   subscription.created         → log seulement
//   subscription.payment.success → tentative d'activation immédiate (best-effort)
//   subscription.payment.failed  → tentative de marquage FAILED (best-effort)
//   subscription.status.change   → log seulement
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
import { MotekiService } from '../payments/moteki.service';

@Controller('webhooks/moteki')
export class MotekiWebhooksController {
  private readonly logger = new Logger(MotekiWebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly motekiService: MotekiService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get<string>('MOTEKI_WEBHOOK_SECRET') ?? '';
    if (!this.webhookSecret) {
      this.logger.warn(
        '⚠️  MOTEKI_WEBHOOK_SECRET non défini — vérification signature désactivée (à ne JAMAIS laisser ainsi en production)',
      );
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-moteki-signature') signature: string,
    @Body() payload: any,
  ) {
    this.logger.log('🔔 Webhook Moteki reçu');
    this.logger.log(`📦 Payload: ${JSON.stringify(payload, null, 2)}`);

    if (this.webhookSecret && signature) {
      const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(payload));
      const valid = this.motekiService.verifyWebhookSignature(
        rawBody,
        signature,
        this.webhookSecret,
      );
      if (!valid) {
        this.logger.error('❌ Signature invalide — webhook Moteki rejeté');
        throw new BadRequestException('Invalid signature');
      }
      this.logger.log('✅ Signature vérifiée');
    }

    const eventType = payload.event;

    try {
      switch (eventType) {
        case 'subscription.payment.success': {
          await this._handlePaymentSuccess(payload.data);
          break;
        }

        case 'subscription.payment.failed': {
          await this._handlePaymentFailed(payload.data);
          break;
        }

        case 'subscription.created': {
          this.logger.log(
            `ℹ️  subscription.created — id ${payload.data?.subscription?.id} (traité via subscription.payment.success)`,
          );
          break;
        }

        case 'subscription.status.change': {
          // Note : les changements de statut déclenchés PAR NOTRE app (ex:
          // POST /subscriptions/{uuid}/cancel) sont déjà reflétés côté nous
          // au moment de l'appel. Ce cas couvre les changements côté Moteki
          // (délai de grâce past_due → suspended, etc.) qu'on se contente
          // de logguer pour l'instant plutôt que de les répercuter
          // automatiquement — le cron quotidien (checkExpiredSubscriptions)
          // reste le filet de sécurité qui redescend en FREE le moment venu.
          this.logger.log(
            `ℹ️  subscription.status.change — id ${payload.data?.subscription?.id} → ${payload.data?.subscription?.status}`,
          );
          break;
        }

        default:
          this.logger.warn(`⚠️  Event Moteki non géré: ${eventType}`);
      }
    } catch (err: any) {
      // Toujours retourner 200 — évite les re-tentatives en boucle de Moteki
      // (la doc précise jusqu'à 3 essais en cas d'échec HTTP)
      this.logger.error(
        `❌ Erreur traitement webhook Moteki [${eventType}]: ${err.message}`,
        err.stack,
      );
    }

    return { received: true };
  }

  // ==========================================================================
  // ✅ subscription.payment.success — trouver le Payment correspondant
  // ==========================================================================

  private async _handlePaymentSuccess(data: any) {
    const sub = data?.subscription ?? data;
    const motekiSubscriptionId: string | undefined = sub?.id;

    if (!motekiSubscriptionId) {
      this.logger.error('❌ subscription.payment.success sans subscription.id — ignoré');
      return;
    }

    const payment = await this._findPayment(data);

    if (!payment) {
      // Pas grave : le webhook n'est ici qu'un raccourci "best-effort" —
      // le polling (checkPendingMotekiOrders, toutes les 5 min) prend le
      // relais de toute façon et retrouve le paiement via son propre
      // order_id qu'on connaît déjà nous-mêmes.
      this.logger.warn(
        `⚠️ [Moteki] Webhook reçu pour subscription ${motekiSubscriptionId} mais aucun Payment ` +
          `correspondant trouvé — pas bloquant, le polling prendra le relais.`,
      );
      return;
    }

    // Idempotence : un webhook peut arriver plusieurs fois pour le même
    // événement (retries Moteki) — checkAndActivateMotekiOrder gère déjà
    // ce cas (skip si déjà SUCCEEDED/FAILED).
    await this.subscriptionsService.handleMotekiPaymentSuccess(
      payment,
      motekiSubscriptionId,
    );
  }

  private async _handlePaymentFailed(data: any) {
    const payment = await this._findPayment(data);
    if (!payment) {
      this.logger.warn(
        `⚠️  subscription.payment.failed reçu mais aucun Payment correspondant trouvé (subscription ${data?.subscription?.id ?? 'inconnue'})`,
      );
      return;
    }
    await this.subscriptionsService.handleMotekiPaymentFailed(payment.id);
  }

  // ==========================================================================
  // 🔎 Corrélation webhook → Payment (voir note en tête de fichier)
  // ==========================================================================

  private async _findPayment(data: any) {
    const sub = data?.subscription ?? data;

    // 1) Référence directe à la commande, si présente dans le payload réel
    const orderId: string | undefined =
      data?.order_id ?? data?.order?.id ?? sub?.order_id;
    const orderNumber: string | undefined =
      data?.order_number ?? data?.order?.order_number ?? sub?.order_number;

    if (orderId) {
      const byOrderId = await this.prisma.payment.findFirst({
        where: { provider: 'MOTEKI', motekiOrderId: orderId },
      });
      if (byOrderId) return byOrderId;
    }
    if (orderNumber) {
      const byOrderNumber = await this.prisma.payment.findFirst({
        where: { provider: 'MOTEKI', motekiOrderNumber: orderNumber },
      });
      if (byOrderNumber) return byOrderNumber;
    }

    // 2) Un renouvellement automatique référence le même abonnement Moteki
    //    qu'un paiement déjà traité une première fois.
    const motekiSubscriptionId: string | undefined = sub?.id;
    if (motekiSubscriptionId) {
      const byMotekiSubId = await this.prisma.payment.findFirst({
        where: { provider: 'MOTEKI', motekiSubscriptionId },
        orderBy: { createdAt: 'desc' },
      });
      if (byMotekiSubId) {
        // Pour un RENOUVELLEMENT (pas le tout premier paiement), on crée un
        // nouveau Payment "enfant" plutôt que de réutiliser l'ancien déjà
        // SUCCEEDED, pour garder un historique de paiements correct.
        if (byMotekiSubId.status === 'SUCCEEDED') {
          return this.prisma.payment.create({
            data: {
              subscriptionId: byMotekiSubId.subscriptionId,
              companyId: byMotekiSubId.companyId,
              provider: 'MOTEKI',
              motekiSubscriptionId,
              motekiCustomerEmail: byMotekiSubId.motekiCustomerEmail,
              amount: Math.round(Number(sub?.amount ?? byMotekiSubId.amount)),
              currency: sub?.currency ?? byMotekiSubId.currency,
              status: 'PENDING',
              paymentMethod: byMotekiSubId.paymentMethod,
              description: `Renouvellement — ${byMotekiSubId.description ?? ''}`.trim(),
              metadata: byMotekiSubId.metadata as any,
            },
          });
        }
        return byMotekiSubId;
      }
    }

    // 3) Dernier recours : email client + PENDING le plus récent
    const customerEmail: string | undefined =
      data?.customer_email ?? data?.customer?.email ?? sub?.customer_email;
    if (customerEmail) {
      const byEmail = await this.prisma.payment.findFirst({
        where: {
          provider: 'MOTEKI',
          motekiCustomerEmail: customerEmail,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (byEmail) return byEmail;
    }

    return null;
  }
}