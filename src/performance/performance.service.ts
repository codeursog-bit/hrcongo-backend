// ============================================================================
// 📄 src/performance/performance.service.ts — CORRIGÉ
// ReviewStatus: DRAFT | SUBMITTED | ACKNOWLEDGED  (pas SHARED)
// Notification: read (pas isRead)
// companyId: toujours string (garanti non-null)
// ============================================================================

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { ReviewStatus } from '@prisma/client';

export const CRITERIA_TEMPLATES: Record<
  string,
  { label: string; criteria: any[] }
> = {
  general: {
    label: 'Grille générale',
    criteria: [
      {
        id: 'qualite_travail',
        label: 'Qualité du travail',
        weight: 25,
        score: 0,
        comment: '',
      },
      {
        id: 'ponctualite',
        label: 'Ponctualité et présence',
        weight: 20,
        score: 0,
        comment: '',
      },
      {
        id: 'initiative',
        label: 'Initiative et autonomie',
        weight: 20,
        score: 0,
        comment: '',
      },
      {
        id: 'travail_equipe',
        label: 'Travail en équipe',
        weight: 20,
        score: 0,
        comment: '',
      },
      {
        id: 'communication',
        label: 'Communication',
        weight: 15,
        score: 0,
        comment: '',
      },
    ],
  },
  industrial: {
    label: 'Industrielle / Pétrolière',
    criteria: [
      { id: 'hse', label: 'Respect HSE', weight: 30, score: 0, comment: '' },
      {
        id: 'qualite_tech',
        label: 'Qualité technique',
        weight: 25,
        score: 0,
        comment: '',
      },
      {
        id: 'ponctualite',
        label: 'Ponctualité',
        weight: 15,
        score: 0,
        comment: '',
      },
      {
        id: 'initiative',
        label: 'Initiative',
        weight: 15,
        score: 0,
        comment: '',
      },
      {
        id: 'communication',
        label: 'Communication',
        weight: 15,
        score: 0,
        comment: '',
      },
    ],
  },
  commercial: {
    label: 'Commerciale',
    criteria: [
      {
        id: 'perf_vente',
        label: 'Performance commerciale',
        weight: 35,
        score: 0,
        comment: '',
      },
      {
        id: 'relation_client',
        label: 'Relation client',
        weight: 25,
        score: 0,
        comment: '',
      },
      {
        id: 'objectifs',
        label: 'Atteinte des objectifs',
        weight: 20,
        score: 0,
        comment: '',
      },
      {
        id: 'initiative',
        label: 'Prospection',
        weight: 10,
        score: 0,
        comment: '',
      },
      {
        id: 'reporting',
        label: 'Reporting',
        weight: 10,
        score: 0,
        comment: '',
      },
    ],
  },
  probation: {
    label: "Fin de période d'essai",
    criteria: [
      {
        id: 'integration',
        label: "Intégration dans l'équipe",
        weight: 20,
        score: 0,
        comment: '',
      },
      {
        id: 'competences',
        label: 'Maîtrise du poste',
        weight: 30,
        score: 0,
        comment: '',
      },
      {
        id: 'autonomie',
        label: 'Autonomie',
        weight: 20,
        score: 0,
        comment: '',
      },
      {
        id: 'comportement',
        label: 'Comportement professionnel',
        weight: 15,
        score: 0,
        comment: '',
      },
      {
        id: 'ponctualite',
        label: 'Ponctualité',
        weight: 15,
        score: 0,
        comment: '',
      },
    ],
  },
};

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  private calcScore(criteria: any[]): number {
    if (!criteria?.length) return 0;
    const totalW = criteria.reduce(
      (s: number, c: any) => s + (c.weight ?? 0),
      0,
    );
    if (!totalW) return 0;
    return (
      Math.round(
        (criteria.reduce(
          (s: number, c: any) => s + (c.score ?? 0) * (c.weight ?? 0),
          0,
        ) /
          totalW) *
          100,
      ) / 100
    );
  }

  static scoreLabel(score: number): string {
    if (score >= 4.5) return 'Exceptionnel';
    if (score >= 3.5) return 'Très bien';
    if (score >= 2.5) return 'Bien';
    if (score >= 1.5) return 'À améliorer';
    return 'Insuffisant';
  }

  private generatePeriod(type?: string): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (type === 'PROBATION') return `Période d'essai ${y}`;
    if (type === 'EXCEPTIONAL') return `Évaluation exceptionnelle ${y}`;
    if (type === 'QUARTERLY') {
      const q = Math.floor(m / 3) + 1;
      return `Q${q} ${y}`;
    }
    return `Annuel ${y}`;
  }

  // companyId garanti non-null
  private async getUserCtx(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, email: true },
    });
    if (!user?.companyId) throw new ForbiddenException('Accès refusé');
    return user as typeof user & { companyId: string };
  }

  private reviewInclude() {
    return {
      employee: {
        select: {
          firstName: true,
          lastName: true,
          position: true,
          photoUrl: true,
          department: { select: { name: true } },
        },
      },
      reviewer: { select: { id: true, firstName: true, lastName: true } },
    };
  }

  private async notifyUser(
    email: string | null,
    companyId: string,
    title: string,
    message: string,
  ) {
    if (!email) return;
    try {
      const u = await this.prisma.user.findFirst({
        where: { email, companyId },
        select: { id: true },
      });
      if (!u) return;
      await this.prisma.notification.create({
        data: {
          userId: u.id,
          type: 'SYSTEM_ALERT',
          title,
          message,
          read: false,
        }, // ← read pas isRead
      });
    } catch (e) {
      this.logger.warn('Erreur notification performance', e);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GRILLES TEMPLATES
  // ──────────────────────────────────────────────────────────────────────────

  getCriteriaTemplates() {
    return Object.entries(CRITERIA_TEMPLATES).map(([key, v]) => ({
      key,
      label: v.label,
      criteria: v.criteria,
    }));
  }

  getCriteriaTemplate(key: string) {
    const tpl = CRITERIA_TEMPLATES[key];
    if (!tpl) throw new NotFoundException(`Grille "${key}" introuvable`);
    return { key, ...tpl };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CREATE REVIEW
  // ──────────────────────────────────────────────────────────────────────────

  async createReview(data: any, reviewerId: string) {
    const user = await this.getUserCtx(reviewerId);

    const employee = await this.prisma.employee.findUnique({
      where: { id: data.employeeId },
      select: { id: true, companyId: true, firstName: true, lastName: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
    if (employee.companyId !== user.companyId)
      throw new ForbiddenException('Employé non autorisé');

    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasPerformanceReviews',
    );

    const criteria = data.criteria ?? null;
    const overallScore = criteria ? this.calcScore(criteria) : null;
    const period = data.period || this.generatePeriod(data.reviewType);

    return this.prisma.performanceReview.create({
      data: {
        employeeId: data.employeeId,
        reviewerId,
        period,
        date: data.date ? new Date(data.date) : new Date(),
        rating: overallScore ?? data.rating ?? data.score ?? null,
        feedback: data.feedback ?? data.comments ?? null,
        status: ReviewStatus.DRAFT,
        // Champs v2
        ...(data.reviewType != null && { reviewType: data.reviewType }),
        ...(criteria != null && { criteria }),
        ...(overallScore != null && { overallScore }),
        ...(data.strengths != null && { strengths: data.strengths }),
        ...(data.improvements != null && { improvements: data.improvements }),
        ...(data.nextGoals != null && { nextGoals: data.nextGoals }),
      },
      include: this.reviewInclude(),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UPDATE REVIEW
  // ──────────────────────────────────────────────────────────────────────────

  async updateReview(reviewId: string, data: any, userId: string) {
    const user = await this.getUserCtx(userId);
    const review = await this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: { employee: { select: { companyId: true } } },
    });
    if (!review) throw new NotFoundException('Évaluation introuvable');
    if (review.employee.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (review.status !== ReviewStatus.DRAFT)
      throw new BadRequestException('Seuls les brouillons sont modifiables');

    const criteria = data.criteria ?? (review as any).criteria ?? null;
    const overallScore = criteria ? this.calcScore(criteria) : null;

    return this.prisma.performanceReview.update({
      where: { id: reviewId },
      data: {
        ...(data.period != null && { period: data.period }),
        ...(data.date != null && { date: new Date(data.date) }),
        ...(criteria != null && {
          criteria,
          overallScore,
          rating: overallScore,
        }),
        ...(data.feedback !== undefined && { feedback: data.feedback }),
        ...(data.strengths !== undefined && { strengths: data.strengths }),
        ...(data.improvements !== undefined && {
          improvements: data.improvements,
        }),
        ...(data.nextGoals !== undefined && { nextGoals: data.nextGoals }),
        ...(data.reviewType != null && { reviewType: data.reviewType }),
      },
      include: this.reviewInclude(),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUBMIT (DRAFT → SUBMITTED)
  // ──────────────────────────────────────────────────────────────────────────

  async submitReview(reviewId: string, userId: string) {
    const user = await this.getUserCtx(userId);
    const review = await this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: {
        employee: {
          select: {
            companyId: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        reviewer: { select: { firstName: true, lastName: true } },
      },
    });
    if (!review) throw new NotFoundException('Évaluation introuvable');
    if (review.employee.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (review.status !== ReviewStatus.DRAFT)
      throw new BadRequestException('Évaluation déjà soumise');

    const updated = await this.prisma.performanceReview.update({
      where: { id: reviewId },
      data: { status: ReviewStatus.SUBMITTED, submittedAt: new Date() } as any,
      include: this.reviewInclude(),
    });

    await this.notifyUser(
      review.employee.email,
      user.companyId,
      '📋 Votre évaluation est disponible',
      `Votre évaluation "${review.period}" a été finalisée par ${review.reviewer.firstName} ${review.reviewer.lastName}.`,
    );

    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ACKNOWLEDGE (SUBMITTED → ACKNOWLEDGED)
  // ──────────────────────────────────────────────────────────────────────────

  async acknowledgeReview(reviewId: string, userId: string) {
    const user = await this.getUserCtx(userId);
    const review = await this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: {
        employee: {
          select: {
            companyId: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    if (!review) throw new NotFoundException('Évaluation introuvable');
    if (review.employee.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (review.status !== ReviewStatus.SUBMITTED)
      throw new BadRequestException('Évaluation non en attente de réception');

    const updated = await this.prisma.performanceReview.update({
      where: { id: reviewId },
      data: {
        status: ReviewStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      } as any,
      include: this.reviewInclude(),
    });

    try {
      await this.prisma.notification.create({
        data: {
          userId: review.reviewerId,
          type: 'SYSTEM_ALERT',
          title: '✅ Évaluation réceptionnée',
          message: `${review.employee.firstName} ${review.employee.lastName} a accusé réception de son évaluation "${review.period}".`,
          read: false, // ← read pas isRead
        },
      });
    } catch {}

    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIND ALL
  // ──────────────────────────────────────────────────────────────────────────

  async findAllReviews(userId: string, overrideCompanyId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true, email: true },
    });
    const isCabinet =
      user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    const companyId =
      isCabinet && overrideCompanyId ? overrideCompanyId : user?.companyId;
    if (!companyId) return [];

    // EMPLOYEE → uniquement ses évaluations soumises/ackd
    if (user?.role === 'EMPLOYEE') {
      const emp = await this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
        select: { id: true },
      });
      if (!emp) return [];
      return this.prisma.performanceReview.findMany({
        where: {
          employeeId: emp.id,
          status: { in: [ReviewStatus.SUBMITTED, ReviewStatus.ACKNOWLEDGED] },
        },
        include: this.reviewInclude(),
        orderBy: { createdAt: 'desc' },
      });
    }

    const whereClause: any = { companyId };
    if (!isCabinet && user!.role === 'MANAGER') {
      const mgr = await this.prisma.employee.findFirst({
        where: { email: user!.email, companyId },
      });
      if (mgr?.departmentId) whereClause.departmentId = mgr.departmentId;
      else return [];
    }

    return this.prisma.performanceReview.findMany({
      where: { employee: whereClause },
      include: this.reviewInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIND ONE
  // ──────────────────────────────────────────────────────────────────────────

  async findOneReview(reviewId: string, userId: string) {
    const user = await this.getUserCtx(userId);
    const review = await this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: this.reviewInclude(),
    });
    if (!review) throw new NotFoundException('Évaluation introuvable');

    const emp = await this.prisma.employee.findUnique({
      where: { id: review.employeeId },
      select: { companyId: true, email: true },
    });
    if (emp?.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (user.role === 'EMPLOYEE') {
      if (emp?.email !== user.email)
        throw new ForbiddenException('Accès refusé');
      if (review.status === ReviewStatus.DRAFT)
        throw new ForbiddenException('Évaluation non disponible');
    }

    return {
      ...review,
      scoreLabel: review.rating
        ? PerformanceService.scoreLabel(Number(review.rating))
        : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HISTORIQUE EMPLOYÉ
  // ──────────────────────────────────────────────────────────────────────────

  async findEmployeeHistory(employeeId: string, userId: string) {
    const user = await this.getUserCtx(userId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true, email: true },
    });
    if (!employee || employee.companyId !== user.companyId)
      throw new NotFoundException('Employé introuvable');

    const where: any = { employeeId };
    if (user.role === 'EMPLOYEE') {
      if (employee.email !== user.email)
        throw new ForbiddenException('Accès refusé');
      where.status = {
        in: [ReviewStatus.SUBMITTED, ReviewStatus.ACKNOWLEDGED],
      };
    }

    const reviews = await this.prisma.performanceReview.findMany({
      where,
      include: this.reviewInclude(),
      orderBy: { date: 'desc' },
    });
    return reviews.map((r) => ({
      ...r,
      scoreLabel: r.rating
        ? PerformanceService.scoreLabel(Number(r.rating))
        : null,
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS
  // ──────────────────────────────────────────────────────────────────────────

  async getStats(userId: string) {
    const user = await this.getUserCtx(userId);
    const companyId = user.companyId;

    const [total, drafts, submitted, acknowledged] = await Promise.all([
      this.prisma.performanceReview.count({
        where: { employee: { companyId } },
      }),
      this.prisma.performanceReview.count({
        where: { employee: { companyId }, status: ReviewStatus.DRAFT },
      }),
      this.prisma.performanceReview.count({
        where: { employee: { companyId }, status: ReviewStatus.SUBMITTED },
      }),
      this.prisma.performanceReview.count({
        where: { employee: { companyId }, status: ReviewStatus.ACKNOWLEDGED },
      }),
    ]);

    const avgResult = await this.prisma.performanceReview.aggregate({
      where: { employee: { companyId }, rating: { not: null } },
      _avg: { rating: true },
    });

    const topEmployees = await this.prisma.performanceReview.groupBy({
      by: ['employeeId'],
      where: { employee: { companyId }, rating: { not: null } },
      _avg: { rating: true },
      orderBy: { _avg: { rating: 'desc' } },
      take: 5,
    });

    const topWithNames = await Promise.all(
      topEmployees.map(async (t) => {
        const avg = t._avg?.rating;
        const emp = await this.prisma.employee.findUnique({
          where: { id: t.employeeId },
          select: {
            firstName: true,
            lastName: true,
            position: true,
            photoUrl: true,
          },
        });
        return {
          employeeId: t.employeeId,
          avgScore: avg ? Number(avg) : 0,
          scoreLabel: avg ? PerformanceService.scoreLabel(Number(avg)) : null,
          employee: emp,
        };
      }),
    );

    const thisYearCount = await this.prisma.performanceReview.count({
      where: {
        employee: { companyId },
        createdAt: { gte: new Date(new Date().getFullYear(), 0, 1) },
      },
    });

    const avg = avgResult._avg?.rating;

    return {
      total,
      drafts,
      submitted,
      acknowledged,
      avgScore: avg ? Number(avg).toFixed(2) : null,
      avgScoreLabel: avg ? PerformanceService.scoreLabel(Number(avg)) : null,
      topEmployees: topWithNames,
      thisYearCount,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GOALS — conservés intégralement
  // ──────────────────────────────────────────────────────────────────────────

  async createGoal(data: any) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: data.employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
    await this.subscriptionGuard.checkFeatureAccess(
      employee.companyId,
      'hasPerformanceReviews',
    );

    return this.prisma.goal.create({
      data: {
        title: data.title,
        description: data.description,
        employeeId: data.employeeId,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        status: 'NOT_STARTED',
        progress: 0,
        keyResults: {
          create: (data.keyResults ?? []).map((kr: any) => ({
            title: kr.title,
            targetValue: kr.target || kr.targetValue,
            currentValue: kr.current || kr.currentValue || 0,
            unit: kr.unit,
          })),
        },
      },
      include: { keyResults: true },
    });
  }

  async findAllGoals(employeeId: string) {
    return this.prisma.goal.findMany({
      where: { employeeId },
      include: { keyResults: true },
    });
  }

  async findAllCompanyGoals(userId: string, overrideCompanyId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true, email: true },
    });
    const isCabinet =
      user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    const companyId =
      isCabinet && overrideCompanyId ? overrideCompanyId : user?.companyId;
    if (!companyId) return [];

    const employeeWhere: any = { companyId };
    if (!isCabinet && user?.role === 'MANAGER') {
      const mgr = await this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
      });
      if (!mgr?.departmentId) return [];
      employeeWhere.departmentId = mgr.departmentId;
    }

    return this.prisma.goal.findMany({
      where: { employee: employeeWhere },
      include: {
        keyResults: true,
        employee: {
          select: { firstName: true, lastName: true, photoUrl: true },
        },
      },
    });
  }

  async updateGoalProgress(goalId: string, progress: number) {
    return this.prisma.goal.update({
      where: { id: goalId },
      data: {
        progress,
        status: progress === 100 ? 'COMPLETED' : 'IN_PROGRESS',
      },
    });
  }

  async updateKeyResultValue(keyResultId: string, currentValue: number) {
    return this.prisma.keyResult.update({
      where: { id: keyResultId },
      data: { currentValue },
    });
  }
}
