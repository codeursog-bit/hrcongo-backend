// ============================================================================
// 📁 src/health/health.controller.ts — Page santé complète
// PUBLIC pour les checks infra + ADMIN pour les détails
// ============================================================================
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../admin/guards/ultra-admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // ── Endpoint public — utilisé par Nginx, Hetzner uptime checks ───────────
  @Get()
  async check() {
    let dbOk = false,
      dbLatency = 0;
    try {
      const t = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - t;
      dbOk = true;
    } catch {
      /* db down */
    }

    const status = dbOk ? 'ok' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV ?? 'development',
      db: { status: dbOk ? 'connected' : 'error', latencyMs: dbLatency },
    };
  }

  @Get('ping')
  ping() {
    return { pong: true, ts: Date.now() };
  }

  // ── Endpoint détaillé — Super Admin uniquement ───────────────────────────
  @Get('details')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  async getDetails() {
    const mem = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const up = process.uptime();

    let dbOk = false,
      dbLatency = 0;
    try {
      const t = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - t;
      dbOk = true;
    } catch {
      /* db down */
    }

    // Stats base de données
    const [
      totalUsers,
      activeUsers,
      totalCompanies,
      totalEmployees,
      totalPayrolls,
      activeSessions,
      totalLogs,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.company.count(),
      this.prisma.employee.count({ where: { status: 'ACTIVE' } }),
      this.prisma.payroll.count(),
      this.prisma.userSession.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.prisma.activityLog.count(),
    ]);

    const d = Math.floor(up / 86400);
    const h = Math.floor((up % 86400) / 3600);
    const m = Math.floor((up % 3600) / 60);

    return {
      status: dbOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),

      server: {
        uptime: Math.floor(up),
        uptimeFormatted: `${d}j ${h}h ${m}m`,
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        env: process.env.NODE_ENV ?? 'development',
      },

      memory: {
        heapUsed: Math.round(mem.heapUsed / 1048576),
        heapTotal: Math.round(mem.heapTotal / 1048576),
        rss: Math.round(mem.rss / 1048576),
        external: Math.round(mem.external / 1048576),
        pct: Math.round((mem.heapUsed / mem.heapTotal) * 100),
        status:
          mem.heapUsed / mem.heapTotal > 0.9
            ? 'critical'
            : mem.heapUsed / mem.heapTotal > 0.7
              ? 'warning'
              : 'ok',
      },

      cpu: {
        userMs: Math.round(cpuUsage.user / 1000),
        systemMs: Math.round(cpuUsage.system / 1000),
      },

      database: {
        status: dbOk ? 'connected' : 'error',
        latencyMs: dbLatency,
        latencyStatus:
          dbLatency < 50 ? 'fast' : dbLatency < 200 ? 'normal' : 'slow',
      },

      app: {
        totalUsers,
        activeUsers,
        totalCompanies,
        totalEmployees,
        totalPayrolls,
        activeSessions,
        totalAuditLogs: totalLogs,
      },

      services: {
        api: { status: 'ok', name: 'NestJS API' },
        db: { status: dbOk ? 'ok' : 'error', name: 'PostgreSQL' },
        auth: { status: 'ok', name: 'JWT + Cookies' },
        audit: { status: 'ok', name: 'Audit Log' },
        crypto: { status: 'ok', name: 'AES-256-GCM' },
      },
    };
  }
}
