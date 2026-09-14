// ============================================================================
// 🛒 MOTEKI SERVICE — remplace YabetooPay pour la COLLECTE de paiements
// (checkout des abonnements). Les VERSEMENTS (commissions affiliés) restent
// sur YabetooPayService.createDisbursement pour l'instant — la doc Moteki
// fournie ne documente pas d'équivalent "disbursement". Voir le message
// accompagnant ce code pour ce point ouvert.
// ============================================================================

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

// ============================================================================
// 📝 TYPES
// ============================================================================

export type MotekiPaymentMethod = 'mobile_money' | 'card' | 'aggregator';

export interface InitiateSubscriptionCheckoutDto {
  digitalProductUuid: string;
  planIndex: number;
  customerFirstName: string;
  customerLastName?: string;
  customerEmail: string;
  customerPhone?: string;
  paymentMethod: MotekiPaymentMethod;
  paymentOperator?: string; // ex: "mtn-cg", "visa", "cinetpay"...
}

export interface MotekiOrderResponse {
  id: string; // "ord-uuid"
  order_number: string; // "MOT-123456"
  status: string;
  payment_status: string;
  payment_method: string;
  payment_operator?: string;
  total_amount: number;
  redirect_url: string;
  checkout_url: string;
}

export interface MotekiSubscriptionResponse {
  id: string;
  status:
    | 'active'
    | 'trial'
    | 'past_due'
    | 'cancelled'
    | 'suspended'
    | 'expired'
    | string;
  status_label?: string;
  billing_cycle: string;
  amount: string;
  currency: string;
  starts_at: string;
  ends_at: string;
  next_billing_date: string | null;
  cancelled_at: string | null;
  auto_renew: boolean;
  product?: { id: string; name: string };
}

export interface MotekiPaymentMethodOption {
  payment_method: MotekiPaymentMethod;
  payment_operators: string[];
}

// ============================================================================
// 🔧 SERVICE
// ============================================================================

@Injectable()
export class MotekiService {
  private readonly logger = new Logger(MotekiService.name);
  private readonly client: AxiosInstance;
  private readonly secretKey: string;

  // 🐛 CORRECTIF : avant, l'absence de MOTEKI_SECRET_KEY faisait planter TOUT
  // le serveur au démarrage (throw dans le constructeur d'un provider Nest
  // instancié au boot). Pour permettre le mode "bascule automatique" (voir
  // isMotekiConfigured() dans moteki.config.ts), on doit pouvoir démarrer
  // sans clé Moteki — l'erreur ne doit remonter qu'au moment où on essaie
  // VRAIMENT d'appeler l'API Moteki, pas avant.
  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('MOTEKI_SECRET_KEY');
    this.secretKey = secretKey ?? '';

    // 🔍 LOG TEMPORAIRE DE DEBUG — à retirer une fois le problème résolu.
    // Affiche ce qui est VRAIMENT chargé en mémoire (pas ce qu'il y a dans
    // le fichier .env) pour confirmer si une variable d'environnement
    // système/session écrase la valeur du .env, ou si le .env lui-même
    // contient une valeur inattendue (mauvaise clé, caractère invisible...).
    this.logger.warn(
      `🔑 [DEBUG TEMPORAIRE] Clé Moteki chargée — longueur: ${this.secretKey.length}, ` +
        `termine par: ...${this.secretKey.slice(-8)}, ` +
        `commence par: ${this.secretKey.slice(0, 6)}...`,
    );

    if (!secretKey) {
      this.logger.warn(
        '⚠️  MOTEKI_SECRET_KEY absent de la config (.env) — MotekiService inactif, YabetooPay prend le relais si configuré.',
      );
    }

    const baseURL =
      this.configService.get<string>('MOTEKI_API_BASE_URL') ??
      'https://api.moteki.co/api/v1';

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.secretKey}`,
      },
      timeout: 30000,
    });

    this.logger.log(`🔧 MotekiService initialisé — base URL: ${baseURL}`);
  }

  /** true si une vraie clé Moteki est configurée — utilisé par la bascule automatique de prestataire. */
  isConfigured(): boolean {
    return !!this.secretKey;
  }

  private assertConfigured() {
    if (!this.secretKey) {
      throw new BadRequestException(
        'Moteki n\'est pas configuré sur ce serveur (MOTEKI_SECRET_KEY manquant).',
      );
    }
  }

  // ==========================================================================
  // 💳 INITIER UN CHECKOUT D'ABONNEMENT
  // POST /storefront/digital-products/{uuid}/subscribe
  // ==========================================================================

  async initiateSubscriptionCheckout(
    dto: InitiateSubscriptionCheckoutDto,
  ): Promise<MotekiOrderResponse> {
    this.assertConfigured();
    try {
      this.logger.log(
        `💳 Initiation checkout Moteki — produit ${dto.digitalProductUuid}, plan #${dto.planIndex}, ${dto.paymentMethod}`,
      );

      const payload = {
        plan_index: dto.planIndex,
        customer_first_name: dto.customerFirstName,
        customer_last_name: dto.customerLastName,
        customer_email: dto.customerEmail,
        customer_phone: dto.customerPhone,
        payment_method: dto.paymentMethod,
        payment_operator: dto.paymentOperator,
      };

      const response = await this.client.post<MotekiOrderResponse>(
        `/storefront/digital-products/${dto.digitalProductUuid}/subscribe`,
        payload,
      );

      this.logger.log(
        `✅ Commande Moteki créée: ${response.data.order_number} (${response.data.status})`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('❌ Échec initiation checkout Moteki:');
      this.logger.error(
        JSON.stringify(error.response?.data, null, 2) || error.message,
      );

      const errMsg =
        error.response?.data?.message ||
        (error.response?.status === 400
          ? 'Ce moyen de paiement n’est pas activé sur la boutique Moteki.'
          : error.response?.status === 422
            ? 'Plan invalide ou produit non abonnement.'
            : 'Erreur lors de l’initiation du paiement.');

      throw new BadRequestException(errMsg);
    }
  }

  // ==========================================================================
  // 🔍 STATUT D'UNE COMMANDE (pour le polling — remplace la dépendance au
  // webhook tant qu'il n'est pas encore fiable côté Moteki)
  //
  // 🐛 CORRECTIF : l'ancien code appelait GET /orders/{id}, qui n'existe pas
  // dans la doc Moteki — d'où l'échec silencieux systématique du polling.
  // Le vrai endpoint (doc "Statut des commandes") est GET
  // /storefront/orders/{order_number}, avec le NUMÉRO de commande
  // ("MOT-xxx"/"ORD-xxx"), pas l'UUID interne — scope read:store, qu'on a déjà.
  // ==========================================================================

  async getOrderStatus(orderNumber: string): Promise<{
    id: string;
    order_number: string;
    status: string; // pending | processing | completed | cancelled | refunded
    payment_status: string; // pending | awaiting_payment | paid | failed | refunded
    payment_method: string;
    total_amount: number;
    created_at: string;
  }> {
    try {
      this.assertConfigured();
      const response = await this.client.get(`/storefront/orders/${orderNumber}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `❌ Échec récupération statut commande Moteki ${orderNumber}:`,
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        'Erreur lors de la vérification du statut de la commande',
      );
    }
  }

  // ==========================================================================
  // 🔍 STATUT D'UN ABONNEMENT
  // GET /subscriptions/{uuid}
  // ==========================================================================

  async getSubscriptionStatus(
    subscriptionUuid: string,
  ): Promise<MotekiSubscriptionResponse> {
    try {
      this.assertConfigured();
      const response = await this.client.get<MotekiSubscriptionResponse>(
        `/subscriptions/${subscriptionUuid}`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        '❌ Échec récupération statut abonnement Moteki:',
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        "Erreur lors de la vérification du statut de l'abonnement",
      );
    }
  }

  // ==========================================================================
  // ❌ ANNULER UN ABONNEMENT
  // POST /subscriptions/{uuid}/cancel — accès conservé jusqu'à ends_at
  // ==========================================================================

  async cancelSubscription(
    subscriptionUuid: string,
    reason?: string,
  ): Promise<MotekiSubscriptionResponse> {
    try {
      this.assertConfigured();
      const response = await this.client.post<MotekiSubscriptionResponse>(
        `/subscriptions/${subscriptionUuid}/cancel`,
        { reason },
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        '❌ Échec annulation abonnement Moteki:',
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        "Erreur lors de l'annulation de l'abonnement",
      );
    }
  }

  // ==========================================================================
  // 💳 MOYENS DE PAIEMENT ACTIVÉS SUR LA BOUTIQUE
  // GET /storefront/payment-methods
  // ==========================================================================

  async getAvailablePaymentMethods(): Promise<MotekiPaymentMethodOption[]> {
    try {
      this.assertConfigured();
      const response = await this.client.get<MotekiPaymentMethodOption[]>(
        '/storefront/payment-methods',
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        '❌ Échec récupération moyens de paiement Moteki:',
        error.response?.data || error.message,
      );
      return [];
    }
  }

  // ==========================================================================
  // 🔐 VÉRIFIER LA SIGNATURE WEBHOOK
  // Header : X-Moteki-Signature: sha256=<hmac_hex>
  // ==========================================================================

  verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    secret: string,
  ): boolean {
    try {
      if (!signatureHeader?.startsWith('sha256=')) return false;
      const provided = signatureHeader.slice('sha256='.length);

      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      const providedBuf = Buffer.from(provided, 'hex');
      const expectedBuf = Buffer.from(expected, 'hex');
      if (providedBuf.length !== expectedBuf.length) return false;

      return crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch (error) {
      this.logger.error('❌ Échec vérification signature webhook Moteki:', error);
      return false;
    }
  }
}