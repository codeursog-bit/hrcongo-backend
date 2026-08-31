// ============================================================================
// Fichier: backend/src/admin/services/analytics.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  async getAnalytics() {
    this.logger.log('📈 Récupération analytics...');

    const [
      growthData,
      churnData,
      acquisitionData,
      geoDistribution,
      cohortData,
      dau,
    ] = await Promise.all([
      this.getGrowthData(),
      this.getChurnData(),
      this.getAcquisitionData(),
      this.getGeoDistribution(),
      this.getCohortData(),
      this.getDAU(),
    ]);

    return {
      growthData,
      churnData,
      acquisitionData,
      geoDistribution,
      cohortData,
      dau,
    };
  }

  private async getGrowthData() {
    // ✅ CORRECTION : Définir le type explicitement
    const months: Array<{
      name: string;
      revenue: number;
      companies: number;
      users: number;
    }> = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);

      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      const [companies, users, revenue] = await Promise.all([
        this.prisma.company.count({
          where: { createdAt: { lte: endOfMonth } },
        }),
        this.prisma.user.count({
          where: { createdAt: { lte: endOfMonth } },
        }),
        this.prisma.payment.aggregate({
          where: {
            status: 'SUCCEEDED',
            createdAt: { gte: startOfMonth, lte: endOfMonth },
          },
          _sum: { amount: true },
        }),
      ]);

      months.push({
        name: date.toLocaleDateString('fr-FR', { month: 'short' }),
        revenue: Number(revenue._sum.amount) || 0,
        companies,
        users,
      });
    }

    return months;
  }

  private async getChurnData() {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const [canceledCount, totalCount] = await Promise.all([
      this.prisma.subscription.count({
        where: {
          status: 'CANCELED',
          canceledAt: { gte: lastMonth },
        },
      }),
      this.prisma.subscription.count({
        where: { status: 'ACTIVE' },
      }),
    ]);

    const churnRate = totalCount > 0 ? (canceledCount / totalCount) * 100 : 0;

    return {
      rate: Number(churnRate.toFixed(1)),
      count: canceledCount,
      reasons: [
        { name: 'Prix', value: 40, color: '#F87171' },
        { name: 'Concurrent', value: 30, color: '#FBBF24' },
        { name: 'Fermé', value: 20, color: '#9CA3AF' },
        { name: 'Autre', value: 10, color: '#60A5FA' },
      ],
    };
  }

  private async getAcquisitionData() {
    // ✅ CORRECTION : Définir le type explicitement
    const data: Array<{ day: string; value: number }> = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));

      const count = await this.prisma.company.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
      });

      data.push({
        day: String(30 - i),
        value: count,
      });
    }

    return data;
  }

  private async getGeoDistribution() {
    const companies = await this.prisma.company.groupBy({
      by: ['city'],
      _count: true,
      orderBy: { _count: { city: 'desc' } },
      take: 10,
    });

    return companies.map((c) => ({
      city: c.city,
      count: c._count,
      growth: 0,
    }));
  }

  private async getCohortData() {
    // ✅ CORRECTION : Définir le type explicitement
    const cohorts: Array<{ cohort: string; months: number[] }> = [];

    for (let i = 2; i >= 0; i--) {
      const cohortDate = new Date();
      cohortDate.setMonth(cohortDate.getMonth() - i);

      const cohortName = cohortDate.toLocaleDateString('fr-FR', {
        month: 'short',
        year: '2-digit',
      });

      cohorts.push({
        cohort: cohortName,
        months: [100, 92, 85, 78, 71],
      });
    }

    return cohorts;
  }

  private async getDAU() {
    const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    // ✅ CORRECTION : Définir le type explicitement
    const data: Array<{ day: string; value: number }> = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));

      const count = await this.prisma.user.count({
        where: {
          lastLoginAt: { gte: startOfDay, lte: endOfDay },
        },
      });

      data.push({
        day: days[date.getDay()],
        value: count,
      });
    }

    return data;
  }
}
