// ============================================================================
// 📁 src/notifications/push-notifications.service.ts
// ============================================================================
// 🔥 KONZA SUITE — Web Push Service (vraies notifications téléphone)
//
// Multi-appareil : un utilisateur peut avoir plusieurs abonnements actifs
// (téléphone perso + tablette bureau, par ex.) — chacun est une ligne
// PushSubscription séparée. S'abonner sur un nouvel appareil n'écrase plus
// les autres.
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
import { SystemLogsService } from '../system-logs/system-logs.service';

@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);
  private vapidConfigured = false;

  constructor(
    private prisma: PrismaService,
    private systemLogs: SystemLogsService,
  ) {}

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
      this.systemLogs.log({
        source: 'push-notifications:startup',
        level: 'ALERT',
        message: 'Clés VAPID manquantes au démarrage — AUCUN push ne peut être envoyé sur toute la plateforme',
      });
      return;
    }

    webpush.setVapidDetails(mailto, publicKey, privateKey);
    this.vapidConfigured = true;
    this.logger.log('✅ Web Push initialisé (VAPID configuré)');
  }

  // ─── Retourne la clé publique VAPID pour le frontend ─────────────────────
  getPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY ?? '';
  }

  // ============================================================================
  // 📱 Enregistrer le token push d'un appareil
  // Appelé depuis le controller quand l'employé clique "Activer". Un nouvel
  // appareil s'AJOUTE aux abonnements existants — il ne les remplace pas.
  // ============================================================================
  async registerToken(
    userId: string,
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    deviceLabel?: string,
  ): Promise<void> {
    const token = JSON.stringify(subscription);

    // upsert par token : si ce même appareil se réabonne (token identique),
    // on met juste à jour lastUsedAt au lieu de créer un doublon.
    await this.prisma.pushSubscription.upsert({
      where: { token },
      create: { userId, token, deviceLabel },
      update: { lastUsedAt: new Date(), deviceLabel },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { pushNotifEnabled: true },
    });

    this.logger.log(`📲 Appareil push enregistré pour userId: ${userId}`);
  }

  // ============================================================================
  // 🔕 Supprimer l'abonnement d'UN appareil (pas les autres)
  // `endpoint` permet de cibler l'appareil courant précisément. Sans
  // `endpoint` (vieux client, compat), on retire tous les appareils de
  // l'utilisateur — comportement de l'ancienne version à champ unique.
  // ============================================================================
  async unregisterToken(userId: string, endpoint?: string): Promise<void> {
    if (endpoint) {
      const subs = await this.prisma.pushSubscription.findMany({
        where: { userId },
        select: { id: true, token: true },
      });
      const match = subs.find((s) => {
        try {
          return JSON.parse(s.token).endpoint === endpoint;
        } catch {
          return false;
        }
      });
      if (match) {
        await this.prisma.pushSubscription.delete({ where: { id: match.id } });
      }
    } else {
      await this.prisma.pushSubscription.deleteMany({ where: { userId } });
    }

    const remaining = await this.prisma.pushSubscription.count({ where: { userId } });
    if (remaining === 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { pushNotifEnabled: false },
      });
    }

    this.logger.log(`🔕 Abonnement push retiré pour userId: ${userId} (${remaining} appareil(s) restant(s))`);
  }

  // ============================================================================
  // 🚀 Envoyer une notification push à un utilisateur — sur TOUS ses appareils
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
    if (!this.vapidConfigured) {
      // Déjà loggé en ALERT au démarrage — pas la peine de spammer les logs
      // à chaque tentative d'envoi, juste sortir proprement.
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushNotifEnabled: true },
    });
    if (!user?.pushNotifEnabled) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) return;

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

    // Chaque appareil est indépendant : un échec sur l'un ne doit jamais
    // empêcher l'envoi aux autres.
    await Promise.all(
      subscriptions.map((sub) => this.sendToOneSubscription(sub, pushPayload, userId, payload.title)),
    );
  }

  private async sendToOneSubscription(
    sub: { id: string; token: string },
    pushPayload: string,
    userId: string,
    title: string,
  ): Promise<void> {
    let subscription: webpush.PushSubscription;
    try {
      subscription = JSON.parse(sub.token) as webpush.PushSubscription;
    } catch {
      this.logger.warn(`⚠️  Token push illisible (id: ${sub.id}) pour userId: ${userId}`);
      await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      await this.systemLogs.log({
        source: 'push-notifications:send',
        level: 'WARNING',
        message: `Token push illisible (JSON invalide) pour userId ${userId} — appareil retiré`,
      });
      return;
    }

    try {
      await webpush.sendNotification(subscription, pushPayload);
      this.logger.log(`✅ Push envoyé → userId: ${userId} | "${title}"`);
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        this.logger.warn(`🗑️  Abonnement push expiré (id: ${sub.id}) pour userId: ${userId} — suppression`);
        await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});

        const remaining = await this.prisma.pushSubscription.count({ where: { userId } });
        if (remaining === 0) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { pushNotifEnabled: false },
          }).catch(() => {});
        }

        await this.systemLogs.log({
          source: 'push-notifications:send',
          level: 'WARNING',
          message: `Abonnement push expiré (${err.statusCode}) pour userId ${userId} — un appareil retiré, ${remaining} restant(s)`,
          details: { evaluated: 1, skipped: [{ employeeId: userId, reason: `Abonnement expiré (HTTP ${err.statusCode})` }] },
        });
      } else {
        this.logger.error(`❌ Erreur push pour userId: ${userId}:`, err.message);
        await this.systemLogs.log({
          source: 'push-notifications:send',
          level: 'ERROR',
          message: `Échec d'envoi push pour userId ${userId} : ${err.message}`,
          details: { errors: [String(err?.stack ?? err)] },
        });
      }
    }
  }
}