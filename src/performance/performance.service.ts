// ============================================================================
// 📄 src/performance/performance.service.ts — SÉCURISÉ (phase 0)
// Tous les accès passent par PerformanceAccessService ; la fiche d'évaluation
// pondérée (cycles) vit dans ReviewSheetService / ReviewCyclesService.
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
import { PerformanceAccessService } from './performance-access.service';
import { ReviewSheetService } from './review-sheet.service';
import { verdictLabel } from './performance-scoring.util';
import {
  LIMITS, asArray, asBody, asDate, asNumber, asOptUuid, asRequiredText, asText, asUuid,
} from './performance-validation.util';

/** Assainit les critères d'une fiche libre : champs connus uniquement, bornés */
function sanitizeCriteria(raw: unknown) {
  if (raw === undefined || raw === null) return null;
  return asArray<any>(raw, 'Critères', 30).map((c0, i) => {
    const c = asBody(c0);
    const description = asText(c.description, 'Description', 500);
    return {
      id: asRequiredText(c.id ?? `c${i}`, 'Critère', 80),
      label: asRequiredText(c.label, 'Libellé du critère', 120),
      ...(description && { description }),
      weight: asNumber(c.weight ?? 0, 'Poids', 0, 100),
      score: asNumber(c.score ?? 0, 'Note', 0, 5),
      comment: asText(c.comment, 'Commentaire', 2000) ?? '',
    };
  });
}

/** JSON libre (objectifs suivants d'une ancienne fiche) : tableau, taille bornée */
function sanitizeJsonList(raw: unknown, label: string) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new BadRequestException(`${label} : liste attendue`);
  if (raw.length > 30 || JSON.stringify(raw).length > 20000)
    throw new BadRequestException(`${label} : contenu trop volumineux`);
  return raw;
}

/** À quelle évaluation un objectif est rattaché (affiché dans la page Objectifs) */
const GOAL_LINKS = {
  evaluatedInReview: { select: { id: true, period: true, status: true } },
  plannedInReview: { select: { id: true, period: true, status: true } },
} as const;

const REVIEW_TYPE_RE = /^[A-Za-z0-9_-]{1,40}$/;
function cleanReviewType(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !REVIEW_TYPE_RE.test(v))
    throw new BadRequestException("Type d'évaluation invalide");
  return v;
}

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
  success_factors: {
    label: 'Facteurs de succès (5 × 20 %)',
    criteria: [
      { id: 'ownership', label: 'Ownership & Responsabilité', weight: 20, score: 0, comment: '' },
      { id: 'qualite_rigueur', label: 'Qualité & Rigueur', weight: 20, score: 0, comment: '' },
      { id: 'collaboration', label: 'Collaboration', weight: 20, score: 0, comment: '' },
      { id: 'initiative_resolution', label: 'Initiative & Résolution', weight: 20, score: 0, comment: '' },
      { id: 'leadership_impact', label: 'Leadership / Impact', weight: 20, score: 0, comment: '' },
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
    private access: PerformanceAccessService,
    private sheet: ReviewSheetService,
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
  // CREATE REVIEW (fiche libre, hors cycle — conservé pour compatibilité)
  // ──────────────────────────────────────────────────────────────────────────

  async createReview(raw: unknown, reviewerId: string) {
    const data = asBody(raw);
    const employeeId = asUuid(data.employeeId, 'Employé');
    const ctx = await this.access.getCtx(reviewerId);
    this.access.assertCanManage(ctx);
    const employee = await this.access.assertCanManageEmployee(ctx, employeeId);
    await this.access.assertFeature(ctx);

    const reviewType = cleanReviewType(data.reviewType);
    const criteria = sanitizeCriteria(data.criteria);
    const overallScore = criteria ? this.calcScore(criteria) : null;
    const period = asText(data.period, 'Période', 60)?.trim() || this.generatePeriod(reviewType);
    const manualRating = data.rating ?? data.score;

    return this.prisma.performanceReview.create({
      data: {
        employeeId: employee.id,
        reviewerId,
        period,
        date: data.date ? asDate(data.date, 'Date') : new Date(),
        rating: overallScore ?? (manualRating !== undefined && manualRating !== null ? asNumber(manualRating, 'Note', 0, 5) : null),
        feedback: asText(data.feedback ?? data.comments, 'Commentaire', LIMITS.LONG) ?? null,
        status: ReviewStatus.DRAFT,
        ...(reviewType != null && { reviewType }),
        ...(criteria != null && { criteria }),
        ...(overallScore != null && { overallScore }),
        ...(data.strengths != null && { strengths: asText(data.strengths, 'Points forts', LIMITS.LONG) }),
        ...(data.improvements != null && { improvements: asText(data.improvements, "Axes d'amélioration", LIMITS.LONG) }),
        ...(data.nextGoals != null && { nextGoals: sanitizeJsonList(data.nextGoals, 'Objectifs suivants') as any }),
      },
      include: this.reviewInclude(),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UPDATE REVIEW (fiche libre) — les fiches de cycle passent par /sheet
  // ──────────────────────────────────────────────────────────────────────────

  async updateReview(reviewId: string, raw: unknown, userId: string) {
    const data = asBody(raw);
    const ctx = await this.access.getCtx(userId);
    const review = await this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: {
        employee: {
          select: {
            id: true,
            companyId: true,
            department: { select: { managerId: true } },
          },
        },
      },
    });
    if (!review || review.employee.companyId !== ctx.companyId)
      throw new NotFoundException('Évaluation introuvable');
    if (!this.access.canWriteReview(ctx, review as any))
      throw new ForbiddenException('Accès refusé');
    if (review.status !== ReviewStatus.DRAFT)
      throw new BadRequestException('Seuls les brouillons sont modifiables');
    if (review.cycleId)
      throw new BadRequestException(
        "Cette évaluation fait partie d'un cycle : modifiez-la via la fiche d'évaluation",
      );

    const newCriteria = sanitizeCriteria(data.criteria);
    const criteria = newCriteria ?? (review as any).criteria ?? null;
    const overallScore = criteria ? this.calcScore(criteria) : null;
    const reviewType = cleanReviewType(data.reviewType);

    // 🔒 Écriture conditionnelle : seulement tant que la fiche est un brouillon
    const res = await this.prisma.performanceReview.updateMany({
      where: { id: reviewId, status: ReviewStatus.DRAFT },
      data: {
        ...(data.period != null && { period: asRequiredText(data.period, 'Période', 60) }),
        ...(data.date != null && { date: asDate(data.date, 'Date') }),
        ...(criteria != null && { criteria, overallScore, rating: overallScore }),
        ...(data.feedback !== undefined && { feedback: asText(data.feedback, 'Commentaire', LIMITS.LONG) }),
        ...(data.strengths !== undefined && { strengths: asText(data.strengths, 'Points forts', LIMITS.LONG) }),
        ...(data.improvements !== undefined && { improvements: asText(data.improvements, "Axes d'amélioration", LIMITS.LONG) }),
        ...(data.nextGoals !== undefined && { nextGoals: sanitizeJsonList(data.nextGoals, 'Objectifs suivants') as any }),
        ...(reviewType != null && { reviewType }),
      },
    });
    if (res.count !== 1) throw new BadRequestException('Seuls les brouillons sont modifiables');
    return this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: this.reviewInclude(),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUBMIT / ACKNOWLEDGE — délégués à la fiche (contrôles + notifications)
  // ──────────────────────────────────────────────────────────────────────────

  submitReview(reviewId: string, userId: string, companyId?: string) {
    return this.sheet.submit(reviewId, userId, companyId);
  }

  acknowledgeReview(
    reviewId: string,
    dto: { comment?: string },
    userId: string,
    companyId?: string,
  ) {
    return this.sheet.acknowledge(reviewId, dto ?? {}, userId, companyId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LECTURE
  // ──────────────────────────────────────────────────────────────────────────

  private withLabel<T extends { rating: any; cycleId?: string | null }>(r: T) {
    const score = r.rating !== null && r.rating !== undefined ? Number(r.rating) : null;
    return {
      ...r,
      scoreLabel:
        score === null
          ? null
          : r.cycleId
            ? verdictLabel(score)
            : PerformanceService.scoreLabel(score),
    };
  }

  async findAllReviews(userId: string, overrideCompanyId?: string) {
    let ctx;
    try {
      ctx = await this.access.getCtx(userId, overrideCompanyId);
    } catch {
      return [];
    }

    // EMPLOYEE (ou tout rôle sans mission de supervision) → ses évaluations non-brouillon
    if (!ctx.isHR && !ctx.isManager) {
      if (!ctx.employeeId) return [];
      const mine = await this.prisma.performanceReview.findMany({
        where: {
          employeeId: ctx.employeeId,
          status: { in: [ReviewStatus.SUBMITTED, ReviewStatus.ACKNOWLEDGED] },
        },
        include: this.reviewInclude(),
        orderBy: { createdAt: 'desc' },
      });
      return mine.map((r) => this.withLabel(r));
    }

    const employee = await this.access.superviseWhere(ctx);
    const reviews = await this.prisma.performanceReview.findMany({
      where: { employee },
      include: this.reviewInclude(),
      orderBy: { createdAt: 'desc' },
    });
    return reviews.map((r) => this.withLabel(r));
  }

  async findOneReview(reviewId: string, userId: string) {
    const ctx = await this.access.getCtx(userId);
    const review = await this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: this.reviewInclude(),
    });
    if (!review) throw new NotFoundException('Évaluation introuvable');
    await this.access.assertCanViewEmployee(ctx, review.employeeId);
    // L'employé ne voit jamais un brouillon (même s'il est "self")
    if (
      this.access.isSelf(ctx, review.employeeId) &&
      review.status === ReviewStatus.DRAFT
    )
      throw new ForbiddenException('Évaluation non disponible');
    return this.withLabel(review);
  }

  async findEmployeeHistory(employeeId: string, userId: string) {
    const ctx = await this.access.getCtx(userId);
    await this.access.assertCanViewEmployee(ctx, employeeId);

    const where: any = { employeeId };
    if (this.access.isSelf(ctx, employeeId)) {
      where.status = {
        in: [ReviewStatus.SUBMITTED, ReviewStatus.ACKNOWLEDGED],
      };
    }
    const reviews = await this.prisma.performanceReview.findMany({
      where,
      include: this.reviewInclude(),
      orderBy: { date: 'desc' },
    });
    return reviews.map((r) => this.withLabel(r));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS (RH / managers uniquement, restreintes au périmètre)
  // ──────────────────────────────────────────────────────────────────────────

  async getStats(userId: string) {
    const ctx = await this.access.getCtx(userId);
    this.access.assertCanManage(ctx);
    const employee = await this.access.superviseWhere(ctx);

    const [total, drafts, submitted, acknowledged] = await Promise.all([
      this.prisma.performanceReview.count({ where: { employee } }),
      this.prisma.performanceReview.count({
        where: { employee, status: ReviewStatus.DRAFT },
      }),
      this.prisma.performanceReview.count({
        where: { employee, status: ReviewStatus.SUBMITTED },
      }),
      this.prisma.performanceReview.count({
        where: { employee, status: ReviewStatus.ACKNOWLEDGED },
      }),
    ]);

    const avgResult = await this.prisma.performanceReview.aggregate({
      where: { employee, rating: { not: null } },
      _avg: { rating: true },
    });

    const topEmployees = await this.prisma.performanceReview.groupBy({
      by: ['employeeId'],
      where: { employee, rating: { not: null } },
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
        employee,
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
  // GOALS — désormais isolés par entreprise, par rôle et par périmètre
  // ──────────────────────────────────────────────────────────────────────────

  async createGoal(raw: unknown, userId: string) {
    const data = asBody(raw);
    const ctx = await this.access.getCtx(userId);
    this.access.assertCanManage(ctx);
    const employee = await this.access.assertCanManageEmployee(
      ctx,
      asUuid(data.employeeId, 'Employé'),
    );
    await this.access.assertFeature(ctx);

    const title = asRequiredText(data.title, 'Titre', LIMITS.TITLE);
    const start = asDate(data.startDate, 'Date de début');
    const end = asDate(data.endDate, 'Date de fin');
    if (end < start) throw new BadRequestException('Dates invalides');
    const weight = data.weight !== undefined && data.weight !== null ? asNumber(data.weight, 'Poids', 0, 100) : null;

    const keyResults = asArray<any>(data.keyResults, 'Résultats clés', 20).map((k0) => {
      const k = asBody(k0);
      return {
        title: asRequiredText(k.title, 'Résultat clé', LIMITS.TITLE),
        targetValue: asNumber(k.target ?? k.targetValue ?? 0, 'Cible', 0, 1e9),
        currentValue: asNumber(k.current ?? k.currentValue ?? 0, 'Valeur actuelle', 0, 1e9),
        unit: asText(k.unit, 'Unité', 30) || undefined,
      };
    });

    return this.prisma.goal.create({
      data: {
        title,
        description: asText(data.description, 'Description', LIMITS.COMMENT),
        employeeId: employee.id,
        startDate: start,
        endDate: end,
        status: 'NOT_STARTED',
        progress: 0,
        weight,
        kpi: asText(data.kpi, 'KPI', LIMITS.KPI) ?? null,
        support: asText(data.support, 'Support', 255) ?? null,
        keyResults: { create: keyResults },
      },
      include: { keyResults: true },
    });
  }

  /** Retire les champs réservés au manager quand c'est l'employé qui lit */
  private stripManagerFields<T extends Record<string, any>>(g: T) {
    const { score, managerComment, ...rest } = g;
    return rest;
  }

  /** Objectifs d'un employé : lui-même, son supérieur ou la RH (les notes restent côté fiche) */
  async findAllGoals(employeeId: string, userId: string) {
    const ctx = await this.access.getCtx(userId);
    await this.access.assertCanViewEmployee(ctx, employeeId);
    const goals = await this.prisma.goal.findMany({
      where: { employeeId },
      include: { keyResults: true, ...GOAL_LINKS },
      orderBy: { endDate: 'asc' },
    });
    // L'employé ne reçoit jamais note/commentaire du manager via cette route
    return this.access.isSelf(ctx, employeeId)
      ? goals.map((g) => this.stripManagerFields(g))
      : goals;
  }

  async findAllCompanyGoals(userId: string, overrideCompanyId?: string) {
    let ctx;
    try {
      ctx = await this.access.getCtx(userId, overrideCompanyId);
    } catch {
      return [];
    }
    const supervising = ctx.isHR || ctx.isManager;
    // Un simple employé ne voit que ses propres objectifs
    const employee = supervising
      ? await this.access.superviseWhere(ctx)
      : { companyId: ctx.companyId, id: ctx.employeeId ?? 'none' };

    const goals = await this.prisma.goal.findMany({
      where: { employee },
      include: {
        keyResults: true,
        ...GOAL_LINKS,
        employee: {
          select: { firstName: true, lastName: true, photoUrl: true },
        },
      },
      orderBy: { endDate: 'asc' },
      take: 500,
    });
    return supervising ? goals : goals.map((g) => this.stripManagerFields(g));
  }

  private async loadGoalForUpdate(goalId: string, userId: string) {
    const ctx = await this.access.getCtx(userId);
    const goal = await this.prisma.goal.findUnique({
      where: { id: goalId },
      select: { id: true, employeeId: true },
    });
    if (!goal) throw new NotFoundException('Objectif introuvable');
    // L'employé met à jour SA progression ; le supérieur / la RH aussi
    await this.access.assertCanViewEmployee(ctx, goal.employeeId);
    return goal;
  }

  async updateGoalProgress(goalId: string, progress: number, userId: string) {
    await this.loadGoalForUpdate(goalId, userId);
    const p = Number(progress);
    if (!Number.isInteger(p) || p < 0 || p > 100)
      throw new BadRequestException('Progression : entier de 0 à 100');
    return this.prisma.goal.update({
      where: { id: goalId },
      data: {
        progress: p,
        status: p === 100 ? 'COMPLETED' : p > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
      },
    });
  }

  async updateKeyResultValue(
    keyResultId: string,
    currentValue: number,
    userId: string,
  ) {
    const kr = await this.prisma.keyResult.findUnique({
      where: { id: keyResultId },
      select: { id: true, goalId: true },
    });
    if (!kr) throw new NotFoundException('Résultat clé introuvable');
    await this.loadGoalForUpdate(kr.goalId, userId);
    const v = Number(currentValue);
    if (!Number.isFinite(v) || v < 0)
      throw new BadRequestException('Valeur invalide');
    // Mise à jour + recalcul de la progression de l'objectif (moyenne des résultats clés,
    // chacun plafonné à 100 %) dans la même transaction.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.keyResult.update({
        where: { id: keyResultId },
        data: { currentValue: v },
      });
      const all = await tx.keyResult.findMany({
        where: { goalId: kr.goalId },
        select: { targetValue: true, currentValue: true },
      });
      const pcts = all
        .filter((k) => Number(k.targetValue) > 0)
        .map((k) => Math.min(100, (Number(k.currentValue) / Number(k.targetValue)) * 100));
      if (pcts.length) {
        const progress = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
        await tx.goal.update({
          where: { id: kr.goalId },
          data: {
            progress,
            status: progress >= 100 ? 'COMPLETED' : progress > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
          },
        });
      }
      return updated;
    });
  }
}