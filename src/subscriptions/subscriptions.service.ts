// // ============================================================================
// // 📊 SUBSCRIPTIONS SERVICE - PAYMENT INTENTS (sans Checkout Session)
// // ============================================================================
// // Fichier: src/subscriptions/subscriptions.service.ts

// import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { PrismaService } from '../prisma/prisma.service';
// import { YabetooPayService } from '../payments/yabetoopay.service';
// import { PLANS, getPlanPrice } from './config/plans.config';
// import { UpgradeCheckoutDto } from './dto/upgrade-checkout.dto';
// import { AffiliateService } from '../affiliate/affiliate.service'; // ← AJOUT

// @Injectable()
// export class SubscriptionsService {
//   private readonly logger = new Logger(SubscriptionsService.name);

//   constructor(
//     private prisma: PrismaService,
//     private yabetooPayService: YabetooPayService,
//     private configService: ConfigService,
//     private affiliateService: AffiliateService, // ← AJOUT
//   ) {}

//   // ==========================================================================
//   // 🎁 CRÉER UN ABONNEMENT AVEC ESSAI GRATUIT 30 JOURS PRO
//   // ==========================================================================

//   async createTrialSubscription(companyId: string) {
//     this.logger.log(`🎁 Creating TRIAL PRO subscription for company: ${companyId}`);

//     const now = new Date();
//     const trialEnd = new Date(now);
//     trialEnd.setDate(trialEnd.getDate() + 30);

//     const subscription = await this.prisma.subscription.create({
//       data: {
//         companyId,
//         plan: 'PRO',
//         status: 'TRIALING',
//         pricePerMonth: 0,
//         currency: 'XAF',
//         startDate: now,
//         currentPeriodStart: now,
//         currentPeriodEnd: trialEnd,
//         trialEndsAt: trialEnd,
//       },
//     });

//     this.logger.log(`✅ TRIAL PRO subscription created until ${trialEnd.toLocaleDateString()}`);
//     return subscription;
//   }

//   // ==========================================================================
//   // ⏰ VÉRIFIER ET DOWNGRADE LES ESSAIS EXPIRÉS (CRON JOB)
//   // ==========================================================================

//   async checkExpiredTrials() {
//     this.logger.log('⏰ Checking for expired trial subscriptions...');

//     const now = new Date();
//     const expiredTrials = await this.prisma.subscription.findMany({
//       where: { status: 'TRIALING', trialEndsAt: { lte: now } },
//     });

//     this.logger.log(`📊 Found ${expiredTrials.length} expired trials`);

//     for (const trial of expiredTrials) {
//       await this.prisma.subscription.update({
//         where: { id: trial.id },
//         data: { plan: 'FREE', status: 'ACTIVE', pricePerMonth: 0 },
//       });
//       this.logger.log(`📉 Downgraded company ${trial.companyId} from TRIAL PRO to FREE`);
//     }

//     return { downgraded: expiredTrials.length };
//   }

//   // ==========================================================================
//   // ⚠️ ENVOYER DES ALERTES AVANT EXPIRATION
//   // ==========================================================================

//   async sendTrialExpirationAlerts() {
//     this.logger.log('🔔 Sending trial expiration alerts...');

//     const now = new Date();
//     const in7Days = new Date(now);
//     in7Days.setDate(in7Days.getDate() + 7);

//     const trials7Days = await this.prisma.subscription.findMany({
//       where: {
//         status: 'TRIALING',
//         trialEndsAt: { gte: now, lte: in7Days },
//       },
//       include: { company: { select: { email: true, legalName: true } } },
//     });

//     for (const trial of trials7Days) {
//       this.logger.log(`📧 Sending 7-day alert to ${trial.company.email}`);
//     }

//     return { alerts: trials7Days.length };
//   }

//   // ==========================================================================
//   // 💳 CRÉER UN PAYMENT INTENT POUR UPGRADE
//   // (Remplace createUpgradeCheckout qui utilisait les sessions)
//   // ==========================================================================

//   async createUpgradeCheckout(
//     companyId: string,
//     dto: UpgradeCheckoutDto,
//     userId: string,
//   ) {
//     this.logger.log(`💳 Creating payment intent for company: ${companyId} - Plan: ${dto.plan}`);

//     const currentSubscription = await this.prisma.subscription.findUnique({
//       where: { companyId },
//     });

//     if (!currentSubscription) {
//       throw new NotFoundException('Aucun abonnement trouvé');
//     }

//     const amount = getPlanPrice(dto.plan, dto.billingPeriod);
//     const planConfig = PLANS[dto.plan];

//     this.logger.log(`💰 Amount: ${amount} XAF`);

//     // 🚀 CRÉER LE PAYMENT INTENT (pas de session checkout)
//     const intent = await this.yabetooPayService.createPaymentIntent({
//       amount,
//       currency: 'xaf',
//       metadata: {
//         companyId,
//         subscriptionId: currentSubscription.id,
//         plan: dto.plan,
//         billingPeriod: dto.billingPeriod,
//         userId,
//       },
//     });

//     this.logger.log(`✅ Payment intent created: ${intent.id}`);
//     this.logger.log(`🔑 Client secret: ${intent.client_secret}`);

//     // 💾 SAUVEGARDER EN BDD
//     const payment = await this.prisma.payment.create({
//       data: {
//         subscriptionId: currentSubscription.id,
//         companyId,
//         yabetooIntentId: intent.id,
//         clientSecret: intent.client_secret,
//         amount,
//         currency: 'XAF',
//         status: 'PENDING',
//         description: `Abonnement ${planConfig.name} - ${dto.billingPeriod === 'yearly' ? 'Annuel' : 'Mensuel'}`,
//         metadata: {
//           plan: dto.plan,
//           billingPeriod: dto.billingPeriod,
//           intentId: intent.id,
//         },
//       },
//     });

//     this.logger.log(`💾 Payment record created: ${payment.id}`);

//     // Retourner intentId + clientSecret au frontend pour confirmer le paiement
//     return {
//       intentId: intent.id,
//       clientSecret: intent.client_secret,
//       paymentId: payment.id,
//       plan: dto.plan,
//       billingPeriod: dto.billingPeriod,
//       amount,
//     };
//   }

//   // ==========================================================================
//   // ✅ CONFIRMER UN PAYMENT INTENT (appel frontend avec téléphone + opérateur)
//   // ==========================================================================

//   async confirmPayment(
//     companyId: string,
//     intentId: string,
//     clientSecret: string,
//     phone: string,
//     operator: 'AIRTEL' | 'MTN' | 'ORANGE',
//   ) {
//     this.logger.log(`✅ Confirming payment intent: ${intentId}`);

//     // Vérifier que le paiement existe bien en BDD
//     const payment = await this.prisma.payment.findFirst({
//       where: { companyId, yabetooIntentId: intentId, status: 'PENDING' },
//     });

//     if (!payment) {
//       throw new NotFoundException('Paiement introuvable ou déjà traité');
//     }

//     // 📱 Confirmer avec Yabetoo → déclenche la demande Mobile Money
//     const confirmation = await this.yabetooPayService.confirmPaymentIntent({
//       intentId,
//       clientSecret,
//       paymentMethod: {
//         type: 'momo',
//         phone,
//         operator,
//       },
//     });

//     this.logger.log(`📱 Payment confirmation sent to ${phone} (${operator})`);
//     this.logger.log(`📊 Confirmation status: ${confirmation.status}`);

//     // Mettre à jour le paiement avec les infos de confirmation
//     await this.prisma.payment.update({
//       where: { id: payment.id },
//       data: {
//         status: 'PROCESSING',
//         paymentMethod: operator,
//         paymentMethodDetails: { phone, operator },
//         yabetooChargeId: confirmation.id,
//         yabetooTransactionId: confirmation.transactionId,
//         yabetooFinancialTxId: confirmation.financialTransactionId,
//       },
//     });

//     // Si paiement déjà succès (rare mais possible en sandbox)
//     if (confirmation.status === 'succeeded') {
//       this.logger.log('✅ Payment immediately succeeded');
//       await this.handlePaymentSuccess(payment, confirmation);
//       return {
//         status: 'succeeded',
//         message: 'Paiement confirmé avec succès. Votre abonnement est activé.',
//       };
//     }

//     // Cas normal : en attente de confirmation Mobile Money sur le téléphone
//     return {
//       status: 'pending',
//       message: `Une demande de paiement a été envoyée au ${phone}. Confirmez sur votre téléphone.`,
//     };
//   }

//   // ==========================================================================
//   // 🔧 HELPER : Activer le paiement après succès
//   // ==========================================================================

//   private async handlePaymentSuccess(payment: any, confirmation: any) {
//     const metadata = payment.metadata as any;
//     const { plan, billingPeriod } = metadata;

//     await this.prisma.payment.update({
//       where: { id: payment.id },
//       data: {
//         status: 'SUCCEEDED',
//         paidAt: new Date(),
//         yabetooChargeId: confirmation.id || payment.yabetooChargeId,
//       },
//     });

//     await this.activateUpgrade(payment.companyId, plan, billingPeriod);

//     // ─── COMMISSION AFFILIÉ ────────────────────────────────────────────────
//     try {
//       await this.affiliateService.handleSuccessfulPayment(payment.id);
//     } catch (err) {
//       // Ne pas faire échouer le flux pour une erreur d'affiliation
//       this.logger.error('[Affiliate] Erreur calcul commission (handlePaymentSuccess):', err);
//     }
//   }

//   // ==========================================================================
//   // ✅ ACTIVER L'UPGRADE (APRÈS PAIEMENT RÉUSSI)
//   // ==========================================================================

//   async activateUpgrade(
//     companyId: string,
//     plan: 'BASIC' | 'PRO' | 'ENTERPRISE',
//     billingPeriod: 'monthly' | 'yearly',
//   ) {
//     this.logger.log(`✅ Activating upgrade for company: ${companyId} to ${plan}`);

//     const planConfig = PLANS[plan];
//     const now = new Date();
//     const periodEnd = new Date(now);

//     if (billingPeriod === 'yearly') {
//       periodEnd.setFullYear(periodEnd.getFullYear() + 1);
//     } else {
//       periodEnd.setMonth(periodEnd.getMonth() + 1);
//     }

//     const currentSubscription = await this.prisma.subscription.findUnique({
//       where: { companyId },
//     });

//     if (!currentSubscription) {
//       throw new NotFoundException('Aucun abonnement trouvé');
//     }

//     await this.prisma.subscription.update({
//       where: { companyId },
//       data: {
//         plan,
//         status: 'ACTIVE',
//         pricePerMonth: planConfig.priceMonthly,
//         trialEndsAt: null,
//         currentPeriodStart: now,
//         currentPeriodEnd: periodEnd,
//         canceledAt: null,
//       },
//     });

//     this.logger.log(`🎉 Upgrade activated - Plan: ${plan} until ${periodEnd.toISOString()}`);
//   }

//   // ==========================================================================
//   // 📊 RÉCUPÉRER L'ABONNEMENT D'UNE ENTREPRISE
//   // ==========================================================================

//   async getSubscription(companyId: string) {
//     const subscription = await this.prisma.subscription.findUnique({
//       where: { companyId },
//       include: {
//         payments: {
//           orderBy: { createdAt: 'desc' },
//           take: 5,
//         },
//       },
//     });

//     if (!subscription) {
//       throw new NotFoundException('Aucun abonnement trouvé');
//     }

//     let daysLeftInTrial = 0;
//     if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
//       const diff = subscription.trialEndsAt.getTime() - new Date().getTime();
//       daysLeftInTrial = Math.ceil(diff / (1000 * 60 * 60 * 24));
//     }

//     return {
//       ...subscription,
//       planDetails: PLANS[subscription.plan],
//       daysLeftInTrial,
//     };
//   }

//   // ==========================================================================
//   // 📊 RÉCUPÉRER LES STATS D'UTILISATION
//   // ==========================================================================

//   async getUsageStats(companyId: string) {
//     const subscription = await this.prisma.subscription.findUnique({
//       where: { companyId },
//     });

//     if (!subscription) {
//       throw new NotFoundException('Aucun abonnement trouvé');
//     }

//     const planLimits = PLANS[subscription.plan].limits;

//     const [employeesCount, usersCount, departmentsCount, jobOffersCount] = await Promise.all([
//       this.prisma.employee.count({ where: { companyId } }),
//       this.prisma.user.count({ where: { companyId } }),
//       this.prisma.department.count({ where: { companyId } }),
//       this.prisma.jobOffer.count({ where: { companyId } }),
//     ]);

//     return {
//       plan: subscription.plan,
//       status: subscription.status,
//       limits: {
//         employees: {
//           current: employeesCount,
//           max: planLimits.maxEmployees,
//           percentage: planLimits.maxEmployees === -1 ? 0 : Math.round((employeesCount / planLimits.maxEmployees) * 100),
//         },
//         users: {
//           current: usersCount,
//           max: planLimits.maxUsers,
//           percentage: planLimits.maxUsers === -1 ? 0 : Math.round((usersCount / planLimits.maxUsers) * 100),
//         },
//         departments: {
//           current: departmentsCount,
//           max: planLimits.maxDepartments,
//           percentage: planLimits.maxDepartments === -1 ? 0 : Math.round((departmentsCount / planLimits.maxDepartments) * 100),
//         },
//         jobOffers: {
//           current: jobOffersCount,
//           max: planLimits.maxJobOffers,
//           percentage: planLimits.maxJobOffers === -1 ? 0 : Math.round((jobOffersCount / planLimits.maxJobOffers) * 100),
//         },
//       },
//       features: planLimits,
//     };
//   }

//   // ==========================================================================
//   // ❌ ANNULER UN ABONNEMENT
//   // ==========================================================================

//   async cancelSubscription(companyId: string, userId: string) {
//     this.logger.log(`❌ Canceling subscription for company: ${companyId}`);

//     await this.prisma.subscription.update({
//       where: { companyId },
//       data: {
//         plan: 'FREE',
//         status: 'CANCELED',
//         canceledAt: new Date(),
//         pricePerMonth: 0,
//         trialEndsAt: null,
//       },
//     });

//     this.logger.log('✅ Subscription canceled');
//   }

//   // ==========================================================================
//   // 🔔 ACTIVER LE PAIEMENT VIA WEBHOOK (SANS COMPANYID)
//   // ==========================================================================

//   async activatePaymentByWebhook(webhookData: {
//     intentId: string;
//     chargeId: string;
//     transactionId: string;
//     financialTransactionId: string;
//     amount: number;
//     currency: string;
//     status: string;
//   }) {
//     this.logger.log('🔔 ============================================');
//     this.logger.log('🔔 ACTIVATING PAYMENT FROM WEBHOOK');
//     this.logger.log('🔔 ============================================');
//     this.logger.log(`🔔 Intent ID: ${webhookData.intentId}`);
//     this.logger.log(`🔔 Charge ID: ${webhookData.chargeId}`);
//     this.logger.log(`🔔 Amount: ${webhookData.amount} ${webhookData.currency}`);

//     // Chercher d'abord par intentId
//     let payment = await this.prisma.payment.findFirst({
//       where: { yabetooIntentId: webhookData.intentId },
//       include: { subscription: true },
//     });

//     // Fallback : chercher par montant + devise + statut PENDING ou PROCESSING
//     if (!payment) {
//       this.logger.warn(`⚠️ Payment not found by intentId, searching by amount...`);
//       payment = await this.prisma.payment.findFirst({
//         where: {
//           amount: webhookData.amount,
//           currency: webhookData.currency.toUpperCase(),
//           status: { in: ['PENDING', 'PROCESSING'] },
//         },
//         orderBy: { createdAt: 'desc' },
//         include: { subscription: true },
//       });
//     }

//     if (!payment) {
//       this.logger.error(`❌ Payment not found for intent: ${webhookData.intentId} / amount: ${webhookData.amount}`);
//       throw new NotFoundException('Paiement introuvable');
//     }

//     this.logger.log(`✅ Payment found: ${payment.id}`);
//     this.logger.log(`📊 Company: ${payment.companyId}`);

//     // Mettre à jour le paiement
//     await this.prisma.payment.update({
//       where: { id: payment.id },
//       data: {
//         status: 'SUCCEEDED',
//         paidAt: new Date(),
//         yabetooChargeId: webhookData.chargeId,
//         yabetooTransactionId: webhookData.transactionId,
//         yabetooFinancialTxId: webhookData.financialTransactionId,
//       },
//     });

//     this.logger.log('✅ Payment updated with webhook data');

//     // Activer l'abonnement
//     const metadata = payment.metadata as any;
//     const { plan, billingPeriod } = metadata;

//     this.logger.log(`🚀 Activating subscription - Plan: ${plan}, Period: ${billingPeriod}`);

//     await this.activateUpgrade(payment.companyId, plan, billingPeriod);

//     // ─── COMMISSION AFFILIÉ ────────────────────────────────────────────────
//     try {
//       await this.affiliateService.handleSuccessfulPayment(payment.id);
//     } catch (err) {
//       // Ne pas faire échouer le webhook pour une erreur d'affiliation
//       this.logger.error('[Affiliate] Erreur calcul commission (webhook):', err);
//     }

//     this.logger.log('🎉 ============================================');
//     this.logger.log('🎉 SUBSCRIPTION ACTIVATED VIA WEBHOOK');
//     this.logger.log(`🎉 Company: ${payment.companyId} - Plan: ${plan}`);
//     this.logger.log('🎉 ============================================');

//     return {
//       success: true,
//       paymentId: payment.id,
//       companyId: payment.companyId,
//       plan,
//     };
//   }

//   // ==========================================================================
//   // 💳 RÉCUPÉRER L'HISTORIQUE DES PAIEMENTS
//   // ==========================================================================

//   async getPaymentHistory(companyId: string) {
//     return this.prisma.payment.findMany({
//       where: { companyId },
//       orderBy: { createdAt: 'desc' },
//     });
//   }

//   // ==========================================================================
//   // 📋 RÉCUPÉRER TOUS LES PLANS DISPONIBLES
//   // ==========================================================================

//   getAvailablePlans() {
//     return { plans: PLANS };
//   }
// }

// ============================================================================
// 📊 SUBSCRIPTIONS SERVICE - PAYMENT INTENTS (sans Checkout Session)
// ============================================================================
// Fichier: src/subscriptions/subscriptions.service.ts

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { YabetooPayService } from '../payments/yabetoopay.service';
import { PLANS, getPlanPrice } from './config/plans.config';
import { UpgradeCheckoutDto } from './dto/upgrade-checkout.dto';
import { AffiliateService } from '../affiliate/affiliate.service'; // ← AJOUT

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private yabetooPayService: YabetooPayService,
    private configService: ConfigService,
    private affiliateService: AffiliateService, // ← AJOUT
  ) {}

  // ==========================================================================
  // 🎁 CRÉER UN ABONNEMENT AVEC ESSAI GRATUIT 30 JOURS PRO
  // ==========================================================================

  async createTrialSubscription(companyId: string) {
    this.logger.log(
      `🎁 Creating TRIAL PRO subscription for company: ${companyId}`,
    );

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 30);

    const subscription = await this.prisma.subscription.create({
      data: {
        companyId,
        plan: 'PRO',
        status: 'TRIALING',
        pricePerMonth: 0,
        currency: 'XAF',
        startDate: now,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
        trialEndsAt: trialEnd,
      },
    });

    this.logger.log(
      `✅ TRIAL PRO subscription created until ${trialEnd.toLocaleDateString()}`,
    );
    return subscription;
  }

  // ==========================================================================
  // ⏰ VÉRIFIER ET DOWNGRADE LES ESSAIS EXPIRÉS (CRON JOB)
  // ==========================================================================

  async checkExpiredTrials() {
    this.logger.log('⏰ Checking for expired trial subscriptions...');

    const now = new Date();
    const expiredTrials = await this.prisma.subscription.findMany({
      where: { status: 'TRIALING', trialEndsAt: { lte: now } },
    });

    this.logger.log(`📊 Found ${expiredTrials.length} expired trials`);

    for (const trial of expiredTrials) {
      await this.prisma.subscription.update({
        where: { id: trial.id },
        data: { plan: 'FREE', status: 'ACTIVE', pricePerMonth: 0 },
      });
      this.logger.log(
        `📉 Downgraded company ${trial.companyId} from TRIAL PRO to FREE`,
      );
    }

    return { downgraded: expiredTrials.length };
  }

  // ==========================================================================
  // ⚠️ ENVOYER DES ALERTES AVANT EXPIRATION
  // ==========================================================================

  async sendTrialExpirationAlerts() {
    this.logger.log('🔔 Sending trial expiration alerts...');

    const now = new Date();
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);

    const trials7Days = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIALING',
        trialEndsAt: { gte: now, lte: in7Days },
      },
      include: { company: { select: { email: true, legalName: true } } },
    });

    for (const trial of trials7Days) {
      this.logger.log(`📧 Sending 7-day alert to ${trial.company.email}`);
    }

    return { alerts: trials7Days.length };
  }

  // ==========================================================================
  // 💳 CRÉER UN PAYMENT INTENT POUR UPGRADE
  // (Remplace createUpgradeCheckout qui utilisait les sessions)
  // ==========================================================================

  async createUpgradeCheckout(
    companyId: string,
    dto: UpgradeCheckoutDto,
    userId: string,
  ) {
    this.logger.log(
      `💳 Creating payment intent for company: ${companyId} - Plan: ${dto.plan}`,
    );

    const currentSubscription = await this.prisma.subscription.findUnique({
      where: { companyId },
    });

    if (!currentSubscription) {
      throw new NotFoundException('Aucun abonnement trouvé');
    }

    const amount = getPlanPrice(dto.plan, dto.billingPeriod);
    const planConfig = PLANS[dto.plan];

    this.logger.log(`💰 Amount: ${amount} XAF`);

    // 🚀 CRÉER LE PAYMENT INTENT (pas de session checkout)
    const intent = await this.yabetooPayService.createPaymentIntent({
      amount,
      currency: 'xaf',
      metadata: {
        companyId,
        subscriptionId: currentSubscription.id,
        plan: dto.plan,
        billingPeriod: dto.billingPeriod,
        userId,
      },
    });

    this.logger.log(`✅ Payment intent created: ${intent.id}`);
    this.logger.log(`🔑 Client secret: ${intent.client_secret}`);

    // 💾 SAUVEGARDER EN BDD
    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId: currentSubscription.id,
        companyId,
        yabetooIntentId: intent.id,
        clientSecret: intent.client_secret,
        amount,
        currency: 'XAF',
        status: 'PENDING',
        description: `Abonnement ${planConfig.name} - ${dto.billingPeriod === 'yearly' ? 'Annuel' : 'Mensuel'}`,
        metadata: {
          plan: dto.plan,
          billingPeriod: dto.billingPeriod,
          intentId: intent.id,
        },
      },
    });

    this.logger.log(`💾 Payment record created: ${payment.id}`);

    // Retourner intentId + clientSecret au frontend pour confirmer le paiement
    return {
      intentId: intent.id,
      clientSecret: intent.client_secret,
      paymentId: payment.id,
      plan: dto.plan,
      billingPeriod: dto.billingPeriod,
      amount,
    };
  }

  // ==========================================================================
  // ✅ CONFIRMER UN PAYMENT INTENT (appel frontend avec téléphone + opérateur)
  // ==========================================================================

  async confirmPayment(
    companyId: string,
    intentId: string,
    clientSecret: string,
    phone: string,
    operator: 'AIRTEL' | 'MTN' | 'ORANGE',
  ) {
    this.logger.log(`✅ Confirming payment intent: ${intentId}`);

    // Vérifier que le paiement existe bien en BDD
    const payment = await this.prisma.payment.findFirst({
      where: { companyId, yabetooIntentId: intentId, status: 'PENDING' },
    });

    if (!payment) {
      throw new NotFoundException('Paiement introuvable ou déjà traité');
    }

    // 📱 Confirmer avec Yabetoo → déclenche la demande Mobile Money
    const confirmation = await this.yabetooPayService.confirmPaymentIntent({
      intentId,
      clientSecret,
      paymentMethod: {
        type: 'momo',
        phone,
        operator,
      },
    });

    this.logger.log(`📱 Payment confirmation sent to ${phone} (${operator})`);
    this.logger.log(`📊 Confirmation status: ${confirmation.status}`);

    // Mettre à jour le paiement avec les infos de confirmation
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PROCESSING',
        paymentMethod: operator,
        paymentMethodDetails: { phone, operator },
        yabetooChargeId: confirmation.id,
        yabetooTransactionId: confirmation.transactionId,
        yabetooFinancialTxId: confirmation.financialTransactionId,
      },
    });

    // Si paiement déjà succès (rare mais possible en sandbox)
    if (confirmation.status === 'succeeded') {
      this.logger.log('✅ Payment immediately succeeded');
      await this.handlePaymentSuccess(payment, confirmation);
      return {
        status: 'succeeded',
        message: 'Paiement confirmé avec succès. Votre abonnement est activé.',
      };
    }

    // Cas normal : en attente de confirmation Mobile Money sur le téléphone
    return {
      status: 'pending',
      message: `Une demande de paiement a été envoyée au ${phone}. Confirmez sur votre téléphone.`,
    };
  }

  // ==========================================================================
  // 🔧 HELPER : Activer le paiement après succès
  // ==========================================================================

  private async handlePaymentSuccess(payment: any, confirmation: any) {
    const metadata = payment.metadata;
    const { plan, billingPeriod } = metadata;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        paidAt: new Date(),
        yabetooChargeId: confirmation.id || payment.yabetooChargeId,
      },
    });

    await this.activateUpgrade(payment.companyId, plan, billingPeriod);

    // ─── COMMISSION AFFILIÉ ────────────────────────────────────────────────
    try {
      await this.affiliateService.handleSuccessfulPayment(payment.id);
    } catch (err) {
      // Ne pas faire échouer le flux pour une erreur d'affiliation
      this.logger.error(
        '[Affiliate] Erreur calcul commission (handlePaymentSuccess):',
        err,
      );
    }
  }

  // ==========================================================================
  // ✅ ACTIVER L'UPGRADE (APRÈS PAIEMENT RÉUSSI)
  // ==========================================================================

  async activateUpgrade(
    companyId: string,
    plan: 'BASIC' | 'PRO' | 'ENTERPRISE',
    billingPeriod: 'monthly' | 'yearly',
  ) {
    this.logger.log(
      `✅ Activating upgrade for company: ${companyId} to ${plan}`,
    );

    const planConfig = PLANS[plan];
    const now = new Date();
    const periodEnd = new Date(now);

    if (billingPeriod === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const currentSubscription = await this.prisma.subscription.findUnique({
      where: { companyId },
    });

    if (!currentSubscription) {
      throw new NotFoundException('Aucun abonnement trouvé');
    }

    await this.prisma.subscription.update({
      where: { companyId },
      data: {
        plan,
        status: 'ACTIVE',
        pricePerMonth: planConfig.priceMonthly,
        trialEndsAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      },
    });

    this.logger.log(
      `🎉 Upgrade activated - Plan: ${plan} until ${periodEnd.toISOString()}`,
    );
  }

  // ==========================================================================
  // 📊 RÉCUPÉRER L'ABONNEMENT D'UNE ENTREPRISE
  // ==========================================================================

  async getSubscription(companyId: string) {
    // ── PME gérée par cabinet → abonnement synthétique ──────────────────────
    // La PME n'a pas de Subscription propre.
    // Son accès est garanti par le CabinetSubscription de son cabinet.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { managedByCabinet: true, cabinetId: true },
    });

    if (company?.managedByCabinet && company.cabinetId) {
      const cabinetSub = await this.prisma.cabinetSubscription
        .findUnique({
          where: { cabinetId: company.cabinetId },
          include: { cabinet: { select: { name: true } } },
        })
        .catch(() => null);

      const isActive =
        !cabinetSub || ['ACTIVE', 'TRIALING'].includes(cabinetSub.status);
      const periodEnd =
        cabinetSub?.currentPeriodEnd ?? new Date(Date.now() + 30 * 86_400_000);

      return {
        id: cabinetSub?.id ?? 'cabinet-managed',
        companyId,
        plan: 'ENTERPRISE' as const,
        status: isActive ? 'ACTIVE' : 'PAST_DUE',
        startDate: cabinetSub?.startDate ?? new Date(),
        currentPeriodStart: cabinetSub?.currentPeriodStart ?? new Date(),
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        pricePerMonth: 0,
        currency: 'XAF',
        isCabinetManaged: true,
        cabinetName: cabinetSub?.cabinet?.name ?? null,
        payments: [],
        daysLeftInTrial: 0,
        planDetails: PLANS['ENTERPRISE'] ?? {
          name: 'Cabinet géré',
          limits: {
            maxEmployees: -1,
            maxUsers: -1,
            maxDepartments: -1,
            maxJobOffers: -1,
            hasEmployeeManualCreate: true,
            hasEmployeeImportExcel: true,
            hasAttendanceGPS: true,
            hasAttendanceManual: true,
            hasAttendanceCorrections: true,
            hasLeaveManagement: true,
            hasPayrollIndividual: false,
            hasPayrollBulk: false,
            hasPayrollExport: false,
            hasPayrollAccountingExport: false,
            hasRecruitmentManual: true,
            hasRecruitmentAI: true,
            hasDocumentManagement: true,
            hasDocumentUnlimited: true,
            hasAssetManagement: true,
            hasPerformanceReviews: true,
            hasTraining: true,
            hasOnboarding: true,
            hasLoansAndAdvances: true,
            hasReportsBasic: true,
            hasReportsAnalytics: true,
            hasEmailNotifications: true,
            hasEmailAutomation: false,
            hasEmployeeExport: true,
          },
        },
      };
    }
    // ── fin bypass ───────────────────────────────────────────────────────────

    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Aucun abonnement trouvé');
    }

    let daysLeftInTrial = 0;
    if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
      const diff = subscription.trialEndsAt.getTime() - new Date().getTime();
      daysLeftInTrial = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    return {
      ...subscription,
      planDetails: PLANS[subscription.plan],
      daysLeftInTrial,
    };
  }

  // ==========================================================================
  // 📊 RÉCUPÉRER LES STATS D'UTILISATION
  // ==========================================================================

  async getUsageStats(companyId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
    });

    if (!subscription) {
      throw new NotFoundException('Aucun abonnement trouvé');
    }

    const planLimits = PLANS[subscription.plan].limits;

    const [employeesCount, usersCount, departmentsCount, jobOffersCount] =
      await Promise.all([
        this.prisma.employee.count({ where: { companyId } }),
        this.prisma.user.count({ where: { companyId } }),
        this.prisma.department.count({ where: { companyId } }),
        this.prisma.jobOffer.count({ where: { companyId } }),
      ]);

    return {
      plan: subscription.plan,
      status: subscription.status,
      limits: {
        employees: {
          current: employeesCount,
          max: planLimits.maxEmployees,
          percentage:
            planLimits.maxEmployees === -1
              ? 0
              : Math.round((employeesCount / planLimits.maxEmployees) * 100),
        },
        users: {
          current: usersCount,
          max: planLimits.maxUsers,
          percentage:
            planLimits.maxUsers === -1
              ? 0
              : Math.round((usersCount / planLimits.maxUsers) * 100),
        },
        departments: {
          current: departmentsCount,
          max: planLimits.maxDepartments,
          percentage:
            planLimits.maxDepartments === -1
              ? 0
              : Math.round(
                  (departmentsCount / planLimits.maxDepartments) * 100,
                ),
        },
        jobOffers: {
          current: jobOffersCount,
          max: planLimits.maxJobOffers,
          percentage:
            planLimits.maxJobOffers === -1
              ? 0
              : Math.round((jobOffersCount / planLimits.maxJobOffers) * 100),
        },
      },
      features: planLimits,
    };
  }

  // ==========================================================================
  // ❌ ANNULER UN ABONNEMENT
  // ==========================================================================

  async cancelSubscription(companyId: string, userId: string) {
    this.logger.log(`❌ Canceling subscription for company: ${companyId}`);

    await this.prisma.subscription.update({
      where: { companyId },
      data: {
        plan: 'FREE',
        status: 'CANCELED',
        canceledAt: new Date(),
        pricePerMonth: 0,
        trialEndsAt: null,
      },
    });

    this.logger.log('✅ Subscription canceled');
  }

  // ==========================================================================
  // 🔔 ACTIVER LE PAIEMENT VIA WEBHOOK (SANS COMPANYID)
  // ==========================================================================

  async activatePaymentByWebhook(webhookData: {
    intentId: string;
    chargeId: string;
    transactionId: string;
    financialTransactionId: string;
    amount: number;
    currency: string;
    status: string;
  }) {
    this.logger.log('🔔 ============================================');
    this.logger.log('🔔 ACTIVATING PAYMENT FROM WEBHOOK');
    this.logger.log('🔔 ============================================');
    this.logger.log(`🔔 Intent ID: ${webhookData.intentId}`);
    this.logger.log(`🔔 Charge ID: ${webhookData.chargeId}`);
    this.logger.log(`🔔 Amount: ${webhookData.amount} ${webhookData.currency}`);

    // Chercher d'abord par intentId
    let payment = await this.prisma.payment.findFirst({
      where: { yabetooIntentId: webhookData.intentId },
      include: { subscription: true },
    });

    // Fallback : chercher par montant + devise + statut PENDING ou PROCESSING
    if (!payment) {
      this.logger.warn(
        `⚠️ Payment not found by intentId, searching by amount...`,
      );
      payment = await this.prisma.payment.findFirst({
        where: {
          amount: webhookData.amount,
          currency: webhookData.currency.toUpperCase(),
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        orderBy: { createdAt: 'desc' },
        include: { subscription: true },
      });
    }

    if (!payment) {
      this.logger.error(
        `❌ Payment not found for intent: ${webhookData.intentId} / amount: ${webhookData.amount}`,
      );
      throw new NotFoundException('Paiement introuvable');
    }

    this.logger.log(`✅ Payment found: ${payment.id}`);
    this.logger.log(`📊 Company: ${payment.companyId}`);

    // Mettre à jour le paiement
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        paidAt: new Date(),
        yabetooChargeId: webhookData.chargeId,
        yabetooTransactionId: webhookData.transactionId,
        yabetooFinancialTxId: webhookData.financialTransactionId,
      },
    });

    this.logger.log('✅ Payment updated with webhook data');

    // Activer l'abonnement
    const metadata = payment.metadata as any;
    const { plan, billingPeriod } = metadata;

    this.logger.log(
      `🚀 Activating subscription - Plan: ${plan}, Period: ${billingPeriod}`,
    );

    await this.activateUpgrade(payment.companyId, plan, billingPeriod);

    // ─── COMMISSION AFFILIÉ ────────────────────────────────────────────────
    try {
      await this.affiliateService.handleSuccessfulPayment(payment.id);
    } catch (err) {
      // Ne pas faire échouer le webhook pour une erreur d'affiliation
      this.logger.error('[Affiliate] Erreur calcul commission (webhook):', err);
    }

    this.logger.log('🎉 ============================================');
    this.logger.log('🎉 SUBSCRIPTION ACTIVATED VIA WEBHOOK');
    this.logger.log(`🎉 Company: ${payment.companyId} - Plan: ${plan}`);
    this.logger.log('🎉 ============================================');

    return {
      success: true,
      paymentId: payment.id,
      companyId: payment.companyId,
      plan,
    };
  }

  // ==========================================================================
  // 💳 RÉCUPÉRER L'HISTORIQUE DES PAIEMENTS
  // ==========================================================================

  async getPaymentHistory(companyId: string) {
    return this.prisma.payment.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================================================
  // 📋 RÉCUPÉRER TOUS LES PLANS DISPONIBLES
  // ==========================================================================

  getAvailablePlans() {
    return { plans: PLANS };
  }
}
