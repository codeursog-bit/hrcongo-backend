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

    const [totalRevenue, recentTransactions, subscriptionEvents] =
      await Promise.all([
        this.getTotalRevenue(),
        this.getRecentTransactions(),
        this.getSubscriptionEvents(),
      ]);

    return {
      totalRevenue,
      recentTransactions,
      subscriptionEvents,
    };
  }

  private async getTotalRevenue() {
    const result = await this.prisma.payment.aggregate({
      where: { status: 'SUCCEEDED' },
      _sum: { amount: true },
    });

    return Number(result._sum.amount) || 0;
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

    return transactions.map((t) => ({
      id: t.id,
      invoiceId:
        t.yabetooIntentId || t.clientSecret || `INV-${t.id.slice(0, 8)}`,
      companyId: t.companyId,
      companyName: t.company.tradeName || t.company.legalName,
      companyLogo: this.generateInitials(t.company.legalName),
      plan: t.subscription.plan,
      amount: Number(t.amount),
      date: t.createdAt.toISOString(),
      method: t.paymentMethod || 'Bank Transfer',
      status: this.mapPaymentStatus(t.status),
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
      details: `Paiement ${p.subscription.plan}`,
      impact: Number(p.amount),
      date: p.createdAt.toLocaleDateString('fr-FR', {
        month: 'short',
        day: 'numeric',
      }),
    }));
  }

  private mapPaymentStatus(status: string): string {
    const statusMap: Record<string, string> = {
      SUCCEEDED: 'Success',
      FAILED: 'Failed',
      PENDING: 'Pending',
      PROCESSING: 'Pending',
      REFUNDED: 'Refunded',
    };
    return statusMap[status] || 'Unknown';
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
