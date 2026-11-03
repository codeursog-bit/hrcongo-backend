// ============================================================================
// 📊 SUBSCRIPTIONS CONTROLLER - AVEC CONFIRM PAYMENT
// ============================================================================
// Fichier: src/subscriptions/subscriptions.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionsService } from './subscriptions.service';
import { UpgradeCheckoutDto } from './dto/upgrade-checkout.dto';
import { MotekiCheckoutDto } from './dto/moteki-checkout.dto';
import { ChariowCheckoutDto } from './dto/chariow-checkout.dto';
import { SubscriptionGuard } from './guards/subscription.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { MotekiService } from '../payments/moteki.service';
import { YabetooPayService } from '../payments/yabetoopay.service';
import { ChariowService } from '../payments/chariow.service';
import { PricingService } from './pricing.service';
import { CustomQuotesService } from './custom-quotes.service';
import { DiscountCodesService } from './discount-codes.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ValidateDiscountDto } from './dto/billing-admin.dto';

@Controller('subscriptions')
@UseGuards(AuthGuard('jwt'))
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionGuard: SubscriptionGuard,
    private readonly motekiService: MotekiService,
    private readonly yabetooPayService: YabetooPayService,
    private readonly chariowService: ChariowService,
    private readonly pricingService: PricingService,
    private readonly customQuotesService: CustomQuotesService,
    private readonly discountCodesService: DiscountCodesService,
    private readonly invoicesService: InvoicesService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  // ==========================================================================
  // 📋 RÉCUPÉRER L'ABONNEMENT ACTUEL
  // ==========================================================================

  @Get('current')
  async getCurrentSubscription(@Request() req) {
    const user = req.user;
    if (!user.companyId) return { subscription: null };
    return this.subscriptionsService.getSubscription(user.companyId);
  }

  // ==========================================================================
  // 📊 RÉCUPÉRER LES STATS D'UTILISATION
  // ==========================================================================

  @Get('usage')
  async getUsageStats(@Request() req) {
    const user = req.user;
    if (!user.companyId) return null;
    return this.subscriptionGuard.getUsageStats(user.companyId);
  }

  // ==========================================================================
  // 📋 RÉCUPÉRER TOUS LES PLANS DISPONIBLES
  // ==========================================================================

  @Get('plans')
  async getPlans() {
    return this.subscriptionsService.getAvailablePlans();
  }

  // ==========================================================================
  // 💳 INITIER UN PAIEMENT (CRÉER LE PAYMENT INTENT - ADMIN UNIQUEMENT)
  // Retourne intentId + clientSecret au frontend
  // ==========================================================================

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  async upgradeSubscription(@Body() dto: UpgradeCheckoutDto, @Request() req) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    return this.subscriptionsService.createUpgradeCheckout(
      user.companyId,
      dto,
      user.sub,
    );
  }

  // ==========================================================================
  // ✅ CONFIRMER LE PAIEMENT (appel après saisie téléphone + opérateur)
  // ==========================================================================

  @Post('confirm-payment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  async confirmPayment(
    @Body()
    body: {
      intentId: string;
      clientSecret: string;
      phone: string;
      operator: 'AIRTEL' | 'MTN' | 'ORANGE';
    },
    @Request() req,
  ) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    return this.subscriptionsService.confirmPayment(
      user.companyId,
      body.intentId,
      body.clientSecret,
      body.phone,
      body.operator,
    );
  }

  // ==========================================================================
  // 🛒 MOTEKI — MOYENS DE PAIEMENT ACTIVÉS SUR LA BOUTIQUE
  // (utilisé par le frontend pour construire dynamiquement la liste des
  // opérateurs mobile money proposés — pas de liste codée en dur qui
  // risquerait de proposer un opérateur non activé côté Moteki)
  // ==========================================================================

  // ==========================================================================
  // 🔀 QUEL PRESTATAIRE DE PAIEMENT EST ACTIF ?
  // ==========================================================================
  //
  // Bascule automatique : si MOTEKI_SECRET_KEY est configuré dans .env, on
  // utilise Moteki ; sinon, YabetooPay (dont le code est resté intact —
  // voir createUpgradeCheckout/confirmPayment ci-dessous) prend le relais
  // automatiquement. Le frontend appelle cet endpoint pour savoir quel
  // modal de paiement afficher, sans rien coder en dur.
  // ==========================================================================

  @Get('payment-provider')
  async getActivePaymentProvider() {
    // Choisi par le super admin (réglages plateforme)
    const { paymentProvider } = await this.platformSettings.get();
    const configured = {
      YABETOOPAY: this.yabetooPayService.isConfigured(),
      MOTEKI: this.motekiService.isConfigured(),
      CHARIOW: this.chariowService.isConfigured(),
    } as const;
    return { provider: configured[paymentProvider] ? paymentProvider : ('NONE' as const) };
  }

  /** Devis actif de l'entreprise (null si aucun) */
  @Get('quote')
  async getActiveQuote(@Request() req) {
    if (!req.user.companyId) return { quote: null };
    const q = await this.customQuotesService.findActiveForCompany(req.user.companyId);
    return {
      quote: q && {
        id: q.id, plan: q.plan, amount: q.amount, months: q.months,
        isRecurring: q.isRecurring, validUntil: q.validUntil,
      },
    };
  }

  /** Aperçu du prix avec un code (n'enregistre rien) */
  @Post('discount/validate')
  @HttpCode(HttpStatus.OK)
  async validateDiscount(@Body() dto: ValidateDiscountDto, @Request() req) {
    if (!req.user.companyId) throw new ForbiddenException('Aucune entreprise associée');
    const base = await this.pricingService.getPrice(dto.plan, dto.billingPeriod);
    const a = await this.discountCodesService.apply(dto.code, req.user.companyId, base);
    return {
      code: a.code, percentOff: a.percentOff,
      originalAmount: a.originalAmount, discountAmount: a.discountAmount, finalAmount: a.finalAmount,
    };
  }

  // ── Factures ────────────────────────────────────────────────────────────
  @Get('invoices')
  async listInvoices(@Request() req) {
    if (!req.user.companyId) return { invoices: [] };
    return { invoices: await this.invoicesService.listForCompany(req.user.companyId) };
  }

  @Get('invoices/:id/pdf')
  async downloadInvoice(@Param('id') id: string, @Request() req, @Res() res: Response) {
    if (!req.user.companyId) throw new ForbiddenException('Aucune entreprise associée');
    const inv = await this.invoicesService.getOwned(id, req.user.companyId);
    const pdf = await this.invoicesService.buildPdf(inv);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${inv.number}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Post('invoices/:id/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  async resendInvoice(@Param('id') id: string, @Request() req) {
    if (!req.user.companyId) throw new ForbiddenException('Aucune entreprise associée');
    return this.invoicesService.resend(id, req.user.companyId, req.user.sub);
  }

  @Get('moteki/payment-methods')
  async getMotekiPaymentMethods() {
    return this.motekiService.getAvailablePaymentMethods();
  }

  // ==========================================================================
  // 🛒 MOTEKI — INITIER UN CHECKOUT D'ABONNEMENT (nouveau prestataire)
  // Un seul appel : Moteki initie ET déclenche le paiement, retourne une
  // checkoutUrl vers laquelle rediriger le client (ou vers laquelle son
  // navigateur est déjà en train d'aller si vous ouvrez ça dans une iframe).
  // ==========================================================================

  @Post('upgrade/moteki')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  async upgradeSubscriptionViaMoteki(
    @Body() dto: MotekiCheckoutDto,
    @Request() req,
  ) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    return this.subscriptionsService.createMotekiCheckout(
      user.companyId,
      dto,
    );
  }

  // ==========================================================================
  // 🔎 MOTEKI — VÉRIFIER À LA DEMANDE SI UNE COMMANDE EST PAYÉE
  // ==========================================================================
  //
  // Appelé par la page /success juste après le retour de Moteki, pour ne
  // pas attendre le prochain passage du cron (toutes les 5 min) — voir
  // SubscriptionsService.checkAndActivateMotekiOrder pour la logique.
  // ==========================================================================

  @Post('moteki/check-order/:paymentId')
  @HttpCode(HttpStatus.OK)
  async checkMotekiOrder(
    @Param('paymentId') paymentId: string,
    @Request() req,
  ) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    // On vérifie que ce paiement appartient bien à l'entreprise de
    // l'utilisateur avant de le laisser déclencher une vérification —
    // évite qu'un utilisateur puisse sonder/activer le paiement d'une
    // autre entreprise en devinant un id.
    const payment = await this.subscriptionsService.getPaymentOwnedByCompany(
      paymentId,
      user.companyId,
    );
    if (!payment) {
      throw new ForbiddenException('Paiement introuvable pour votre entreprise');
    }

    return this.subscriptionsService.checkAndActivateMotekiOrder(paymentId);
  }

  // ==========================================================================
  // 🛒 CHARIOW — INITIER UN CHECKOUT D'ABONNEMENT (3e prestataire, redondance)
  // ==========================================================================

  @Post('upgrade/chariow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  async upgradeSubscriptionViaChariow(
    @Body() dto: ChariowCheckoutDto,
    @Request() req,
  ) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    return this.subscriptionsService.createChariowCheckout(
      user.companyId,
      dto,
    );
  }

  // ==========================================================================
  // 🔎 CHARIOW — VÉRIFIER À LA DEMANDE SI UNE VENTE EST PAYÉE
  // ==========================================================================

  @Post('chariow/check-sale/:paymentId')
  @HttpCode(HttpStatus.OK)
  async checkChariowSale(
    @Param('paymentId') paymentId: string,
    @Request() req,
  ) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    const payment = await this.subscriptionsService.getPaymentOwnedByCompany(
      paymentId,
      user.companyId,
    );
    if (!payment) {
      throw new ForbiddenException('Paiement introuvable pour votre entreprise');
    }

    return this.subscriptionsService.checkAndActivateChariowSale(paymentId);
  }

  // ==========================================================================
  // 🔎 YABETOO — VÉRIFIER À LA DEMANDE SI UN PAIEMENT EST PAYÉ
  // (filet de sécurité — le webhook reste la voie normale/rapide, ceci
  // couvre le cas où il n'arrive pas)
  // ==========================================================================

  @Post('yabetoo/check-payment/:paymentId')
  @HttpCode(HttpStatus.OK)
  async checkYabetooPayment(
    @Param('paymentId') paymentId: string,
    @Request() req,
  ) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    const payment = await this.subscriptionsService.getPaymentOwnedByCompany(
      paymentId,
      user.companyId,
    );
    if (!payment) {
      throw new ForbiddenException('Paiement introuvable pour votre entreprise');
    }

    return this.subscriptionsService.checkAndActivateYabetooPayment(paymentId);
  }

  // ==========================================================================
  // 💳 RÉCUPÉRER L'HISTORIQUE DES PAIEMENTS
  // ==========================================================================

  @Get('payments')
  async getPaymentHistory(@Request() req) {
    const user = req.user;
    if (!user.companyId) return { payments: [] };
    return this.subscriptionsService.getPaymentHistory(user.companyId);
  }

  // ==========================================================================
  // ❌ ANNULER L'ABONNEMENT
  // ==========================================================================

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  async cancelSubscription(@Request() req) {
    const user = req.user;
    if (!user.companyId)
      throw new ForbiddenException('Aucune entreprise associée');

    await this.subscriptionsService.cancelSubscription(
      user.companyId,
      user.sub,
    );
    return { success: true, message: 'Abonnement annulé avec succès' };
  }
}