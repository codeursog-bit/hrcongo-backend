// ============================================================================
// Fichier: backend/src/admin/services/settings.service.ts
// ============================================================================

import { legalNow } from '../../legal-parameters/legal-parameters.core';
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
      // Valeurs lues dans le référentiel légal (page « Paramètres légaux »).
      legalRates: {
        cnssSalarialRate: +(legalNow().cnss.salarialRate * 100).toFixed(4),
        cnssEmployerRate: +(
          (legalNow().cnss.employerPensionRate +
            legalNow().cnss.employerFamilyRate +
            legalNow().cnss.employerAccidentRate) * 100
        ).toFixed(4),
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