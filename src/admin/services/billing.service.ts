// ============================================================================
// Fichier: backend/src/admin/services/billing.service.ts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {}

  async getBillingStats() {
    this.logger.log('💰 Récupération stats billing...');

    const [totalRevenue, recentTransactions, subscriptionEvents, revenueHistory] =
      await Promise.all([
        this.getTotalRevenue(),
        this.getRecentTransactions(),
        this.getSubscriptionEvents(),
        this.getRevenueHistory(),
      ]);

    return {
      totalRevenue,
      recentTransactions,
      subscriptionEvents,
      revenueHistory,
    };
  }

  private async getTotalRevenue() {
    const result = await this.prisma.payment.aggregate({
      where: { status: 'SUCCEEDED' },
      _sum: { amount: true },
    });

    return Number(result._sum.amount) || 0;
  }

  /**
   * Revenu encaissé (paiements SUCCEEDED) mois par mois, sur les 6 derniers
   * mois — alimente le graphique d'évolution qui était vide jusqu'ici (le
   * champ n'existait tout simplement pas côté backend).
   */
  private async getRevenueHistory() {
    const months: { month: string; value: number }[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const result = await this.prisma.payment.aggregate({
        where: { status: 'SUCCEEDED', createdAt: { gte: start, lt: end } },
        _sum: { amount: true },
      });

      months.push({
        month: start.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
        value: Number(result._sum.amount) || 0,
      });
    }

    return months;
  }

  private async getRecentTransactions() {
    const transactions = await this.prisma.payment.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        company: {
          select: {
            legalName: true,
            tradeName: true,
          },
        },
        subscription: {
          select: {
            plan: true,
          },
        },
      },
    });

    // ⚠️ Forme alignée sur ce que consomme réellement billing/page.tsx —
    // avant, les champs s'appelaient différemment (`date` au lieu de
    // `createdAt`, `companyName` au lieu de `company.legalName`), donc la
    // date et le nom de l'entreprise affichaient toujours "—" dans le
    // tableau, silencieusement, depuis le début.
    return transactions.map((t) => ({
      id: t.id,
      invoiceId: t.yabetooIntentId || t.clientSecret || `INV-${t.id.slice(0, 8)}`,
      companyId: t.companyId,
      company: {
        legalName: t.company.legalName,
        tradeName: t.company.tradeName,
      },
      subscription: {
        plan: t.subscription?.plan ?? null,
      },
      amount: Number(t.amount),
      createdAt: t.createdAt.toISOString(),
      paymentMethod: t.paymentMethod || 'Bank Transfer',
      status: t.status, // brut (SUCCEEDED/FAILED/...) — le mapping d'affichage se fait côté front
    }));
  }

  private async getSubscriptionEvents() {
    const recentPayments = await this.prisma.payment.findMany({
      where: {
        status: 'SUCCEEDED',
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        company: {
          select: {
            legalName: true,
            tradeName: true,
          },
        },
        subscription: {
          select: {
            plan: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return recentPayments.map((p) => ({
      id: p.id,
      type: 'upgrade',
      companyName: p.company.tradeName || p.company.legalName,
      details: `Paiement ${p.subscription?.plan ?? ''}`,
      impact: Number(p.amount),
      date: p.createdAt.toLocaleDateString('fr-FR', {
        month: 'short',
        day: 'numeric',
      }),
    }));
  }

  private generateInitials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}