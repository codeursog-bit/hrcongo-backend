// ============================================================================
// Fichier: backend/src/admin/services/subscriptions.service.ts
// Service ADMIN dédié — n'appelle jamais le SubscriptionsService "tenant"
// ============================================================================

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ActivateSubscriptionDto,
  SetSubscriptionPeriodDto,
  UpdateSubscriptionPlanDto,
  SuspendSubscriptionDto,
  ExtendSubscriptionDto,
} from '../dto/company-actions.dto';

const PLAN_DEFAULT_PRICE: Record<string, number> = {
  FREE: 0,
  BASIC: 15000,
  PRO: 35000,
  ENTERPRISE: 75000,
};

@Injectable()
export class AdminSubscriptionsService {
  private readonly logger = new Logger(AdminSubscriptionsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Liste tous les abonnements avec leur échéance, pour repérer ceux qui
   * expirent bientôt ou qui sont déjà expirés. Un abonnement expiré garde
   * toujours son plan/statut actuel affiché — rien n'est masqué.
   */
  async getAll(filters?: { expiringInDays?: number; expired?: boolean; status?: string }) {
    const where: any = {};
    const now = new Date();

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.expired) {
      where.currentPeriodEnd = { lt: now };
    } else if (filters?.expiringInDays !== undefined) {
      const limit = new Date(now.getTime() + filters.expiringInDays * 24 * 60 * 60 * 1000);
      where.currentPeriodEnd = { gte: now, lte: limit };
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where,
      include: {
        company: {
          select: { id: true, legalName: true, tradeName: true, archivedAt: true },
        },
      },
      orderBy: { currentPeriodEnd: 'asc' },
    });

    return subscriptions
      // Les entreprises archivées sont déjà traitées par l'archivage
      // (abonnement annulé) — pas utile de les remonter dans ce triage.
      .filter((s) => !s.company.archivedAt)
      .map((s) => {
        const daysRemaining = Math.ceil(
          (s.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );
        return {
          companyId: s.companyId,
          companyName: s.company.tradeName || s.company.legalName,
          plan: s.plan,
          status: s.status,
          pricePerMonth: s.pricePerMonth,
          currentPeriodEnd: s.currentPeriodEnd,
          daysRemaining,
          isExpired: daysRemaining < 0,
        };
      });
  }

  /**
   * Réactive l'abonnement d'une entreprise (statut → ACTIVE).
   * Si `amount` est fourni, enregistre aussi le paiement manuel encaissé
   * hors plateforme (virement, cash, mobile money) — il apparaît alors
   * dans le CA (/admin/billing) comme n'importe quel paiement YabetooPay.
   */
  async activate(companyId: string, dto: ActivateSubscriptionDto, actorUserId: string) {
    const subscription = await this.getRawOrThrow(companyId);

    const updated = await this.prisma.subscription.update({
      where: { companyId },
      data: {
        status: 'ACTIVE',
        canceledAt: null,
      },
    });

    let payment: Payment | null = null;
    if (dto.amount && dto.amount > 0) {
      payment = await this.recordManualPayment(companyId, subscription.id, {
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        description: `Réactivation manuelle par le super admin${dto.reason ? ' — ' + dto.reason : ''}`,
      });
    }

    await this.logAction(actorUserId, companyId, {
      action: 'SUBSCRIPTION_ACTIVATED',
      description: `Abonnement de l'entreprise ${companyId} réactivé par le super admin`,
      changes: { before: { status: subscription.status }, after: { status: updated.status } },
      metadata: {
        ...(dto.reason ? { reason: dto.reason } : {}),
        paymentRecorded: !!payment,
        paymentId: payment?.id,
      },
    });

    return { subscription: updated, payment };
  }

  /**
   * Définit une période précise (date de début optionnelle → date de fin
   * obligatoire) et le cycle de facturation (mensuel/annuel), au lieu de
   * juste "prolonger de N jours". Utile pour coller exactement à ce que
   * le client a réellement payé (ex: du 1er janvier au 31 décembre).
   */
  async setPeriod(companyId: string, dto: SetSubscriptionPeriodDto, actorUserId: string) {
    const subscription = await this.getRawOrThrow(companyId);

    const endDate = new Date(dto.endDate);
    const startDate = dto.startDate ? new Date(dto.startDate) : subscription.currentPeriodStart;

    const updated = await this.prisma.subscription.update({
      where: { companyId },
      data: {
        status: 'ACTIVE',
        canceledAt: null,
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        billingCycle: dto.billingCycle ?? subscription.billingCycle,
      },
    });

    let payment: Payment | null = null;
    if (dto.amount && dto.amount > 0) {
      payment = await this.recordManualPayment(companyId, subscription.id, {
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        description: `Période définie manuellement (${startDate.toLocaleDateString('fr-FR')} → ${endDate.toLocaleDateString('fr-FR')}) par le super admin${dto.reason ? ' — ' + dto.reason : ''}`,
      });
    }

    await this.logAction(actorUserId, companyId, {
      action: 'SUBSCRIPTION_PERIOD_SET',
      description: `Période de l'abonnement de l'entreprise ${companyId} définie du ${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')} par le super admin`,
      changes: {
        before: {
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          billingCycle: subscription.billingCycle,
        },
        after: {
          currentPeriodStart: updated.currentPeriodStart,
          currentPeriodEnd: updated.currentPeriodEnd,
          billingCycle: updated.billingCycle,
        },
      },
      metadata: {
        ...(dto.reason ? { reason: dto.reason } : {}),
        paymentRecorded: !!payment,
        paymentId: payment?.id,
      },
    });

    return { subscription: updated, payment };
  }

  /**
   * Suspend ou annule l'abonnement d'une entreprise.
   */
  async suspend(companyId: string, dto: SuspendSubscriptionDto, actorUserId: string) {
    const subscription = await this.getRawOrThrow(companyId);
    const newStatus = dto.status ?? 'PAUSED';

    const updated = await this.prisma.subscription.update({
      where: { companyId },
      data: {
        status: newStatus,
        canceledAt: newStatus === 'CANCELED' ? new Date() : subscription.canceledAt,
      },
    });

    await this.logAction(actorUserId, companyId, {
      action: newStatus === 'CANCELED' ? 'SUBSCRIPTION_CANCELED' : 'SUBSCRIPTION_SUSPENDED',
      description: `Abonnement de l'entreprise ${companyId} passé en ${newStatus} par le super admin`,
      changes: { before: { status: subscription.status }, after: { status: updated.status } },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    return updated;
  }

  /**
   * Change le plan d'un abonnement (et optionnellement son prix mensuel).
   */
  async changePlan(companyId: string, dto: UpdateSubscriptionPlanDto, actorUserId: string) {
    const subscription = await this.getRawOrThrow(companyId);

    const pricePerMonth =
      dto.pricePerMonth ?? PLAN_DEFAULT_PRICE[dto.plan] ?? subscription.pricePerMonth;

    const updated = await this.prisma.subscription.update({
      where: { companyId },
      data: {
        plan: dto.plan as any,
        pricePerMonth,
      },
    });

    await this.logAction(actorUserId, companyId, {
      action: 'SUBSCRIPTION_PLAN_CHANGED',
      description: `Plan de l'entreprise ${companyId} changé en ${dto.plan} par le super admin`,
      changes: {
        before: { plan: subscription.plan, pricePerMonth: subscription.pricePerMonth },
        after: { plan: updated.plan, pricePerMonth: updated.pricePerMonth },
      },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    return updated;
  }

  /**
   * Prolonge la période courante d'un abonnement de N jours.
   * Même logique que `activate` pour le paiement manuel optionnel : si
   * `amount` est fourni, c'est un renouvellement payé hors plateforme et
   * ça compte dans le CA ; sinon c'est un geste gratuit, rien n'est facturé.
   */
  async extend(companyId: string, dto: ExtendSubscriptionDto, actorUserId: string) {
    const subscription = await this.getRawOrThrow(companyId);

    const base =
      subscription.currentPeriodEnd > new Date()
        ? subscription.currentPeriodEnd
        : new Date();
    const newPeriodEnd = new Date(base.getTime() + dto.days * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.subscription.update({
      where: { companyId },
      data: {
        currentPeriodEnd: newPeriodEnd,
        // Si l'abonnement était en pause/expiré, prolonger le remet actif
        status: subscription.status === 'CANCELED' ? subscription.status : 'ACTIVE',
      },
    });

    let payment: Payment | null = null;
    if (dto.amount && dto.amount > 0) {
      payment = await this.recordManualPayment(companyId, subscription.id, {
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        description: `Prolongation manuelle de ${dto.days} jour(s) par le super admin${dto.reason ? ' — ' + dto.reason : ''}`,
      });
    }

    await this.logAction(actorUserId, companyId, {
      action: 'SUBSCRIPTION_EXTENDED',
      description: `Abonnement de l'entreprise ${companyId} prolongé de ${dto.days} jour(s) par le super admin`,
      changes: {
        before: { currentPeriodEnd: subscription.currentPeriodEnd },
        after: { currentPeriodEnd: updated.currentPeriodEnd },
      },
      metadata: {
        ...(dto.reason ? { reason: dto.reason } : {}),
        paymentRecorded: !!payment,
        paymentId: payment?.id,
      },
    });

    return { subscription: updated, payment };
  }

  // ==========================================================================
  // 🔧 Helpers privés
  // ==========================================================================

  /**
   * Enregistre un paiement encaissé hors plateforme (virement, cash, mobile
   * money) directement en SUCCEEDED — il n'y a pas de webhook à attendre
   * puisque l'argent a déjà été reçu au moment où le super admin clique.
   */
  private async recordManualPayment(
    companyId: string,
    subscriptionId: string,
    data: { amount: number; paymentMethod?: string; description: string },
  ) {
    return this.prisma.payment.create({
      data: {
        subscriptionId,
        companyId,
        provider: 'MANUAL',
        amount: data.amount,
        currency: 'XAF',
        status: 'SUCCEEDED',
        paymentMethod: data.paymentMethod ?? 'Autre',
        description: data.description,
        paidAt: new Date(),
      },
    });
  }

  private async getRawOrThrow(companyId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
    });
    if (!subscription) {
      throw new NotFoundException(
        `Aucun abonnement trouvé pour l'entreprise ${companyId}`,
      );
    }
    return subscription;
  }

  private async logAction(
    userId: string,
    companyId: string,
    entry: { action: string; description: string; changes?: any; metadata?: any },
  ) {
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: entry.action,
        entity: 'SUBSCRIPTION',
        entityId: companyId,
        description: entry.description,
        changes: entry.changes,
        metadata: entry.metadata,
      },
    });
  }
}