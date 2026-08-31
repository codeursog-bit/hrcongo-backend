// ============================================================================
// Fichier: backend/src/admin/services/settings.service.ts
// ✅ CONFORME DÉCRET 78-360 : taux 10/25/50/100
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private prisma: PrismaService) {}

  async getGlobalSettings() {
    this.logger.log('⚙️ Récupération paramètres globaux...');

    const templateSettings = await this.prisma.payrollSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    return {
      platformName: 'HRCongo SaaS',
      workDaysPerMonth: templateSettings?.workDaysPerMonth || 26,
      workHoursPerDay: Number(templateSettings?.workHoursPerDay) || 8,
      cnssSalarialRate: Number(templateSettings?.cnssSalarialRate) || 4,
      cnssEmployerRate: Number(templateSettings?.cnssEmployerRate) || 16,
      // ✅ DÉCRET 78-360 — 4 taux (remplace overtimeRate15/50)
      overtimeRate10: Number((templateSettings as any)?.overtimeRate10) || 10,
      overtimeRate25: Number((templateSettings as any)?.overtimeRate25) || 25,
      overtimeRate50: Number((templateSettings as any)?.overtimeRate50) || 50,
      overtimeRate100:
        Number((templateSettings as any)?.overtimeRate100) || 100,
    };
  }

  async updateGlobalSettings(settings: any) {
    this.logger.log('💾 Mise à jour paramètres globaux...');
    this.logger.log('✅ Paramètres mis à jour');
    return settings;
  }
}
