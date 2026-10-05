// ============================================================================
// 📄 src/performance/review-cycles.service.ts
// Cycles d'évaluation (campagnes) + modèles de fiche par poste
//   1. RH crée un cycle (ex : "T4 2026")
//   2. RH lance le cycle → une fiche (DRAFT) par employé, pré-remplie :
//        - facteurs de succès / compétences issus du modèle (match sur le poste)
//        - objectifs = ceux fixés à la revue précédente (T+1), sinon ceux du modèle
// ============================================================================

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PerfCtx,
  PerformanceAccessService,
} from './performance-access.service';
import { CRITERIA_TEMPLATES } from './performance.service';
import { sumWeights } from './performance-scoring.util';
import {
  LIMITS, asArray, asBody, asDate, asEnum, asNumber, asOptUuid, asRequiredText, asText, asUuid, asUuidArray,
} from './performance-validation.util';

const CYCLE_TYPES = ['ANNUAL', 'PROBATION', 'QUARTERLY', 'EXCEPTIONAL'] as const;

export interface CreateCycleDto {
  name: string;
  type?: 'ANNUAL' | 'PROBATION' | 'QUARTERLY' | 'EXCEPTIONAL';
  startDate: string;
  endDate: string;
  objectivesWeight?: number;
  templateId?: string | null;
}

export interface LaunchCycleDto {
  /** Si absent ET departmentIds absent → tous les employés ACTIVE */
  employeeIds?: string[];
  departmentIds?: string[];
}

export interface TemplateDto {
  name: string;
  description?: string;
  jobTitle?: string | null;
  criteria: Array<{
    id?: string;
    label: string;
    description?: string;
    weight: number;
    competencyId?: string;
  }>;
  objectives?: Array<{ title: string; kpi?: string; weight: number }>;
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'critere';

@Injectable()
export class ReviewCyclesService {
  private readonly logger = new Logger(ReviewCyclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PerformanceAccessService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // MODÈLES
  // ──────────────────────────────────────────────────────────────────────────

  private cleanCriteria(raw: unknown) {
    const criteria = asArray<any>(raw, 'Critères', 30);
    if (!criteria.length) throw new BadRequestException('Ajoutez au moins un critère');
    const seen = new Set<string>();
    const cleaned = criteria.map((c0, i) => {
      const c = asBody(c0);
      const label = asRequiredText(c.label, `Critère ${i + 1} : libellé`, 120);
      const w = asNumber(c.weight, `Critère "${label}" : poids`, 0.01, 100);
      let id = (asText(c.id, 'Identifiant du critère', 60) || slug(label)).trim() || slug(label);
      while (seen.has(id)) id = `${id}_${i}`;
      seen.add(id);
      const description = asText(c.description, 'Description', 500);
      return {
        id,
        label,
        ...(description && { description }),
        ...(c.competencyId ? { competencyId: asUuid(c.competencyId, 'Compétence') } : {}),
        weight: w,
      };
    });
    if (Math.abs(sumWeights(cleaned) - 100) > 0.011)
      throw new BadRequestException(
        `La somme des poids des critères doit faire 100 % (actuellement ${sumWeights(cleaned)} %)`,
      );
    return cleaned;
  }

  private cleanObjectives(raw: unknown) {
    const objectives = asArray<any>(raw, 'Objectifs', 30);
    if (!objectives.length) return null;
    const cleaned = objectives.map((o0, i) => {
      const o = asBody(o0);
      const title = asRequiredText(o.title, `Objectif ${i + 1} : titre`, LIMITS.TITLE);
      return {
        title,
        kpi: asText(o.kpi, 'KPI', LIMITS.KPI) || null,
        weight: asNumber(o.weight, `Objectif "${title}" : poids`, 0.01, 100),
      };
    });
    if (Math.abs(sumWeights(cleaned) - 100) > 0.011)
      throw new BadRequestException(
        `La somme des poids des objectifs doit faire 100 % (actuellement ${sumWeights(cleaned)} %)`,
      );
    return cleaned;
  }

  /** Vérifie que chaque compétence citée appartient bien à l'entreprise (anti-IDOR) */
  private async assertCompetenciesInCompany(criteria: Array<{ competencyId?: string }>, companyId: string) {
    const ids = [...new Set(criteria.map((c) => c.competencyId).filter(Boolean) as string[])];
    if (!ids.length) return;
    const n = await this.prisma.competency.count({ where: { id: { in: ids }, companyId } });
    if (n !== ids.length) throw new BadRequestException('Compétence introuvable dans votre entreprise');
  }

  async listTemplates(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const custom = await this.prisma.evaluationTemplate.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { name: 'asc' },
    });
    const builtin = Object.entries(CRITERIA_TEMPLATES).map(([key, v]) => ({
      id: `builtin:${key}`,
      builtin: true,
      name: v.label,
      jobTitle: null,
      criteria: v.criteria.map(({ id, label, weight }: any) => ({
        id,
        label,
        weight,
      })),
      objectives: null,
    }));
    return { builtin, custom };
  }

  async createTemplate(raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    await this.access.assertFeature(ctx);
    const name = asRequiredText(dto.name, 'Nom', 100);
    const criteria = this.cleanCriteria(dto.criteria);
    await this.assertCompetenciesInCompany(criteria, ctx.companyId);
    return this.prisma.evaluationTemplate.create({
      data: {
        companyId: ctx.companyId,
        name,
        description: asText(dto.description, 'Description', 1000) || null,
        jobTitle: asText(dto.jobTitle, 'Poste', 120)?.trim() || null,
        criteria: criteria as any,
        objectives: this.cleanObjectives(dto.objectives) as any,
      },
    });
  }

  async updateTemplate(id: string, raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const existing = await this.prisma.evaluationTemplate.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new NotFoundException('Modèle introuvable');
    const criteria = dto.criteria !== undefined ? this.cleanCriteria(dto.criteria) : undefined;
    if (criteria) await this.assertCompetenciesInCompany(criteria, ctx.companyId);
    const name = dto.name !== undefined ? asRequiredText(dto.name, 'Nom', 100) : undefined;
    const description = asText(dto.description, 'Description', 1000);
    const jobTitle = dto.jobTitle !== undefined ? asText(dto.jobTitle, 'Poste', 120)?.trim() || null : undefined;
    // `where: { id }` seul est sûr ici : l'appartenance à l'entreprise vient d'être vérifiée ci-dessus
    return this.prisma.evaluationTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(criteria !== undefined && { criteria: criteria as any }),
        ...(dto.objectives !== undefined && { objectives: this.cleanObjectives(dto.objectives) as any }),
      },
    });
  }

  async deleteTemplate(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const existing = await this.prisma.evaluationTemplate.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new NotFoundException('Modèle introuvable');
    // Les fiches déjà lancées gardent leurs critères (copiés dans la fiche)
    await this.prisma.evaluationTemplate.delete({ where: { id } });
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CYCLES
  // ──────────────────────────────────────────────────────────────────────────

  async createCycle(raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    await this.access.assertFeature(ctx);

    const name = asRequiredText(dto.name, 'Nom du cycle', 100);
    const start = asDate(dto.startDate, 'Début');
    const end = asDate(dto.endDate, 'Fin');
    if (end <= start) throw new BadRequestException('Période invalide');
    const type = dto.type === undefined ? 'QUARTERLY' : asEnum(dto.type, CYCLE_TYPES, 'Type de cycle');

    const objectivesWeight = dto.objectivesWeight === undefined ? 80 : asNumber(dto.objectivesWeight, 'Part des objectifs', 0, 100);
    if (!Number.isInteger(objectivesWeight))
      throw new BadRequestException('La part des objectifs doit être un entier entre 0 et 100');

    let templateId: string | null = null;
    if (typeof dto.templateId === 'string' && dto.templateId.startsWith('builtin:')) {
      templateId = null; // grille intégrée : pas de modèle propre à l'entreprise
    } else if (dto.templateId) {
      const tpl = await this.prisma.evaluationTemplate.findFirst({
        where: { id: asUuid(dto.templateId, 'Modèle'), companyId: ctx.companyId },
        select: { id: true },
      });
      if (!tpl) throw new NotFoundException('Modèle introuvable');
      templateId = tpl.id;
    }

    return this.prisma.reviewCycle.create({
      data: {
        companyId: ctx.companyId,
        name,
        type: type as any,
        startDate: start,
        endDate: end,
        objectivesWeight,
        selfAssessmentEnabled: false, // l'employé ne se note jamais (colonne conservée, jamais activée)
        templateId,
        createdById: ctx.userId,
      },
    });
  }

  async listCycles(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const where: any = { companyId: ctx.companyId };
    const cycles = await this.prisma.reviewCycle.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { reviews: true } },
        template: { select: { id: true, name: true } },
      },
    });
    return cycles;
  }

  async getCycle(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);

    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { template: { select: { id: true, name: true } } },
    });
    if (!cycle) throw new NotFoundException('Cycle introuvable');

    const employeeWhere = await this.access.superviseWhere(ctx);
    const reviews = await this.prisma.performanceReview.findMany({
      where: { cycleId: id, employee: employeeWhere },
      select: {
        id: true,
        status: true,
        overallScore: true,
        verdict: true,
        submittedAt: true,
        acknowledgedAt: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            photoUrl: true,
            department: { select: { name: true } },
          },
        },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    const count = (f: (r: (typeof reviews)[number]) => boolean) =>
      reviews.filter(f).length;
    return {
      cycle,
      progress: {
        total: reviews.length,
        draft: count((r) => r.status === 'DRAFT'),
        submitted: count((r) => r.status === 'SUBMITTED'),
        acknowledged: count((r) => r.status === 'ACKNOWLEDGED'),
      },
      reviews,
    };
  }

  async closeCycle(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!cycle) throw new NotFoundException('Cycle introuvable');
    if (cycle.status === 'CLOSED')
      throw new BadRequestException('Cycle déjà clôturé');
    return this.prisma.reviewCycle.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPRESSION D'UN CYCLE (RH uniquement)
  //  • supprime aussi ses évaluations en brouillon ;
  //  • s'il contient des évaluations déjà transmises, il faut le demander explicitement
  //    (withReviews) — elles sont alors supprimées aussi ;
  //  • les objectifs rattachés redeviennent « libres » ; les niveaux de compétence issus
  //    de ces évaluations sont retirés.
  // ──────────────────────────────────────────────────────────────────────────
  async deleteCycle(id: string, withReviews: boolean, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, companyId: ctx.companyId },
      select: { id: true, name: true },
    });
    if (!cycle) throw new NotFoundException('Cycle introuvable');

    const transmitted = await this.prisma.performanceReview.count({
      where: { cycleId: id, status: { not: 'DRAFT' } },
    });
    if (transmitted > 0 && !withReviews)
      throw new BadRequestException(
        `Ce cycle contient ${transmitted} évaluation(s) déjà transmise(s) aux employés. Confirmez la suppression complète pour les supprimer aussi.`,
      );

    const deleted = await this.prisma.$transaction(async (tx) => {
      const reviews = await tx.performanceReview.findMany({
        where: { cycleId: id },
        select: { id: true },
      });
      const ids = reviews.map((r: any) => r.id);
      if (ids.length) {
        await tx.competencyAssessment.deleteMany({ where: { reviewId: { in: ids } } });
        await tx.performanceReview.deleteMany({ where: { id: { in: ids }, cycleId: id } });
      }
      const gone = await tx.reviewCycle.deleteMany({ where: { id, companyId: ctx.companyId } });
      if (gone.count !== 1) throw new NotFoundException('Cycle introuvable');
      return ids.length;
    });

    this.logger.warn(
      `Cycle supprimé : id=${id} nom="${cycle.name}" évaluations=${deleted} (dont transmises=${transmitted}) par=${ctx.userId} entreprise=${ctx.companyId}`,
    );
    return { success: true, deletedReviews: deleted };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LANCEMENT
  // ──────────────────────────────────────────────────────────────────────────

  async launchCycle(
    id: string,
    raw: unknown,
    userId: string,
    companyId?: string,
  ) {
    const b = asBody(raw);
    const dto: LaunchCycleDto = {
      employeeIds: asUuidArray(b.employeeIds, 'Employés', 1000),
      departmentIds: asUuidArray(b.departmentIds, 'Départements', 200),
    };
    const ctx = await this.access.getCtx(userId, companyId);
    // RH : toute l'entreprise · MANAGER : uniquement les employés de son département
    this.access.assertCanManage(ctx);
    await this.access.assertFeature(ctx);

    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { template: true },
    });
    if (!cycle) throw new NotFoundException('Cycle introuvable');
    if (cycle.status !== 'OPEN')
      throw new ForbiddenException('Ce cycle est clôturé');

    // ── Employés ciblés ─────────────────────────────────────────────────────
    const empWhere: any = { companyId: ctx.companyId, status: 'ACTIVE' };
    if (ctx.isHR) {
      if (dto.employeeIds?.length) empWhere.id = { in: dto.employeeIds };
      else if (dto.departmentIds?.length)
        empWhere.departmentId = { in: dto.departmentIds };
    } else {
      // Manager : périmètre = ses départements, jamais plus
      const managed = await this.access.managedEmployeeIds(ctx);
      if (!managed.length)
        throw new BadRequestException(
          "Vous n'êtes responsable d'aucun département avec des employés",
        );
      if (dto.employeeIds?.length) {
        const allowed = new Set(managed);
        if (dto.employeeIds.some((e) => !allowed.has(e)))
          throw new ForbiddenException(
            "Certains employés ne font pas partie de votre département",
          );
        empWhere.id = { in: dto.employeeIds };
      } else {
        empWhere.id = { in: managed };
      }
    }
    const employees = await this.prisma.employee.findMany({
      where: empWhere,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        position: true,
        department: { select: { managerId: true } },
      },
    });
    if (!employees.length)
      throw new BadRequestException('Aucun employé actif dans ce périmètre');

    const alreadyIn = await this.prisma.performanceReview.findMany({
      where: { cycleId: id },
      select: { employeeId: true },
    });
    const done = new Set(alreadyIn.map((r) => r.employeeId));

    // ── Modèles de l'entreprise (match sur le poste) ────────────────────────
    const templates = await this.prisma.evaluationTemplate.findMany({
      where: { companyId: ctx.companyId },
    });
    const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
    const pickTemplate = (position: string) =>
      templates.find((t) => t.jobTitle && norm(t.jobTitle) === norm(position)) ??
      cycle.template ??
      null;
    const fallbackCriteria = () =>
      CRITERIA_TEMPLATES['success_factors'].criteria.map((c: any) => ({
        ...c,
        score: 0,
        comment: '',
      }));

    // Comptes utilisateurs des employés (pour notifier)
    const users = await this.prisma.user.findMany({
      where: {
        companyId: ctx.companyId,
        OR: [
          { employeeId: { in: employees.map((e) => e.id) } },
          { email: { in: employees.map((e) => e.email) } },
        ],
      },
      select: { id: true, email: true, employeeId: true },
    });

    let created = 0;
    let carriedGoals = 0;
    let templateGoals = 0;
    let standaloneGoals = 0;
    const withoutGoals: string[] = [];
    const reviewerNotifs = new Map<string, number>();

    for (const emp of employees) {
      if (done.has(emp.id)) continue;

      const tpl = pickTemplate(emp.position);
      const criteria = tpl
        ? (tpl.criteria as any[]).map((c) => ({
            ...c,
            score: 0,
            comment: '',
          }))
        : fallbackCriteria();

      const empUser = users.find(
        (u) => u.employeeId === emp.id || u.email === emp.email,
      );
      let reviewerId = emp.department?.managerId ?? ctx.userId;
      if (ctx.isManager) reviewerId = ctx.userId;
      if (empUser && reviewerId === empUser.id) reviewerId = ctx.userId; // jamais évalué par soi-même

      // Revue précédente (objectifs T+1 à reprendre)
      const prev = await this.prisma.performanceReview.findFirst({
        where: {
          employeeId: emp.id,
          status: { in: ['SUBMITTED', 'ACKNOWLEDGED'] },
        },
        orderBy: { date: 'desc' },
        select: { id: true },
      });

      try {
      await this.prisma.$transaction(async (tx) => {
        const review = await tx.performanceReview.create({
          data: {
            employeeId: emp.id,
            reviewerId,
            cycleId: cycle.id,
            period: cycle.name,
            reviewType: cycle.type as string,
            date: new Date(),
            status: 'DRAFT',
            criteria: criteria as any,
          },
        });

        let goalCount = 0;
        if (prev) {
          const carried = await tx.goal.updateMany({
            where: {
              employeeId: emp.id,
              plannedInReviewId: prev.id,
              evaluatedInReviewId: null,
            },
            data: { evaluatedInReviewId: review.id },
          });
          goalCount = carried.count;
          carriedGoals += carried.count;
        }

        // Objectifs « libres » (créés depuis la page Objectifs) qui couvrent la période :
        // ils entrent dans la fiche pour être évalués. Priorité aux objectifs réellement
        // assignés, avant les objectifs types du modèle.
        if (goalCount === 0) {
          const free = await tx.goal.findMany({
            where: {
              employeeId: emp.id,
              evaluatedInReviewId: null,
              plannedInReviewId: null,
              status: { not: 'CANCELLED' },
              startDate: { lte: cycle.endDate },
              endDate: { gte: cycle.startDate },
            },
            orderBy: { endDate: 'asc' },
            take: 20,
            select: { id: true, weight: true },
          });
          if (free.length) {
            await tx.goal.updateMany({
              where: { id: { in: free.map((g: any) => g.id) }, employeeId: emp.id },
              data: { evaluatedInReviewId: review.id },
            });
            // Aucun poids défini → répartition égale (le responsable ajuste dans la fiche)
            const sum = free.reduce((t: number, g: any) => t + Number(g.weight ?? 0), 0);
            if (sum <= 0) {
              const base = Math.floor((100 / free.length) * 100) / 100;
              for (let i = 0; i < free.length; i++) {
                await tx.goal.update({
                  where: { id: (free[i] as any).id },
                  data: { weight: i === free.length - 1 ? Math.round((100 - base * (free.length - 1)) * 100) / 100 : base },
                });
              }
            }
            goalCount = free.length;
            standaloneGoals += free.length;
          }
        }

        const tplObjectives = (tpl?.objectives as any[] | null) ?? null;
        if (goalCount === 0 && tplObjectives?.length) {
          await tx.goal.createMany({
            data: tplObjectives.map((o) => ({
              employeeId: emp.id,
              title: o.title,
              kpi: o.kpi ?? null,
              weight: o.weight,
              startDate: cycle.startDate,
              endDate: cycle.endDate,
              evaluatedInReviewId: review.id,
            })),
          });
          goalCount = tplObjectives.length;
          templateGoals += goalCount;
        }
        if (goalCount === 0)
          withoutGoals.push(`${emp.firstName} ${emp.lastName}`);
      });
      } catch (e: any) {
        // Lancement simultané : la contrainte unique (cycleId, employeeId) a déjà
        // empêché le doublon → on ignore cet employé au lieu de renvoyer une 500.
        if (e?.code === 'P2002') continue;
        throw e;
      }

      created++;
      reviewerNotifs.set(reviewerId, (reviewerNotifs.get(reviewerId) ?? 0) + 1);
    }

    await this.prisma.reviewCycle.update({
      where: { id },
      data: { launchedAt: new Date() },
    });

    // Notifications (best effort)
    try {
      const rows = [
        ...[...reviewerNotifs.entries()].map(([uid, n]) => ({
          userId: uid,
          type: 'SYSTEM_ALERT' as any,
          title: `📋 Évaluations ${cycle.name}`,
          message: `${n} évaluation(s) à rédiger pour le cycle ${cycle.name}.`,
          link: '/performance',
        })),
      ];
      if (rows.length)
        await this.prisma.notification.createMany({ data: rows as any });
    } catch (e) {
      this.logger.warn('Notifications de lancement non envoyées', e as any);
    }

    return {
      created,
      skipped: employees.length - created,
      carriedGoals,
      standaloneGoals,
      templateGoals,
      // Employés sans aucun objectif : le manager devra en ajouter dans la fiche
      withoutGoals,
    };
  }
}