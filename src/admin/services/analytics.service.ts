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
      mau,
      unitEconomics,
      featureAdoption,
      riskSignals,
    ] = await Promise.all([
      this.getGrowthData(),
      this.getChurnData(),
      this.getAcquisitionData(),
      this.getGeoDistribution(),
      this.getCohortData(),
      this.getDAU(),
      this.getMAU(),
      this.getUnitEconomics(),
      this.getFeatureAdoption(),
      this.getRiskSignals(),
    ]);

    return {
      growthData,
      churnData,
      acquisitionData,
      geoDistribution,
      cohortData,
      dau,
      mau,
      unitEconomics,
      featureAdoption,
      riskSignals,
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
      // Pas de champ "raison d'annulation" structuré en base pour l'instant
      // (le motif est juste du texte libre dans l'ActivityLog) → on ne peut
      // pas honnêtement calculer cette répartition, donc on ne l'invente plus.
      reasons: [],
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
    // Colonnes affichées par le composant frontend : Month 1, 2, 3, 6, 12
    const offsets = [1, 2, 3, 6, 12];
    const cohorts: Array<{ cohort: string; months: number[] }> = [];
    const now = new Date();

    for (let i = 2; i >= 0; i--) {
      const cohortStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const cohortEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const cohortCompanies = await this.prisma.company.findMany({
        where: { createdAt: { gte: cohortStart, lt: cohortEnd } },
        select: { archivedAt: true },
      });

      const total = cohortCompanies.length;
      const cohortName = cohortStart.toLocaleDateString('fr-FR', {
        month: 'short',
        year: '2-digit',
      });

      // Pour chaque échéance (M+1, M+2…), on ne peut donner un vrai chiffre
      // que si cette échéance est déjà passée. Sinon on renvoie 0 (le
      // composant l'affiche comme "-", ce qui est honnête : pas encore su).
      const months = offsets.map((offset) => {
        const checkpoint = new Date(cohortEnd.getFullYear(), cohortEnd.getMonth() + offset, 1);
        if (total === 0 || checkpoint > now) return 0;

        const retained = cohortCompanies.filter(
          (c) => !c.archivedAt || c.archivedAt > checkpoint,
        ).length;

        return Math.round((retained / total) * 100);
      });

      cohorts.push({ cohort: cohortName, months });
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

  /**
   * Utilisateurs actifs sur les 30 derniers jours (même logique que le DAU,
   * fenêtre plus large) — sert à calculer un vrai ratio DAU/MAU côté front.
   */
  private async getMAU() {
    const start = new Date();
    start.setDate(start.getDate() - 30);

    return this.prisma.user.count({
      where: { lastLoginAt: { gte: start } },
    });
  }

  /**
   * ARPU réel + répartition Direct/Parrainage (via la table AffiliateCompany
   * qui existe déjà) + rétention à 12 mois (même logique que les cohortes).
   * Pas de CAC : aucune donnée de dépense marketing n'existe en base, donc
   * on ne le calcule pas plutôt que d'inventer un chiffre.
   */
  private async getUnitEconomics() {
    const [activeCompaniesCount, mrrResult, totalCompanies, referredCompanies] =
      await Promise.all([
        this.prisma.company.count({
          where: { archivedAt: null, isActive: true },
        }),
        this.prisma.subscription.aggregate({
          where: { status: { in: ['ACTIVE', 'TRIALING'] }, company: { archivedAt: null } },
          _sum: { pricePerMonth: true },
        }),
        this.prisma.company.count(),
        this.prisma.affiliateCompany.count(),
      ]);

    const arpu =
      activeCompaniesCount > 0
        ? Math.round((Number(mrrResult._sum.pricePerMonth) || 0) / activeCompaniesCount)
        : 0;

    const referralPct = totalCompanies > 0
      ? Math.round((referredCompanies / totalCompanies) * 100)
      : 0;

    // Rétention à 12 mois : entreprises créées il y a au moins 1 an, encore
    // non archivées aujourd'hui.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const [companiesOverAYear, stillActiveOverAYear] = await Promise.all([
      this.prisma.company.count({ where: { createdAt: { lte: oneYearAgo } } }),
      this.prisma.company.count({
        where: { createdAt: { lte: oneYearAgo }, archivedAt: null },
      }),
    ]);

    const annualRetention = companiesOverAYear > 0
      ? Math.round((stillActiveOverAYear / companiesOverAYear) * 100)
      : null; // null = pas assez de recul (aucune entreprise n'a 1 an d'ancienneté)

    return {
      arpu,
      acquisitionChannels: {
        direct: 100 - referralPct,
        referral: referralPct,
      },
      annualRetention,
    };
  }

  /**
   * Adoption réelle des modules — % d'entreprises actives ayant au moins
   * une ligne dans la table correspondante. Remplace le mock "pas de
   * système de tracking de features" par un vrai proxy d'usage.
   */
  private async getFeatureAdoption() {
    const totalActive = await this.prisma.company.count({
      where: { archivedAt: null, isActive: true },
    });

    if (totalActive === 0) {
      return [];
    }

    const [payroll, documents, leaves, jobOffers, training] = await Promise.all([
      this.prisma.company.count({
        where: { archivedAt: null, isActive: true, payrolls: { some: {} } },
      }),
      this.prisma.company.count({
        where: { archivedAt: null, isActive: true, documents: { some: {} } },
      }),
      this.prisma.company.count({
        where: { archivedAt: null, isActive: true, leaves: { some: {} } },
      }),
      this.prisma.company.count({
        where: { archivedAt: null, isActive: true, jobOffers: { some: {} } },
      }),
      this.prisma.company.count({
        where: { archivedAt: null, isActive: true, trainingCourses: { some: {} } },
      }),
    ]);

    const pct = (n: number) => Math.round((n / totalActive) * 100);

    return [
      { name: 'Paie', value: pct(payroll) },
      { name: 'Documents', value: pct(documents) },
      { name: 'Congés', value: pct(leaves) },
      { name: 'Recrutement', value: pct(jobOffers) },
      { name: 'Formation', value: pct(training) },
    ];
  }

  /**
   * Remplace le widget "Prédiction Churn IA" (100% fictif) par des signaux
   * réels et honnêtes — pas d'IA, juste des règles simples sur des données
   * qui existent vraiment : pas de connexion depuis 14j+, ou 2+ paiements
   * échoués sur l'abonnement.
   */
  private async getRiskSignals() {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const activeCompanies = await this.prisma.company.findMany({
      where: { archivedAt: null, isActive: true },
      select: {
        id: true,
        legalName: true,
        users: { select: { lastLoginAt: true } },
        subscription: { select: { id: true } },
      },
    });

    const failedCounts = await this.prisma.payment.groupBy({
      by: ['subscriptionId'],
      where: { status: 'FAILED' },
      _count: true,
    });
    const failedBySubscription = new Map(
      failedCounts.map((f) => [f.subscriptionId, f._count]),
    );

    const risky = activeCompanies
      .map((c) => {
        const lastLogin = c.users
          .map((u) => u.lastLoginAt)
          .filter((d): d is Date => !!d)
          .sort((a, b) => b.getTime() - a.getTime())[0];

        const noRecentLogin = !lastLogin || lastLogin < fourteenDaysAgo;
        const failedPayments = c.subscription
          ? failedBySubscription.get(c.subscription.id) ?? 0
          : 0;

        const reasons: string[] = [];
        if (noRecentLogin) reasons.push('Aucune connexion depuis 14j+');
        if (failedPayments >= 2) reasons.push(`${failedPayments} paiements échoués`);

        return { name: c.legalName, reasons };
      })
      .filter((c) => c.reasons.length > 0)
      .slice(0, 10);

    return {
      count: risky.length,
      companies: risky,
    };
  }
}