// ============================================================================
// ⏰ CRON JOB - GESTION AUTOMATIQUE DES ESSAIS GRATUITS
// ============================================================================
// Fichier: src/subscriptions/cron/subscription.cron.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionsService } from '../subscriptions.service';

@Injectable()
export class SubscriptionCronService {
  private readonly logger = new Logger(SubscriptionCronService.name);

  constructor(private subscriptionsService: SubscriptionsService) {}

  // ==========================================================================
  // ⏰ VÉRIFIER LES ESSAIS + ABONNEMENTS PAYANTS EXPIRÉS (TOUS LES JOURS À 9H00)
  // ==========================================================================

  @Cron('0 9 * * *', {
    name: 'check-expired-subscriptions',
    timeZone: 'Africa/Brazzaville',
  })
  async handleExpiredSubscriptions() {
    this.logger.log('🔄 Starting expired subscriptions check...');

    try {
      const result = await this.subscriptionsService.checkExpiredSubscriptions();

      this.logger.log(
        `✅ Expired subscriptions processed: ${result.downgradedTrials} essai(s) + ${result.downgradedPaid} abonnement(s) payant(s) → FREE`,
      );
    } catch (error) {
      this.logger.error('❌ Error processing expired subscriptions:', error);
    }
  }

  // ==========================================================================
  // 🔔 ENVOYER LES RAPPELS J-7 / J-3 / J-1 (TOUS LES JOURS À 10H00)
  // ==========================================================================

  @Cron('0 10 * * *', {
    name: 'send-renewal-reminders',
    timeZone: 'Africa/Brazzaville',
  })
  async handleRenewalReminders() {
    this.logger.log("📧 Sending renewal reminders (J-7/J-3/J-1)...");

    try {
      const result = await this.subscriptionsService.sendRenewalReminders();

      this.logger.log(`✅ Alerts sent: ${result.alerts} companies notified`);
    } catch (error) {
      this.logger.error('❌ Error sending alerts:', error);
    }
  }

  // ==========================================================================
  // 🔎 MOTEKI — VÉRIFIER LES COMMANDES EN ATTENTE (TOUTES LES 5 MINUTES)
  // ==========================================================================
  //
  // Filet de sécurité : active l'abonnement dès qu'une commande Moteki
  // PENDING passe payée, même si le client n'est jamais revenu sur
  // /success (qui déclenche déjà une vérification immédiate à l'arrivée —
  // voir GET /subscriptions/moteki/check-order/:paymentId).
  // ==========================================================================

  @Cron('*/5 * * * *', {
    name: 'check-pending-moteki-orders',
    timeZone: 'Africa/Brazzaville',
  })
  async handlePendingMotekiOrders() {
    try {
      const result = await this.subscriptionsService.checkPendingMotekiOrders();
      if (result.checked > 0 || result.expired > 0) {
        this.logger.log(
          `🔎 [Moteki] ${result.checked} commande(s) vérifiée(s), ${result.activated} activée(s), ${result.expired} expirée(s)`,
        );
      }
    } catch (error) {
      this.logger.error('❌ Error checking pending Moteki orders:', error);
    }
  }

  // ==========================================================================
  // 🔎 CHARIOW — VÉRIFIER LES VENTES EN ATTENTE (TOUTES LES 5 MINUTES)
  // ==========================================================================
  //
  // Même filet de sécurité que Moteki, pour le 3e prestataire.
  // ==========================================================================

  @Cron('*/5 * * * *', {
    name: 'check-pending-chariow-sales',
    timeZone: 'Africa/Brazzaville',
  })
  async handlePendingChariowSales() {
    try {
      const result = await this.subscriptionsService.checkPendingChariowSales();
      if (result.checked > 0 || result.expired > 0) {
        this.logger.log(
          `🔎 [Chariow] ${result.checked} vente(s) vérifiée(s), ${result.activated} activée(s), ${result.expired} expirée(s)`,
        );
      }
    } catch (error) {
      this.logger.error('❌ Error checking pending Chariow sales:', error);
    }
  }

  // ==========================================================================
  // 🧹 NETTOYER LES PAIEMENTS ÉCHOUÉS (TOUS LES LUNDIS À 2H00)
  // ==========================================================================

  @Cron('0 2 * * 1', {
    name: 'cleanup-failed-payments',
    timeZone: 'Africa/Brazzaville',
  })
  async handleFailedPaymentsCleanup() {
    this.logger.log('🧹 Cleaning up old failed payments...');

    // TODO: Supprimer les paiements FAILED de plus de 30 jours
  }
}