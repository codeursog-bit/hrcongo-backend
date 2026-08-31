// ============================================================================
// 📁 src/admin/services/monitoring.service.ts — Super Admin
// Vue complète cross-entreprises : audit, sécurité, santé serveur
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  constructor(private readonly prisma: PrismaService) {}

  async getMonitoringData() {
    const [logs, security, stats, topCompanies, serverHealth] =
      await Promise.all([
        this.getAuditLogs({}),
        this.getSecurityEvents(),
        this.getGlobalStats(),
        this.getTopActiveCompanies(),
        this.getServerHealth(),
      ]);
    return {
      logs,
      security,
      stats,
      topCompanies,
      serverHealth,
      apiRequests: [],
      dbQueries: [],
      errors: [],
      webhooks: [],
    };
  }

  async getAuditLogs(filters: {
    companyId?: string;
    action?: string;
    entity?: string;
    severity?: string;
    userId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const take = Math.min(filters.limit ?? 100, 500);
    const skip = ((filters.page ?? 1) - 1) * take;
    const where: any = {};
    if (filters.companyId) where.user = { companyId: filters.companyId };
    if (filters.action)
      where.action = { contains: filters.action.toUpperCase() };
    if (filters.entity) where.entity = filters.entity.toUpperCase();
    if (filters.userId) where.userId = filters.userId;
    if (filters.severity)
      where.metadata = {
        path: ['severity'],
        equals: filters.severity.toUpperCase(),
      };
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }
    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
              companyId: true,
              company: { select: { id: true, legalName: true } },
            },
          },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);
    return {
      data: logs.map((l) => this.fmt(l)),
      meta: {
        total,
        page: filters.page ?? 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async getSecurityEvents(limit = 200) {
    const events = await this.prisma.activityLog.findMany({
      where: {
        action: {
          in: [
            'LOGIN_FAILED',
            '2FA_DISABLED',
            'CHANGE_PASSWORD_FAILED',
            'CONTRACT_RUPTURE',
            'SUBSCRIPTION_CANCEL',
            'EMPLOYEE_DELETE',
            'PAYROLL_DELETE',
            'CABINET_REMOVE_COMPANY',
            'SETTINGS_PAYROLL',
            'EXPORT_ETAX',
            'EXPORT_CNSS',
          ],
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            company: { select: { legalName: true } },
          },
        },
      },
    });
    return events.map((e) => ({
      id: e.id,
      timestamp: e.createdAt.toISOString(),
      action: e.action,
      description: e.description,
      user: e.user?.email ?? 'inconnu',
      userName: e.user ? `${e.user.firstName} ${e.user.lastName}` : '—',
      company: (e.user as any)?.company?.legalName ?? '—',
      role: e.user?.role ?? '—',
      ip: (e.metadata as any)?.ip ?? 'N/A',
      severity: (e.metadata as any)?.severity ?? 'CRITICAL',
      risk: this.risk(e.action),
    }));
  }

  async getGlobalStats() {
    const h24 = new Date(Date.now() - 86400000);
    const d7 = new Date(Date.now() - 7 * 86400000);
    const d30 = new Date(Date.now() - 30 * 86400000);
    const CRIT = [
      'CONTRACT_RUPTURE',
      'EMPLOYEE_DELETE',
      'PAYROLL_DELETE',
      '2FA_DISABLED',
      'SUBSCRIPTION_CANCEL',
      'SETTINGS_PAYROLL',
      'EXPORT_ETAX',
      'CABINET_REMOVE_COMPANY',
    ];
    const [t24h, t7d, t30d, c24h, c7d, l24h, fl24h, ex24h, byAct, byEnt, byCo] =
      await Promise.all([
        this.prisma.activityLog.count({ where: { createdAt: { gte: h24 } } }),
        this.prisma.activityLog.count({ where: { createdAt: { gte: d7 } } }),
        this.prisma.activityLog.count({ where: { createdAt: { gte: d30 } } }),
        this.prisma.activityLog.count({
          where: { createdAt: { gte: h24 }, action: { in: CRIT } },
        }),
        this.prisma.activityLog.count({
          where: { createdAt: { gte: d7 }, action: { in: CRIT } },
        }),
        this.prisma.activityLog.count({
          where: { createdAt: { gte: h24 }, action: 'LOGIN' },
        }),
        this.prisma.activityLog.count({
          where: { createdAt: { gte: h24 }, action: { contains: 'FAILED' } },
        }),
        this.prisma.activityLog.count({
          where: { createdAt: { gte: h24 }, action: { contains: 'EXPORT' } },
        }),
        this.prisma.activityLog.groupBy({
          by: ['action'],
          where: { createdAt: { gte: d7 } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 10,
        }),
        this.prisma.activityLog.groupBy({
          by: ['entity'],
          where: { createdAt: { gte: d7 } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
        }),
        this.prisma.activityLog
          .findMany({
            where: { createdAt: { gte: d7 } },
            select: {
              action: true,
              user: {
                select: { company: { select: { id: true, legalName: true } } },
              },
            },
            take: 5000,
          })
          .then((logs) => {
            const m: Record<string, { name: string; c: number }> = {};
            logs.forEach((l) => {
              const co = (l.user as any)?.company;
              if (!co) return;
              if (!m[co.id]) m[co.id] = { name: co.legalName, c: 0 };
              m[co.id].c++;
            });
            return Object.entries(m)
              .sort((a, b) => b[1].c - a[1].c)
              .slice(0, 10)
              .map(([id, v]) => ({
                companyId: id,
                name: v.name,
                actions: v.c,
              }));
          }),
      ]);
    return {
      total24h: t24h,
      total7d: t7d,
      total30d: t30d,
      critical24h: c24h,
      critical7d: c7d,
      logins24h: l24h,
      failedLogins24h: fl24h,
      exports24h: ex24h,
      failRatio: l24h > 0 ? Math.round((fl24h / (l24h + fl24h)) * 100) : 0,
      byAction7d: byAct.map((r) => ({ action: r.action, count: r._count.id })),
      byEntity7d: byEnt.map((r) => ({ entity: r.entity, count: r._count.id })),
      byCompany7d: byCo,
    };
  }

  async getTopActiveCompanies(limit = 10) {
    const d7 = new Date(Date.now() - 7 * 86400000);
    const logs = await this.prisma.activityLog.findMany({
      where: { createdAt: { gte: d7 } },
      select: {
        action: true,
        user: {
          select: { company: { select: { id: true, legalName: true } } },
        },
      },
      take: 5000,
    });
    const CRIT = new Set([
      'CONTRACT_RUPTURE',
      'EMPLOYEE_DELETE',
      'PAYROLL_DELETE',
      '2FA_DISABLED',
      'SUBSCRIPTION_CANCEL',
      'SETTINGS_PAYROLL',
    ]);
    const EXP = new Set([
      'EXPORT_EXCEL',
      'EXPORT_SAGE',
      'EXPORT_ETAX',
      'EXPORT_CSV',
      'EXPORT_CNSS',
      'EXPORT_PDF_BATCH',
    ]);
    const m: Record<
      string,
      { name: string; actions: number; criticals: number; exports: number }
    > = {};
    logs.forEach((l) => {
      const co = (l.user as any)?.company;
      if (!co) return;
      if (!m[co.id])
        m[co.id] = { name: co.legalName, actions: 0, criticals: 0, exports: 0 };
      m[co.id].actions++;
      if (CRIT.has(l.action)) m[co.id].criticals++;
      if (EXP.has(l.action)) m[co.id].exports++;
    });
    return Object.entries(m)
      .sort((a, b) => b[1].actions - a[1].actions)
      .slice(0, limit)
      .map(([id, v]) => ({ companyId: id, ...v }));
  }

  async getServerHealth() {
    const mem = process.memoryUsage();
    const up = process.uptime();
    let dbStatus = 'healthy',
      dbLatency = 0;
    try {
      const t = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - t;
    } catch {
      dbStatus = 'error';
    }
    const activeSessions = await this.prisma.userSession
      .count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      })
      .catch(() => 0);
    return {
      uptime: up,
      uptimeFormatted: this.fmtUptime(up),
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1048576),
        heapTotal: Math.round(mem.heapTotal / 1048576),
        rss: Math.round(mem.rss / 1048576),
        pct: Math.round((mem.heapUsed / mem.heapTotal) * 100),
      },
      db: { status: dbStatus, latencyMs: dbLatency },
      activeSessions,
      nodeVersion: process.version,
      pid: process.pid,
      env: process.env.NODE_ENV ?? 'development',
    };
  }

  async getCompanyAuditStats(companyId: string) {
    const d30 = new Date(Date.now() - 30 * 86400000);
    const [total, criticals, byAction, recent] = await Promise.all([
      this.prisma.activityLog.count({
        where: { user: { companyId }, createdAt: { gte: d30 } },
      }),
      this.prisma.activityLog.count({
        where: {
          user: { companyId },
          createdAt: { gte: d30 },
          action: {
            in: [
              'CONTRACT_RUPTURE',
              'EMPLOYEE_DELETE',
              'PAYROLL_DELETE',
              '2FA_DISABLED',
              'EXPORT_ETAX',
            ],
          },
        },
      }),
      this.prisma.activityLog.groupBy({
        by: ['action'],
        where: { user: { companyId }, createdAt: { gte: d30 } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.activityLog.findMany({
        where: { user: { companyId } },
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);
    return {
      period: '30 jours',
      total,
      criticals,
      byAction: byAction.map((r) => ({ action: r.action, count: r._count.id })),
      recent: recent.map((l) => this.fmt(l)),
    };
  }

  private fmt(l: any) {
    return {
      id: l.id,
      timestamp: l.createdAt.toISOString(),
      time: l.createdAt.toISOString().split('T')[1].split('.')[0],
      level: this.lvl(l.action),
      severity: l.metadata?.severity ?? 'INFO',
      action: l.action,
      entity: l.entity,
      description: l.description,
      user: l.user?.email ?? 'system',
      userName: l.user ? `${l.user.firstName} ${l.user.lastName}` : '—',
      role: l.user?.role ?? '—',
      company: l.user?.company?.legalName ?? '—',
      companyId: l.user?.companyId ?? null,
      ip: l.metadata?.ip ?? 'N/A',
      duration: l.metadata?.duration ?? null,
      path: l.metadata?.path ?? null,
      metadata: l.metadata,
    };
  }

  private lvl(a: string) {
    if (
      a.includes('FAILED') ||
      a.includes('DELETE') ||
      a.includes('RUPTURE') ||
      a.includes('CANCEL') ||
      a.includes('DISABLED')
    )
      return 'ERROR';
    if (a.includes('EXPORT') || a.includes('UPDATE') || a.includes('CHANGE'))
      return 'WARN';
    return 'INFO';
  }

  private risk(a: string): string {
    if (
      [
        'CONTRACT_RUPTURE',
        'EMPLOYEE_DELETE',
        'PAYROLL_DELETE',
        '2FA_DISABLED',
        'SUBSCRIPTION_CANCEL',
        'CABINET_REMOVE_COMPANY',
      ].includes(a)
    )
      return 'Critical';
    if (
      [
        'LOGIN_FAILED',
        'EXPORT_ETAX',
        'EXPORT_CNSS',
        'SETTINGS_PAYROLL',
      ].includes(a)
    )
      return 'High';
    if (a.includes('EXPORT') || a.includes('FAILED')) return 'Medium';
    return 'Low';
  }

  private fmtUptime(s: number) {
    const d = Math.floor(s / 86400),
      h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d}j ${h}h ${m}m`;
  }
}
