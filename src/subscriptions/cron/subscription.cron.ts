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
  // ⏰ VÉRIFIER LES ESSAIS EXPIRÉS (TOUS LES JOURS À 9H00)
  // ==========================================================================

  @Cron('0 9 * * *', {
    name: 'check-expired-trials',
    timeZone: 'Africa/Brazzaville',
  })
  async handleExpiredTrials() {
    this.logger.log('🔄 Starting expired trials check...');

    try {
      const result = await this.subscriptionsService.checkExpiredTrials();

      this.logger.log(
        `✅ Expired trials processed: ${result.downgraded} downgraded to FREE`,
      );
    } catch (error) {
      this.logger.error('❌ Error processing expired trials:', error);
    }
  }

  // ==========================================================================
  // 🔔 ENVOYER ALERTES EXPIRATION (TOUS LES JOURS À 10H00)
  // ==========================================================================

  @Cron('0 10 * * *', {
    name: 'send-trial-alerts',
    timeZone: 'Africa/Brazzaville',
  })
  async handleTrialAlerts() {
    this.logger.log('📧 Sending trial expiration alerts...');

    try {
      const result =
        await this.subscriptionsService.sendTrialExpirationAlerts();

      this.logger.log(`✅ Alerts sent: ${result.alerts} companies notified`);
    } catch (error) {
      this.logger.error('❌ Error sending alerts:', error);
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
