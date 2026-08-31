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
      select: { plan: true, status: true, trialEndsAt: true },
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
        select: { plan: true, status: true, trialEndsAt: true },
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
        select: { plan: true, status: true, trialEndsAt: true },
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

      return canUseFeature(subscription.plan, feature);
    } catch {
      return false;
    }
  }
}
