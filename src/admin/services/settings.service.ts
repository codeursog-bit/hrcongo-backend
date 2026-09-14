// ============================================================================
// Fichier: backend/src/admin/services/settings.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private platformSettings: PlatformSettingsService) {}

  async getGlobalSettings() {
    this.logger.log('⚙️ Récupération réglages plateforme...');
    const settings = await this.platformSettings.get();

    return {
      // Réglage réel, modifiable — remplace l'ancienne fausse valeur figée.
      preShiftReminderMinutes: settings.preShiftReminderMinutes,
      updatedAt: settings.updatedAt,

      // Taux légaux (Décret 78-360) — identiques pour toutes les entreprises
      // par la loi, donc affichés ici à titre de référence, non modifiables
      // depuis cet écran (ce ne sont pas des "réglages plateforme").
      legalRates: {
        cnssSalarialRate: 4,
        cnssEmployerRate: 16,
        overtimeRate10: 10,
        overtimeRate25: 25,
        overtimeRate50: 50,
        overtimeRate100: 100,
      },
    };
  }

  async updateGlobalSettings(
    data: { preShiftReminderMinutes?: number },
    actorUserId: string,
  ) {
    this.logger.log(`💾 Mise à jour réglages plateforme: ${JSON.stringify(data)}`);
    return this.platformSettings.update(data, actorUserId);
  }
}