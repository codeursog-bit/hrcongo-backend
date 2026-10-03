// ============================================================================
// Fichier: backend/src/admin/services/user-activity.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PushNotificationsService } from '../../notifications/push-notifications.service';

const ONLINE_NOW_MINUTES = 2;

@Injectable()
export class AdminUserActivityService {
  private readonly logger = new Logger(AdminUserActivityService.name);

  constructor(
    private prisma: PrismaService,
    private push: PushNotificationsService,
  ) {}

  /**
   * 🆕 Envoie une notification de TEST à l'administrateur qui clique (dans l'app + push).
   * Sert à vérifier de bout en bout : abonnement, envoi, affichage sur l'appareil, accusé de réception.
   */
  async sendTestPush(userId: string) {
    const title = '🔔 Test de notification Konza RH';
    const message = "Si vous lisez ceci, les notifications fonctionnent sur cet appareil.";
    await this.prisma.notification.create({
      data: { userId, type: 'SYSTEM_ALERT', title, message, link: '/admin/push-notifications' },
    });
    await this.push.sendPushToUser(userId, {
      title,
      body: message,
      url: '/admin/push-notifications',
      tag: `push-test-${userId}`,
    });
    return {
      sent: true,
      apiPublicUrlConfigured: !!process.env.API_PUBLIC_URL, // sans elle, aucun accusé de réception possible
    };
  }

  /** Utilisateurs actifs dans les 2 dernières minutes. */
  async getOnlineNow() {
    const since = new Date(Date.now() - ONLINE_NOW_MINUTES * 60_000);

    const users = await this.prisma.user.findMany({
      where: { lastActiveAt: { gte: since } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        lastActiveAt: true,
        company: { select: { id: true, legalName: true, tradeName: true } },
      },
      orderBy: { lastActiveAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      role: u.role,
      companyName: u.company?.tradeName || u.company?.legalName || null,
      lastActiveAt: u.lastActiveAt,
    }));
  }

  /** Utilisateurs vus dans les dernières `hours` heures (par défaut 24h). */
  async getRecentlyOnline(hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60_000);
    const onlineSince = new Date(Date.now() - ONLINE_NOW_MINUTES * 60_000);

    const users = await this.prisma.user.findMany({
      where: { lastActiveAt: { gte: since } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        lastActiveAt: true,
        company: { select: { id: true, legalName: true, tradeName: true } },
      },
      orderBy: { lastActiveAt: 'desc' },
      take: 100,
    });

    return users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      role: u.role,
      companyName: u.company?.tradeName || u.company?.legalName || null,
      lastActiveAt: u.lastActiveAt,
      isOnlineNow: u.lastActiveAt ? u.lastActiveAt >= onlineSince : false,
    }));
  }

  /** Classement des utilisateurs les plus actifs sur une période. */
  async getMostActive(period: 'today' | 'week' | 'month' = 'week') {
    const { from, to } = this.periodRange(period);

    const rows = await this.prisma.dailyUserActivity.groupBy({
      by: ['userId'],
      where: { date: { gte: from, lte: to } },
      _sum: { activeMinutes: true, requestCount: true },
      orderBy: { _sum: { activeMinutes: 'desc' } },
      take: 20,
    });

    const userIds = rows.map((r) => r.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        company: { select: { legalName: true, tradeName: true } },
      },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const u = userById.get(r.userId);
      return {
        userId: r.userId,
        name: u ? `${u.firstName} ${u.lastName}` : 'Utilisateur supprimé',
        email: u?.email ?? null,
        role: u?.role ?? null,
        companyName: u?.company?.tradeName || u?.company?.legalName || null,
        activeMinutes: r._sum.activeMinutes ?? 0,
        requestCount: r._sum.requestCount ?? 0,
      };
    });
  }

  /**
   * Qui a activé les notifications push, et parmi eux qui a vraiment un
   * appareil enregistré (les deux ne vont pas toujours ensemble — voir le
   * bug diagnostiqué plus tôt dans la conversation : activé côté profil
   * n'implique pas forcément un abonnement technique réussi).
   */
  async getPushStatus() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        pushNotifEnabled: true,
        company: { select: { legalName: true, tradeName: true } },
        _count: { select: { pushSubscriptions: true } },
      },
    });

    const enabled = users.filter((u) => u.pushNotifEnabled);
    const withDevice = enabled.filter((u) => u._count.pushSubscriptions > 0);
    const enabledButBroken = enabled.filter((u) => u._count.pushSubscriptions === 0);

    return {
      totalUsers: users.length,
      enabledCount: enabled.length,
      activeDeviceCount: withDevice.length,
      brokenCount: enabledButBroken.length,
      users: enabled.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        role: u.role,
        companyName: u.company?.tradeName || u.company?.legalName || null,
        status: u._count.pushSubscriptions > 0 ? 'active' : 'broken',
        deviceCount: u._count.pushSubscriptions,
      })),
    };
  }

  /**
   * Diagnostic complet push — TOUS les utilisateurs actifs, activés ou non,
   * avec le détail de leurs appareils. Objectif : que le super admin puisse
   * voir en un coup d'œil qui a activé, qui n'a jamais activé, et qui a
   * activé mais a un abonnement cassé (aucun appareil valide) — sans avoir
   * à checker manuellement chaque compte.
   */
  async getPushDiagnostics() {
    const vapidConfigured = !!(
      process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    );

    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        pushNotifEnabled: true,
        lastActiveAt: true,
        company: { select: { legalName: true, tradeName: true } },
        pushSubscriptions: {
          select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
          orderBy: { lastUsedAt: 'desc' },
        },
      },
      orderBy: [{ pushNotifEnabled: 'desc' }, { lastActiveAt: 'desc' }],
    });

    const rows = users.map((u) => {
      const deviceCount = u.pushSubscriptions.length;
      const status: 'active' | 'enabled_no_device' | 'disabled' =
        !u.pushNotifEnabled ? 'disabled' : deviceCount > 0 ? 'active' : 'enabled_no_device';

      return {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        role: u.role,
        companyName: u.company?.tradeName || u.company?.legalName || null,
        pushNotifEnabled: u.pushNotifEnabled,
        lastActiveAt: u.lastActiveAt,
        deviceCount,
        devices: u.pushSubscriptions.map((s) => ({
          id: s.id,
          label: s.deviceLabel,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
        })),
        status,
      };
    });

    return {
      vapidConfigured,
      totalUsers: rows.length,
      activeCount: rows.filter((r) => r.status === 'active').length,
      brokenCount: rows.filter((r) => r.status === 'enabled_no_device').length,
      disabledCount: rows.filter((r) => r.status === 'disabled').length,
      users: rows,
    };
  }

  /**
   * 🆕 RÉCEPTIONS — pour chaque notification créée (in-app), l'état de l'envoi push associé.
   *   • « dans l'app »  = la notification existe pour l'utilisateur (+ lue ou non, et quand)
   *   • « hors app »    = l'envoi push (SENT / PARTIAL = accepté par le service push de l'appareil ;
   *                       NO_DEVICE / DISABLED / EXPIRED / FAILED / NO_VAPID = non délivré)
   * Rapprochement notification ↔ envoi : même utilisateur, même titre, à ±3 minutes.
   */
  async getPushReceipts(params: {
    hours?: number;
    type?: string;
    push?: string; // all | sent | not_sent | none | <STATUS>
    read?: string; // all | read | unread
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const hours = Math.min(Math.max(Number(params.hours) || 24, 1), 24 * 30);
    const limit = Math.min(Math.max(Number(params.limit) || 50, 10), 200);
    const page = Math.max(Number(params.page) || 1, 1);
    const since = new Date(Date.now() - hours * 3_600_000);

    const where: any = { createdAt: { gte: since } };
    if (params.type && params.type !== 'all') where.type = params.type;
    if (params.read === 'read') where.read = true;
    if (params.read === 'unread') where.read = false;

    // Plafond de lecture (plateforme de quelques centaines d'utilisateurs) : on joint en mémoire
    const notifs = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 3000,
      select: { id: true, userId: true, type: true, title: true, read: true, readAt: true, createdAt: true },
    });

    const userIds = [...new Set(notifs.map((n) => n.userId))];
    const [users, deliveries] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true, firstName: true, lastName: true, email: true, role: true,
              company: { select: { legalName: true, tradeName: true } },
            },
          })
        : [],
      userIds.length
        ? (this.prisma as any).pushDelivery.findMany({
            where: { userId: { in: userIds }, createdAt: { gte: new Date(since.getTime() - 5 * 60_000) } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, userId: true, title: true, status: true, devicesTotal: true, devicesOk: true, error: true, createdAt: true, ackAt: true, ackedDevices: true },
          })
        : [],
    ]);
    const userById = new Map<string, any>((users as any[]).map((u: any) => [u.id, u] as [string, any]));
    const byUser = new Map<string, any[]>();
    for (const d of deliveries as any[]) {
      const arr = byUser.get(d.userId) ?? [];
      arr.push(d);
      byUser.set(d.userId, arr);
    }

    const q = (params.search ?? '').trim().toLowerCase();
    const pushFilter = (params.push ?? 'all').toUpperCase();
    const OK = ['SENT', 'PARTIAL'];

    const rows = notifs
      .map((n) => {
        const u = userById.get(n.userId);
        const cands = (byUser.get(n.userId) ?? []).filter(
          (d) => d.title === n.title && Math.abs(new Date(d.createdAt).getTime() - new Date(n.createdAt).getTime()) <= 3 * 60_000,
        );
        const best = cands.sort(
          (a, b) =>
            Math.abs(new Date(a.createdAt).getTime() - new Date(n.createdAt).getTime()) -
            Math.abs(new Date(b.createdAt).getTime() - new Date(n.createdAt).getTime()),
        )[0];
        return {
          id: n.id,
          userId: n.userId,
          name: u ? `${u.firstName} ${u.lastName}` : 'Utilisateur supprimé',
          email: u?.email ?? null,
          role: u?.role ?? null,
          companyName: u?.company?.tradeName || u?.company?.legalName || null,
          type: n.type as string,
          title: n.title,
          createdAt: n.createdAt,
          inApp: { read: n.read, readAt: n.readAt },
          push: best
            ? { status: best.status as string, devicesOk: best.devicesOk, devicesTotal: best.devicesTotal, error: best.error ?? null, at: best.createdAt, ackAt: best.ackAt ?? null, ackedDevices: best.ackedDevices ?? 0 }
            : null, // aucun envoi push tenté pour cette notification
        };
      })
      .filter((r) => {
        if (q && !(`${r.name} ${r.email ?? ''} ${r.companyName ?? ''}`.toLowerCase().includes(q))) return false;
        if (pushFilter === 'SENT') return !!r.push && OK.includes(r.push.status);
        if (pushFilter === 'NOT_SENT') return !!r.push && !OK.includes(r.push.status);
        if (pushFilter === 'NONE') return !r.push;
        if (pushFilter !== 'ALL') return r.push?.status === pushFilter;
        return true;
      });

    const stats = {
      total: rows.length,
      inAppRead: rows.filter((r) => r.inApp.read).length,
      inAppUnread: rows.filter((r) => !r.inApp.read).length,
      pushDelivered: rows.filter((r) => r.push && OK.includes(r.push.status)).length,
      pushConfirmed: rows.filter((r) => r.push?.ackAt).length, // affichée sur l'appareil (confirmé par le service worker)
      pushNotDelivered: rows.filter((r) => r.push && !OK.includes(r.push.status)).length,
      pushNotAttempted: rows.filter((r) => !r.push).length,
      byPushStatus: rows.reduce((acc: Record<string, number>, r) => {
        const k = r.push?.status ?? 'AUCUN_ENVOI';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
      capped: notifs.length >= 3000,
    };

    const types = [...new Set(notifs.map((n) => n.type as string))].sort();
    return {
      hours,
      stats,
      types,
      total: rows.length,
      page,
      limit,
      items: rows.slice((page - 1) * limit, page * limit),
    };
  }

  private periodRange(period: 'today' | 'week' | 'month') {
    const now = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const from = new Date(now);
    if (period === 'week') from.setDate(from.getDate() - 7);
    if (period === 'month') from.setDate(from.getDate() - 30);

    return { from: fmt(from), to: fmt(now) };
  }
}