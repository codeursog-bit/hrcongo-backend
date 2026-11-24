// ============================================================================
// 📁 src/notifications/push-notifications.service.ts
// ============================================================================
// 🔥 KONZA SUITE — Web Push Service (vraies notifications téléphone)
//
// Multi-appareil : un utilisateur peut avoir plusieurs appareils (téléphone perso
// + tablette bureau, par ex.) — chacun est UNE ligne PushSubscription.
//
// 🆕 IDENTITÉ D'APPAREIL : l'app génère un `deviceId` stable (gardé dans le
// navigateur) et l'envoie à chaque activation. Réactiver sur le même téléphone
// met à jour la MÊME ligne (même si le navigateur a donné une nouvelle adresse
// push) au lieu d'en créer une de plus. Désactiver ne supprime plus la ligne :
// elle passe en DISABLED (avec la date) et un historique est conservé pour le
// super admin. Un abonnement mort (404/410) passe en EXPIRED.
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

export interface PushDeviceMeta {
  deviceId?: string;
  deviceLabel?: string;
  userAgent?: string;
}

export type PushSendStatus =
  | 'SENT' | 'PARTIAL' | 'FAILED' | 'EXPIRED' | 'NO_DEVICE' | 'DISABLED' | 'NO_VAPID';

export interface PushSendResult {
  status: PushSendStatus;
  devicesTotal: number;
  devicesOk: number;
}

type DeviceEventType = 'ENABLED' | 'REACTIVATED' | 'DISABLED' | 'EXPIRED' | 'MOVED';
interface PendingEvent {
  userId: string;
  deviceId: string | null;
  deviceLabel: string | null;
  type: DeviceEventType;
}


export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  actions?: { action: string; title: string }[];
  // Pour les boutons "Oubli" / "Heures sup" dans la notif native
  actionUrls?: Record<string, string>;
  // Durée de vie côté service push (secondes) : passé ce délai, un appareil éteint/hors
  // ligne ne reçoit plus rien. Un rappel « dans 20 min » n'a aucun sens après l'heure.
  ttlSeconds?: number;
  // 'high' = livraison immédiate même quand le téléphone est en veille (mode Doze Android).
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

const EVENT_RETENTION_DAYS = 180;
// On ne réécrit « dernier envoi réussi » qu'au plus toutes les 5 min par appareil (évite 1 écriture par message de chat)
const SUCCESS_TOUCH_MS = 5 * 60 * 1000;

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
  // 🧰 Utilitaires appareil
  // ============================================================================
  private cleanDeviceId(raw?: string): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const v = raw.trim();
    return /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
  }

  /** Historique : best-effort, ne doit jamais faire échouer une opération. */
  private async writeEvents(events: PendingEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.prisma.pushDeviceEvent.createMany({
        data: events.map((e) => ({
          userId: e.userId,
          deviceId: e.deviceId,
          deviceLabel: e.deviceLabel,
          type: e.type,
        })),
      });
    } catch (err: any) {
      this.logger.warn(`Historique appareil non écrit : ${err?.message}`);
    }
  }

  /** `pushNotifEnabled` = au moins un appareil ACTIF. Recalculé après chaque changement. */
  private async refreshUserFlag(userId: string): Promise<void> {
    try {
      const active = await this.prisma.pushSubscription.count({ where: { userId, status: 'ACTIVE' } });
      await this.prisma.user.update({
        where: { id: userId },
        data: { pushNotifEnabled: active > 0 },
      });
    } catch {
      /* l'utilisateur a pu être supprimé entre-temps */
    }
  }

  // ============================================================================
  // 📱 Enregistrer / réactiver un appareil
  // Appelé quand l'employé active les notifications (clic ou activation auto).
  //  • avec deviceId : 1 ligne par (compte, appareil) — le jeton est simplement mis à jour
  //  • sans deviceId (ancienne version de l'app) : comportement historique, 1 ligne par jeton
  // ============================================================================
  async registerToken(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    meta: PushDeviceMeta = {},
  ): Promise<void> {
    const token = JSON.stringify(subscription);
    const deviceId = this.cleanDeviceId(meta.deviceId);
    const label = meta.deviceLabel?.slice(0, 150) ?? null;
    const userAgent = meta.userAgent?.slice(0, 300) ?? null;
    const now = new Date();
    const events: PendingEvent[] = [];
    const movedFrom: string[] = [];

    const run = async () => {
      if (!deviceId) {
        await this.prisma.pushSubscription.upsert({
          where: { token },
          create: { userId, token, deviceLabel: label, userAgent },
          update: {
            userId, lastUsedAt: now, deviceLabel: label, userAgent,
            status: 'ACTIVE', disabledAt: null, lastError: null,
          },
        });
        return;
      }

      await this.prisma.$transaction(async (tx) => {
        const byToken = await tx.pushSubscription.findUnique({ where: { token } });
        const byDevice = await tx.pushSubscription.findUnique({
          where: { userId_deviceId: { userId, deviceId } },
        });

        if (byDevice) {
          // Même appareil connu. Si son nouveau jeton appartient déjà à une AUTRE ligne
          // (vieil enregistrement du même téléphone, ou autre compte), on retire celle-là.
          if (byToken && byToken.id !== byDevice.id) {
            if (byToken.userId !== userId) {
              movedFrom.push(byToken.userId);
              events.push({ userId: byToken.userId, deviceId: byToken.deviceId, deviceLabel: byToken.deviceLabel, type: 'MOVED' });
            }
            await tx.pushSubscription.delete({ where: { id: byToken.id } });
          }
          const wasInactive = byDevice.status !== 'ACTIVE';
          await tx.pushSubscription.update({
            where: { id: byDevice.id },
            data: {
              token, userAgent, deviceLabel: label ?? byDevice.deviceLabel,
              status: 'ACTIVE', disabledAt: null, lastError: null, lastUsedAt: now,
              ...(wasInactive ? { enabledAt: now } : {}),
            },
          });
          if (wasInactive) events.push({ userId, deviceId, deviceLabel: label ?? byDevice.deviceLabel, type: 'REACTIVATED' });
        } else if (byToken) {
          // Jeton déjà connu mais sans identifiant (ancienne ligne) ou rattaché à un autre compte : on l'adopte.
          const moved = byToken.userId !== userId;
          const wasInactive = byToken.status !== 'ACTIVE';
          if (moved) {
            movedFrom.push(byToken.userId);
            events.push({ userId: byToken.userId, deviceId: byToken.deviceId, deviceLabel: byToken.deviceLabel, type: 'MOVED' });
          }
          await tx.pushSubscription.update({
            where: { id: byToken.id },
            data: {
              userId, deviceId, userAgent, deviceLabel: label ?? byToken.deviceLabel,
              status: 'ACTIVE', disabledAt: null, lastError: null, lastUsedAt: now,
              ...(moved || wasInactive ? { enabledAt: now } : {}),
            },
          });
          if (moved) events.push({ userId, deviceId, deviceLabel: label, type: 'ENABLED' });
          else if (wasInactive) events.push({ userId, deviceId, deviceLabel: label, type: 'REACTIVATED' });
        } else {
          await tx.pushSubscription.create({
            data: { userId, token, deviceId, deviceLabel: label, userAgent, enabledAt: now },
          });
          events.push({ userId, deviceId, deviceLabel: label, type: 'ENABLED' });
        }
      });
    };

    try {
      await run();
    } catch (err: any) {
      // Deux onglets du même appareil qui s'enregistrent en même temps : l'un des deux perd la course (P2002).
      if (err?.code === 'P2002') {
        events.length = 0;
        movedFrom.length = 0;
        await run();
      } else {
        throw err;
      }
    }

    await this.writeEvents(events);
    await this.refreshUserFlag(userId);
    for (const uid of new Set(movedFrom)) await this.refreshUserFlag(uid);

    // Ménage de l'historique de CE compte (rare : seulement à l'enregistrement d'un appareil)
    const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000);
    this.prisma.pushDeviceEvent
      .deleteMany({ where: { userId, createdAt: { lt: cutoff } } })
      .catch(() => {});

    this.logger.log(`📲 Appareil push enregistré pour userId: ${userId}${deviceId ? ` (device ${deviceId.slice(0, 8)})` : ''}`);
  }

  // ============================================================================
  // 🔎 Cet appareil (endpoint) est-il encore ACTIF pour cet utilisateur ?
  // Si non → le front doit recréer un abonnement NEUF au lieu de renvoyer le même endpoint.
  // ============================================================================
  async hasEndpoint(userId: string, endpoint?: string): Promise<boolean> {
    if (!endpoint) return false;
    const n = await this.prisma.pushSubscription.count({
      where: { userId, status: 'ACTIVE', token: { contains: endpoint } },
    });
    return n > 0;
  }

  // ============================================================================
  // 🔕 Désactiver UN appareil (jamais les autres)
  // La ligne est CONSERVÉE (état DISABLED + date) : le super admin voit qui a désactivé quoi.
  // Sans deviceId ni endpoint → on ne touche à rien (l'ancien « tout supprimer » effaçait
  // aussi les autres téléphones du compte).
  // ============================================================================
  async unregisterToken(userId: string, target: { deviceId?: string; endpoint?: string } = {}): Promise<void> {
    const deviceId = this.cleanDeviceId(target.deviceId);
    let sub: { id: string; deviceId: string | null; deviceLabel: string | null; status: string } | null = null;

    if (deviceId) {
      sub = await this.prisma.pushSubscription.findUnique({
        where: { userId_deviceId: { userId, deviceId } },
        select: { id: true, deviceId: true, deviceLabel: true, status: true },
      });
    }
    if (!sub && target.endpoint) {
      const candidates = await this.prisma.pushSubscription.findMany({
        where: { userId, token: { contains: target.endpoint } },
        select: { id: true, deviceId: true, deviceLabel: true, status: true, token: true },
      });
      sub = candidates.find((c) => {
        try { return JSON.parse(c.token).endpoint === target.endpoint; } catch { return false; }
      }) ?? null;
    }

    if (!sub) {
      this.logger.warn(`🔕 Désactivation push ignorée (appareil introuvable) pour userId: ${userId}`);
      return;
    }

    if (sub.status !== 'DISABLED') {
      await this.prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { status: 'DISABLED', disabledAt: new Date() },
      });
      await this.writeEvents([{ userId, deviceId: sub.deviceId, deviceLabel: sub.deviceLabel, type: 'DISABLED' }]);
    }
    await this.refreshUserFlag(userId);
    this.logger.log(`🔕 Appareil push désactivé pour userId: ${userId}`);
  }

  // ============================================================================
  // 🚀 Envoyer une notification push à un utilisateur — sur TOUS ses appareils ACTIFS
  // C'est LA méthode centrale. Ne renvoie rien (comportement historique).
  // ============================================================================
  async sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
    await this.sendPushToUserDetailed(userId, payload);
  }

  /** Même envoi, mais renvoie le résultat (utilisé par l'envoi groupé du super admin). */
  async sendPushToUserDetailed(userId: string, payload: PushPayload): Promise<PushSendResult> {
    if (!this.vapidConfigured) {
      await this.recordDelivery(userId, payload, 'NO_VAPID');
      return { status: 'NO_VAPID', devicesTotal: 0, devicesOk: 0 };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushNotifEnabled: true },
    });
    if (!user?.pushNotifEnabled) {
      await this.recordDelivery(userId, payload, 'DISABLED');
      return { status: 'DISABLED', devicesTotal: 0, devicesOk: 0 };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    if (subscriptions.length === 0) {
      await this.recordDelivery(userId, payload, 'NO_DEVICE');
      return { status: 'NO_DEVICE', devicesTotal: 0, devicesOk: 0 };
    }

    // On crée la trace AVANT l'envoi pour glisser son id dans la notification : le service
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
    const sendOptions: webpush.RequestOptions = {};
    if (payload.ttlSeconds != null) sendOptions.TTL = Math.max(0, Math.floor(payload.ttlSeconds));
    if (payload.urgency) sendOptions.urgency = payload.urgency;

    const results = await Promise.all(
      subscriptions.map((sub) => this.sendToOneSubscription(sub, pushPayload, userId, payload.title, sendOptions)),
    );

    // Trace de l'envoi (consultable dans le super admin). « SENT » = accepté par le service
    // push du navigateur/téléphone (FCM, Mozilla, Apple) : c'est la preuve la plus fiable côté serveur.
    const ok = results.filter((r) => r.ok).length;
    const status: PushSendStatus =
      ok === results.length ? 'SENT'
      : ok > 0 ? 'PARTIAL'
      : results.every((r) => r.expired) ? 'EXPIRED'
      : 'FAILED';
    await this.finishDelivery(
      deliveryId,
      userId,
      payload,
      status as 'SENT' | 'PARTIAL' | 'FAILED' | 'EXPIRED',
      results.length,
      ok,
      results.find((r) => !r.ok)?.error,
    );
    return { status, devicesTotal: results.length, devicesOk: ok };
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
    sub: {
      id: string; token: string; deviceId: string | null; deviceLabel: string | null;
      lastSuccessAt: Date | null;
    },
    pushPayload: string,
    userId: string,
    title: string,
    options?: webpush.RequestOptions,
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
      await webpush.sendNotification(subscription, pushPayload, options);
      this.logger.log(`✅ Push envoyé → userId: ${userId} | "${title}"`);
      // Dernier envoi réussi (au plus toutes les 5 min par appareil)
      if (!sub.lastSuccessAt || Date.now() - sub.lastSuccessAt.getTime() > SUCCESS_TOUCH_MS) {
        this.prisma.pushSubscription
          .update({ where: { id: sub.id }, data: { lastSuccessAt: new Date(), lastError: null } })
          .catch(() => {});
      }
      return { ok: true };
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        this.logger.warn(`🗑️  Abonnement push expiré (id: ${sub.id}) pour userId: ${userId}`);
        if (sub.deviceId) {
          // Appareil identifié : on GARDE la ligne (état EXPIRED) pour que le super admin le voie.
          await this.prisma.pushSubscription
            .update({
              where: { id: sub.id },
              data: {
                status: 'EXPIRED', disabledAt: new Date(),
                lastFailureAt: new Date(), lastError: `HTTP ${err.statusCode}`,
              },
            })
            .catch(() => {});
          await this.writeEvents([{ userId, deviceId: sub.deviceId, deviceLabel: sub.deviceLabel, type: 'EXPIRED' }]);
        } else {
          // Ancienne ligne sans identifiant : impossible de la ré-associer, on la supprime comme avant.
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }

        const remaining = await this.prisma.pushSubscription.count({ where: { userId, status: 'ACTIVE' } });
        if (remaining === 0) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { pushNotifEnabled: false },
          }).catch(() => {});
        }

        await this.systemLogs.log({
          source: 'push-notifications:send',
          level: 'WARNING',
          message: `Abonnement push expiré (${err.statusCode}) pour userId ${userId} — un appareil retiré, ${remaining} actif(s) restant(s)`,
          details: { evaluated: 1, skipped: [{ employeeId: userId, reason: `Abonnement expiré (HTTP ${err.statusCode})` }] },
        });
        return { ok: false, expired: true, error: `HTTP ${err.statusCode}` };
      } else {
        this.logger.error(`❌ Erreur push pour userId: ${userId}:`, err.message);
        this.prisma.pushSubscription
          .update({
            where: { id: sub.id },
            data: { lastFailureAt: new Date(), lastError: String(err?.message ?? err).slice(0, 300) },
          })
          .catch(() => {});
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