// ============================================================================
// 🛒 MOTEKI SERVICE — remplace YabetooPay pour la COLLECTE de paiements
// (checkout des abonnements). Les VERSEMENTS (commissions affiliés) restent
// sur YabetooPayService.createDisbursement — Moteki ne documente pas
// d'équivalent "disbursement".
//
// ⚠️ MIGRATION v1 → v2 (Merchant Payments API) — voir doc "Paiements
// marchands" fournie par Moteki. La doc confirme que v1 (/storefront/
// digital-products/{uuid}/subscribe) reste fonctionnelle et n'a PAS changé,
// mais en pratique le flux v1 posait des soucis de fiabilité en prod (pas
// d'idempotence, pas de re-vérification serveur du montant/opérateur,
// commandes orphelines si le paiement échouait juste après création). Le
// flux v2 corrige tout ça : création atomique (intention + commande d'un
// coup, zéro orphelin en cas d'échec), Idempotency-Key obligatoire (rejeu
// sûr), montant figé et re-résolu serveur, MSISDN figé à l'intention et
// re-vérifié au confirm. On utilise donc v2 pour TOUT le checkout —
// initiateSubscriptionCheckout/getOrderStatus (v1) sont retirés au profit
// de createPaymentIntent/confirmPayment/getPaymentStatus (v2).
//
// GET /subscriptions/{uuid} et POST /subscriptions/{uuid}/cancel restent en
// v1 (pas d'équivalent v2 documenté) — mais on ne s'en sert plus pour piloter
// l'accès KonzaRH : exactement comme pour Chariow, la source de vérité pour
// la date de fin d'abonnement reste 100% interne à l'app
// (SubscriptionsService.activateUpgrade), Moteki n'étant qu'un rail de
// paiement. getSubscriptionStatus/cancelSubscription ci-dessous ne sont
// conservés que pour un éventuel usage de suivi/support côté Moteki.
// ============================================================================

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

// ============================================================================
// 📝 TYPES
// ============================================================================

export type MotekiPaymentMethod = 'mobile_money' | 'card' | 'aggregator';

export interface CreateMotekiPaymentIntentDto {
  productUuid: string; // UUID du produit digital "subscription" côté Moteki
  planIndex: number;
  customerFirstName: string;
  customerLastName?: string;
  customerEmail: string;
  customerCountry: string; // iso2 minuscule, ex: "cg"
  customerPhoneE164: string; // ex: "+242061234567"
  operator: string; // ex: "mtn" (SANS suffixe pays — voir splitOperatorCountry)
  merchantReference?: string;
}

export interface MotekiPaymentIntentResponse {
  payment_reference: string; // "pi_xxx" — clé de corrélation pour confirm/poll
  order_number: string;
  order_uuid: string;
  status: 'awaiting_confirmation' | string;
  payment_status: string;
  amount: number; // montant figé/re-résolu SERVEUR — fait foi, pas celui envoyé
  currency: string;
  next_step: { action: string; confirm_url: string; expires_at: string };
}

export interface MotekiConfirmResponse {
  payment_reference: string;
  order_number: string;
  status: 'processing' | 'succeeded' | 'failed' | string;
  payment_status: 'pending' | 'paid' | 'failed' | string;
  amount?: number;
  currency?: string;
  poll_url?: string; // présent si status="processing"
  code?: string; // ex: "PUSH_DENIED" — présent si status="failed"
  message?: string; // message d'échec lisible, présent si status="failed"
}

export interface MotekiPaymentStatusResponse {
  payment_reference: string;
  order_number: string;
  order_uuid: string;
  status: 'awaiting_confirmation' | 'processing' | 'succeeded' | 'failed' | 'expired' | string;
  payment_status: 'pending' | 'paid' | 'failed' | string;
  amount: number;
  currency: string;
  expires_at?: string;
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
  payment_operators: string[]; // ex: ["mtn-cg", "orange-cg"] — voir splitOperatorCountry
}

// ============================================================================
// 🔧 SERVICE
// ============================================================================

@Injectable()
export class MotekiService {
  private readonly logger = new Logger(MotekiService.name);
  private readonly client: AxiosInstance;
  private readonly secretKey: string;

  constructor(private configService: ConfigService) {
    // 🧪 MODE TEST TEMPORAIRE — décommente la ligne suivante pour forcer la
    // clé en dur et vérifier si le problème vient de ConfigService/l'env,
    // ou de la clé elle-même. À RETIRER une fois le diagnostic fait.
    // const secretKey = 'sk_2gUfizdaI10JCzacRtYVeYTnSjV7HUye6Ujb4K8Y4R9cnaYZ';

    const secretKey = this.configService.get<string>('MOTEKI_SECRET_KEY');
    this.secretKey = secretKey ?? '';

    if (!secretKey) {
      this.logger.warn(
        '⚠️  MOTEKI_SECRET_KEY absent de la config (.env) — MotekiService inactif, un autre prestataire prend le relais si configuré.',
      );
    }

    // 🔍 DIAGNOSTIC — ne jamais logger la clé en clair, juste sa "forme".
    // Compare la longueur et le préfixe avec ce que montre le dashboard
    // Moteki. Si ça ne matche pas ici, le souci est la valeur/le chargement
    // de la variable (env du conteneur pas à jour, ordre ConfigModule, etc.)
    // — pas le code d'appel HTTP plus bas.
    this.logger.debug(
      `🔍 MOTEKI_SECRET_KEY chargée — longueur: ${this.secretKey.length}, ` +
        `début: "${this.secretKey.slice(0, 6)}", fin: "${this.secretKey.slice(-4)}", ` +
        `contient espace/retour-ligne: ${/\s/.test(this.secretKey)}`,
    );

    // ⚠️ baseURL = racine du domaine, PAS /api/v1 — v1 (/api/v1/...) et v2
    // (/api/v2/...) n'ont pas le même préfixe, donc chaque méthode qualifie
    // son propre chemin complet ci-dessous plutôt que de dépendre d'un
    // préfixe unique dans baseURL (piège classique qui doublerait /api/v1
    // sur tous les appels v2 sinon).
    const baseURL =
      this.configService.get<string>('MOTEKI_API_BASE_URL') ??
      'https://api.moteki.co';

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
      timeout: 30000,
    });

    // 🔍 DIAGNOSTIC — confirme le header EXACT envoyé à chaque requête (utile
    // si tu soupçonnes un intercepteur ou une config qui écrase le header
    // après coup). À retirer une fois le diagnostic terminé.
    this.client.interceptors.request.use((config) => {
      const authHeader = config.headers?.Authorization as string | undefined;
      this.logger.debug(
        `🔍 [Moteki] Requête ${config.method?.toUpperCase()} ${config.url} — ` +
          `Authorization présent: ${!!authHeader}, longueur: ${authHeader?.length ?? 0}`,
      );
      return config;
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
  // 🔀 401 vs 403 — voir doc "Dépannage API" : un 401 n'est JAMAIS un problème
  // de scope (ça c'est 403) ; le corps du 401 dit précisément la cause. On
  // relaie ce message tel quel plutôt que notre propre texte générique, pour
  // que ce soit diagnosticable direct côté KonzaRH sans avoir à checker les
  // logs serveur Moteki.
  // ==========================================================================

  private explainMotekiError(error: any): string {
    const status = error.response?.status;
    const body = error.response?.data;
    const bodyMsg: string | undefined = body?.message || body?.error;

    if (status === 401) {
      // On relaie le message exact de Moteki — il distingue déjà
      // "API key required" / "Invalid or revoked API key" / "API key expired"
      return `Clé Moteki refusée : ${bodyMsg ?? 'raison inconnue'} — vérifiez MOTEKI_SECRET_KEY.`;
    }
    if (status === 403) {
      return `Scope manquant sur la clé Moteki (${bodyMsg ?? 'ability requise absente'}) — ajoutez le scope nécessaire depuis le dashboard Moteki (Plus → Développeur).`;
    }
    if (status === 409) {
      return bodyMsg ?? 'Conflit : référence déjà utilisée ou intention déjà dans un état final.';
    }
    if (status === 422) {
      return bodyMsg ?? 'Validation échouée (montant, opérateur, ou Idempotency-Key rejouée avec un payload différent).';
    }
    if (status === 429) {
      return 'Limite de débit Moteki dépassée, réessayez dans quelques instants.';
    }
    return bodyMsg ?? 'Erreur de communication avec Moteki.';
  }

  // ==========================================================================
  // 🔧 Les opérateurs renvoyés par /storefront/payment-methods (v1, ex:
  // "mtn-cg") ont un format différent de celui attendu par confirm (v2, ex:
  // "mtn" + country "cg" séparés). On découpe sur le dernier "-".
  // ⚠️ À vérifier en pratique dès le 1er test réel : si Moteki renvoie déjà
  // des opérateurs SANS suffixe pays pour votre boutique, cette fonction est
  // un no-op sûr (elle renvoie l'opérateur tel quel + le pays par défaut).
  // ==========================================================================

  splitOperatorCountry(
    operatorWithSuffix: string,
    defaultCountry = 'cg',
  ): { operator: string; country: string } {
    const lastDash = operatorWithSuffix.lastIndexOf('-');
    if (lastDash === -1) {
      return { operator: operatorWithSuffix, country: defaultCountry };
    }
    return {
      operator: operatorWithSuffix.slice(0, lastDash),
      country: operatorWithSuffix.slice(lastDash + 1),
    };
  }

  // ==========================================================================
  // 1️⃣ CRÉER L'INTENTION DE PAIEMENT (v2)
  // POST /api/v2/storefront/payments
  // ==========================================================================

  async createPaymentIntent(
    dto: CreateMotekiPaymentIntentDto,
  ): Promise<MotekiPaymentIntentResponse> {
    this.assertConfigured();
    const idempotencyKey = crypto.randomUUID();
    try {
      this.logger.log(
        `💳 [Moteki v2] Création intention — produit ${dto.productUuid}, plan #${dto.planIndex}, ${dto.customerEmail}`,
      );

      const payload = {
        customer: {
          first_name: dto.customerFirstName,
          last_name: dto.customerLastName,
          email: dto.customerEmail,
          phone: dto.customerPhoneE164,
          country: dto.customerCountry,
        },
        order: {
          currency: 'XAF',
          items: [{ product_uuid: dto.productUuid, quantity: 1, plan_index: dto.planIndex }],
          coupon_code: null,
          merchant_reference: dto.merchantReference,
        },
        payment: {
          method: 'mobile_money',
          operator: dto.operator,
        },
      };

      const response = await this.client.post<MotekiPaymentIntentResponse>(
        '/api/v2/storefront/payments',
        payload,
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );

      this.logger.log(
        `✅ [Moteki v2] Intention créée: ${response.data.payment_reference} (commande ${response.data.order_number})`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('❌ [Moteki v2] Échec création intention:', error.response?.data || error.message);
      throw new BadRequestException(this.explainMotekiError(error));
    }
  }

  // ==========================================================================
  // 2️⃣ CONFIRMER LE PAIEMENT (v2) — déclenche le push Mobile Money
  // POST /api/v2/storefront/payments/{payment_reference}/confirm
  // ==========================================================================

  async confirmPayment(
    paymentReference: string,
    msisdnE164: string,
    country: string,
    operator: string,
  ): Promise<MotekiConfirmResponse> {
    this.assertConfigured();
    const idempotencyKey = crypto.randomUUID();
    try {
      this.logger.log(`📲 [Moteki v2] Confirmation ${paymentReference} — push vers ${operator}`);

      const response = await this.client.post<MotekiConfirmResponse>(
        `/api/v2/storefront/payments/${paymentReference}/confirm`,
        { msisdn: msisdnE164, country, operator },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );

      this.logger.log(
        `📲 [Moteki v2] Confirm ${paymentReference} → status: ${response.data.status}`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `❌ [Moteki v2] Échec confirmation ${paymentReference}:`,
        error.response?.data || error.message,
      );
      throw new BadRequestException(this.explainMotekiError(error));
    }
  }

  // ==========================================================================
  // 🔍 STATUT D'UN PAIEMENT (v2, pour le polling)
  // GET /api/v2/storefront/payments/{payment_reference}
  //
  // ⚠️ La doc est explicite : "Pas de webhook pour l'instant... le polling
  // fait foi." Donc contrairement à v1 (qui documentait un X-Moteki-Signature
  // webhook), on ne dépend QUE de cet appel pour savoir si c'est payé.
  // États terminaux : succeeded | failed | expired. Non-terminaux :
  // awaiting_confirmation | processing.
  // ==========================================================================

  async getPaymentStatus(paymentReference: string): Promise<MotekiPaymentStatusResponse> {
    this.assertConfigured();
    try {
      const response = await this.client.get<MotekiPaymentStatusResponse>(
        `/api/v2/storefront/payments/${paymentReference}`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `❌ [Moteki v2] Échec récupération statut ${paymentReference}:`,
        error.response?.data || error.message,
      );
      throw new BadRequestException(this.explainMotekiError(error));
    }
  }

  isPaymentSucceeded(p: { status: string }): boolean {
    return p.status === 'succeeded';
  }

  isPaymentFailed(p: { status: string }): boolean {
    return p.status === 'failed' || p.status === 'expired';
  }

  // ==========================================================================
  // 🔍 STATUT D'UN ABONNEMENT CÔTÉ MOTEKI (v1, suivi/support uniquement —
  // jamais utilisé pour piloter l'accès KonzaRH, voir note en tête de fichier)
  // GET /subscriptions/{uuid}
  // ==========================================================================

  async getSubscriptionStatus(subscriptionUuid: string): Promise<MotekiSubscriptionResponse> {
    this.assertConfigured();
    try {
      const response = await this.client.get<MotekiSubscriptionResponse>(
        `/api/v1/subscriptions/${subscriptionUuid}`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('❌ Échec récupération statut abonnement Moteki:', error.response?.data || error.message);
      throw new BadRequestException(this.explainMotekiError(error));
    }
  }

  // ==========================================================================
  // ❌ ANNULER UN ABONNEMENT CÔTÉ MOTEKI (v1 — accès conservé jusqu'à ends_at)
  // POST /subscriptions/{uuid}/cancel
  // ==========================================================================

  async cancelSubscription(subscriptionUuid: string, reason?: string): Promise<MotekiSubscriptionResponse> {
    this.assertConfigured();
    try {
      const response = await this.client.post<MotekiSubscriptionResponse>(
        `/api/v1/subscriptions/${subscriptionUuid}/cancel`,
        { note: reason },
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('❌ Échec annulation abonnement Moteki:', error.response?.data || error.message);
      throw new BadRequestException(this.explainMotekiError(error));
    }
  }

  // ==========================================================================
  // 💳 MOYENS DE PAIEMENT ACTIVÉS SUR LA BOUTIQUE (v1, inchangé)
  // GET /storefront/payment-methods
  // ==========================================================================

  async getAvailablePaymentMethods(): Promise<MotekiPaymentMethodOption[]> {
    try {
      this.assertConfigured();
      const response = await this.client.get<MotekiPaymentMethodOption[]>(
        '/api/v1/storefront/payment-methods',
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('❌ Échec récupération moyens de paiement Moteki:', error.response?.data || error.message);
      return [];
    }
  }

  // ==========================================================================
  // 🔐 VÉRIFIER LA SIGNATURE WEBHOOK (v1 — X-Moteki-Signature: sha256=...)
  // ⚠️ Conservé pour compatibilité mais peu pertinent désormais : le
  // checkout passe maintenant par v2, qui n'a PAS de webhook documenté
  // ("le polling fait foi" — voir SubscriptionsService.checkAndActivateMotekiOrder).
  // Ce webhook v1 ne recevra donc plus d'événements liés à nos paiements.
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