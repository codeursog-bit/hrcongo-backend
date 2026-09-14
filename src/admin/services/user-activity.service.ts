// ============================================================================
// Fichier: backend/src/admin/services/user-activity.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ONLINE_NOW_MINUTES = 2;

@Injectable()
export class AdminUserActivityService {
  private readonly logger = new Logger(AdminUserActivityService.name);

  constructor(private prisma: PrismaService) {}

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