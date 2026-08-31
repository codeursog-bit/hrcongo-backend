// // ============================================================================
// // 💳 YABETOOPAY SERVICE - URLS CORRECTES SELON DOC
// // ============================================================================
// // Fichier: src/payments/yabetoopay.service.ts

// import { Injectable, Logger, BadRequestException } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import axios, { AxiosInstance } from 'axios';

// // ============================================================================
// // 📝 TYPES
// // ============================================================================

// export interface CreateCheckoutSessionDto {
//   amount: number;
//   currency: string;
//   successUrl: string;
//   cancelUrl: string;
//   metadata?: Record<string, any>;
//   items?: Array<{
//     productId?: string;
//     productName: string;
//     quantity: number;
//     price: number;
//   }>;
// }

// export interface CheckoutSessionResponse {
//   id: string;
//   accountId: string;
//   orderId: string;
//   successUrl: string;
//   cancelUrl: string;
//   expiresAt: string;
//   createdAt: string;
//   updatedAt: string;
// }

// export interface CreatePaymentIntentDto {
//   amount: number;
//   currency: string;
//   metadata?: Record<string, any>;
// }

// export interface ConfirmPaymentIntentDto {
//   intentId: string;
//   clientSecret: string;
//   paymentMethod: {
//     type: 'momo';
//     phone: string;
//     operator: 'AIRTEL' | 'MTN' | 'ORANGE';
//     country?: string;
//   };
// }

// export interface PaymentIntentResponse {
//   id: string;
//   amount: number;
//   currency: string;
//   client_secret: string;
//   status: 'pending' | 'succeeded' | 'failed';
//   label: string;
// }

// export interface PaymentConfirmationResponse {
//   intentId: string;
//   financialTransactionId: string;
//   transactionId: string;
//   amount: number;
//   currency: string;
//   status: 'succeeded' | 'failed' | 'expired';
//   captured: boolean;
//   externalId: string;
//   id: string;
//   failureMessage?: string;
//   failureCode?: string;
// }

// // ============================================================================
// // 🔧 SERVICE
// // ============================================================================

// @Injectable()
// export class YabetooPayService {
//   private readonly logger = new Logger(YabetooPayService.name);

//   private readonly sessionsClient: AxiosInstance;
//   private readonly apiClient: AxiosInstance;

//   private readonly secretKey: string;
//   private readonly accountId: string;
//   private readonly isSandbox: boolean;

//   constructor(private configService: ConfigService) {
//     const secretKey = this.configService.get<string>('YABETOOPAY_SECRET_KEY');
//     if (!secretKey) {
//       this.logger.error('❌ YABETOOPAY_SECRET_KEY is not defined in .env');
//       throw new Error('YABETOOPAY_SECRET_KEY is required');
//     }
//     this.secretKey = secretKey;

//     const accountId = this.configService.get<string>('YABETOOPAY_ACCOUNT_ID');
//     if (!accountId) {
//       this.logger.error('❌ YABETOOPAY_ACCOUNT_ID is not defined in .env');
//       throw new Error('YABETOOPAY_ACCOUNT_ID is required');
//     }
//     this.accountId = accountId;

//     const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
//     this.isSandbox = nodeEnv !== 'production';

//     const headers = {
//       'Content-Type': 'application/json',
//       'Authorization': `Bearer ${this.secretKey}`,
//     };

//     const sessionsBaseURL = 'https://buy.api.yabetoopay.com/v1';
//     this.sessionsClient = axios.create({ baseURL: sessionsBaseURL, headers, timeout: 30000 });

//     const intentsBaseURL = this.isSandbox
//       ? 'https://pay.sandbox.yabetoopay.com/v1'
//       : 'https://pay.api.yabetoopay.com/v1';

//     this.apiClient = axios.create({ baseURL: intentsBaseURL, headers, timeout: 30000 });

//     this.logger.log(`🔧 YabetooPayService initialized (${this.isSandbox ? 'SANDBOX' : 'PRODUCTION'})`);
//     this.logger.log(`🔗 Sessions URL : ${sessionsBaseURL}`);
//     this.logger.log(`🔗 Intents URL  : ${intentsBaseURL}`);
//     this.logger.log(`🏢 Account ID   : ${this.accountId}`);
//   }

//   // ==========================================================================
//   // 💳 CRÉER UNE SESSION DE PAIEMENT
//   // ==========================================================================

//   async createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResponse & { url: string }> {
//     try {
//       this.logger.log(`💳 Creating checkout session: ${dto.amount} ${dto.currency.toUpperCase()}`);

//       const payload = {
//         total: dto.amount,
//         currency: dto.currency.toLowerCase(),
//         accountId: this.accountId,
//         successUrl: dto.successUrl,
//         cancelUrl: dto.cancelUrl,
//         metadata: dto.metadata || {},
//         items: dto.items || [{ productName: 'Abonnement HR Congo', quantity: 1, price: dto.amount }],
//       };

//       const response = await this.sessionsClient.post<CheckoutSessionResponse>('/sessions', payload);
//       this.logger.log(`✅ Session created: ${response.data.id}`);

//       let checkoutUrl: string;
//       if ('url' in response.data && typeof (response.data as any).url === 'string') {
//         checkoutUrl = (response.data as any).url;
//         this.logger.log('✅ URL de checkout retournée par l\'API');
//       } else {
//         checkoutUrl = `https://pay.yabetoo.com/c/${response.data.id}`;
//         this.logger.log('⚠️ URL de checkout construite manuellement');
//       }

//       this.logger.log(`🔗 Checkout URL: ${checkoutUrl}`);
//       return { ...response.data, url: checkoutUrl };
//     } catch (error: any) {
//       this.logger.error('❌ Failed to create checkout session');
//       this.logger.error(`❌ Status: ${error.response?.status}`);
//       this.logger.error(`❌ Response: ${JSON.stringify(error.response?.data, null, 2)}`);

//       if (error.response?.data?.errors) {
//         const errorMessages = error.response.data.errors.map((e: any) => `${e.field}: ${e.message}`).join(', ');
//         throw new BadRequestException(errorMessages);
//       }
//       throw new BadRequestException(
//         error.response?.data?.message || 'Erreur lors de la création de la session de paiement',
//       );
//     }
//   }

//   // ==========================================================================
//   // 🔍 RÉCUPÉRER LE STATUT D'UNE SESSION
//   // ==========================================================================

//   async getSessionStatus(sessionId: string): Promise<any> {
//     try {
//       this.logger.log(`🔍 Checking session status: ${sessionId}`);
//       const response = await this.sessionsClient.get(`/sessions/${sessionId}`);
//       this.logger.log(`📊 Session status: ${JSON.stringify(response.data)}`);
//       return response.data;
//     } catch (error: any) {
//       this.logger.error('❌ Failed to get session status:', error.response?.data || error.message);
//       throw new BadRequestException('Erreur lors de la vérification du statut');
//     }
//   }

//   // ==========================================================================
//   // 2️⃣ CRÉER UNE INTENTION DE PAIEMENT
//   // ✅ FIX : Yabetoo retourne "clientSecret" (camelCase) dans la réponse.
//   //          On normalise vers client_secret pour la cohérence interne.
//   // ==========================================================================

//   async createPaymentIntent(dto: CreatePaymentIntentDto): Promise<PaymentIntentResponse> {
//     try {
//       this.logger.log(`💳 Creating payment intent: ${dto.amount} ${dto.currency}`);

//       const response = await this.apiClient.post(
//         '/payment-intents',
//         {
//           amount: dto.amount,
//           currency: dto.currency.toLowerCase(),
//           metadata: dto.metadata,
//         },
//       );

//       const data = response.data as any;
//       // ✅ FIX : Yabetoo retourne "clientSecret" (camelCase), pas "client_secret"
//       const clientSecret = data.clientSecret ?? data.client_secret;

//       if (!clientSecret) {
//         this.logger.warn('⚠️ client_secret absent de la réponse Yabetoo ! Dump complet :');
//         this.logger.warn(JSON.stringify(data, null, 2));
//       }

//       this.logger.log(`✅ Payment intent created: ${data.id}`);
//       this.logger.log(`🔑 Client secret: ${clientSecret}`);

//       return { ...data, client_secret: clientSecret };
//     } catch (error: any) {
//       this.logger.error('❌ Failed to create payment intent:', error.response?.data || error.message);
//       throw new BadRequestException(
//         error.response?.data?.errors || 'Erreur lors de la création de l\'intention de paiement',
//       );
//     }
//   }

//   // ==========================================================================
//   // 3️⃣ CONFIRMER UNE INTENTION DE PAIEMENT
//   // ✅ FIX (3 corrections selon doc Yabetoo) :
//   //   - phone      → msisdn en format international (+242XXXXXXXXX)
//   //   - operator   → operator_name en minuscules ("mtn", "airtel", "orange")
//   //   - country    → minuscules ("cg", "cm")
//   // ==========================================================================

//   async confirmPaymentIntent(dto: ConfirmPaymentIntentDto): Promise<PaymentConfirmationResponse> {
//     try {
//       this.logger.log(`✅ Confirming payment intent: ${dto.intentId}`);
//       this.logger.log(`📱 Phone: ${dto.paymentMethod.phone} | Operator: ${dto.paymentMethod.operator}`);

//       const country = (dto.paymentMethod.country ?? 'CG').toUpperCase();
//       const msisdn = this.formatMsisdn(dto.paymentMethod.phone, country);
//       const operatorName = dto.paymentMethod.operator.toLowerCase(); // "MTN" → "mtn"

//       const payload = {
//         client_secret: dto.clientSecret,
//         payment_method_data: {
//           type: 'momo',
//           momo: {
//             country: country.toLowerCase(), // "CG" → "cg"
//             msisdn,                         // "064133693" → "+242064133693"
//             operator_name: operatorName,    // "MTN" → "mtn"
//           },
//         },
//       };

//       this.logger.log(`📦 Confirm payload: ${JSON.stringify(payload, null, 2)}`);

//       const response = await this.apiClient.post<PaymentConfirmationResponse>(
//         `/payment-intents/${dto.intentId}/confirm`,
//         payload,
//       );

//       this.logger.log(`🎉 Payment confirmation sent: ${response.data.id} (${response.data.status})`);
//       return response.data;
//     } catch (error: any) {
//       this.logger.error('❌ Failed to confirm payment:');
//       this.logger.error(error.response?.data || error.message);
//       throw new BadRequestException(
//         error.response?.data?.errors || 'Erreur lors de la confirmation du paiement',
//       );
//     }
//   }

//   // ==========================================================================
//   // 4️⃣ RÉCUPÉRER LE STATUT D'UN PAIEMENT
//   // ==========================================================================

//   async getPaymentStatus(intentId: string): Promise<PaymentIntentResponse> {
//     try {
//       this.logger.log(`🔍 Checking payment status: ${intentId}`);
//       const response = await this.apiClient.get<PaymentIntentResponse>(`/payment-intents/${intentId}`);
//       this.logger.log(`📊 Payment status: ${response.data.status}`);
//       return response.data;
//     } catch (error: any) {
//       this.logger.error('❌ Failed to get payment status:', error.response?.data || error.message);
//       throw new BadRequestException('Erreur lors de la vérification du statut de paiement');
//     }
//   }

//   // ==========================================================================
//   // 5️⃣ VÉRIFIER LA SIGNATURE DU WEBHOOK
//   // ==========================================================================

//   verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
//     try {
//       const crypto = require('crypto');
//       const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
//       return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
//     } catch (error) {
//       this.logger.error('❌ Failed to verify webhook signature:', error);
//       return false;
//     }
//   }

//   // ==========================================================================
//   // 6️⃣ FORMATER LE MONTANT
//   // ==========================================================================

//   formatAmount(amountInFCFA: number): number {
//     return Math.round(amountInFCFA);
//   }

//   // ==========================================================================
//   // 7️⃣ VÉRIFIER SI SANDBOX MODE
//   // ==========================================================================

//   isSandboxMode(): boolean {
//     return this.isSandbox;
//   }

//   // ==========================================================================
//   // 🔧 HELPER PRIVÉ : Formater le numéro en format international (msisdn)
//   // ==========================================================================

//   private formatMsisdn(phone: string, country: string): string {
//     const digits = phone.replace(/\D/g, '');

//     // Si déjà en format international, retourner tel quel
//     if (phone.startsWith('+')) return `+${digits}`;

//     const countryCodes: Record<string, string> = {
//       CG: '+242', // Congo-Brazzaville
//       CM: '+237', // Cameroun
//       CD: '+243', // Congo-Kinshasa
//       CI: '+225', // Côte d'Ivoire
//       SN: '+221', // Sénégal
//       GA: '+241', // Gabon
//       BJ: '+229', // Bénin
//       TG: '+228', // Togo
//     };

//     const prefix = countryCodes[country] ?? '+242';
//     return `${prefix}${digits}`;
//   }
// }

// ============================================================================
// 💳 YABETOOPAY SERVICE
// Fichier: src/payments/yabetoopay.service.ts
//
// AJOUTS (tout le reste est identique à la version originale) :
//   - createDisbursement() — POST /v1/disbursements
//   - getDisbursement()    — GET  /v1/disbursement/{id}
//   - DisbursementResponse (type)
//   - CreateDisbursementDto (type)
//
// Corrections selon doc officielle :
//   - endpoint create : /v1/disbursements  (pluriel)
//   - endpoint get    : /v1/disbursement/{id} (singulier)
//   - statut initial  : "processing" (pas "pending")
//   - msisdn          : sans le "+" (ex: "242066594471")
//   - country         : MAJUSCULES dans le payload ("CG")
// ============================================================================

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

// ============================================================================
// 📝 TYPES ORIGINAUX — INCHANGÉS
// ============================================================================

export interface CreateCheckoutSessionDto {
  amount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, any>;
  items?: Array<{
    productId?: string;
    productName: string;
    quantity: number;
    price: number;
  }>;
}

export interface CheckoutSessionResponse {
  id: string;
  accountId: string;
  orderId: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentIntentDto {
  amount: number;
  currency: string;
  metadata?: Record<string, any>;
}

export interface ConfirmPaymentIntentDto {
  intentId: string;
  clientSecret: string;
  paymentMethod: {
    type: 'momo';
    phone: string;
    operator: 'AIRTEL' | 'MTN' | 'ORANGE';
    country?: string;
  };
}

export interface PaymentIntentResponse {
  id: string;
  amount: number;
  currency: string;
  client_secret: string;
  status: 'pending' | 'succeeded' | 'failed';
  label: string;
}

export interface PaymentConfirmationResponse {
  intentId: string;
  financialTransactionId: string;
  transactionId: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'expired';
  captured: boolean;
  externalId: string;
  id: string;
  failureMessage?: string;
  failureCode?: string;
}

// ============================================================================
// 📝 NOUVEAUX TYPES — DISBURSEMENT
// ============================================================================

export interface CreateDisbursementDto {
  amount: number; // ex: 10000
  currency: string; // "XAF"
  firstName: string;
  lastName: string;
  phone: string; // numéro local ou international — on normalise en interne
  operator: 'MTN' | 'AIRTEL' | 'ORANGE';
  country?: string; // défaut "CG"
}

export interface DisbursementResponse {
  id: string; // ex: "wt_RMqehxy8NNi1ocJFG2SSAZMj81m6spo72vnZ"
  object: string; // "disbursement"
  amount: number;
  currency: string;
  status: 'processing' | 'succeeded' | 'failed'; // "processing" à la création
  firstName: string;
  lastName: string;
  operatorName: string;
  country: string;
  phone: string;
  type: number;
  shouldExecutedAt: string; // date d'exécution prévue (J+1)
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 🔧 SERVICE
// ============================================================================

@Injectable()
export class YabetooPayService {
  private readonly logger = new Logger(YabetooPayService.name);

  private readonly sessionsClient: AxiosInstance;
  private readonly apiClient: AxiosInstance;

  private readonly secretKey: string;
  private readonly accountId: string;
  private readonly isSandbox: boolean;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('YABETOOPAY_SECRET_KEY');
    if (!secretKey) {
      this.logger.error('❌ YABETOOPAY_SECRET_KEY is not defined in .env');
      throw new Error('YABETOOPAY_SECRET_KEY is required');
    }
    this.secretKey = secretKey;

    const accountId = this.configService.get<string>('YABETOOPAY_ACCOUNT_ID');
    if (!accountId) {
      this.logger.error('❌ YABETOOPAY_ACCOUNT_ID is not defined in .env');
      throw new Error('YABETOOPAY_ACCOUNT_ID is required');
    }
    this.accountId = accountId;

    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    this.isSandbox = nodeEnv !== 'production';

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.secretKey}`,
    };

    const sessionsBaseURL = 'https://buy.api.yabetoopay.com/v1';
    this.sessionsClient = axios.create({
      baseURL: sessionsBaseURL,
      headers,
      timeout: 30000,
    });

    const intentsBaseURL = this.isSandbox
      ? 'https://pay.sandbox.yabetoopay.com/v1'
      : 'https://pay.api.yabetoopay.com/v1';

    this.apiClient = axios.create({
      baseURL: intentsBaseURL,
      headers,
      timeout: 30000,
    });

    this.logger.log(
      `🔧 YabetooPayService initialized (${this.isSandbox ? 'SANDBOX' : 'PRODUCTION'})`,
    );
    this.logger.log(`🔗 Sessions URL : ${sessionsBaseURL}`);
    this.logger.log(`🔗 Intents URL  : ${intentsBaseURL}`);
    this.logger.log(`🏢 Account ID   : ${this.accountId}`);
  }

  // ==========================================================================
  // 1️⃣ CRÉER UNE SESSION DE PAIEMENT — INCHANGÉ
  // ==========================================================================

  async createCheckoutSession(
    dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponse & { url: string }> {
    try {
      this.logger.log(
        `💳 Creating checkout session: ${dto.amount} ${dto.currency.toUpperCase()}`,
      );

      const payload = {
        total: dto.amount,
        currency: dto.currency.toLowerCase(),
        accountId: this.accountId,
        successUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
        metadata: dto.metadata || {},
        items: dto.items || [
          {
            productName: 'Abonnement HR Congo',
            quantity: 1,
            price: dto.amount,
          },
        ],
      };

      const response = await this.sessionsClient.post<CheckoutSessionResponse>(
        '/sessions',
        payload,
      );
      this.logger.log(`✅ Session created: ${response.data.id}`);

      let checkoutUrl: string;
      if (
        'url' in response.data &&
        typeof (response.data as any).url === 'string'
      ) {
        checkoutUrl = (response.data as any).url;
        this.logger.log("✅ URL de checkout retournée par l'API");
      } else {
        checkoutUrl = `https://pay.yabetoo.com/c/${response.data.id}`;
        this.logger.log('⚠️ URL de checkout construite manuellement');
      }

      this.logger.log(`🔗 Checkout URL: ${checkoutUrl}`);
      return { ...response.data, url: checkoutUrl };
    } catch (error: any) {
      this.logger.error('❌ Failed to create checkout session');
      this.logger.error(`❌ Status: ${error.response?.status}`);
      this.logger.error(
        `❌ Response: ${JSON.stringify(error.response?.data, null, 2)}`,
      );
      if (error.response?.data?.errors) {
        const errorMessages = error.response.data.errors
          .map((e: any) => `${e.field}: ${e.message}`)
          .join(', ');
        throw new BadRequestException(errorMessages);
      }
      throw new BadRequestException(
        error.response?.data?.message ||
          'Erreur lors de la création de la session de paiement',
      );
    }
  }

  // ==========================================================================
  // 2️⃣ RÉCUPÉRER LE STATUT D'UNE SESSION — INCHANGÉ
  // ==========================================================================

  async getSessionStatus(sessionId: string): Promise<any> {
    try {
      this.logger.log(`🔍 Checking session status: ${sessionId}`);
      const response = await this.sessionsClient.get(`/sessions/${sessionId}`);
      this.logger.log(`📊 Session status: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        '❌ Failed to get session status:',
        error.response?.data || error.message,
      );
      throw new BadRequestException('Erreur lors de la vérification du statut');
    }
  }

  // ==========================================================================
  // 3️⃣ CRÉER UNE INTENTION DE PAIEMENT — INCHANGÉ
  // ==========================================================================

  async createPaymentIntent(
    dto: CreatePaymentIntentDto,
  ): Promise<PaymentIntentResponse> {
    try {
      this.logger.log(
        `💳 Creating payment intent: ${dto.amount} ${dto.currency}`,
      );

      const response = await this.apiClient.post('/payment-intents', {
        amount: dto.amount,
        currency: dto.currency.toLowerCase(),
        metadata: dto.metadata,
      });

      const data = response.data;
      const clientSecret = data.clientSecret ?? data.client_secret;

      if (!clientSecret) {
        this.logger.warn(
          '⚠️ client_secret absent de la réponse Yabetoo ! Dump complet :',
        );
        this.logger.warn(JSON.stringify(data, null, 2));
      }

      this.logger.log(`✅ Payment intent created: ${data.id}`);
      this.logger.log(`🔑 Client secret: ${clientSecret}`);

      return { ...data, client_secret: clientSecret };
    } catch (error: any) {
      this.logger.error(
        '❌ Failed to create payment intent:',
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        error.response?.data?.errors ||
          "Erreur lors de la création de l'intention de paiement",
      );
    }
  }

  // ==========================================================================
  // 4️⃣ CONFIRMER UNE INTENTION DE PAIEMENT — INCHANGÉ
  // ==========================================================================

  async confirmPaymentIntent(
    dto: ConfirmPaymentIntentDto,
  ): Promise<PaymentConfirmationResponse> {
    try {
      this.logger.log(`✅ Confirming payment intent: ${dto.intentId}`);
      this.logger.log(
        `📱 Phone: ${dto.paymentMethod.phone} | Operator: ${dto.paymentMethod.operator}`,
      );

      const country = (dto.paymentMethod.country ?? 'CG').toUpperCase();
      const msisdn = this.formatMsisdn(dto.paymentMethod.phone, country);
      const operatorName = dto.paymentMethod.operator.toLowerCase();

      const payload = {
        client_secret: dto.clientSecret,
        payment_method_data: {
          type: 'momo',
          momo: {
            country: country.toLowerCase(),
            msisdn,
            operator_name: operatorName,
          },
        },
      };

      this.logger.log(
        `📦 Confirm payload: ${JSON.stringify(payload, null, 2)}`,
      );

      const response = await this.apiClient.post<PaymentConfirmationResponse>(
        `/payment-intents/${dto.intentId}/confirm`,
        payload,
      );

      this.logger.log(
        `🎉 Payment confirmation sent: ${response.data.id} (${response.data.status})`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('❌ Failed to confirm payment:');
      this.logger.error(error.response?.data || error.message);
      throw new BadRequestException(
        error.response?.data?.errors ||
          'Erreur lors de la confirmation du paiement',
      );
    }
  }

  // ==========================================================================
  // 5️⃣ RÉCUPÉRER LE STATUT D'UN PAIEMENT — INCHANGÉ
  // ==========================================================================

  async getPaymentStatus(intentId: string): Promise<PaymentIntentResponse> {
    try {
      this.logger.log(`🔍 Checking payment status: ${intentId}`);
      const response = await this.apiClient.get<PaymentIntentResponse>(
        `/payment-intents/${intentId}`,
      );
      this.logger.log(`📊 Payment status: ${response.data.status}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        '❌ Failed to get payment status:',
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        'Erreur lors de la vérification du statut de paiement',
      );
    }
  }

  // ==========================================================================
  // 6️⃣ VÉRIFIER LA SIGNATURE DU WEBHOOK — INCHANGÉ
  // ==========================================================================

  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    try {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch (error) {
      this.logger.error('❌ Failed to verify webhook signature:', error);
      return false;
    }
  }

  // ==========================================================================
  // 7️⃣ FORMATER LE MONTANT — INCHANGÉ
  // ==========================================================================

  formatAmount(amountInFCFA: number): number {
    return Math.round(amountInFCFA);
  }

  // ==========================================================================
  // 8️⃣ VÉRIFIER SI SANDBOX MODE — INCHANGÉ
  // ==========================================================================

  isSandboxMode(): boolean {
    return this.isSandbox;
  }

  // ==========================================================================
  // 9️⃣ NOUVEAU — CRÉER UN DISBURSEMENT (versement sortant)
  // Doc : POST /v1/disbursements
  //
  // Statut initial : "processing" (J+1 d'exécution réelle)
  // Confirmation finale : webhook disbursement.completed
  //
  // Règles sur le msisdn selon doc :
  //   - Sans le "+" — ex: "242066594471" (pas "+242066594471")
  //   - country en MAJUSCULES : "CG"
  //   - operator_name en minuscules : "mtn"
  // ==========================================================================

  async createDisbursement(
    dto: CreateDisbursementDto,
  ): Promise<DisbursementResponse> {
    try {
      const country = (dto.country ?? 'CG').toUpperCase();
      // msisdn SANS le "+", juste les chiffres avec l'indicatif pays
      const msisdn = this.formatMsisdnForDisbursement(dto.phone, country);
      const operator = dto.operator.toLowerCase(); // "MTN" → "mtn"

      const payload = {
        amount: dto.amount,
        currency: dto.currency.toUpperCase(), // "XAF"
        first_name: dto.firstName,
        last_name: dto.lastName,
        payment_method_data: {
          type: 'momo',
          momo: {
            msisdn, // "242066594471" (sans +)
            country, // "CG" (MAJUSCULES)
            operator_name: operator, // "mtn"
          },
        },
      };

      this.logger.log(
        `💸 Creating disbursement: ${dto.amount} ${dto.currency} → ${msisdn} via ${operator.toUpperCase()}`,
      );
      this.logger.log(
        `📦 Disbursement payload: ${JSON.stringify(payload, null, 2)}`,
      );

      // Endpoint : POST /v1/disbursements (PLURIEL)
      const response = await this.apiClient.post<DisbursementResponse>(
        '/disbursements',
        payload,
      );

      this.logger.log(
        `✅ Disbursement créé: ${response.data.id} — status: ${response.data.status}` +
          ` — exécution prévue: ${response.data.shouldExecutedAt}`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('❌ Failed to create disbursement:');
      this.logger.error(
        JSON.stringify(error.response?.data, null, 2) || error.message,
      );

      // Extraire le message d'erreur Yabetoo
      const errMsg = error.response?.data?.errors
        ? error.response.data.errors
            .map((e: any) => `${e.field}: ${e.message}`)
            .join(', ')
        : (error.response?.data?.message ??
          'Erreur lors du versement automatique');

      throw new BadRequestException(errMsg);
    }
  }

  // ==========================================================================
  // 🔟 NOUVEAU — RÉCUPÉRER UN DISBURSEMENT par ID
  // Doc : GET /v1/disbursement/{id} (SINGULIER)
  // ==========================================================================

  async getDisbursement(disbursementId: string): Promise<DisbursementResponse> {
    try {
      this.logger.log(`🔍 Getting disbursement: ${disbursementId}`);
      // Endpoint : GET /v1/disbursement/{id} (SINGULIER)
      const response = await this.apiClient.get<DisbursementResponse>(
        `/disbursement/${disbursementId}`,
      );
      this.logger.log(`📊 Disbursement status: ${response.data.status}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        '❌ Failed to get disbursement:',
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        'Erreur lors de la vérification du disbursement',
      );
    }
  }

  // ==========================================================================
  // 🔧 HELPERS PRIVÉS
  // ==========================================================================

  // Helper original pour confirmPaymentIntent (avec "+") — INCHANGÉ
  private formatMsisdn(phone: string, country: string): string {
    const digits = phone.replace(/\D/g, '');
    if (phone.startsWith('+')) return `+${digits}`;
    const countryCodes: Record<string, string> = {
      CG: '+242',
      CM: '+237',
      CD: '+243',
      CI: '+225',
      SN: '+221',
      GA: '+241',
      BJ: '+229',
      TG: '+228',
    };
    const prefix = countryCodes[country] ?? '+242';
    return `${prefix}${digits}`;
  }

  // Nouveau helper pour disbursement (SANS "+", juste chiffres) — selon doc
  private formatMsisdnForDisbursement(phone: string, country: string): string {
    const digits = phone.replace(/\D/g, '');

    // Si déjà avec indicatif (commence par 242, 237, etc.) → retourner tel quel
    const countryDialCodes: Record<string, string> = {
      CG: '242',
      CM: '237',
      CD: '243',
      CI: '225',
      SN: '221',
      GA: '241',
      BJ: '229',
      TG: '228',
    };
    const dialCode = countryDialCodes[country] ?? '242';

    if (digits.startsWith(dialCode)) return digits; // ex: "242066594471" → ok
    if (phone.startsWith('+')) return digits; // "+242066594471" → "242066594471"
    return `${dialCode}${digits}`; // "066594471" → "242066594471"
  }
}
