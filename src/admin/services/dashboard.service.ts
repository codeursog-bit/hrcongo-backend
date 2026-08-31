// ============================================================================
// Fichier: backend/src/admin/services/dashboard.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
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
    ] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { isActive: true } }),
      this.prisma.company.count({ where: { isActive: false } }),
      this.prisma.user.count(),
      this.prisma.employee.count(),
      this.getTotalMRR(),
      this.getRecentCompanies(),
      this.getFailedPayments(),
      this.getSystemHealth(),
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
    };
  }

  private async getTotalMRR() {
    const result = await this.prisma.subscription.aggregate({
      where: {
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      _sum: {
        pricePerMonth: true,
      },
    });

    return Number(result._sum.pricePerMonth) || 0;
  }

  private async getRecentCompanies() {
    const companies = await this.prisma.company.findMany({
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
      status: c.isActive ? 'Active' : 'Inactive',
      mrr: Number(c.subscription?.pricePerMonth) || 0,
      region: c.city,
      rccm: c.rccmNumber,
      email: c.email,
      joinedDate: c.createdAt.toISOString(),
      contactPerson: c.legalName,
      health: {
        payment: 'good',
        usage: 'good',
        support: 'good',
      },
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

    return payments.map((p) => ({
      id: p.id,
      companyName: p.company.legalName,
      amount: Number(p.amount),
      attempts: 1,
      error: p.description || 'Payment failed', // ✅ CORRIGÉ
      contact: p.company.email,
      date: p.createdAt.toISOString(),
    }));
  }

  private async getSystemHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const uptime = Math.floor(process.uptime() / 60);

      return {
        database: 'healthy',
        uptime,
        cpuLoad: 0,
        memoryUsage: 0,
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
