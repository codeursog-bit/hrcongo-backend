// ============================================================================
// Fichier: backend/src/admin/services/dashboard.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import * as os from 'os';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private prisma: PrismaService) {}

  async getStats() {
    this.logger.log('📊 Récupération statistiques dashboard...');

    const [
      totalCompanies,
      activeCompanies,
      inactiveCompanies,
      totalUsers,
      totalEmployees,
      totalMRR,
      recentCompanies,
      failedPayments,
      systemHealth,
      growth,
    ] = await Promise.all([
      this.prisma.company.count({ where: { archivedAt: null } }),
      this.prisma.company.count({ where: { archivedAt: null, isActive: true } }),
      this.prisma.company.count({ where: { archivedAt: null, isActive: false } }),
      this.prisma.user.count(),
      this.prisma.employee.count(),
      this.getTotalMRR(),
      this.getRecentCompanies(),
      this.getFailedPayments(),
      this.getSystemHealth(),
      this.getCompanyGrowth(),
    ]);

    return {
      totalCompanies,
      activeCompanies,
      inactiveCompanies,
      totalUsers,
      totalEmployees,
      totalMRR,
      recentCompanies,
      failedPayments,
      systemHealth,
      growth,
    };
  }

  /**
   * % de croissance du nombre d'entreprises (non archivées) sur les 30
   * derniers jours — remplace le 12.5 codé en dur qui s'affichait dans le
   * header sur toutes les pages admin, peu importe la réalité.
   */
  private async getCompanyGrowth(): Promise<number> {
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const [currentCount, pastCount] = await Promise.all([
      this.prisma.company.count({ where: { archivedAt: null } }),
      this.prisma.company.count({
        where: { archivedAt: null, createdAt: { lte: monthAgo } },
      }),
    ]);

    if (pastCount === 0) return 0; // pas assez de recul pour un % significatif
    return Number((((currentCount - pastCount) / pastCount) * 100).toFixed(1));
  }

  private async getTotalMRR() {
    const result = await this.prisma.subscription.aggregate({
      where: {
        status: { in: ['ACTIVE', 'TRIALING'] },
        company: { archivedAt: null },
      },
      _sum: {
        pricePerMonth: true,
      },
    });

    return Number(result._sum.pricePerMonth) || 0;
  }

  private async getRecentCompanies() {
    const companies = await this.prisma.company.findMany({
      where: { archivedAt: null },
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: true,
        _count: {
          select: {
            employees: true,
            users: true,
          },
        },
      },
    });

    return companies.map((c) => ({
      id: c.id,
      name: c.tradeName || c.legalName,
      logo: this.generateInitials(c.legalName),
      plan: c.subscription?.plan || 'FREE',
      employees: c._count.employees,
      users: c._count.users,
      lastActive: this.calculateLastActive(c.updatedAt),
      status: c.isActive ? 'Active' : 'Suspended',
      mrr: Number(c.subscription?.pricePerMonth) || 0,
      region: c.city,
      rccm: c.rccmNumber,
      email: c.email,
      joinedDate: c.createdAt.toISOString(),
      contactPerson: c.legalName,
    }));
  }

  private async getFailedPayments() {
    const payments = await this.prisma.payment.findMany({
      where: { status: 'FAILED' },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        company: {
          select: {
            legalName: true,
            email: true,
          },
        },
      },
    });

    // Nombre réel de tentatives échouées pour ce même abonnement
    // (au lieu d'une valeur fixe qui ne voulait rien dire)
    const attemptCounts = await Promise.all(
      payments.map((p) =>
        this.prisma.payment.count({
          where: { subscriptionId: p.subscriptionId, status: 'FAILED' },
        }),
      ),
    );

    return payments.map((p, i) => ({
      id: p.id,
      companyName: p.company.legalName,
      amount: Number(p.amount),
      attempts: attemptCounts[i],
      error: p.description || 'Payment failed',
      contact: p.company.email,
      date: p.createdAt.toISOString(),
    }));
  }

  private async getSystemHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const uptime = Math.floor(process.uptime() / 60);
      const mem = process.memoryUsage();

      return {
        database: 'healthy',
        uptime,
        cpuLoad: Math.round(os.loadavg()[0] * 100) / 100,
        memoryUsage: Math.round((mem.heapUsed / mem.heapTotal) * 100),
      };
    } catch (error) {
      return {
        database: 'error',
        uptime: 0,
        cpuLoad: 0,
        memoryUsage: 0,
      };
    }
  }

  private generateInitials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  private calculateLastActive(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "À l'instant";
    if (minutes < 60) return `${minutes} min`;
    if (hours < 24) return `${hours}h`;
    return `${days}j`;
  }
}