// ============================================================================
// 🔔 WEBHOOK CHARIOW (Pulse) — POST /webhooks/chariow
// ============================================================================
// ⚠️ NON VÉRIFIÉ / BEST-EFFORT : la doc Chariow reçue jusqu'ici ne décrit ni
// le nom exact des événements Pulse, ni le mécanisme de signature (contrairement
// à Moteki qui documente "X-Moteki-Signature: sha256=..."). Ce contrôleur reste
// donc désactivé par défaut tant que CHARIOW_WEBHOOK_SECRET n'est pas défini,
// et surtout : la vraie source de vérité est le POLLING (voir
// SubscriptionsService.checkAndActivateChariowSale / checkPendingChariowSales,
// appelé par un cron toutes les 5 min ET à la demande depuis la page
// /success) — exactement le même principe que pour Moteki. Ce webhook n'est
// qu'un raccourci "si ça marche, tant mieux, activation plus rapide".
//
// ⚠️ AVANT DE BRANCHER CECI EN PROD :
//   1. Récupérer la doc Pulse complète (nom des événements, format du
//      payload, header de signature) auprès du support Chariow.
//   2. Adapter eventType / payload.data ci-dessous en conséquence.
//   3. Implémenter une vraie vérification de signature (retirer le
//      court-circuit "signature non vérifiée" plus bas).
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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';

@Controller('webhooks/chariow')
export class ChariowWebhooksController {
  private readonly logger = new Logger(ChariowWebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get<string>('CHARIOW_WEBHOOK_SECRET') ?? '';
    if (!this.webhookSecret) {
      this.logger.warn(
        '⚠️  CHARIOW_WEBHOOK_SECRET non défini — vérification signature désactivée. ' +
          'Pas bloquant : le polling (checkPendingChariowSales) reste la source de vérité.',
      );
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-chariow-signature') signature: string,
    @Body() payload: any,
  ) {
    this.logger.log('🔔 Webhook Chariow (Pulse) reçu');
    this.logger.log(`📦 Payload: ${JSON.stringify(payload, null, 2)}`);

    // 🔒 CORRECTIF SÉCURITÉ (audit, item mineur) : le header de signature est
    // désormais exigé, par rigueur — même faille de principe que sur
    // YabetooPay/Moteki (`if (secret && signature)` sautait la vérification
    // si le header était juste absent). Pas de fraude possible ici puisque
    // l'activation ne se fait JAMAIS depuis ce payload (toujours
    // checkAndActivateChariowSale, qui re-vérifie via l'API) ; ceci ferme
    // simplement la porte par cohérence.
    // ⚠️ La vérification cryptographique de la signature elle-même reste
    // TODO tant que le mécanisme Pulse n'est pas documenté (voir note en
    // tête de fichier) — on ne peut donc garantir que l'authenticité, pas
    // encore vérifier la valeur du header.
    if (!signature) {
      this.logger.error('❌ Webhook Chariow rejeté — header x-chariow-signature absent');
      throw new BadRequestException('Signature manquante');
    }

    const saleId: string | undefined =
      payload?.data?.sale?.id ?? payload?.data?.id ?? payload?.sale_id;

    if (!saleId) {
      this.logger.warn('⚠️  Webhook Chariow sans identifiant de vente exploitable — ignoré');
      return { received: true };
    }

    try {
      const payment = await this.prisma.payment.findFirst({
        where: { provider: 'CHARIOW', chariowSaleId: saleId },
      });

      if (!payment) {
        this.logger.warn(
          `⚠️ [Chariow] Webhook reçu pour la vente ${saleId} mais aucun Payment correspondant trouvé — ` +
            'pas bloquant, le polling prendra le relais.',
        );
        return { received: true };
      }

      // Idempotence gérée par checkAndActivateChariowSale (skip si déjà
      // SUCCEEDED/FAILED) — on se contente de redéclencher la même
      // vérification qui fait autorité (l'appel API, pas ce payload).
      await this.subscriptionsService.checkAndActivateChariowSale(payment.id);
    } catch (err: any) {
      // Toujours retourner 200 — évite des retries en boucle côté Chariow.
      this.logger.error(
        `❌ Erreur traitement webhook Chariow pour vente ${saleId}: ${err.message}`,
        err.stack,
      );
    }

    return { received: true };
  }
}