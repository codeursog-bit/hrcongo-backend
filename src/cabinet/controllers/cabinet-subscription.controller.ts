// ============================================================================
// src/cabinet/controllers/cabinet-subscription.controller.ts
// Routes abonnement cabinet — GET/POST uniquement
// NOTE: Le webhook YaBetooPay est géré de manière UNIFIÉE dans
//       src/subscriptions/webhooks.controller.ts
//       Il distingue entreprise vs cabinet via intent.metadata.type
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CabinetMemberGuard,
  CabinetAdminGuard,
} from '../guards/cabinet.guards';
import { CabinetSubscriptionService } from '../services/cabinet-subscription.service';

@Controller('cabinet')
@UseGuards(JwtAuthGuard)
export class CabinetSubscriptionController {
  constructor(private readonly svc: CabinetSubscriptionService) {}

  // GET /cabinet/:cabinetId/subscription
  @Get(':cabinetId/subscription')
  @UseGuards(CabinetMemberGuard)
  getSubscription(@Param('cabinetId') cabinetId: string) {
    return this.svc.getSubscription(cabinetId);
  }

  // POST /cabinet/:cabinetId/subscription/upgrade
  // Crée un PaymentIntent YaBetooPay avec metadata.type = 'cabinet_subscription'
  // → le webhook unifié (/webhooks/yabetoopay) saura que c'est un paiement cabinet
  @Post(':cabinetId/subscription/upgrade')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  @HttpCode(HttpStatus.OK)
  initiateUpgrade(
    @Param('cabinetId') cabinetId: string,
    @Body() dto: { plan: any; billingPeriod: any },
  ) {
    return this.svc.initiateUpgrade(cabinetId, dto);
  }

  // POST /cabinet/:cabinetId/subscription/confirm-payment
  // Envoie la demande Mobile Money sur le téléphone de l'utilisateur
  @Post(':cabinetId/subscription/confirm-payment')
  @UseGuards(CabinetMemberGuard)
  @HttpCode(HttpStatus.OK)
  confirmPayment(
    @Param('cabinetId') cabinetId: string,
    @Body()
    dto: {
      intentId: string;
      clientSecret: string;
      phone: string;
      operator: any;
    },
  ) {
    return this.svc.confirmPayment(cabinetId, dto);
  }
}
