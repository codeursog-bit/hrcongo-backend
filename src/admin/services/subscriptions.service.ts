// ============================================================================
// Fichier: backend/src/admin/services/subscriptions.service.ts
// Service ADMIN dédié — n'appelle jamais le SubscriptionsService "tenant"
// ============================================================================

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
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
   * Réactive l'abonnement d'une entreprise (statut → ACTIVE).
   */
  async activate(companyId: string, actorUserId: string, reason?: string) {
    const subscription = await this.getRawOrThrow(companyId);

    const updated = await this.prisma.subscription.update({
      where: { companyId },
      data: {
        status: 'ACTIVE',
        canceledAt: null,
      },
    });

    await this.logAction(actorUserId, companyId, {
      action: 'SUBSCRIPTION_ACTIVATED',
      description: `Abonnement de l'entreprise ${companyId} réactivé par le super admin`,
      changes: { before: { status: subscription.status }, after: { status: updated.status } },
      metadata: reason ? { reason } : undefined,
    });

    return updated;
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
   * Prolonge la période courante d'un abonnement de N jours
   * (paiement manuel/hors ligne, geste commercial, etc.)
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

    await this.logAction(actorUserId, companyId, {
      action: 'SUBSCRIPTION_EXTENDED',
      description: `Abonnement de l'entreprise ${companyId} prolongé de ${dto.days} jour(s) par le super admin`,
      changes: {
        before: { currentPeriodEnd: subscription.currentPeriodEnd },
        after: { currentPeriodEnd: updated.currentPeriodEnd },
      },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    return updated;
  }

  // ==========================================================================
  // 🔧 Helpers privés
  // ==========================================================================

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