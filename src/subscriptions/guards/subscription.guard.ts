// // Fichier: src/subscriptions/guards/subscription.guard.ts

// import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
// import { PrismaService } from '../../prisma/prisma.service';
// import { getPlanLimits, canUseFeature, isWithinLimit, PlanLimits } from '../config/plans.config';

// export type LimitType = keyof Pick<PlanLimits,
//   'maxEmployees' |
//   'maxUsers' |
//   'maxDepartments' |
//   'maxJobOffers'
// >;

// export type FeatureType = keyof Pick<PlanLimits,
//   'hasEmployeeManualCreate' |
//   'hasEmployeeImportExcel' |
//   'hasEmployeeExport' |
//   'hasAttendanceManual' |
//   'hasAttendanceGPS' |
//   'hasAttendanceCorrections' |
//   'hasPayrollIndividual' |
//   'hasPayrollBulk' |
//   'hasPayrollExport' |
//   'hasPayrollAccountingExport' |
//   'hasLeaveManagement' |
//   'hasRecruitmentManual' |
//   'hasRecruitmentAI' |
//   'hasDocumentManagement' |
//   'hasDocumentUnlimited' |
//   'hasAssetManagement' |
//   'hasPerformanceReviews' |
//   'hasTraining' |
//   'hasReportsBasic' |
//   'hasReportsAnalytics' |
//   'hasEmailNotifications' |
//   'hasEmailAutomation'

// >;

// @Injectable()
// export class SubscriptionGuard {
//   constructor(private prisma: PrismaService) {}

//   // ==========================================================================
//   // ✅ VÉRIFIER SI UNE FEATURE EST DISPONIBLE
//   // ==========================================================================

//   async checkFeatureAccess(companyId: string, feature: FeatureType): Promise<void> {
//     const subscription = await this.prisma.subscription.findUnique({
//       where: { companyId },
//       select: { plan: true, status: true, trialEndsAt: true }
//     });

//     if (!subscription) {
//       throw new NotFoundException('Aucun abonnement trouvé pour cette entreprise');
//     }

//     // ✅ CORRECTION : Accepter ACTIVE et TRIALING
//     if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
//       throw new ForbiddenException('Votre abonnement n\'est pas actif. Veuillez renouveler votre abonnement.');
//     }

//     // ✅ Si TRIALING, vérifier que l'essai n'est pas expiré
//     if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
//       if (new Date() > subscription.trialEndsAt) {
//         throw new ForbiddenException('Votre période d\'essai est expirée. Veuillez upgrader votre abonnement.');
//       }
//     }

//     const hasAccess = canUseFeature(subscription.plan, feature);

//     if (!hasAccess) {
//       throw new ForbiddenException(
//         `Cette fonctionnalité n'est pas disponible avec le plan ${subscription.plan}. ` +
//         `Veuillez upgrader votre abonnement pour y accéder.`
//       );
//     }
//   }

//   // ==========================================================================
//   // ✅ VÉRIFIER UNE LIMITE NUMÉRIQUE (AVEC TRANSACTION)
//   // ==========================================================================

//   async checkLimit(
//     companyId: string,
//     limitType: LimitType,
//     errorMessage?: string
//   ): Promise<void> {
//     // ✅ Utiliser une transaction pour éviter les race conditions
//     return this.prisma.$transaction(async (tx) => {
//       const subscription = await tx.subscription.findUnique({
//         where: { companyId },
//         select: { plan: true, status: true, trialEndsAt: true }
//       });

//       if (!subscription) {
//         throw new ForbiddenException('Aucun abonnement trouvé');
//       }

//       // ✅ CORRECTION : Accepter ACTIVE et TRIALING
//       if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
//         throw new ForbiddenException('Abonnement invalide ou inactif');
//       }

//       // ✅ Vérifier expiration essai
//       if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
//         if (new Date() > subscription.trialEndsAt) {
//           throw new ForbiddenException('Votre période d\'essai est expirée.');
//         }
//       }

//       const planLimits = getPlanLimits(subscription.plan);
//       const maxLimit = planLimits[limitType];

//       if (maxLimit === -1) return; // Illimité

//       // ✅ Compter avec FOR UPDATE pour lock
//       let currentCount = 0;

//       switch (limitType) {
//         case 'maxEmployees':
//           currentCount = await tx.employee.count({
//             where: { companyId, status: 'ACTIVE' }
//           });
//           break;

//         case 'maxUsers':
//           currentCount = await tx.user.count({
//             where: { companyId, isActive: true }
//           });
//           break;

//         case 'maxDepartments':
//           currentCount = await tx.department.count({
//             where: { companyId }
//           });
//           break;

//         case 'maxJobOffers':
//           currentCount = await tx.jobOffer.count({
//             where: {
//               companyId,
//               status: { in: ['DRAFT', 'PUBLISHED'] }
//             }
//           });
//           break;
//       }

//       if (currentCount >= maxLimit) {
//         const defaultMessage =
//           `Limite atteinte : ${currentCount}/${maxLimit} ${this.getLimitLabel(limitType)}. ` +
//           `Veuillez upgrader votre abonnement.`;
//         throw new ForbiddenException(errorMessage || defaultMessage);
//       }
//     });
//   }

//   // ==========================================================================
//   // 📊 RÉCUPÉRER LES STATS D'UTILISATION
//   // ==========================================================================

//   async getUsageStats(companyId: string) {
//     const subscription = await this.prisma.subscription.findUnique({
//       where: { companyId },
//       select: { plan: true, status: true, trialEndsAt: true }
//     });

//     if (!subscription) return null;

//     const planLimits = getPlanLimits(subscription.plan);

//     const [employeesCount, usersCount, departmentsCount, jobOffersCount] = await Promise.all([
//       this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } }),
//       this.prisma.user.count({ where: { companyId, isActive: true } }),
//       this.prisma.department.count({ where: { companyId } }),
//       this.prisma.jobOffer.count({
//         where: { companyId, status: { in: ['DRAFT', 'PUBLISHED'] } }
//       })
//     ]);

//     // ✅ Calculer jours restants essai
//    let daysLeftInTrial: number | null = null;  // Ajouter le type
//     if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
//       const diff = subscription.trialEndsAt.getTime() - new Date().getTime();
//       daysLeftInTrial = Math.ceil(diff / (1000 * 60 * 60 * 24));
//     }

//     return {
//       plan: subscription.plan,
//       status: subscription.status,
//       daysLeftInTrial, // ✅ Nouveau champ
//       limits: {
//         employees: {
//           current: employeesCount,
//           max: planLimits.maxEmployees,
//           percentage: planLimits.maxEmployees === -1 ? 0 :
//             Math.round((employeesCount / planLimits.maxEmployees) * 100)
//         },
//         users: {
//           current: usersCount,
//           max: planLimits.maxUsers,
//           percentage: planLimits.maxUsers === -1 ? 0 :
//             Math.round((usersCount / planLimits.maxUsers) * 100)
//         },
//         departments: {
//           current: departmentsCount,
//           max: planLimits.maxDepartments,
//           percentage: planLimits.maxDepartments === -1 ? 0 :
//             Math.round((departmentsCount / planLimits.maxDepartments) * 100)
//         },
//         jobOffers: {
//           current: jobOffersCount,
//           max: planLimits.maxJobOffers,
//           percentage: planLimits.maxJobOffers === -1 ? 0 :
//             Math.round((jobOffersCount / planLimits.maxJobOffers) * 100)
//         }
//       },
//       features: {
//         hasEmployeeImportExcel: planLimits.hasEmployeeImportExcel,
//         hasAttendanceGPS: planLimits.hasAttendanceGPS,
//         hasPayrollBulk: planLimits.hasPayrollBulk,
//         hasLeaveManagement: planLimits.hasLeaveManagement,
//         hasRecruitmentManual: planLimits.hasRecruitmentManual,
//         hasRecruitmentAI: planLimits.hasRecruitmentAI,
//         hasDocumentManagement: planLimits.hasDocumentManagement,
//         hasAssetManagement: planLimits.hasAssetManagement,
//         hasPerformanceReviews: planLimits.hasPerformanceReviews,
//         hasTraining: planLimits.hasTraining,
//         hasReportsAnalytics: planLimits.hasReportsAnalytics,
//         hasEmailAutomation: planLimits.hasEmailAutomation,
//       }
//     };
//   }

//   // ==========================================================================
//   // 🏷️ HELPER : Libellés des limites
//   // ==========================================================================

//   private getLimitLabel(limitType: LimitType): string {
//     const labels: Record<LimitType, string> = {
//       maxEmployees: 'employés',
//       maxUsers: 'utilisateurs',
//       maxDepartments: 'départements',
//       maxJobOffers: 'offres d\'emploi actives'
//     };
//     return labels[limitType];
//   }

//   // ==========================================================================
//   // 🔍 VÉRIFIER SI UNE FEATURE EST DISPONIBLE (SANS EXCEPTION)
//   // ==========================================================================

//   async hasFeature(companyId: string, feature: FeatureType): Promise<boolean> {
//     try {
//       const subscription = await this.prisma.subscription.findUnique({
//         where: { companyId },
//         select: { plan: true, status: true, trialEndsAt: true }
//       });

//       if (!subscription) return false;

//       // ✅ CORRECTION : Accepter ACTIVE et TRIALING
//       if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
//         return false;
//       }

//       // ✅ Vérifier expiration
//       if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
//         if (new Date() > subscription.trialEndsAt) return false;
//       }

//       return canUseFeature(subscription.plan, feature);
//     } catch {
//       return false;
//     }
//   }
// }

import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getPlanLimits,
  canUseFeature,
  isWithinLimit,
  PlanLimits,
} from '../config/plans.config';

export type LimitType = keyof Pick<
  PlanLimits,
  'maxEmployees' | 'maxUsers' | 'maxDepartments' | 'maxJobOffers'
>;

export type FeatureType = keyof Pick<
  PlanLimits,
  | 'hasEmployeeManualCreate'
  | 'hasEmployeeImportExcel'
  | 'hasEmployeeExport'
  | 'hasAttendanceManual'
  | 'hasAttendanceGPS'
  | 'hasAttendanceCorrections'
  | 'hasPayrollIndividual'
  | 'hasPayrollBulk'
  | 'hasPayrollExport'
  | 'hasPayrollAccountingExport'
  | 'hasLeaveManagement'
  | 'hasRecruitmentManual'
  | 'hasRecruitmentAI'
  | 'hasDocumentManagement'
  | 'hasDocumentUnlimited'
  | 'hasAssetManagement'
  | 'hasPerformanceReviews'
  | 'hasTraining'
  | 'hasOnboarding'
  | 'hasLoansAndAdvances'
  | 'hasReportsBasic'
  | 'hasReportsAnalytics'
  | 'hasEmailNotifications'
  | 'hasEmailAutomation'
>;

@Injectable()
export class SubscriptionGuard {
  constructor(private prisma: PrismaService) {}

  // ==========================================================================
  // ✅ VÉRIFIER SI UNE FEATURE EST DISPONIBLE
  // ==========================================================================

  async checkFeatureAccess(
    companyId: string,
    feature: FeatureType,
  ): Promise<void> {
    // ── PME gérée par cabinet → bypass total ────────────────────────────────
    // Ces PME n'ont pas de Subscription propre. Leur accès est garanti
    // par l'abonnement de leur cabinet. Toutes les features sont disponibles
    // sauf la paie en masse (gérée côté cabinet).
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { managedByCabinet: true },
    });
    if (company?.managedByCabinet) {
      // Bloquer uniquement hasPayrollBulk côté PME (géré par le cabinet)
      if (feature === 'hasPayrollBulk') {
        throw new ForbiddenException(
          'La génération groupée de bulletins est gérée par votre cabinet.',
        );
      }
      return; // tout le reste est autorisé
    }
    // ── fin bypass ───────────────────────────────────────────────────────────

    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
      select: {
        plan: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        'Aucun abonnement trouvé pour cette entreprise',
      );
    }

    // ✅ CORRECTION : Accepter ACTIVE et TRIALING
    if (
      subscription.status !== 'ACTIVE' &&
      subscription.status !== 'TRIALING'
    ) {
      throw new ForbiddenException(
        "Votre abonnement n'est pas actif. Veuillez renouveler votre abonnement.",
      );
    }

    // ✅ Si TRIALING, vérifier que l'essai n'est pas expiré
    if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
      if (new Date() > subscription.trialEndsAt) {
        throw new ForbiddenException(
          "Votre période d'essai est expirée. Veuillez upgrader votre abonnement.",
        );
      }
    }

    // 🐛 CORRECTIF : un abonnement payant ACTIVE dont la période est
    // dépassée doit être traité comme expiré même si le cron quotidien de
    // downgrade n'est pas encore passé (fenêtre de quelques heures max) —
    // sans ce filet de sécurité, l'accès payant restait utilisable jusqu'au
    // prochain passage du cron.
    if (
      subscription.status === 'ACTIVE' &&
      subscription.plan !== 'FREE' &&
      subscription.currentPeriodEnd &&
      new Date() > subscription.currentPeriodEnd
    ) {
      throw new ForbiddenException(
        "Votre abonnement est arrivé à échéance. Veuillez le renouveler pour continuer à profiter de cette fonctionnalité.",
      );
    }

    const hasAccess = canUseFeature(subscription.plan, feature);

    if (!hasAccess) {
      throw new ForbiddenException(
        `Cette fonctionnalité n'est pas disponible avec le plan ${subscription.plan}. ` +
          `Veuillez upgrader votre abonnement pour y accéder.`,
      );
    }
  }

  // ==========================================================================
  // ✅ VÉRIFIER UNE LIMITE NUMÉRIQUE (AVEC TRANSACTION)
  // ==========================================================================

  async checkLimit(
    companyId: string,
    limitType: LimitType,
    errorMessage?: string,
  ): Promise<void> {
    // ── PME gérée par cabinet → bypass total ────────────────────────────────
    // Les limites (maxEmployees, maxUsers, etc.) sont gérées au niveau
    // du plan cabinet (maxEmployees total sur toutes les PME), pas par PME.
    // Vérifier au niveau cabinet se fait dans CabinetSubscriptionService.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { managedByCabinet: true },
    });
    if (company?.managedByCabinet) return;
    // ── fin bypass ───────────────────────────────────────────────────────────

    // ✅ Utiliser une transaction pour éviter les race conditions
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { companyId },
        select: {
          plan: true,
          status: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
        },
      });

      if (!subscription) {
        throw new ForbiddenException('Aucun abonnement trouvé');
      }

      // ✅ CORRECTION : Accepter ACTIVE et TRIALING
      if (
        subscription.status !== 'ACTIVE' &&
        subscription.status !== 'TRIALING'
      ) {
        throw new ForbiddenException('Abonnement invalide ou inactif');
      }

      // ✅ Vérifier expiration essai
      if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
        if (new Date() > subscription.trialEndsAt) {
          throw new ForbiddenException("Votre période d'essai est expirée.");
        }
      }

      // 🐛 CORRECTIF : filet de sécurité identique à checkFeatureAccess —
      // un abonnement payant ACTIVE mais dont currentPeriodEnd est dépassé
      // ne doit pas laisser passer une action limitée avant le passage du
      // cron de downgrade quotidien.
      if (
        subscription.status === 'ACTIVE' &&
        subscription.plan !== 'FREE' &&
        subscription.currentPeriodEnd &&
        new Date() > subscription.currentPeriodEnd
      ) {
        throw new ForbiddenException(
          "Votre abonnement est arrivé à échéance. Veuillez le renouveler.",
        );
      }

      const planLimits = getPlanLimits(subscription.plan);
      const maxLimit = planLimits[limitType];

      if (maxLimit === -1) return; // Illimité

      // ✅ Compter avec FOR UPDATE pour lock
      let currentCount = 0;

      switch (limitType) {
        case 'maxEmployees':
          currentCount = await tx.employee.count({
            where: { companyId, status: 'ACTIVE' },
          });
          break;

        case 'maxUsers':
          currentCount = await tx.user.count({
            where: { companyId, isActive: true },
          });
          break;

        case 'maxDepartments':
          currentCount = await tx.department.count({
            where: { companyId },
          });
          break;

        case 'maxJobOffers':
          currentCount = await tx.jobOffer.count({
            where: {
              companyId,
              status: { in: ['DRAFT', 'PUBLISHED'] },
            },
          });
          break;
      }

      if (currentCount >= maxLimit) {
        const defaultMessage =
          `Limite atteinte : ${currentCount}/${maxLimit} ${this.getLimitLabel(limitType)}. ` +
          `Veuillez upgrader votre abonnement.`;
        throw new ForbiddenException(errorMessage || defaultMessage);
      }
    });
  }

  // ==========================================================================
  // 📊 RÉCUPÉRER LES STATS D'UTILISATION
  // ==========================================================================

  async getUsageStats(companyId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
      select: { plan: true, status: true, trialEndsAt: true },
    });

    if (!subscription) return null;

    const planLimits = getPlanLimits(subscription.plan);

    const [employeesCount, usersCount, departmentsCount, jobOffersCount] =
      await Promise.all([
        this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } }),
        this.prisma.user.count({ where: { companyId, isActive: true } }),
        this.prisma.department.count({ where: { companyId } }),
        this.prisma.jobOffer.count({
          where: { companyId, status: { in: ['DRAFT', 'PUBLISHED'] } },
        }),
      ]);

    // ✅ Calculer jours restants essai
    let daysLeftInTrial: number | null = null; // Ajouter le type
    if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
      const diff = subscription.trialEndsAt.getTime() - new Date().getTime();
      daysLeftInTrial = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    return {
      plan: subscription.plan,
      status: subscription.status,
      daysLeftInTrial, // ✅ Nouveau champ
      limits: {
        employees: {
          current: employeesCount,
          max: planLimits.maxEmployees,
          percentage:
            planLimits.maxEmployees === -1
              ? 0
              : Math.round((employeesCount / planLimits.maxEmployees) * 100),
        },
        users: {
          current: usersCount,
          max: planLimits.maxUsers,
          percentage:
            planLimits.maxUsers === -1
              ? 0
              : Math.round((usersCount / planLimits.maxUsers) * 100),
        },
        departments: {
          current: departmentsCount,
          max: planLimits.maxDepartments,
          percentage:
            planLimits.maxDepartments === -1
              ? 0
              : Math.round(
                  (departmentsCount / planLimits.maxDepartments) * 100,
                ),
        },
        jobOffers: {
          current: jobOffersCount,
          max: planLimits.maxJobOffers,
          percentage:
            planLimits.maxJobOffers === -1
              ? 0
              : Math.round((jobOffersCount / planLimits.maxJobOffers) * 100),
        },
      },
      features: {
        hasEmployeeImportExcel: planLimits.hasEmployeeImportExcel,
        hasAttendanceGPS: planLimits.hasAttendanceGPS,
        hasPayrollBulk: planLimits.hasPayrollBulk,
        hasLeaveManagement: planLimits.hasLeaveManagement,
        hasRecruitmentManual: planLimits.hasRecruitmentManual,
        hasRecruitmentAI: planLimits.hasRecruitmentAI,
        hasDocumentManagement: planLimits.hasDocumentManagement,
        hasAssetManagement: planLimits.hasAssetManagement,
        hasPerformanceReviews: planLimits.hasPerformanceReviews,
        hasTraining: planLimits.hasTraining,
        hasOnboarding: planLimits.hasOnboarding,
        hasLoansAndAdvances: planLimits.hasLoansAndAdvances,
        hasReportsAnalytics: planLimits.hasReportsAnalytics,
        hasEmailAutomation: planLimits.hasEmailAutomation,
      },
    };
  }

  // ==========================================================================
  // 🏷️ HELPER : Libellés des limites
  // ==========================================================================

  private getLimitLabel(limitType: LimitType): string {
    const labels: Record<LimitType, string> = {
      maxEmployees: 'employés',
      maxUsers: 'utilisateurs',
      maxDepartments: 'départements',
      maxJobOffers: "offres d'emploi actives",
    };
    return labels[limitType];
  }

  // ==========================================================================
  // 🔍 VÉRIFIER SI UNE FEATURE EST DISPONIBLE (SANS EXCEPTION)
  // ==========================================================================

  async hasFeature(companyId: string, feature: FeatureType): Promise<boolean> {
    try {
      const subscription = await this.prisma.subscription.findUnique({
        where: { companyId },
        select: {
          plan: true,
          status: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
        },
      });

      if (!subscription) return false;

      // ✅ CORRECTION : Accepter ACTIVE et TRIALING
      if (
        subscription.status !== 'ACTIVE' &&
        subscription.status !== 'TRIALING'
      ) {
        return false;
      }

      // ✅ Vérifier expiration
      if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
        if (new Date() > subscription.trialEndsAt) return false;
      }

      if (
        subscription.status === 'ACTIVE' &&
        subscription.plan !== 'FREE' &&
        subscription.currentPeriodEnd &&
        new Date() > subscription.currentPeriodEnd
      ) {
        return false;
      }

      return canUseFeature(subscription.plan, feature);
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // 🚧 VÉRIFICATION GÉNÉRALE D'ACCÈS — POUR TOUTE ACTION UTILISATEUR
  // ==========================================================================
  //
  // À appeler en tête de chaque action "métier" qu'un utilisateur (employé
  // OU admin/RH) peut déclencher — pointage, demande de prêt/avance, demande
  // de formation, demande de congé/absence, ticket de permission, etc.
  // Contrairement à checkFeatureAccess/checkLimit (qui vérifient UNE feature
  // ou UNE limite précise du plan), cette méthode répond à une question plus
  // simple : "l'abonnement de cette entreprise est-il dans un état qui doit
  // bloquer toute action ?" — essai/abonnement expiré, ou plan Gratuit
  // dépassant son quota d'employés inclus suite à un non-renouvellement.
  //
  // Le message renvoyé s'adapte au rôle de l'auteur de l'action : un
  // admin/RH est renvoyé vers le renouvellement, un employé (ou manager) ne
  // voit qu'un message doux l'invitant à contacter son RH — jamais de détail
  // de facturation côté employé.
  // ==========================================================================

  private static readonly HR_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

  async assertActionAllowed(companyId: string, role?: string): Promise<void> {
    // ── PME gérée par cabinet → bypass total ──────────────────────────────
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { managedByCabinet: true },
    });
    if (company?.managedByCabinet) return;
    // ── fin bypass ─────────────────────────────────────────────────────────

    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
      select: {
        plan: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    });

    // Pas d'abonnement configuré pour cette entreprise (cas anormal /
    // legacy) → on ne bloque pas par erreur d'intégration, checkFeatureAccess
    // /checkLimit restent le filet de sécurité principal ailleurs.
    if (!subscription) return;

    const now = new Date();

    const trialExpired =
      subscription.status === 'TRIALING' &&
      !!subscription.trialEndsAt &&
      subscription.trialEndsAt < now;

    const paidExpired =
      subscription.plan !== 'FREE' &&
      (subscription.status === 'CANCELED' ||
        subscription.status === 'PAST_DUE' ||
        (subscription.status === 'ACTIVE' &&
          subscription.currentPeriodEnd < now));

    let blocked = trialExpired || paidExpired;

    // Plan Gratuit (choisi ou atteint suite à non-renouvellement) : au-delà
    // du quota d'employés inclus, on bloque plutôt que de laisser deviner
    // qui "compte" encore parmi les employés existants.
    if (!blocked && subscription.plan === 'FREE') {
      const maxEmployees = getPlanLimits('FREE').maxEmployees;
      if (maxEmployees !== -1) {
        const activeCount = await this.prisma.employee.count({
          where: { companyId, status: 'ACTIVE' },
        });
        if (activeCount > maxEmployees) blocked = true;
      }
    }

    if (!blocked) return;

    if (role && SubscriptionGuard.HR_ROLES.includes(role)) {
      throw new ForbiddenException(
        "L'abonnement de votre entreprise est terminé et l'accès est désormais limité au plan Gratuit. Renouvelez votre abonnement pour redonner à votre équipe un accès complet.",
      );
    }

    throw new ForbiddenException(
      "Accès bloqué. Merci de contacter votre RH ou administrateur pour régulariser l'abonnement de votre entreprise.",
    );
  }
}