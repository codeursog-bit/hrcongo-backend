// ============================================================================
// 📁 src/notifications/push-notifications.service.ts
// ============================================================================
// 🔥 KONZA SUITE — Web Push Service (vraies notifications téléphone)
//
// Prérequis :
//   npm install web-push
//   npm install --save-dev @types/web-push
//
// Variables d'environnement à ajouter dans ton .env :
//   VAPID_PUBLIC_KEY=   ← généré via: npx web-push generate-vapid-keys
//   VAPID_PRIVATE_KEY=  ← idem
//   VAPID_MAILTO=mailto:ton@email.com
// ============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';

@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Initialisation VAPID au démarrage du module ──────────────────────────
  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const mailto = process.env.VAPID_MAILTO ?? 'mailto:contact@konzasuite.com';

    if (!publicKey || !privateKey) {
      this.logger.warn(
        '⚠️  VAPID keys manquantes — Push notifications désactivées.',
      );
      this.logger.warn(
        '   Génère tes clés avec : npx web-push generate-vapid-keys',
      );
      return;
    }

    webpush.setVapidDetails(mailto, publicKey, privateKey);
    this.logger.log('✅ Web Push initialisé (VAPID configuré)');
  }

  // ─── Retourne la clé publique VAPID pour le frontend ─────────────────────
  getPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY ?? '';
  }

  // ============================================================================
  // 📱 Enregistrer le token push d'un appareil
  // Appelé depuis le controller quand l'employé clique "Activer"
  // ============================================================================
  async registerToken(
    userId: string,
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pushToken: JSON.stringify(subscription),
        pushNotifEnabled: true,
      },
    });

    this.logger.log(`📲 Push token enregistré pour userId: ${userId}`);
  }

  // ============================================================================
  // 🔕 Supprimer le token push d'un appareil
  // ============================================================================
  async unregisterToken(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pushToken: null,
        pushNotifEnabled: false,
      },
    });

    this.logger.log(`🔕 Push token supprimé pour userId: ${userId}`);
  }

  // ============================================================================
  // 🚀 Envoyer une notification push à un utilisateur
  // C'est LA méthode centrale — appelée depuis AttendanceCronService
  // ============================================================================
  async sendPushToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      url?: string;
      tag?: string;
      requireInteraction?: boolean;
      actions?: { action: string; title: string }[];
      // Pour les boutons "Oubli" / "Heures sup" dans la notif native
      actionUrls?: Record<string, string>;
    },
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true, pushNotifEnabled: true },
    });

    if (!user?.pushToken || !user.pushNotifEnabled) return;

    let subscription: webpush.PushSubscription;
    try {
      subscription = JSON.parse(user.pushToken) as webpush.PushSubscription;
    } catch {
      this.logger.warn(`⚠️  Token push invalide pour userId: ${userId}`);
      return;
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? '/',
      tag: payload.tag ?? 'konza-notif',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      requireInteraction: payload.requireInteraction ?? false,
      actions: payload.actions ?? [],
      // URLs pour chaque bouton d'action (lu par sw.js)
      ...payload.actionUrls,
    });

    try {
      await webpush.sendNotification(subscription, pushPayload);
      this.logger.log(
        `✅ Push envoyé → userId: ${userId} | "${payload.title}"`,
      );
    } catch (err: any) {
      // Token expiré ou révoqué → nettoyer
      if (err.statusCode === 410 || err.statusCode === 404) {
        this.logger.warn(
          `🗑️  Token push expiré pour userId: ${userId} — suppression`,
        );
        await this.unregisterToken(userId);
      } else {
        this.logger.error(
          `❌ Erreur push pour userId: ${userId}:`,
          err.message,
        );
      }
    }
  }
}
