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
      // userId aussi : si un autre compte se connecte sur le même appareil, le token lui est rattaché
      update: { userId, lastUsedAt: new Date(), deviceLabel },
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
      await this.recordDelivery(userId, payload, 'NO_VAPID');
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushNotifEnabled: true },
    });
    if (!user?.pushNotifEnabled) {
      await this.recordDelivery(userId, payload, 'DISABLED');
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) {
      await this.recordDelivery(userId, payload, 'NO_DEVICE');
      return;
    }

    // 🆕 On crée la trace AVANT l'envoi pour glisser son id dans la notification : le service
    // worker de l'appareil s'en servira pour confirmer que la notification s'est bien affichée.
    const deliveryId = await this.createPendingDelivery(userId, payload, subscriptions.length);
    const apiPublicUrl = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');

    const pushPayload = JSON.stringify({
      ...(deliveryId && apiPublicUrl
        ? { ackId: deliveryId, ackUrl: `${apiPublicUrl}/push/ack/${deliveryId}` }
        : {}),
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
    const results = await Promise.all(
      subscriptions.map((sub) => this.sendToOneSubscription(sub, pushPayload, userId, payload.title)),
    );

    // 🆕 Trace de l'envoi (consultable dans le super admin). « SENT » = accepté par le service
    // push du navigateur/téléphone (FCM, Mozilla, Apple) : c'est la preuve la plus fiable côté serveur.
    const ok = results.filter((r) => r.ok).length;
    const status =
      ok === results.length ? 'SENT'
      : ok > 0 ? 'PARTIAL'
      : results.every((r) => r.expired) ? 'EXPIRED'
      : 'FAILED';
    await this.finishDelivery(
      deliveryId,
      userId,
      payload,
      status,
      results.length,
      ok,
      results.find((r) => !r.ok)?.error,
    );
  }

  /** Crée la ligne de suivi « PENDING » avant l'envoi (renvoie son id, ou null si la base refuse). */
  private async createPendingDelivery(
    userId: string,
    payload: { title: string; tag?: string },
    devicesTotal: number,
  ): Promise<string | null> {
    try {
      const row = await (this.prisma as any).pushDelivery.create({
        data: {
          userId,
          title: payload.title.slice(0, 255),
          tag: payload.tag?.slice(0, 100) ?? null,
          status: 'PENDING',
          devicesTotal,
          devicesOk: 0,
        },
        select: { id: true },
      });
      return row.id as string;
    } catch {
      return null; // le suivi ne doit jamais empêcher un envoi
    }
  }

  private async finishDelivery(
    deliveryId: string | null,
    userId: string,
    payload: { title: string; tag?: string },
    status: 'SENT' | 'PARTIAL' | 'FAILED' | 'EXPIRED',
    devicesTotal: number,
    devicesOk: number,
    error?: string,
  ): Promise<void> {
    if (!deliveryId) {
      await this.recordDelivery(userId, payload, status, devicesTotal, devicesOk, error);
      return;
    }
    try {
      await (this.prisma as any).pushDelivery.update({
        where: { id: deliveryId },
        data: { status, devicesTotal, devicesOk, error: error ? error.slice(0, 300) : null },
      });
    } catch {
      /* suivi best-effort */
    }
  }

  /**
   * 🆕 Appelé par le service worker de l'appareil quand la notification vient de s'afficher.
   * Preuve de réception « hors app » : plus forte que « accepté par le service push ».
   */
  async acknowledge(deliveryId: string): Promise<void> {
    try {
      await (this.prisma as any).pushDelivery.updateMany({
        where: { id: deliveryId, ackAt: null },
        data: { ackAt: new Date() },
      });
      await (this.prisma as any).pushDelivery.updateMany({
        where: { id: deliveryId },
        data: { ackedDevices: { increment: 1 } },
      });
    } catch {
      /* best-effort */
    }
  }

  private async recordDelivery(
    userId: string,
    payload: { title: string; tag?: string },
    status: 'SENT' | 'PARTIAL' | 'FAILED' | 'EXPIRED' | 'NO_DEVICE' | 'DISABLED' | 'NO_VAPID',
    devicesTotal = 0,
    devicesOk = 0,
    error?: string,
  ): Promise<void> {
    try {
      await (this.prisma as any).pushDelivery.create({
        data: {
          userId,
          title: payload.title.slice(0, 255),
          tag: payload.tag?.slice(0, 100) ?? null,
          status,
          devicesTotal,
          devicesOk,
          error: error ? error.slice(0, 300) : null,
        },
      });
    } catch {
      // Le suivi ne doit JAMAIS empêcher ni faire échouer un envoi
    }
  }

  private async sendToOneSubscription(
    sub: { id: string; token: string },
    pushPayload: string,
    userId: string,
    title: string,
  ): Promise<{ ok: boolean; expired?: boolean; error?: string }> {
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
      return { ok: false, error: 'Token illisible' };
    }

    try {
      await webpush.sendNotification(subscription, pushPayload);
      this.logger.log(`✅ Push envoyé → userId: ${userId} | "${title}"`);
      return { ok: true };
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
        return { ok: false, expired: true, error: `HTTP ${err.statusCode}` };
      } else {
        this.logger.error(`❌ Erreur push pour userId: ${userId}:`, err.message);
        await this.systemLogs.log({
          source: 'push-notifications:send',
          level: 'ERROR',
          message: `Échec d'envoi push pour userId ${userId} : ${err.message}`,
          details: { errors: [String(err?.stack ?? err)] },
        });
        return { ok: false, error: String(err?.message ?? err).slice(0, 300) };
      }
    }
  }
}