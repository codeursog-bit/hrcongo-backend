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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionsService } from './subscriptions.service';
import { UpgradeCheckoutDto } from './dto/upgrade-checkout.dto';
import { MotekiCheckoutDto } from './dto/moteki-checkout.dto';
import { SubscriptionGuard } from './guards/subscription.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PLANS } from './config/plans.config';
import { MotekiService } from '../payments/moteki.service';

@Controller('subscriptions')
@UseGuards(AuthGuard('jwt'))
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionGuard: SubscriptionGuard,
    private readonly motekiService: MotekiService,
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
    return { plans: PLANS };
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
  getActivePaymentProvider() {
    const provider = this.motekiService.isConfigured() ? 'MOTEKI' : 'YABETOOPAY';
    return { provider };
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