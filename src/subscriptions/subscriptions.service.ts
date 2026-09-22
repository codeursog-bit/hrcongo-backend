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
import { MotekiService } from '../payments/moteki.service';
import { ChariowService } from '../payments/chariow.service';
import { PLANS, getPlanPrice } from './config/plans.config';
import { getMotekiPlanRef } from './config/moteki.config';
import { getChariowProductId } from './config/chariow.config';
import { UpgradeCheckoutDto } from './dto/upgrade-checkout.dto';
import { MotekiCheckoutDto } from './dto/moteki-checkout.dto';
import { ChariowCheckoutDto } from './dto/chariow-checkout.dto';
import { randomUUID } from 'crypto';
import { AffiliateService } from '../affiliate/affiliate.service'; // ← AJOUT
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private yabetooPayService: YabetooPayService, // ← conservé UNIQUEMENT pour l'historique + les versements affiliés
    private motekiService: MotekiService, // ← prestataire de collecte des paiements d'abonnement
    private chariowService: ChariowService, // ← 3e prestataire de collecte, en redondance de Moteki
    private configService: ConfigService,
    private affiliateService: AffiliateService, // ← AJOUT
    private notificationsService: NotificationsService, // ← rappels J-7/J-3/J-1
    private mailService: MailService, // ← rappels par email (module global, pas d'import module requis)
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
  // ⏰ VÉRIFIER ET DOWNGRADE LES ESSAIS + ABONNEMENTS PAYANTS EXPIRÉS (CRON)
  // ==========================================================================
  //
  // 🐛 CORRECTIF : cette méthode ne traitait auparavant que les essais
  // (status TRIALING). Un abonnement PAYANT (BASIC/PRO/ENTERPRISE, status
  // ACTIVE) dont `currentPeriodEnd` était dépassé restait donc "ACTIVE" pour
  // toujours si le client ne renouvelait pas — l'app continuait de lui
  // accorder tous les accès du plan payant indéfiniment. On traite
  // maintenant les deux cas et on redescend systématiquement vers FREE
  // (= "on limite l'accès" plutôt que de couper l'app) quand la période
  // payée ou l'essai est terminé sans renouvellement.
  // ==========================================================================

  async checkExpiredSubscriptions() {
    this.logger.log('⏰ Checking for expired trials / paid subscriptions...');

    const now = new Date();

    // 1) Essais gratuits expirés
    const expiredTrials = await this.prisma.subscription.findMany({
      where: { status: 'TRIALING', trialEndsAt: { lte: now } },
    });

    for (const trial of expiredTrials) {
      await this.prisma.subscription.update({
        where: { id: trial.id },
        data: {
          plan: 'FREE',
          status: 'ACTIVE',
          pricePerMonth: 0,
          trialEndsAt: null,
          downgradedAt: now,
        },
      });
      this.logger.log(
        `📉 Essai expiré : company ${trial.companyId} → FREE`,
      );
    }

    // 2) Abonnements payants dont la période payée est terminée et qui
    //    n'ont pas été renouvelés à temps (voir activateUpgrade : un
    //    renouvellement à temps repousse déjà currentPeriodEnd, donc ne
    //    remonte jamais ici).
    const expiredPaid = await this.prisma.subscription.findMany({
      where: {
        plan: { not: 'FREE' },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        currentPeriodEnd: { lte: now },
      },
    });

    for (const sub of expiredPaid) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { plan: 'FREE', status: 'ACTIVE', pricePerMonth: 0, downgradedAt: now },
      });
      this.logger.log(
        `📉 Abonnement ${sub.plan} non renouvelé : company ${sub.companyId} → FREE`,
      );

      // Notifie l'admin/RH que l'entreprise est repassée en Gratuit
      // (in-app + email — le mail reste le canal fiable si l'admin ne
      // rouvre pas l'appli tout de suite).
      try {
        const dedupKey = `subscription-expired:${sub.companyId}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}`;
        if (await this.notificationsService.tryClaim(dedupKey)) {
          await this.notificationsService.createForGroup(
            sub.companyId,
            ['ADMIN', 'HR_MANAGER'],
            {
              type: 'SUBSCRIPTION_EXPIRED',
              title: 'Votre abonnement est terminé',
              message: `Votre forfait ${PLANS[sub.plan]?.name ?? sub.plan} n'a pas été renouvelé. Votre entreprise est repassée sur le plan Gratuit — certaines fonctionnalités et actions sont désormais limitées. Renouvelez à tout moment pour retrouver un accès complet.`,
              link: '/parametres/subscription',
            },
          );

          const recipients = await this.getAdminRecipients(sub.companyId);
          for (const r of recipients) {
            this.mailService
              .sendSubscriptionExpired({
                to: r.email,
                firstName: r.firstName,
                planName: PLANS[sub.plan]?.name ?? sub.plan,
              })
              .catch((err) =>
                this.logger.error(`Échec email abonnement expiré → ${r.email}:`, err),
              );
          }
        }
      } catch (err) {
        this.logger.error('Erreur notification abonnement expiré:', err);
      }
    }

    return {
      downgradedTrials: expiredTrials.length,
      downgradedPaid: expiredPaid.length,
    };
  }

  // ==========================================================================
  // 📧 HELPER : destinataires admin/RH d'une entreprise (pour les rappels)
  // ==========================================================================

  private async getAdminRecipients(
    companyId: string,
  ): Promise<{ email: string; firstName: string }[]> {
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: ['ADMIN', 'HR_MANAGER'] },
        isActive: true,
      },
      select: { email: true, firstName: true },
    });
    return users;
  }

  // ==========================================================================
  // 🔔 RAPPELS AVANT ÉCHÉANCE — J-7 / J-3 / J-1 (essai ET abonnement payant)
  // ==========================================================================
  //
  // Envoie un rappel doux, une seule fois par palier (dédoublonné via
  // NotificationDedupKey, qui survit à la lecture/suppression des
  // notifications côté utilisateur), à J-7, J-3 et J-1 avant la fin de
  // l'essai OU de la période payée en cours — pas seulement l'essai comme
  // avant.
  // ==========================================================================

  private readonly REMINDER_THRESHOLDS = [7, 3, 1] as const;

  async sendRenewalReminders() {
    this.logger.log("🔔 Vérification des rappels d'échéance J-7/J-3/J-1...");

    const now = new Date();
    let alertsSent = 0;

    // Bornes larges : on affine ensuite jour par jour pour matcher pile un
    // des 3 paliers (évite d'envoyer le rappel plusieurs jours de suite).
    const maxWindow = new Date(now);
    maxWindow.setDate(maxWindow.getDate() + this.REMINDER_THRESHOLDS[0] + 1);

    // Essais en cours qui approchent de leur fin
    const trialsSoon = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIALING',
        trialEndsAt: { gte: now, lte: maxWindow },
      },
    });

    for (const sub of trialsSoon) {
      alertsSent += await this.maybeSendThresholdReminder(
        sub.companyId,
        sub.trialEndsAt!,
        now,
        'essai',
      );
    }

    // Abonnements payants qui approchent de leur fin (et n'ont pas encore
    // été renouvelés à cette date — un renouvellement à temps aura déjà
    // repoussé currentPeriodEnd, donc il ne matchera plus une des fenêtres)
    const paidSoon = await this.prisma.subscription.findMany({
      where: {
        plan: { not: 'FREE' },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        currentPeriodEnd: { gte: now, lte: maxWindow },
      },
    });

    for (const sub of paidSoon) {
      alertsSent += await this.maybeSendThresholdReminder(
        sub.companyId,
        sub.currentPeriodEnd,
        now,
        'abonnement',
        sub.plan,
      );
    }

    this.logger.log(`✅ ${alertsSent} rappel(s) envoyé(s)`);
    return { alerts: alertsSent };
  }

  private async maybeSendThresholdReminder(
    companyId: string,
    endDate: Date,
    now: Date,
    kind: 'essai' | 'abonnement',
    planName?: string,
  ): Promise<number> {
    const daysLeft = Math.ceil(
      (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    const threshold = this.REMINDER_THRESHOLDS.find((t) => t === daysLeft);
    if (!threshold) return 0;

    // Clé d'idempotence ancrée sur la date de fin réelle : si l'entreprise
    // renouvelle, currentPeriodEnd change et la clé change avec elle — pas
    // besoin de "réinitialiser" quoi que ce soit à la main.
    const dedupKey = `subscription-reminder:${companyId}:${endDate.toISOString().slice(0, 10)}:J-${threshold}`;
    const canNotify = await this.notificationsService.tryClaim(dedupKey);
    if (!canNotify) return 0;

    const dayLabel = threshold === 1 ? '1 jour' : `${threshold} jours`;
    const isLastCall = threshold === 1;

    const title =
      kind === 'essai'
        ? `Votre essai gratuit se termine dans ${dayLabel}`
        : `Votre abonnement ${planName ? PLANS[planName]?.name ?? planName : ''} se termine dans ${dayLabel}`;

    const message = isLastCall
      ? `Dernier jour : sans renouvellement demain, votre entreprise repassera automatiquement sur le plan Gratuit et certaines actions (ajout d'employé, paie groupée, pointage...) seront limitées. Renouvelez dès maintenant pour ne rien perdre.`
      : kind === 'essai'
        ? `Il vous reste ${dayLabel} d'essai gratuit. Passez à un forfait payant dès maintenant pour continuer à profiter de toutes les fonctionnalités sans interruption.`
        : `Il vous reste ${dayLabel} avant la fin de votre période payée. Pensez à renouveler pour éviter tout retour automatique au plan Gratuit.`;

    try {
      await this.notificationsService.createForGroup(
        companyId,
        ['ADMIN', 'HR_MANAGER'],
        {
          type: 'SUBSCRIPTION_EXPIRING',
          title,
          message,
          link: '/parametres/subscription',
          metadata: { daysLeft: threshold, kind },
        },
      );

      const recipients = await this.getAdminRecipients(companyId);
      for (const r of recipients) {
        this.mailService
          .sendSubscriptionReminder({
            to: r.email,
            firstName: r.firstName,
            kind,
            planName: planName ? PLANS[planName]?.name ?? planName : undefined,
            daysLeft: threshold,
          })
          .catch((err) =>
            this.logger.error(`Échec email rappel abonnement → ${r.email}:`, err),
          );
      }

      return 1;
    } catch (err) {
      this.logger.error('Erreur envoi rappel abonnement:', err);
      return 0;
    }
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
  // 🛒 MOTEKI — INITIER UN CHECKOUT D'ABONNEMENT (remplace createUpgradeCheckout
  // + confirmPayment : Moteki initie ET déclenche le paiement en un seul appel)
  // ==========================================================================

  async createMotekiCheckout(companyId: string, dto: MotekiCheckoutDto) {
    this.logger.log(
      `🛒 [Moteki v2] Initiation paiement — company: ${companyId} — plan: ${dto.plan} (${dto.billingPeriod})`,
    );

    const currentSubscription = await this.prisma.subscription.findUnique({
      where: { companyId },
    });
    if (!currentSubscription) {
      throw new NotFoundException('Aucun abonnement trouvé');
    }

    const planRef = getMotekiPlanRef(dto.plan, dto.billingPeriod);
    const expectedAmount = getPlanPrice(dto.plan, dto.billingPeriod);
    const planConfig = PLANS[dto.plan];

    // Congo-Brazzaville uniquement pour l'instant (voir profil KonzaRH) —
    // E.164 (+242...) et pays "cg" en dur, comme pour Chariow.
    const rawPhone = (dto.customerPhone ?? '').replace(/\D/g, '');
    const phoneE164 = dto.customerPhone?.startsWith('+')
      ? dto.customerPhone
      : `+242${rawPhone}`;
    const { operator } = this.motekiService.splitOperatorCountry(
      dto.paymentOperator ?? '',
      'cg',
    );

    // 1️⃣ Créer l'intention de paiement (v2) — le montant renvoyé fait foi,
    // re-résolu serveur depuis le produit/plan, pas celui qu'on a envoyé.
    const intent = await this.motekiService.createPaymentIntent({
      productUuid: planRef.digitalProductUuid,
      planIndex: planRef.planIndex,
      customerFirstName: dto.customerFirstName,
      customerLastName: dto.customerLastName,
      customerEmail: dto.customerEmail,
      customerCountry: 'cg',
      customerPhoneE164: phoneE164,
      operator,
    });

    if (intent.amount && intent.amount !== expectedAmount) {
      this.logger.warn(
        `⚠️ [Moteki v2] Montant reçu (${intent.amount}) ≠ tarif attendu (${expectedAmount}) pour ${dto.plan}/${dto.billingPeriod} — vérifier la config des subscription_plans sur le dashboard Moteki.`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId: currentSubscription.id,
        companyId,
        provider: 'MOTEKI',
        motekiOrderId: intent.order_uuid,
        motekiOrderNumber: intent.order_number,
        motekiPaymentReference: intent.payment_reference,
        motekiCustomerEmail: dto.customerEmail,
        amount: intent.amount || expectedAmount,
        currency: 'XAF',
        status: 'PENDING',
        paymentMethod: 'mobile_money',
        paymentMethodDetails: {
          paymentOperator: dto.paymentOperator,
          customerPhone: dto.customerPhone,
        },
        description: `Abonnement ${planConfig.name} - ${dto.billingPeriod === 'yearly' ? 'Annuel' : 'Mensuel'} (Moteki)`,
        metadata: {
          plan: dto.plan,
          billingPeriod: dto.billingPeriod,
          motekiPaymentReference: intent.payment_reference,
        },
      },
    });

    this.logger.log(
      `💾 [Moteki v2] Payment record créé: ${payment.id} — intention ${intent.payment_reference}`,
    );

    // 2️⃣ Confirmer immédiatement — déclenche le push Mobile Money vers le
    // client. On enchaîne les deux appels côté serveur pour garder la même
    // UX qu'avant côté frontend (un seul clic), le client n'a rien de plus
    // à faire que d'approuver le push sur son téléphone (code PIN/USSD).
    const confirm = await this.motekiService.confirmPayment(
      intent.payment_reference,
      phoneE164,
      'cg',
      operator,
    );

    // 3️⃣ On laisse checkAndActivateMotekiOrder faire foi pour la décision
    // d'activation (il rappelle GET .../payments/{ref}, la source de vérité
    // documentée) plutôt que de dupliquer la logique ici avec le retour de
    // confirm — même s'il est déjà synchrone dans certains cas ("succès
    // synchrone (rare)" selon la doc). Ça évite d'avoir deux chemins de code
    // qui décident de l'activation différemment.
    let activationResult: { activated: boolean; status: string } = {
      activated: false,
      status: confirm.status,
    };
    try {
      activationResult = await this.checkAndActivateMotekiOrder(payment.id);
    } catch (err) {
      this.logger.error(
        `[Moteki v2] Échec vérification immédiate après confirm (${payment.id}), le cron réessaiera:`,
        err,
      );
    }

    return {
      paymentId: payment.id,
      paymentReference: intent.payment_reference,
      orderNumber: intent.order_number,
      status: confirm.status, // 'processing' | 'succeeded' | 'failed'
      activated: activationResult.activated,
      // Présents seulement si confirm a échoué tout de suite (ex: PUSH_DENIED)
      code: confirm.code,
      message: confirm.message,
      plan: dto.plan,
      billingPeriod: dto.billingPeriod,
      amount: intent.amount || expectedAmount,
    };
  }

  // ==========================================================================
  // 🔐 HELPER : vérifier qu'un paiement appartient bien à une entreprise
  // (contrôle d'accès pour /moteki/check-order/:paymentId)
  // ==========================================================================

  async getPaymentOwnedByCompany(paymentId: string, companyId: string) {
    return this.prisma.payment.findFirst({
      where: { id: paymentId, companyId },
      select: { id: true },
    });
  }

  // ==========================================================================
  // 🔎 MOTEKI v2 — VÉRIFIER + ACTIVER UN PAIEMENT EN ATTENTE (POLLING)
  // ==========================================================================
  //
  // La doc v2 est explicite : "Pas de webhook pour l'instant... le polling
  // fait foi." On interroge donc GET /api/v2/storefront/payments/{ref} —
  // jamais starts_at/ends_at d'un éventuel abonnement Moteki, qui reste hors
  // de notre contrôle. Dès que payé, on réutilise EXACTEMENT la même
  // logique de calcul de dates que Chariow/YabetooPay (activateUpgrade),
  // puisque c'est un paiement ponctuel comme les autres — Moteki n'est
  // qu'un rail de paiement, jamais la source de vérité pour l'accès.
  // ==========================================================================

  async checkAndActivateMotekiOrder(paymentId: string): Promise<{
    activated: boolean;
    status: string;
  }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment || payment.provider !== 'MOTEKI' || !payment.motekiPaymentReference) {
      throw new NotFoundException('Paiement Moteki introuvable');
    }

    // Idempotence : déjà traité, on ne refait rien.
    if (payment.status === 'SUCCEEDED') {
      return { activated: true, status: 'already_succeeded' };
    }
    if (payment.status === 'FAILED') {
      return { activated: false, status: 'already_failed' };
    }

    const intentStatus = await this.motekiService.getPaymentStatus(
      payment.motekiPaymentReference,
    );

    if (this.motekiService.isPaymentSucceeded(intentStatus)) {
      const { plan, billingPeriod } = (payment.metadata as any) ?? {};
      if (!plan || !billingPeriod) {
        this.logger.error(
          `❌ [Moteki v2] Payment ${payment.id} sans plan/billingPeriod en metadata — activation manuelle requise.`,
        );
        return { activated: false, status: 'missing_metadata' };
      }

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      });

      await this.activateUpgrade(payment.companyId, plan, billingPeriod);

      try {
        await this.affiliateService.handleSuccessfulPayment(payment.id);
      } catch (err) {
        this.logger.error('[Affiliate] Erreur calcul commission (Moteki):', err);
      }

      this.logger.log(
        `🎉 [Moteki v2] Paiement ${payment.motekiPaymentReference} confirmé payé → abonnement activé pour company ${payment.companyId}`,
      );
      return { activated: true, status: 'activated' };
    }

    if (this.motekiService.isPaymentFailed(intentStatus)) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      this.logger.warn(
        `❌ [Moteki v2] Paiement ${payment.motekiPaymentReference} échoué/expiré (status: ${intentStatus.status})`,
      );
      return { activated: false, status: 'failed' };
    }

    // awaiting_confirmation / processing — rien à faire, le prochain
    // passage du cron (ou le prochain appel depuis /success) retentera.
    return { activated: false, status: 'pending' };
  }

  // ==========================================================================
  // ⏰ MOTEKI v2 — CRON : VÉRIFIER TOUS LES PAIEMENTS EN ATTENTE
  // (filet de sécurité — indispensable ici puisqu'il n'y a PAS de webhook v2)
  // ==========================================================================

  async checkPendingMotekiOrders() {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48); // au-delà, on arrête de sonder (probablement abandonné)

    const pending = await this.prisma.payment.findMany({
      where: {
        provider: 'MOTEKI',
        status: 'PENDING',
        motekiPaymentReference: { not: null },
        createdAt: { gte: cutoff },
      },
    });

    let activated = 0;
    for (const payment of pending) {
      try {
        const result = await this.checkAndActivateMotekiOrder(payment.id);
        if (result.activated) activated++;
      } catch (err) {
        this.logger.error(`Erreur vérification paiement Moteki ${payment.id}:`, err);
      }
    }

    // Paiements trop vieux et toujours PENDING → on arrête de les sonder
    // pour de bon (l'intention v2 elle-même expire de toute façon après
    // 15-30 min selon la doc, donc ceux-là seront déjà "expired" côté
    // Moteki bien avant qu'on atteigne les 48h).
    const stale = await this.prisma.payment.updateMany({
      where: {
        provider: 'MOTEKI',
        status: 'PENDING',
        createdAt: { lt: cutoff },
      },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    if (pending.length > 0 || stale.count > 0) {
      this.logger.log(
        `🔎 [Moteki v2] Polling paiements en attente : ${pending.length} vérifiés, ${activated} activé(s), ${stale.count} expiré(s) sans réponse.`,
      );
    }

    return { checked: pending.length, activated, expired: stale.count };
  }

  // ==========================================================================
  // 🔔 MOTEKI — WEBHOOK (best-effort, PAS la source de vérité pour l'instant)
  // ==========================================================================
  //
  // Le webhook Moteki est encore en construction côté eux — on le laisse
  // brancher pour le jour où il sera fiable, mais on ne dépend plus de lui :
  // s'il arrive et qu'on retrouve le paiement correspondant, tant mieux
  // (activation quasi-instantanée) ; sinon, le polling ci-dessus prend le
  // relais de toute façon dans les minutes qui suivent.
  // ==========================================================================

  async handleMotekiPaymentSuccess(
    payment: { id: string; companyId: string; metadata: any },
    motekiSubscriptionId: string,
  ) {
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { motekiSubscriptionId },
    });
    // Réutilise la même logique fiable que le polling — pas de duplication.
    await this.checkAndActivateMotekiOrder(payment.id);
  }

  async handleMotekiPaymentFailed(paymentId: string) {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    this.logger.warn(`❌ [Moteki] Paiement ${paymentId} marqué FAILED (webhook)`);
  }

  // ==========================================================================
  // 🛒 CHARIOW — INITIER UN CHECKOUT D'ABONNEMENT (achat d'une licence)
  // ==========================================================================

  async createChariowCheckout(companyId: string, dto: ChariowCheckoutDto) {
    this.logger.log(
      `🛒 [Chariow] Initiation checkout — company: ${companyId} — plan: ${dto.plan} (${dto.billingPeriod})`,
    );

    const currentSubscription = await this.prisma.subscription.findUnique({
      where: { companyId },
    });
    if (!currentSubscription) {
      throw new NotFoundException('Aucun abonnement trouvé');
    }

    const productId = getChariowProductId(dto.plan, dto.billingPeriod);
    const expectedAmount = getPlanPrice(dto.plan, dto.billingPeriod);
    const planConfig = PLANS[dto.plan];

    // On pré-génère l'id du Payment AVANT d'appeler Chariow, pour pouvoir
    // construire un redirect_url qui pointe directement sur notre page
    // /success avec ce paymentId — contrairement à Moteki (URL de retour
    // fixe configurée sur son dashboard), Chariow accepte un redirect_url
    // personnalisé par requête (voir doc /checkout), donc pas besoin de
    // sessionStorage côté front pour retrouver le contexte.
    const paymentId = randomUUID();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/success?provider=chariow&paymentId=${paymentId}&plan=${dto.plan}`;

    const checkout = await this.chariowService.initiateCheckout({
      productId,
      customerEmail: dto.customerEmail,
      customerFirstName: dto.customerFirstName,
      customerLastName: dto.customerLastName,
      customerPhoneNumber: dto.customerPhoneNumber,
      customerPhoneCountryCode: dto.customerPhoneCountryCode ?? 'CG',
      discountCode: dto.discountCode,
      redirectUrl,
      customMetadata: {
        companyId,
        plan: dto.plan,
        billingPeriod: dto.billingPeriod,
      },
    });

    if (!checkout.payment?.checkout_url) {
      // Un produit "license" payant ne devrait jamais retourner step="completed"
      // directement (ça, c'est réservé aux produits gratuits) — si ça arrive,
      // mieux vaut le savoir tout de suite plutôt que de perdre le paiement.
      this.logger.warn(
        `⚠️ [Chariow] Checkout sans checkout_url pour la vente ${checkout.purchase?.id} — step reçu: ${checkout.step}`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        id: paymentId,
        subscriptionId: currentSubscription.id,
        companyId,
        provider: 'CHARIOW',
        chariowSaleId: checkout.purchase.id,
        chariowProductId: productId,
        chariowCustomerEmail: dto.customerEmail,
        chariowDiscountCode: dto.discountCode,
        amount: expectedAmount,
        currency: 'XAF',
        status: 'PENDING',
        description: `Abonnement ${planConfig.name} - ${dto.billingPeriod === 'yearly' ? 'Annuel' : 'Mensuel'} (Chariow)`,
        metadata: {
          plan: dto.plan,
          billingPeriod: dto.billingPeriod,
          chariowSaleId: checkout.purchase.id,
          discountCode: dto.discountCode,
        },
      },
    });

    this.logger.log(
      `💾 [Chariow] Payment record créé: ${payment.id} — vente ${checkout.purchase.id}`,
    );

    return {
      paymentId: payment.id,
      saleId: checkout.purchase.id,
      status: checkout.purchase.status,
      checkoutUrl: checkout.payment?.checkout_url,
      plan: dto.plan,
      billingPeriod: dto.billingPeriod,
      amount: expectedAmount,
    };
  }

  // ==========================================================================
  // 🔎 CHARIOW — VÉRIFIER + ACTIVER UNE VENTE EN ATTENTE (POLLING)
  // ==========================================================================
  //
  // Même principe que checkAndActivateMotekiOrder : Chariow ne prélève pas
  // automatiquement le client (voir note en tête de chariow.service.ts), donc
  // on ne fait confiance qu'à notre propre appel API pour savoir si la vente
  // est payée — jamais au webhook seul, ni à license.expires_at.
  // ==========================================================================

  async checkAndActivateChariowSale(paymentId: string): Promise<{
    activated: boolean;
    status: string;
  }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment || payment.provider !== 'CHARIOW' || !payment.chariowSaleId) {
      throw new NotFoundException('Paiement Chariow introuvable');
    }

    // Idempotence : déjà traité, on ne refait rien.
    if (payment.status === 'SUCCEEDED') {
      return { activated: true, status: 'already_succeeded' };
    }
    if (payment.status === 'FAILED') {
      return { activated: false, status: 'already_failed' };
    }

    const sale = await this.chariowService.getSale(payment.chariowSaleId);

    if (this.chariowService.isSalePaid(sale)) {
      const { plan, billingPeriod } = (payment.metadata as any) ?? {};
      if (!plan || !billingPeriod) {
        this.logger.error(
          `❌ [Chariow] Payment ${payment.id} sans plan/billingPeriod en metadata — activation manuelle requise.`,
        );
        return { activated: false, status: 'missing_metadata' };
      }

      // ℹ️ GET /sales/{id} ne renvoie pas la licence (contrairement à List
      // Sales, qui a bien un post_purchase.licences) — on n'a donc pas la clé
      // de licence ici. Ce n'est pas bloquant : elle ne sert qu'au suivi/
      // révocation manuelle côté Chariow, jamais à l'accès app. On enregistre
      // simplement le montant réellement encaissé (après réduction) et la
      // référence de transaction pour la traçabilité comptable.
      const actualAmount = Math.round(sale.amount?.value ?? Number(payment.amount));

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(),
          amount: actualAmount,
          chariowDiscountCode: sale.discount?.code ?? payment.chariowDiscountCode,
          metadata: {
            ...((payment.metadata as any) ?? {}),
            chariowTransactionId: sale.payment?.transaction_id ?? null,
            chariowGateway: sale.payment?.gateway ?? null,
            originalAmount: sale.original_amount?.value ?? null,
            discountAmount: sale.discount_amount?.value ?? null,
          },
        },
      });

      // ✅ Même logique d'ancrage de date que Moteki/YabetooPay — un
      // paiement Chariow est un paiement ponctuel comme un autre, la date
      // d'expiration réelle vient de notre propre calcul, pas de Chariow.
      await this.activateUpgrade(payment.companyId, plan, billingPeriod);

      try {
        await this.affiliateService.handleSuccessfulPayment(payment.id);
      } catch (err) {
        this.logger.error('[Affiliate] Erreur calcul commission (Chariow):', err);
      }

      this.logger.log(
        `🎉 [Chariow] Vente ${payment.chariowSaleId} confirmée payée → abonnement activé pour company ${payment.companyId}`,
      );
      return { activated: true, status: 'activated' };
    }

    if (this.chariowService.isSaleFailed(sale)) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      this.logger.warn(`❌ [Chariow] Vente ${payment.chariowSaleId} échouée/annulée`);
      return { activated: false, status: 'failed' };
    }

    // Toujours en attente — rien à faire, le prochain passage du cron
    // (ou le prochain appel depuis /success) retentera.
    return { activated: false, status: 'pending' };
  }

  // ==========================================================================
  // ⏰ CHARIOW — CRON : VÉRIFIER TOUTES LES VENTES EN ATTENTE
  // (filet de sécurité — tourne même si le client ne revient jamais sur
  // /success après avoir payé)
  // ==========================================================================

  async checkPendingChariowSales() {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48); // au-delà, on arrête de sonder (probablement abandonné)

    const pending = await this.prisma.payment.findMany({
      where: {
        provider: 'CHARIOW',
        status: 'PENDING',
        chariowSaleId: { not: null },
        createdAt: { gte: cutoff },
      },
    });

    let activated = 0;
    for (const payment of pending) {
      try {
        const result = await this.checkAndActivateChariowSale(payment.id);
        if (result.activated) activated++;
      } catch (err) {
        this.logger.error(`Erreur vérification vente Chariow ${payment.id}:`, err);
      }
    }

    const stale = await this.prisma.payment.updateMany({
      where: {
        provider: 'CHARIOW',
        status: 'PENDING',
        createdAt: { lt: cutoff },
      },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    if (pending.length > 0 || stale.count > 0) {
      this.logger.log(
        `🔎 [Chariow] Polling ventes en attente : ${pending.length} vérifiée(s), ${activated} activée(s), ${stale.count} expirée(s) sans réponse.`,
      );
    }

    return { checked: pending.length, activated, expired: stale.count };
  }

  // ==========================================================================
  // ✅ ACTIVER L'UPGRADE / LE RENOUVELLEMENT (APRÈS PAIEMENT RÉUSSI)
  // ==========================================================================
  //
  // 🐛 CORRECTIF IMPORTANT : avant, on faisait toujours repartir la période
  // à `now`, y compris quand l'entreprise payait EN AVANCE (ex: abonnement
  // qui finit le 5, paiement effectué le 2). Résultat : les 3 jours restants
  // déjà payés étaient perdus, et selon le moment du paiement dans le mois,
  // l'abonnement pouvait même "glisser" progressivement.
  //
  // Règle appliquée maintenant (ancrage de la nouvelle période) :
  //   - Si c'est un RENOUVELLEMENT DU MÊME PLAN et que la période payée en
  //     cours n'est pas encore terminée (currentPeriodEnd > maintenant) :
  //     la nouvelle période démarre exactement à l'ancienne date de fin —
  //     jamais avant. Ex: fin le 5, paiement le 2 → nouvelle période
  //     5 → 5+cycle (le paiement du 2 ne fait qu'être mis en file, les
  //     jours déjà payés ne sont ni perdus ni comptés deux fois).
  //     Ex: fin le 5, paiement le 8 (après coup) → on repart de maintenant
  //     (8), comme demandé : on ne récupère pas les jours déjà expirés.
  //   - Si c'est un essai, un plan différent (upgrade/downgrade) ou un
  //     abonnement déjà expiré/annulé : la nouvelle période démarre
  //     immédiatement (maintenant), comme un nouvel abonnement classique.
  // ==========================================================================

  async activateUpgrade(
    companyId: string,
    plan: 'BASIC' | 'PRO' | 'ENTERPRISE',
    billingPeriod: 'monthly' | 'yearly',
  ) {
    this.logger.log(
      `✅ Activating upgrade for company: ${companyId} to ${plan} (${billingPeriod})`,
    );

    const planConfig = PLANS[plan];
    const now = new Date();

    const currentSubscription = await this.prisma.subscription.findUnique({
      where: { companyId },
    });

    if (!currentSubscription) {
      throw new NotFoundException('Aucun abonnement trouvé');
    }

    const isTimelyRenewalOfSamePlan =
      currentSubscription.plan === plan &&
      (currentSubscription.status === 'ACTIVE' ||
        currentSubscription.status === 'PAST_DUE') &&
      currentSubscription.currentPeriodEnd.getTime() > now.getTime();

    // Point d'ancrage : fin de la période en cours si elle court encore,
    // sinon maintenant. On ne fait jamais démarrer une nouvelle période
    // AVANT que la précédente ne soit terminée.
    const periodStart = isTimelyRenewalOfSamePlan
      ? currentSubscription.currentPeriodEnd
      : now;

    const periodEnd = new Date(periodStart);
    if (billingPeriod === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    await this.prisma.subscription.update({
      where: { companyId },
      data: {
        plan,
        status: 'ACTIVE',
        billingCycle: billingPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY',
        pricePerMonth: planConfig.priceMonthly,
        trialEndsAt: null,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
        downgradedAt: null, // ré-abonnement confirmé → on efface le marqueur "rétrogradé"
      },
    });

    if (isTimelyRenewalOfSamePlan) {
      this.logger.log(
        `🎉 Renouvellement anticipé pris en compte — nouvelle période ${periodStart.toISOString()} → ${periodEnd.toISOString()} (les jours restants de l'ancienne période n'ont pas été perdus)`,
      );
    } else {
      this.logger.log(
        `🎉 Upgrade activated - Plan: ${plan} until ${periodEnd.toISOString()}`,
      );
    }
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
        daysLeftInPeriod: Math.ceil(
          (periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        ),
        willRevertToFree: false, // géré par le cabinet, pas de "retour au Gratuit" pour la PME elle-même
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

    // 🆕 Jours restants avant la fin de la période EN COURS, essai ou payant
    // confondu — c'est ce champ que le frontend doit utiliser pour le
    // rappel/toast/modal (voir SubscriptionReminderProvider), pas
    // seulement daysLeftInTrial qui ne couvrait que l'essai.
    const referenceEnd =
      subscription.status === 'TRIALING' && subscription.trialEndsAt
        ? subscription.trialEndsAt
        : subscription.currentPeriodEnd;
    const daysLeftInPeriod = referenceEnd
      ? Math.ceil((referenceEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    // 🆕 "Faut-il un rappel visible ?" côté frontend : uniquement pertinent
    // pour un essai ou un plan payant (pas pour quelqu'un qui a choisi FREE
    // volontairement — rien à renouveler dans ce cas).
    const willRevertToFree =
      subscription.status === 'TRIALING' || subscription.plan !== 'FREE';

    return {
      ...subscription,
      planDetails: PLANS[subscription.plan],
      daysLeftInTrial,
      daysLeftInPeriod,
      willRevertToFree,
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

    // 🐛 IMPORTANT (spécifique Moteki) : Moteki renouvelle automatiquement
    // l'abonnement côté client (débit auto au prochain cycle). Si on se
    // contente d'annuler chez nous sans appeler Moteki, le client continue
    // à être débité alors que notre app affiche "annulé". On cherche donc
    // le dernier paiement Moteki réussi de cette entreprise et on annule
    // aussi côté Moteki (best-effort : une erreur ici ne doit pas bloquer
    // l'annulation locale, mais elle est logguée fort pour suivi manuel).
    const lastMotekiPayment = await this.prisma.payment.findFirst({
      where: {
        companyId,
        provider: 'MOTEKI',
        status: 'SUCCEEDED',
        motekiSubscriptionId: { not: null },
      },
      orderBy: { paidAt: 'desc' },
    });

    if (lastMotekiPayment?.motekiSubscriptionId) {
      try {
        await this.motekiService.cancelSubscription(
          lastMotekiPayment.motekiSubscriptionId,
          'Annulé depuis le dashboard entreprise',
        );
        this.logger.log(
          `✅ [Moteki] Abonnement ${lastMotekiPayment.motekiSubscriptionId} annulé côté Moteki`,
        );
      } catch (err) {
        this.logger.error(
          `❌ [Moteki] Échec annulation côté Moteki pour ${lastMotekiPayment.motekiSubscriptionId} — À ANNULER MANUELLEMENT sur le dashboard Moteki pour éviter un débit client non désiré !`,
          err,
        );
      }
    }

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