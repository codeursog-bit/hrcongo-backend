// ============================================================================
// src/platform-settings/platform-settings.service.ts  (remplace le fichier)
// Réglages plateforme (ligne unique, id=1), modifiables par le super admin.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 1;
const DEFAULTS = { preShiftReminderMinutes: 20, paymentProvider: 'YABETOOPAY' as const };

export type SubscriptionPaymentProvider = 'YABETOOPAY' | 'MOTEKI' | 'CHARIOW';

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(private prisma: PrismaService) {}

  /** Crée la ligne unique si elle n'existe pas encore, sinon la retourne. */
  async get() {
    const existing = await this.prisma.platformSettings.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (existing) return existing;

    return this.prisma.platformSettings.create({
      data: { id: SINGLETON_ID, ...DEFAULTS },
    });
  }

  async update(
    data: { preShiftReminderMinutes?: number; paymentProvider?: SubscriptionPaymentProvider },
    actorUserId: string,
  ) {
    const updated = await this.prisma.platformSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...DEFAULTS, ...data, updatedByUserId: actorUserId },
      update: { ...data, updatedByUserId: actorUserId },
    });
    this.logger.log(`⚙️ Réglages plateforme mis à jour par ${actorUserId}: ${JSON.stringify(data)}`);
    return updated;
  }
}
