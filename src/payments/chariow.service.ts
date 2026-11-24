// ============================================================================
// 🛒 CHARIOW SERVICE — 3e prestataire de COLLECTE (checkout des abonnements),
// en redondance de YabetooPay et Moteki. Utilise le type de produit
// "license" de Chariow : chaque (re)paiement d'abonnement = un nouvel achat
// de licence, avec une expires_at calculée par Chariow selon la durée de
// validité configurée sur le produit (dashboard Chariow).
//
// ⚠️ POINT IMPORTANT (comme pour Moteki) : Chariow NE prélève PAS
// automatiquement le client à chaque échéance. Chaque paiement est un acte
// volontaire déclenché par un appel /checkout — exactement comme Moteki et
// YabetooPay. On ne dépend donc PAS de license.expires_at comme source de
// vérité pour l'accès app : cette date reste interne à Chariow. La source de
// vérité pour l'accès reste 100% interne à l'app (voir
// SubscriptionsService.activateUpgrade), Chariow n'étant ici qu'un rail de
// paiement — voir la note en tête de moteki.service.ts pour le principe.
//
// ✅ GET /sales/{id} : schéma confirmé par la doc officielle "Get Sale"
// (statuts sale.status: awaiting_payment | completed | failed | abandoned |
// settled — et payment.status: initiated | pending | cancelled | failed |
// success). isSalePaid()/isSaleFailed() ci-dessous utilisent ces valeurs
// officielles, plus besoin de déduction.
// ============================================================================

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

// ============================================================================
// 📝 TYPES
// ============================================================================

export interface InitiateChariowCheckoutDto {
  productId: string; // id public ou slug du produit "license" créé sur le dashboard Chariow
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  customerPhoneNumber: string; // numéro seul (sans indicatif) — voir countryCode
  customerPhoneCountryCode: string; // ex: "CG"
  discountCode?: string; // code de réduction optionnel, appliqué par Chariow au checkout
  redirectUrl?: string;
  customMetadata?: Record<string, string>; // ex: { companyId, plan, billingPeriod }
}

export interface ChariowCheckoutResponse {
  step: 'payment' | 'completed';
  message: string | null;
  purchase: {
    id: string; // "sal_xxx" — l'identifiant de vente à conserver pour le polling
    status: string;
  };
  payment: {
    checkout_url: string | null; // à ouvrir/rediriger le client vers cette URL si step="payment"
    transaction_id: string | null;
  };
}

export interface ChariowMoneyAmount {
  value: number;
  formatted: string;
  short: string;
  currency: string;
}

// Objet renvoyé par GET /sales/{id} — champs officiels (doc "Get Sale").
// Seuls les champs utiles à l'activation d'abonnement sont typés en détail ;
// le reste (context, campaign, rating...) est laissé en `any` volontairement.
export interface ChariowSale {
  id: string;
  status: 'awaiting_payment' | 'completed' | 'failed' | 'abandoned' | 'settled' | string;
  amount: ChariowMoneyAmount;
  original_amount: ChariowMoneyAmount;
  discount_amount: ChariowMoneyAmount;
  payment: {
    status: 'initiated' | 'pending' | 'cancelled' | 'failed' | 'success' | string;
    transaction_id: string | null;
    gateway?: string;
    method?: { id: string; name: string; type: string };
    failure_error?: any;
  };
  discount: { id: string; code: string; type: string; value?: number } | null;
  customer: { id: string; email: string; name: string };
  product: { id: string; name: string; slug: string; type: string };
  failed_at: string | null;
  awaiting_payment_at: string | null;
  abandoned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChariowLicense {
  id: string;
  sale_id: string;
  customer_id: string;
  license_key: string;
  status: 'pending_activation' | 'active' | 'expired' | 'revoked';
  expires_at: string | null;
  is_active: boolean;
  is_expired: boolean;
}

export interface ChariowDiscount {
  id: string;
  name: string;
  code: string;
  type: 'percentage' | 'fixed';
  status: 'active' | 'expired';
  value_off: { raw: number; formatted: string };
  usage_limit: number | null;
  usage_count: number;
  start_date: string | null;
  end_date: string | null;
}

// ============================================================================
// 🔧 SERVICE
// ============================================================================

@Injectable()
export class ChariowService {
  private readonly logger = new Logger(ChariowService.name);
  private readonly client: AxiosInstance;
  private readonly secretKey: string;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('CHARIOW_SECRET_KEY');
    this.secretKey = secretKey ?? '';

    if (!secretKey) {
      this.logger.warn(
        '⚠️  CHARIOW_SECRET_KEY absent de la config (.env) — ChariowService inactif.',
      );
    }

    const baseURL =
      this.configService.get<string>('CHARIOW_API_BASE_URL') ??
      'https://api.chariow.com/v1';

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.secretKey}`,
      },
      timeout: 30000,
    });

    this.logger.log(`🔧 ChariowService initialisé — base URL: ${baseURL}`);
  }

  /** true si une vraie clé Chariow est configurée — utilisé par la bascule automatique de prestataire. */
  isConfigured(): boolean {
    return !!this.secretKey;
  }

  private assertConfigured() {
    if (!this.secretKey) {
      throw new BadRequestException(
        "Chariow n'est pas configuré sur ce serveur (CHARIOW_SECRET_KEY manquant).",
      );
    }
  }

  // ==========================================================================
  // 💳 INITIER UN CHECKOUT (achat d'une licence = un paiement d'abonnement)
  // POST /checkout
  // ==========================================================================

  async initiateCheckout(
    dto: InitiateChariowCheckoutDto,
  ): Promise<ChariowCheckoutResponse> {
    this.assertConfigured();
    try {
      this.logger.log(
        `💳 Initiation checkout Chariow — produit ${dto.productId}, client ${dto.customerEmail}` +
          (dto.discountCode ? ` (code: ${dto.discountCode})` : ''),
      );

      const payload = {
        product_id: dto.productId,
        email: dto.customerEmail,
        first_name: dto.customerFirstName,
        last_name: dto.customerLastName,
        phone: {
          number: dto.customerPhoneNumber,
          country_code: dto.customerPhoneCountryCode,
        },
        discount_code: dto.discountCode,
        redirect_url: dto.redirectUrl,
        custom_metadata: dto.customMetadata,
      };

      const response = await this.client.post<{
        data: ChariowCheckoutResponse;
      }>('/checkout', payload);

      const result = response.data.data;
      this.logger.log(
        `✅ Checkout Chariow créé: vente ${result.purchase?.id} (${result.step})`,
      );

      return result;
    } catch (error: any) {
      this.logger.error('❌ Échec initiation checkout Chariow:');
      this.logger.error(
        JSON.stringify(error.response?.data, null, 2) || error.message,
      );

      const status = error.response?.status;
      // 422 couvre aussi le cas "code de réduction invalide" (voir doc
      // checkout) — on relaie le message exact de Chariow dans ce cas plutôt
      // que notre message générique, car il est directement actionnable par
      // le client ("code expiré", "code déjà utilisé", etc.).
      const errMsg =
        error.response?.data?.message ||
        (status === 404
          ? 'Produit Chariow introuvable ou non publié — vérifier CHARIOW_PRODUCT_*_ID.'
          : status === 422
            ? 'Erreur de validation, code de réduction invalide, ou produit non éligible au checkout API.'
            : 'Erreur lors de l’initiation du paiement Chariow.');

      throw new BadRequestException(errMsg);
    }
  }

  // ==========================================================================
  // 🔍 STATUT D'UNE VENTE (pour le polling)
  // GET /sales/{id}
  // ==========================================================================

  async getSale(saleId: string): Promise<ChariowSale> {
    this.assertConfigured();
    try {
      const response = await this.client.get<{ data: ChariowSale }>(
        `/sales/${saleId}`,
      );
      return response.data.data;
    } catch (error: any) {
      this.logger.error(
        `❌ Échec récupération vente Chariow ${saleId}:`,
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        'Erreur lors de la vérification du statut de la vente Chariow',
      );
    }
  }

  // ==========================================================================
  // 🔍 STATUT D'UNE LICENCE
  // GET /licenses/{licenseKey}
  // ==========================================================================

  async getLicense(licenseKey: string): Promise<ChariowLicense> {
    this.assertConfigured();
    try {
      const response = await this.client.get<{ data: ChariowLicense }>(
        `/licenses/${licenseKey}`,
      );
      return response.data.data;
    } catch (error: any) {
      this.logger.error(
        `❌ Échec récupération licence Chariow ${licenseKey}:`,
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        'Erreur lors de la vérification de la licence Chariow',
      );
    }
  }

  // ==========================================================================
  // ❌ RÉVOQUER UNE LICENCE (coupe l'accès — IRRÉVERSIBLE côté Chariow)
  // POST /licenses/{licenseKey}/revoke
  // À réserver au cas "définitivement impayé", jamais à une simple pause.
  // ==========================================================================

  async revokeLicense(licenseKey: string, reason?: string): Promise<void> {
    this.assertConfigured();
    try {
      await this.client.post(`/licenses/${licenseKey}/revoke`, { reason });
      this.logger.log(`🔒 Licence Chariow ${licenseKey} révoquée (${reason ?? 'sans motif'})`);
    } catch (error: any) {
      this.logger.error(
        `❌ Échec révocation licence Chariow ${licenseKey}:`,
        error.response?.data || error.message,
      );
      throw new BadRequestException(
        'Erreur lors de la révocation de la licence Chariow',
      );
    }
  }

  // ==========================================================================
  // 🏷️ RÉDUCTIONS — VALIDATION / AFFICHAGE CÔTÉ FRONT AVANT CHECKOUT
  // GET /discounts?search=CODE — utilisé pour vérifier/afficher une réduction
  // (nom, %, expiration) avant que le client ne lance le paiement. La
  // validation "fait foi" reste toujours celle de POST /checkout côté
  // Chariow (discount_code invalide → 422), ceci n'est qu'un aperçu UX.
  // ==========================================================================

  async findDiscountByCode(code: string): Promise<ChariowDiscount | null> {
    this.assertConfigured();
    try {
      const response = await this.client.get<{
        data: { data: ChariowDiscount[] };
      }>('/discounts', { params: { search: code, status: 'active' } });

      const match = response.data.data.data.find(
        (d) => d.code.toLowerCase() === code.toLowerCase(),
      );
      return match ?? null;
    } catch (error: any) {
      this.logger.error(
        `❌ Échec recherche réduction Chariow "${code}":`,
        error.response?.data || error.message,
      );
      return null;
    }
  }

  // ==========================================================================
  // 🔎 HELPERS D'INTERPRÉTATION DU STATUT (valeurs officielles confirmées)
  // ==========================================================================

  isSalePaid(sale: ChariowSale): boolean {
    return (
      sale.status === 'completed' ||
      sale.status === 'settled' ||
      sale.payment?.status === 'success'
    );
  }

  isSaleFailed(sale: ChariowSale): boolean {
    return (
      sale.status === 'failed' ||
      sale.status === 'abandoned' ||
      sale.payment?.status === 'failed' ||
      sale.payment?.status === 'cancelled'
    );
  }
}