// ============================================================================
// 📊 SUBSCRIPTIONS CONTROLLER - AVEC CONFIRM PAYMENT
// ============================================================================
// Fichier: src/subscriptions/subscriptions.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionsService } from './subscriptions.service';
import { UpgradeCheckoutDto } from './dto/upgrade-checkout.dto';
import { SubscriptionGuard } from './guards/subscription.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PLANS } from './config/plans.config';

@Controller('subscriptions')
@UseGuards(AuthGuard('jwt'))
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionGuard: SubscriptionGuard,
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
