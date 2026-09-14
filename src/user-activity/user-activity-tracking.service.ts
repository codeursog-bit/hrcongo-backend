// ============================================================================
// Fichier: backend/src/user-activity/user-activity-tracking.service.ts
// ============================================================================
// Suit la présence ("en ligne maintenant") et le temps actif quotidien des
// utilisateurs. Appelé en fire-and-forget par ActivityTrackingInterceptor —
// ne doit JAMAIS lever d'exception ni ralentir une requête réelle.

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Écart max entre deux requêtes pour considérer que l'utilisateur est resté
// actif entre les deux (sinon on suppose qu'il était parti — ce trou ne
// compte pas dans le temps actif).
const INACTIVITY_GAP_MINUTES = 5;

// On ne retouche la base qu'une fois toutes les N secondes par utilisateur,
// même s'il fait 50 requêtes dans l'intervalle — évite de saturer la DB.
const DEBOUNCE_MS = 45_000;

// La map de débounce est nettoyée à cet intervalle pour ne pas grossir
// indéfiniment (sinon : une entrée par utilisateur ayant jamais fait une
// requête, jamais libérée — petite fuite mémoire lente sur des mois).
const CLEANUP_INTERVAL_MS = 10 * 60_000;

@Injectable()
export class UserActivityTrackingService implements OnModuleDestroy {
  private readonly logger = new Logger(UserActivityTrackingService.name);
  // En mémoire uniquement — un redémarrage remet à zéro, sans conséquence
  // (pire cas : une mise à jour en plus juste après redémarrage).
  private lastProcessed = new Map<string, number>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {
    this.cleanupTimer = setInterval(() => this.cleanupStaleEntries(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.(); // ne bloque jamais l'arrêt propre du process
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  private cleanupStaleEntries(): void {
    const cutoff = Date.now() - CLEANUP_INTERVAL_MS;
    let removed = 0;
    for (const [userId, ts] of this.lastProcessed) {
      if (ts < cutoff) {
        this.lastProcessed.delete(userId);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`🧹 ${removed} entrée(s) de débounce nettoyée(s)`);
    }
  }

  /** Fire-and-forget — l'appelant ne doit jamais attendre ni catch cette promesse. */
  track(userId: string, companyId?: string | null): void {
    const now = Date.now();
    const last = this.lastProcessed.get(userId);
    if (last && now - last < DEBOUNCE_MS) return; // trop tôt, on ignore ce tick

    this.lastProcessed.set(userId, now);
    this.persist(userId, companyId).catch((err) => {
      this.logger.warn(`Tracking activité échoué pour ${userId}: ${err?.message ?? err}`);
    });
  }

  private async persist(userId: string, companyId?: string | null): Promise<void> {
    const nowDate = new Date();
    const today = this.todayStr(nowDate);

    // Présence temps réel — utilisée pour "en ligne maintenant"
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: nowDate },
    });

    const existing = await this.prisma.dailyUserActivity.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!existing) {
      await this.prisma.dailyUserActivity.create({
        data: {
          userId,
          companyId: companyId ?? null,
          date: today,
          firstSeenAt: nowDate,
          lastSeenAt: nowDate,
          activeMinutes: 0,
          requestCount: 1,
        },
      });
      return;
    }

    const gapMinutes = (nowDate.getTime() - existing.lastSeenAt.getTime()) / 60_000;
    const addMinutes = gapMinutes > 0 && gapMinutes <= INACTIVITY_GAP_MINUTES ? gapMinutes : 0;

    await this.prisma.dailyUserActivity.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: nowDate,
        activeMinutes: existing.activeMinutes + addMinutes,
        requestCount: { increment: 1 },
      },
    });
  }

  private todayStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}