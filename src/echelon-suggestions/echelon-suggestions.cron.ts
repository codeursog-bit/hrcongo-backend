// ============================================================================
// 📁 src/echelon-suggestions/echelon-suggestions.cron.ts
// Pattern identique à src/leaves/cron/leave-accrual.cron.ts pour rester
// cohérent avec le reste du projet.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EchelonSuggestionsService } from './echelon-suggestions.service';

@Injectable()
export class EchelonSuggestionsCron {
  private readonly logger = new Logger(EchelonSuggestionsCron.name);

  constructor(private service: EchelonSuggestionsService) {}

  // Le 1er de chaque mois à 6h00 (Brazzaville) : détecte les paliers
  // d'ancienneté atteints ce mois-ci + reprend les suggestions ignorées le
  // mois précédent, puis étale les dates de notification sur le mois.
  @Cron('0 6 1 * *', { timeZone: 'Africa/Brazzaville' })
  async handleMonthlyGeneration(): Promise<void> {
    this.logger.log("⏰ [CRON] Génération mensuelle des suggestions d'échelon…");
    try {
      await this.service.generateSuggestionsForCurrentMonth();
      this.logger.log('✅ [CRON] Génération terminée');
    } catch (err) {
      this.logger.error('❌ [CRON] Erreur génération suggestions échelon', err);
    }
  }

  // Chaque jour à 7h00 (Brazzaville) : envoie uniquement les notifications
  // programmées pour aujourd'hui — c'est ce qui réalise l'étalement
  // ("5 aujourd'hui, 8 demain") plutôt qu'un envoi groupé le 1er du mois.
  @Cron('0 7 * * *', { timeZone: 'Africa/Brazzaville' })
  async handleDailyNotify(): Promise<void> {
    try {
      await this.service.sendDueNotifications();
    } catch (err) {
      this.logger.error("❌ [CRON] Erreur envoi rappels d'échelon du jour", err);
    }
  }
}