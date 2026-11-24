// ============================================================================
// 📄 src/performance/review-sheet.service.ts
// La "fiche d'évaluation" (équivalent de l'onglet Excel) :
//   A. objectifs pondérés notés 1–5      → Goal (evaluatedInReviewId)
//   B. facteurs de succès / compétences  → PerformanceReview.criteria (JSON)
//   C. objectifs de la période suivante  → Goal (plannedInReviewId)
// + auto-évaluation, soumission avec contrôles, accusé de réception avec
//   droit de réponse, vue "Mon espace".
// ============================================================================

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PerfCtx, PerformanceAccessService } from './performance-access.service';
import { CompetenciesService } from './competencies.service';
import {
  LIMITS, asArray, asBody, asDate, asNumber, asRequiredText, asText, asUuid, asUuidArray,
} from './performance-validation.util';
import {
  SCORE_LEVELS,
  allScored,
  combineScores,
  isValidScore,
  sumWeights,
  verdictLabel,
  weightedAverage,
  weightsAreComplete,
} from './performance-scoring.util';

type Mode = 'writer' | 'self';
// Alias défini après la classe (type-only)
// eslint-disable-next-line @typescript-eslint/no-use-before-define

const addMonths = (d: Date, n: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
};

/** Durée par défaut de la période suivante selon le type de cycle */
const nextPeriodMonths = (type?: string | null) =>
  type === 'ANNUAL' ? 12 : type === 'PROBATION' ? 3 : 3;

function parseScore(v: unknown, label: string): number | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === 0 || v === '') return 0; // remise à zéro
  if (!isValidScore(v))
    throw new BadRequestException(`${label} : la note doit être de 1 à 5`);
  return Number(v);
}

function parseWeight(v: unknown, label: string): number | undefined {
  if (v === undefined) return undefined;
  const w = Number(v);
  if (!Number.isFinite(w) || w < 0 || w > 100)
    throw new BadRequestException(`${label} : poids invalide (0 à 100)`);
  return w;
}

// ── Assainissement des corps de requête (types, bornes, UUID) ───────────────
function cleanScore(v: unknown, label: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '' || v === 0) return null;
  if (typeof v !== 'number') throw new BadRequestException(`${label} : note invalide`);
  if (!isValidScore(v)) throw new BadRequestException(`${label} : la note doit être de 1 à 5`);
  return v;
}
const cleanWeight = (v: unknown, label: string) =>
  v === undefined ? undefined : asNumber(v, `${label} (poids)`, 0, 100);

export function sanitizeSheetDto(raw: unknown) {
  const b = asBody(raw);
  return {
    goals: asArray(b.goals, 'Objectifs', LIMITS.LIST).map((g) => {
      const o = asBody(g);
      return {
        id: asUuid(o.id, 'Objectif'),
        score: cleanScore(o.score, 'Objectif'),
        comment: asText(o.comment, 'Commentaire', LIMITS.COMMENT),
        weight: cleanWeight(o.weight, 'Objectif'),
        title: asText(o.title, 'Titre', LIMITS.TITLE),
        kpi: asText(o.kpi, 'KPI', LIMITS.KPI),
      };
    }),
    addGoals: asArray(b.addGoals, 'Nouveaux objectifs', 20).map((g) => {
      const o = asBody(g);
      return {
        title: asRequiredText(o.title, "Titre de l'objectif", LIMITS.TITLE),
        kpi: asText(o.kpi, 'KPI', LIMITS.KPI),
        weight: cleanWeight(o.weight, 'Objectif'),
      };
    }),
    removeGoalIds: asUuidArray(b.removeGoalIds, 'Objectifs à retirer', LIMITS.LIST),
    criteria: asArray(b.criteria, 'Critères', LIMITS.LIST).map((c) => {
      const o = asBody(c);
      return {
        id: asRequiredText(o.id, 'Critère', 80),
        score: cleanScore(o.score, 'Critère'),
        comment: asText(o.comment, 'Commentaire', LIMITS.COMMENT),
        weight: cleanWeight(o.weight, 'Critère'),
      };
    }),
    nextGoals: asArray(b.nextGoals, 'Objectifs suivants', LIMITS.LIST).map((g) => {
      const o = asBody(g);
      return {
        id: o.id === undefined || o.id === null ? undefined : asUuid(o.id, 'Objectif suivant'),
        title: asText(o.title, 'Titre', LIMITS.TITLE),
        kpi: asText(o.kpi, 'KPI', LIMITS.KPI),
        support: asText(o.support, 'Support', 255),
        weight: cleanWeight(o.weight, 'Objectif suivant'),
        endDate: o.endDate ? asDate(o.endDate, 'Échéance').toISOString() : undefined,
        remove: o.remove === true,
      };
    }),
    strengths: asText(b.strengths, 'Points forts', LIMITS.LONG),
    improvements: asText(b.improvements, "Axes d'amélioration", LIMITS.LONG),
    feedback: asText(b.feedback, 'Commentaire général', LIMITS.LONG),
  };
}

@Injectable()
export class ReviewSheetService {
  private readonly logger = new Logger(ReviewSheetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PerformanceAccessService,
    private readonly competencies: CompetenciesService,
  ) {}

  // ── Chargement + mode d'accès ─────────────────────────────────────────────
  async loadReview(reviewId: string, ctx: PerfCtx) {
    const review = await this.prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: {
        employee: {
          select: {
            id: true,
            companyId: true,
            email: true,
            firstName: true,
            lastName: true,
            position: true,
            photoUrl: true,
            departmentId: true,
            department: { select: { name: true, managerId: true } },
          },
        },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
        cycle: true,
        goalsEvaluated: { orderBy: { createdAt: 'asc' } },
        goalsPlanned: {
          where: { evaluatedInReviewId: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!review || review.employee.companyId !== ctx.companyId)
      throw new NotFoundException('Évaluation introuvable');
    return review;
  }

  private modeOf(ctx: PerfCtx, review: LoadedReview): Mode {
    if (this.access.isSelf(ctx, review.employeeId)) return 'self';
    if (this.access.canWriteReview(ctx, review as any)) return 'writer';
    throw new ForbiddenException('Accès refusé');
  }

  private assertEditable(
    review: LoadedReview,
    mode: Mode,
  ) {
    if (mode !== 'writer')
      throw new ForbiddenException('Seul le responsable peut modifier la fiche');
    if (review.status !== 'DRAFT')
      throw new BadRequestException('Seuls les brouillons sont modifiables');
    if (review.cycle?.status === 'CLOSED')
      throw new BadRequestException('Ce cycle est clôturé');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LECTURE DE LA FICHE
  // ──────────────────────────────────────────────────────────────────────────
  async getSheet(reviewId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    const review = await this.loadReview(reviewId, ctx);
    const mode = this.modeOf(ctx, review);
    const isDraft = review.status === 'DRAFT';
    const cycle = review.cycle;

    // 🔒 L'employé n'accède à son évaluation qu'une fois transmise : il ne note jamais
    // (ni lui-même, ni avant son responsable).
    if (mode === 'self' && isDraft)
      throw new ForbiddenException('Évaluation non disponible');

    // L'employé ne voit RIEN du travail du manager tant que la fiche est en brouillon
    const hide = mode === 'self' && isDraft;
    const criteria = ((review.criteria as any[]) ?? []).map((c) =>
      hide
        ? { id: c.id, label: c.label, description: c.description, weight: c.weight }
        : c,
    );
    const goal = (g: any) =>
      hide
        ? {
            id: g.id,
            title: g.title,
            kpi: g.kpi,
            weight: g.weight !== null ? Number(g.weight) : null,
            endDate: g.endDate,
          }
        : {
            id: g.id,
            title: g.title,
            kpi: g.kpi,
            support: g.support,
            weight: g.weight !== null ? Number(g.weight) : null,
            score: g.score,
            managerComment: g.managerComment,
            progress: g.progress,
            status: g.status,
            endDate: g.endDate,
            validatedAt: g.validatedAt,
          };

    const canEdit =
      mode === 'writer' && isDraft && cycle?.status !== 'CLOSED';

    return {
      review: {
        id: review.id,
        period: review.period,
        reviewType: review.reviewType,
        status: review.status,
        date: review.date,
        employee: {
          id: review.employee.id,
          firstName: review.employee.firstName,
          lastName: review.employee.lastName,
          position: review.employee.position,
          photoUrl: review.employee.photoUrl,
          department: review.employee.department?.name ?? null,
        },
        reviewer: review.reviewer,
        cycle: cycle
          ? {
              id: cycle.id,
              name: cycle.name,
              status: cycle.status,
              objectivesWeight: cycle.objectivesWeight,
            }
          : null,
        objectivesScore: hide ? null : this.n(review.objectivesScore),
        competenciesScore: hide ? null : this.n(review.competenciesScore),
        overallScore: hide ? null : this.n(review.overallScore),
        verdict: hide ? null : review.verdict,
        strengths: hide ? null : review.strengths,
        improvements: hide ? null : review.improvements,
        feedback: hide ? null : review.feedback,
        employeeComment: review.employeeComment,
        employeeCommentAt: review.employeeCommentAt,
        submittedAt: review.submittedAt,
        acknowledgedAt: review.acknowledgedAt,
      },
      goals: review.goalsEvaluated.map(goal),
      criteria,
      nextGoals: hide ? [] : review.goalsPlanned.map(goal),
      scoreLevels: SCORE_LEVELS,
      permissions: {
        isSelf: mode === 'self',
        canEdit,
        canSubmit: canEdit,
        canAcknowledge:
          review.status === 'SUBMITTED' && (mode === 'self' || ctx.isHR),
        // Brouillon : la RH ou le responsable du département · déjà transmise : la RH seule
        canDelete:
          mode === 'writer' && (isDraft || ctx.isHR),
      },
    };
  }

  private n(v: unknown) {
    return v === null || v === undefined ? null : Number(v);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SAUVEGARDE (autosave — appelée souvent, tout est optionnel)
  // ──────────────────────────────────────────────────────────────────────────
  async saveSheet(
    reviewId: string,
    rawDto: {
      goals?: Array<{
        id: string;
        score?: number | null;
        comment?: string | null;
        weight?: number;
        title?: string;
        kpi?: string | null;
      }>;
      addGoals?: Array<{ title: string; kpi?: string; weight?: number }>;
      removeGoalIds?: string[];
      criteria?: Array<{
        id: string;
        score?: number | null;
        comment?: string | null;
        weight?: number;
      }>;
      nextGoals?: Array<{
        id?: string;
        title?: string;
        kpi?: string | null;
        support?: string | null;
        weight?: number;
        endDate?: string;
        remove?: boolean;
      }>;
      strengths?: string | null;
      improvements?: string | null;
      feedback?: string | null;
    },
    userId: string,
    companyId?: string,
  ) {
    const dto = sanitizeSheetDto(rawDto);
    const ctx = await this.access.getCtx(userId, companyId);
    const review = await this.loadReview(reviewId, ctx);
    this.assertEditable(review, this.modeOf(ctx, review));

    const evalIds = new Set<string>(review.goalsEvaluated.map((g) => g.id));
    const plannedIds = new Set<string>(review.goalsPlanned.map((g) => g.id));
    const cycle = review.cycle;

    // ── Validation AVANT toute écriture ─────────────────────────────────────
    for (const g of dto.goals ?? []) {
      if (!evalIds.has(g.id))
        throw new BadRequestException('Objectif étranger à cette fiche');
      parseScore(g.score, 'Objectif');
      parseWeight(g.weight, 'Objectif');
    }
    for (const id of dto.removeGoalIds ?? [])
      if (!evalIds.has(id))
        throw new BadRequestException('Objectif étranger à cette fiche');
    for (const g of dto.addGoals ?? []) {
      if (!g.title?.trim())
        throw new BadRequestException('Titre de l\'objectif requis');
      parseWeight(g.weight, g.title);
    }
    const criteria = ((review.criteria as any[]) ?? []).map((c) => ({ ...c }));
    for (const p of dto.criteria ?? []) {
      const c = criteria.find((x) => x.id === p.id);
      if (!c) throw new BadRequestException(`Critère inconnu : ${p.id}`);
      const s = parseScore(p.score, c.label);
      const w = parseWeight(p.weight, c.label);
      if (s !== undefined) c.score = s;
      if (p.comment !== undefined) c.comment = p.comment ?? '';
      if (w !== undefined) c.weight = w;
    }
    for (const g of dto.nextGoals ?? []) {
      if (g.id && !plannedIds.has(g.id))
        throw new BadRequestException('Objectif T+1 étranger à cette fiche');
      if (!g.id && !g.remove && !g.title?.trim())
        throw new BadRequestException("Titre de l'objectif suivant requis");
      parseWeight(g.weight, g.title ?? 'Objectif suivant');
      if (g.endDate && isNaN(new Date(g.endDate).getTime()))
        throw new BadRequestException('Échéance invalide');
    }

    const defaultStart = cycle?.endDate ?? review.date;
    const defaultEnd = addMonths(defaultStart, nextPeriodMonths(cycle?.type as any));

    // ── Écriture + recalcul dans UNE transaction ───────────────────────────
    await this.prisma.$transaction(async (tx) => {
      // 🔒 Verrou : la fiche doit encore être en brouillon AU MOMENT de l'écriture
      // (évite qu'une sauvegarde automatique tardive écrase une fiche soumise).
      const lock = await tx.performanceReview.updateMany({
        where: { id: review.id, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (lock.count !== 1)
        throw new BadRequestException('Seuls les brouillons sont modifiables');
      for (const g of dto.goals ?? []) {
        const score = parseScore(g.score, 'Objectif');
        const weight = parseWeight(g.weight, 'Objectif');
        await tx.goal.update({
          where: { id: g.id },
          data: {
            ...(score !== undefined && { score: score === 0 ? null : score }),
            ...(g.comment !== undefined && { managerComment: g.comment }),
            ...(weight !== undefined && { weight }),
            ...(g.title?.trim() ? { title: g.title.trim() } : {}),
            ...(g.kpi !== undefined && { kpi: g.kpi }),
          },
        });
      }
      if (dto.removeGoalIds?.length)
        await tx.goal.deleteMany({
          where: { id: { in: dto.removeGoalIds }, evaluatedInReviewId: review.id },
        });
      for (const g of dto.addGoals ?? []) {
        await tx.goal.create({
          data: {
            employeeId: review.employeeId,
            title: g.title.trim(),
            kpi: g.kpi ?? null,
            weight: g.weight ?? null,
            startDate: cycle?.startDate ?? review.date,
            endDate: cycle?.endDate ?? review.date,
            evaluatedInReviewId: review.id,
          },
        });
      }
      for (const g of dto.nextGoals ?? []) {
        if (g.id && g.remove) {
          await tx.goal.deleteMany({
            where: { id: g.id, plannedInReviewId: review.id },
          });
        } else if (g.id) {
          await tx.goal.update({
            where: { id: g.id },
            data: {
              ...(g.title?.trim() ? { title: g.title.trim() } : {}),
              ...(g.kpi !== undefined && { kpi: g.kpi }),
              ...(g.support !== undefined && { support: g.support }),
              ...(g.weight !== undefined && { weight: g.weight }),
              ...(g.endDate && { endDate: new Date(g.endDate) }),
            },
          });
        } else if (!g.remove) {
          await tx.goal.create({
            data: {
              employeeId: review.employeeId,
              title: (g.title as string).trim(),
              kpi: g.kpi ?? null,
              support: g.support ?? null,
              weight: g.weight ?? null,
              startDate: defaultStart,
              endDate: g.endDate ? new Date(g.endDate) : defaultEnd,
              plannedInReviewId: review.id,
            },
          });
        }
      }

      // Recalcul des notes (affichage live côté manager)
      const goals = await tx.goal.findMany({
        where: { evaluatedInReviewId: review.id },
        select: { weight: true, score: true },
      });
      const scores = this.computeScores(goals, criteria, cycle?.objectivesWeight);
      await tx.performanceReview.update({
        where: { id: review.id },
        data: {
          criteria: criteria as any,
          ...scores,
          ...(dto.strengths !== undefined && { strengths: dto.strengths }),
          ...(dto.improvements !== undefined && { improvements: dto.improvements }),
          ...(dto.feedback !== undefined && { feedback: dto.feedback }),
        },
      });
    });

    return this.getSheet(reviewId, userId, companyId);
  }

  private computeScores(
    goals: Array<{ weight: any; score: any }>,
    criteria: any[],
    objectivesWeight?: number | null,
  ) {
    const g = goals.map((x) => ({ weight: Number(x.weight ?? 0), score: x.score }));
    const obj = g.length ? weightedAverage(g) : null;
    const comp = criteria?.length ? weightedAverage(criteria) : null;
    const overall = combineScores(obj, comp, objectivesWeight ?? 80);
    return {
      objectivesScore: obj,
      competenciesScore: comp,
      overallScore: overall,
      rating: overall,
      verdict: overall > 0 ? verdictLabel(overall) : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SOUMISSION (DRAFT → SUBMITTED) avec les mêmes contrôles que l'Excel
  // ──────────────────────────────────────────────────────────────────────────
  async submit(reviewId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    const review = await this.loadReview(reviewId, ctx);
    const mode = this.modeOf(ctx, review);
    if (mode !== 'writer')
      throw new ForbiddenException('Seul le responsable peut soumettre');
    if (review.status !== 'DRAFT')
      throw new BadRequestException('Évaluation déjà soumise');
    if (review.cycle?.status === 'CLOSED')
      throw new BadRequestException('Ce cycle est clôturé');

    const criteria = (review.criteria as any[]) ?? [];
    let scores: Record<string, any> = {};

    // Fiche de cycle → contrôles stricts. Ancienne fiche (sans cycle) → comportement historique.
    if (review.cycleId) {
      const problems: string[] = [];
      const goals = review.goalsEvaluated.map((g) => ({
        weight: Number(g.weight ?? 0),
        score: g.score,
      }));
      if (!goals.length)
        problems.push('Ajoutez au moins un objectif à évaluer (section A).');
      else {
        if (!weightsAreComplete(goals))
          problems.push(
            `Objectifs : la somme des poids doit faire 100 % (actuellement ${sumWeights(goals)} %).`,
          );
        if (!allScored(goals))
          problems.push('Objectifs : notez chaque objectif de 1 à 5.');
      }
      if (criteria.length) {
        if (!weightsAreComplete(criteria))
          problems.push(
            `Facteurs de succès : la somme des poids doit faire 100 % (actuellement ${sumWeights(criteria)} %).`,
          );
        if (!allScored(criteria))
          problems.push('Facteurs de succès : notez chaque critère de 1 à 5.');
      }
      const next = review.goalsPlanned.map((g) => ({ weight: Number(g.weight ?? 0) }));
      if (next.length && !weightsAreComplete(next))
        problems.push(
          `Objectifs de la période suivante : la somme des poids doit faire 100 % (actuellement ${sumWeights(next)} %).`,
        );
      if (problems.length)
        throw new BadRequestException({
          message: problems.join(' '),
          errors: problems,
        });

      scores = this.computeScores(review.goalsEvaluated, criteria, review.cycle?.objectivesWeight);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // 🔒 Transition atomique DRAFT → SUBMITTED : un double clic ou deux
      // requêtes simultanées ne peuvent pas soumettre (ni créditer les niveaux
      // de compétence) deux fois.
      const flip = await tx.performanceReview.updateMany({
        where: { id: review.id, status: 'DRAFT' },
        data: { ...scores, status: 'SUBMITTED', submittedAt: now },
      });
      if (flip.count !== 1)
        throw new BadRequestException('Évaluation déjà soumise');
      const submitted = { id: review.id, status: 'SUBMITTED', submittedAt: now, ...scores };
      if (review.goalsPlanned.length)
        await tx.goal.updateMany({
          where: { plannedInReviewId: review.id, evaluatedInReviewId: null },
          data: { validatedAt: now },
        });
      // Phase 2 : les critères liés à une compétence mettent à jour le niveau de l'employé
      if (review.cycleId)
        await this.competencies.recordFromReview(
          tx,
          {
            id: review.id,
            employeeId: review.employeeId,
            reviewerId: review.reviewerId,
            criteria,
          },
          ctx.companyId,
        );
      return submitted;
    });

    await this.notifyEmployee(
      review.employee,
      ctx.companyId,
      '📋 Votre évaluation est disponible',
      `Votre évaluation "${review.period}" a été finalisée par ${review.reviewer.firstName} ${review.reviewer.lastName}. Consultez-la puis accusez réception.`,
      '/performance/mon-espace',
    );
    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ACCUSÉ DE RÉCEPTION + DROIT DE RÉPONSE (employé, ou RH pour signature papier)
  // ──────────────────────────────────────────────────────────────────────────
  async acknowledge(
    reviewId: string,
    rawDto: unknown,
    userId: string,
    companyId?: string,
  ) {
    const dto = { comment: asText(asBody(rawDto).comment, 'Commentaire', LIMITS.COMMENT) };
    const ctx = await this.access.getCtx(userId, companyId);
    const review = await this.loadReview(reviewId, ctx);
    // L'employé accuse réception lui-même ; la RH peut le faire pour lui
    // (signature papier, employé sans compte) — acknowledgedBy garde la trace de qui l'a fait.
    const bySelf = this.access.isSelf(ctx, review.employeeId);
    if (!bySelf && !ctx.isHR)
      throw new ForbiddenException(
        "Seul l'employé concerné (ou la RH) peut accuser réception de cette évaluation",
      );
    if (review.status !== 'SUBMITTED')
      throw new BadRequestException('Évaluation non en attente de réception');

    const comment = dto.comment?.trim();
    if (comment && comment.length > 5000)
      throw new BadRequestException('Commentaire trop long (5000 caractères max)');

    const now = new Date();
    // 🔒 Transition atomique SUBMITTED → ACKNOWLEDGED (pas de double accusé)
    const flip = await this.prisma.performanceReview.updateMany({
      where: { id: review.id, status: 'SUBMITTED' },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: now,
        acknowledgedBy: userId,
        ...(comment && { employeeComment: comment, employeeCommentAt: now }),
      },
    });
    if (flip.count !== 1)
      throw new BadRequestException('Évaluation non en attente de réception');
    const updated = { id: review.id, status: 'ACKNOWLEDGED', acknowledgedAt: now };

    try {
      await this.prisma.notification.create({
        data: {
          userId: review.reviewerId,
          type: 'SYSTEM_ALERT' as any,
          title: comment ? '💬 Évaluation réceptionnée avec commentaire' : '✅ Évaluation réceptionnée',
          message: bySelf
            ? `${review.employee.firstName} ${review.employee.lastName} a accusé réception de son évaluation "${review.period}"${comment ? ' et a ajouté un commentaire' : ''}.`
            : `La RH a marqué l'évaluation "${review.period}" de ${review.employee.firstName} ${review.employee.lastName} comme reçue.`,
          link: '/performance',
        },
      });
    } catch (e) {
      this.logger.warn('Notification accusé échouée', e as any);
    }
    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPRESSION D'UNE ÉVALUATION
  //  • brouillon      : la RH ou le responsable actuel du département
  //  • déjà transmise : la RH uniquement (c'est un document que l'employé a pu lire)
  //  • jamais l'employé concerné, jamais une autre entreprise
  // Effets : les objectifs rattachés redeviennent « libres » (ils ne sont pas supprimés),
  // les niveaux de compétence issus de cette évaluation sont retirés, et la suppression
  // est tracée dans les journaux du serveur.
  // ──────────────────────────────────────────────────────────────────────────
  async deleteReview(reviewId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    const review = await this.loadReview(reviewId, ctx);
    if (this.access.isSelf(ctx, review.employeeId))
      throw new ForbiddenException('Vous ne pouvez pas supprimer votre propre évaluation');
    if (!this.access.canWriteReview(ctx, review as any))
      throw new ForbiddenException('Accès refusé');
    if (review.status !== 'DRAFT' && !ctx.isHR)
      throw new ForbiddenException(
        'Seule la RH peut supprimer une évaluation déjà transmise à l\'employé',
      );

    await this.prisma.$transaction(async (tx) => {
      // 🔒 Suppression conditionnée au statut lu : si la fiche a changé entre-temps, on refuse
      const del = await tx.performanceReview.deleteMany({
        where: { id: review.id, status: review.status },
      });
      if (del.count !== 1)
        throw new BadRequestException('Cette évaluation vient de changer, actualisez la page');
      await tx.competencyAssessment.deleteMany({ where: { reviewId: review.id } });
    });

    this.logger.warn(
      `Évaluation supprimée : id=${review.id} statut=${review.status} employé=${review.employeeId} par=${ctx.userId} entreprise=${ctx.companyId}`,
    );
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MON ESPACE
  // ──────────────────────────────────────────────────────────────────────────
  async getMe(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    if (!ctx.employeeId)
      return { employeeId: null, reviews: [], goals: [] };

    const [reviews, goals] = await Promise.all([
      this.prisma.performanceReview.findMany({
        where: {
          employeeId: ctx.employeeId,
          status: { in: ['SUBMITTED', 'ACKNOWLEDGED'] },
        },
        orderBy: { date: 'desc' },
        select: {
          id: true,
          period: true,
          date: true,
          status: true,
          overallScore: true,
          verdict: true,
          submittedAt: true,
          acknowledgedAt: true,
          reviewer: { select: { firstName: true, lastName: true } },
        },
      }),
      // Objectifs en cours : ceux fixés à une revue soumise, ou en cours d'évaluation
      // (sans note ni commentaire manager : champs volontairement non sélectionnés)
      this.prisma.goal.findMany({
        where: {
          employeeId: ctx.employeeId,
          status: { not: 'CANCELLED' },
          OR: [
            { evaluatedInReview: { status: 'DRAFT' } },
            {
              evaluatedInReviewId: null,
              plannedInReview: { status: { in: ['SUBMITTED', 'ACKNOWLEDGED'] } },
            },
          ],
        },
        orderBy: { endDate: 'asc' },
        select: {
          id: true,
          title: true,
          kpi: true,
          support: true,
          weight: true,
          progress: true,
          status: true,
          endDate: true,
          keyResults: true,
        },
      }),
    ]);

    return {
      employeeId: ctx.employeeId,
      reviews,
      goals,
    };
  }

  // ── Utilitaire de notification (employé : via User.employeeId ou email) ────
  private async notifyEmployee(
    employee: { id: string; email: string },
    companyId: string,
    title: string,
    message: string,
    link?: string,
  ) {
    try {
      const u = await this.prisma.user.findFirst({
        where: {
          companyId,
          OR: [{ employeeId: employee.id }, { email: employee.email }],
        },
        select: { id: true },
      });
      if (!u) return;
      await this.prisma.notification.create({
        data: { userId: u.id, type: 'SYSTEM_ALERT' as any, title, message, link },
      });
    } catch (e) {
      this.logger.warn('Notification employé échouée', e as any);
    }
  }
}

type LoadedReview = Awaited<ReturnType<ReviewSheetService['loadReview']>>;