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
import { PLANS, getPlanPrice } from './config/plans.config';
import { getMotekiPlanRef } from './config/moteki.config';
import { UpgradeCheckoutDto } from './dto/upgrade-checkout.dto';
import { MotekiCheckoutDto } from './dto/moteki-checkout.dto';
import { AffiliateService } from '../affiliate/affiliate.service'; // ← AJOUT
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private yabetooPayService: YabetooPayService, // ← conservé UNIQUEMENT pour l'historique + les versements affiliés
    private motekiService: MotekiService, // ← nouveau prestataire pour la collecte des paiements d'abonnement
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
        data: { plan: 'FREE', status: 'ACTIVE', pricePerMonth: 0 },
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
      `🛒 [Moteki] Initiation checkout — company: ${companyId} — plan: ${dto.plan} (${dto.billingPeriod})`,
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

    const order = await this.motekiService.initiateSubscriptionCheckout({
      digitalProductUuid: planRef.digitalProductUuid,
      planIndex: planRef.planIndex,
      customerFirstName: dto.customerFirstName,
      customerLastName: dto.customerLastName,
      customerEmail: dto.customerEmail,
      customerPhone: dto.customerPhone,
      paymentMethod: dto.paymentMethod,
      paymentOperator: dto.paymentOperator,
    });

    // ⚠️ Si Moteki facture un montant différent du tarif attendu côté app
    // (produit mal configuré au dashboard, plan_index décalé, etc.), on
    // logue fort plutôt que d'échouer silencieusement — l'argent part quand
    // même chez Moteki, autant le savoir tout de suite.
    if (order.total_amount && order.total_amount !== expectedAmount) {
      this.logger.warn(
        `⚠️ [Moteki] Montant reçu (${order.total_amount}) ≠ tarif attendu (${expectedAmount}) pour ${dto.plan}/${dto.billingPeriod} — vérifier la config des subscription_plans sur le dashboard Moteki.`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId: currentSubscription.id,
        companyId,
        provider: 'MOTEKI',
        motekiOrderId: order.id,
        motekiOrderNumber: order.order_number,
        motekiCustomerEmail: dto.customerEmail,
        amount: order.total_amount || expectedAmount,
        currency: 'XAF',
        status: 'PENDING',
        paymentMethod: dto.paymentMethod,
        paymentMethodDetails: {
          paymentOperator: dto.paymentOperator,
          customerPhone: dto.customerPhone,
        },
        description: `Abonnement ${planConfig.name} - ${dto.billingPeriod === 'yearly' ? 'Annuel' : 'Mensuel'} (Moteki)`,
        metadata: {
          plan: dto.plan,
          billingPeriod: dto.billingPeriod,
          motekiOrderId: order.id,
          motekiOrderNumber: order.order_number,
        },
      },
    });

    this.logger.log(
      `💾 [Moteki] Payment record créé: ${payment.id} — commande ${order.order_number}`,
    );

    return {
      paymentId: payment.id,
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      checkoutUrl: order.checkout_url || order.redirect_url,
      plan: dto.plan,
      billingPeriod: dto.billingPeriod,
      amount: order.total_amount || expectedAmount,
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
  // 🔎 MOTEKI — VÉRIFIER + ACTIVER UNE COMMANDE EN ATTENTE (POLLING)
  // ==========================================================================
  //
  // 🐛 CORRECTIF ARCHITECTURAL : d'après le développeur de Moteki lui-même,
  // (1) le webhook n'est pas encore fiable ("en construction") et sert
  // seulement à refléter un CHANGEMENT D'ÉTAT d'un abonnement déjà connu,
  // pas à déclencher l'activation initiale ; (2) Moteki NE prélève PAS
  // automatiquement le client à chaque échéance (contrairement à ce que
  // laissait penser leur doc) — chaque paiement est un acte volontaire du
  // client, exactement comme avec YabetooPay.
  //
  // On ne peut donc plus faire confiance à starts_at/ends_at renvoyés par
  // Moteki (pas de renouvellement auto = pas de source de vérité côté eux).
  // La bonne approche : interroger NOUS-MÊMES le statut de la commande via
  // son order_id (qu'on connaît déjà depuis notre propre appel /subscribe —
  // donc la corrélation entreprise↔commande est triviale, pas besoin du
  // webhook pour ça), et dès que payée, réutiliser EXACTEMENT la même
  // logique de calcul de dates que YabetooPay (activateUpgrade, avec son
  // ancrage anti-double-comptage) puisque c'est un paiement ponctuel comme
  // les autres.
  // ==========================================================================

  async checkAndActivateMotekiOrder(paymentId: string): Promise<{
    activated: boolean;
    status: string;
  }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment || payment.provider !== 'MOTEKI' || !payment.motekiOrderId) {
      throw new NotFoundException('Paiement Moteki introuvable');
    }

    // Idempotence : déjà traité, on ne refait rien.
    if (payment.status === 'SUCCEEDED') {
      return { activated: true, status: 'already_succeeded' };
    }
    if (payment.status === 'FAILED') {
      return { activated: false, status: 'already_failed' };
    }

    const order = await this.motekiService.getOrderStatus(payment.motekiOrderId);

    // Les valeurs exactes de payment_status/status ne sont pas garanties à
    // 100% tant que la plateforme est en construction — on couvre les
    // libellés les plus probables plutôt que de se fier à un seul mot.
    const isPaid = ['paid', 'completed', 'succeeded'].includes(
      (order.payment_status || order.status || '').toLowerCase(),
    );
    const isFailed = ['failed', 'cancelled', 'canceled', 'expired'].includes(
      (order.payment_status || order.status || '').toLowerCase(),
    );

    if (isPaid) {
      const { plan, billingPeriod } = (payment.metadata as any) ?? {};
      if (!plan || !billingPeriod) {
        this.logger.error(
          `❌ [Moteki] Payment ${payment.id} sans plan/billingPeriod en metadata — activation manuelle requise.`,
        );
        return { activated: false, status: 'missing_metadata' };
      }

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      });

      // ✅ Même logique d'ancrage de date que YabetooPay — un paiement
      // Moteki est un paiement ponctuel comme un autre.
      await this.activateUpgrade(payment.companyId, plan, billingPeriod);

      try {
        await this.affiliateService.handleSuccessfulPayment(payment.id);
      } catch (err) {
        this.logger.error('[Affiliate] Erreur calcul commission (Moteki):', err);
      }

      this.logger.log(
        `🎉 [Moteki] Commande ${payment.motekiOrderId} confirmée payée → abonnement activé pour company ${payment.companyId}`,
      );
      return { activated: true, status: 'activated' };
    }

    if (isFailed) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      this.logger.warn(`❌ [Moteki] Commande ${payment.motekiOrderId} échouée/annulée`);
      return { activated: false, status: 'failed' };
    }

    // Toujours en attente — rien à faire, le prochain passage du cron
    // (ou le prochain appel depuis /success) retentera.
    return { activated: false, status: 'pending' };
  }

  // ==========================================================================
  // ⏰ MOTEKI — CRON : VÉRIFIER TOUTES LES COMMANDES EN ATTENTE
  // (filet de sécurité — tourne même si le client ne revient jamais sur
  // /success après avoir payé)
  // ==========================================================================

  async checkPendingMotekiOrders() {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48); // au-delà, on arrête de sonder (probablement abandonné)

    const pending = await this.prisma.payment.findMany({
      where: {
        provider: 'MOTEKI',
        status: 'PENDING',
        motekiOrderId: { not: null },
        createdAt: { gte: cutoff },
      },
    });

    let activated = 0;
    for (const payment of pending) {
      try {
        const result = await this.checkAndActivateMotekiOrder(payment.id);
        if (result.activated) activated++;
      } catch (err) {
        this.logger.error(`Erreur vérification commande Moteki ${payment.id}:`, err);
      }
    }

    // Commandes trop vieilles et toujours PENDING → on arrête de les
    // sonder pour de bon (évite de solliciter Moteki indéfiniment pour un
    // panier abandonné).
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
        `🔎 [Moteki] Polling commandes en attente : ${pending.length} vérifiées, ${activated} activée(s), ${stale.count} expirée(s) sans réponse.`,
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