// ============================================================================
// 📄 src/performance/development.service.ts — Phase 3 : plan de développement
//   Un plan = des actions (formation, mentorat, projet, auto-formation…) pour
//   combler les écarts de compétences ou préparer une évolution.
//   • Supérieur / RH : crée le plan (éventuellement pré-rempli depuis les écarts),
//     ajoute, modifie, supprime des actions
//   • Employé : voit ses plans, met à jour le statut de ses actions et ajoute une note
//   Le plan passe à "terminé" tout seul quand toutes ses actions sont faites.
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
  LIMITS, asArray, asBody, asDate, asEnum, asOptUuid, asRequiredText, asText,
} from './performance-validation.util';

const ACTION_TYPES = ['TRAINING', 'MENTORING', 'PROJECT', 'SELF_STUDY', 'OTHER'] as const;
const ACTION_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
const PLAN_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

export interface ActionDto {
  type?: (typeof ACTION_TYPES)[number];
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  competencyId?: string | null;
  courseId?: string | null;
  status?: (typeof ACTION_STATUSES)[number];
  employeeNote?: string | null;
}

export interface PlanDto {
  title: string;
  dueDate?: string | null;
  /** Pré-remplit le plan avec une action par compétence en écart */
  fromGaps?: boolean;
  actions?: ActionDto[];
}

const planInclude = {
  actions: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      course: { select: { id: true, title: true } },
      competency: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class DevelopmentService {
  private readonly logger = new Logger(DevelopmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PerformanceAccessService,
    private readonly competencies: CompetenciesService,
  ) {}

  // ── Lecture ───────────────────────────────────────────────────────────────
  private shape(plan: any) {
    const total = plan.actions.length;
    const done = plan.actions.filter((a: any) => a.status === 'DONE').length;
    return { ...plan, progress: { total, done, pct: total ? Math.round((done / total) * 100) : 0 } };
  }

  async getMyPlans(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    if (!ctx.employeeId) return { employeeId: null, plans: [] };
    return { employeeId: ctx.employeeId, plans: await this.plansOf(ctx, ctx.employeeId) };
  }

  async getEmployeePlans(employeeId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    await this.access.assertCanViewEmployee(ctx, employeeId);
    return {
      employeeId,
      canEdit: !this.access.isSelf(ctx, employeeId) && (ctx.isHR || ctx.isManager),
      plans: await this.plansOf(ctx, employeeId),
    };
  }

  private async plansOf(ctx: PerfCtx, employeeId: string) {
    const plans = await this.prisma.developmentPlan.findMany({
      where: { employeeId, companyId: ctx.companyId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: planInclude as any,
    });
    return plans.map((p: any) => this.shape(p));
  }

  // ── Validation ────────────────────────────────────────────────────────────
  private parseDate(v: unknown, label: string): Date | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    return asDate(v, label);
  }

  /** Assainit une action (types, bornes) et vérifie que formation/compétence sont de l'entreprise */
  private async cleanAction(raw: unknown, companyId: string, requireTitle: boolean) {
    const a = asBody(raw);
    const title = requireTitle ? asRequiredText(a.title, "Intitulé de l'action", 200) : asText(a.title, "Intitulé de l'action", 200);
    const type = a.type === undefined ? undefined : asEnum(a.type, ACTION_TYPES, "Type d'action");
    const courseId = a.courseId === undefined ? undefined : asOptUuid(a.courseId, 'Formation');
    const competencyId = a.competencyId === undefined ? undefined : asOptUuid(a.competencyId, 'Compétence');
    if (courseId) {
      const c = await this.prisma.trainingCourse.count({ where: { id: courseId, companyId } });
      if (!c) throw new BadRequestException('Formation introuvable');
    }
    if (competencyId) {
      const c = await this.prisma.competency.count({ where: { id: competencyId, companyId } });
      if (!c) throw new BadRequestException('Compétence introuvable');
    }
    const description = asText(a.description, 'Détails', LIMITS.COMMENT);
    return {
      ...(type !== undefined && { type: type as any }),
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description.trim() || null }),
      ...(competencyId !== undefined && { competencyId }),
      ...(courseId !== undefined && { courseId }),
      dueDate: this.parseDate(a.dueDate, 'Échéance'),
    };
  }

  // ── Création d'un plan ────────────────────────────────────────────────────
  async createPlan(employeeId: string, raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const emp = await this.access.assertCanManageEmployee(ctx, employeeId);
    await this.access.assertFeature(ctx);
    const title = asRequiredText(dto.title, 'Titre du plan', 160);

    const cleaned: any[] = [];
    for (const a of asArray(dto.actions, 'Actions', 50)) cleaned.push(await this.cleanAction(a, ctx.companyId, true));

    let generated = 0;
    if (dto.fromGaps === true) {
      const view: any = await this.competencies.getEmployeeCompetencies(employeeId, userId, companyId);
      for (const r of view.rows ?? []) {
        if (r.current === null || r.gap <= 0) continue; // seuls les écarts constatés
        const course = r.courses?.[0];
        cleaned.push({
          type: (course ? 'TRAINING' : 'OTHER') as any,
          title: `Progresser en « ${r.competency.name} » (niveau ${r.current} → ${r.required})`,
          description: null,
          competencyId: r.competency.id,
          courseId: course?.id ?? null,
          dueDate: null,
        });
        generated++;
      }
    }

    const plan = await this.prisma.developmentPlan.create({
      data: {
        companyId: ctx.companyId,
        employeeId: emp.id,
        title,
        dueDate: this.parseDate(dto.dueDate, 'Échéance du plan') ?? null,
        createdById: ctx.userId,
        actions: { create: cleaned.map((a, i) => ({ ...a, sortOrder: i })) },
      },
      include: planInclude as any,
    });

    await this.notifyEmployee(emp, ctx.companyId, '🎯 Nouveau plan de développement',
      `Un plan de développement « ${plan.title} » a été préparé pour vous.`);
    return { ...this.shape(plan), generatedFromGaps: generated };
  }

  // ── Plan : modification / suppression ─────────────────────────────────────
  private async loadPlan(planId: string, ctx: PerfCtx) {
    const plan = await this.prisma.developmentPlan.findFirst({
      where: { id: planId, companyId: ctx.companyId },
      select: { id: true, employeeId: true, status: true },
    });
    if (!plan) throw new NotFoundException('Plan introuvable');
    return plan;
  }

  async updatePlan(planId: string, raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const plan = await this.loadPlan(planId, ctx);
    await this.access.assertCanManageEmployee(ctx, plan.employeeId);
    const title = dto.title === undefined ? undefined : asRequiredText(dto.title, 'Titre', 160);
    const status = dto.status === undefined ? undefined : asEnum(dto.status, PLAN_STATUSES, 'Statut');
    const updated = await this.prisma.developmentPlan.update({
      where: { id: planId },
      data: {
        ...(title !== undefined && { title }),
        ...(status !== undefined && { status: status as any }),
        ...(dto.dueDate !== undefined && { dueDate: this.parseDate(dto.dueDate, 'Échéance du plan') }),
      },
      include: planInclude as any,
    });
    return this.shape(updated);
  }

  async deletePlan(planId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const plan = await this.loadPlan(planId, ctx);
    await this.access.assertCanManageEmployee(ctx, plan.employeeId);
    await this.prisma.developmentPlan.delete({ where: { id: planId } });
    return { success: true };
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async addAction(planId: string, raw: unknown, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const plan = await this.loadPlan(planId, ctx);
    await this.access.assertCanManageEmployee(ctx, plan.employeeId);
    const data = await this.cleanAction(raw, ctx.companyId, true);
    const last = await this.prisma.developmentAction.findFirst({
      where: { planId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
    });
    await this.prisma.$transaction(async (tx: any) => {
      await tx.developmentAction.create({ data: { ...data, planId, sortOrder: (last?.sortOrder ?? -1) + 1 } });
      // Une nouvelle action rouvre un plan terminé
      if (plan.status === 'COMPLETED')
        await tx.developmentPlan.update({ where: { id: planId }, data: { status: 'ACTIVE' } });
    });
    return this.reload(planId);
  }

  async updateAction(actionId: string, raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    const action = await this.prisma.developmentAction.findUnique({
      where: { id: actionId },
      include: { plan: { select: { id: true, companyId: true, employeeId: true, createdById: true, title: true } } },
    });
    if (!action || action.plan.companyId !== ctx.companyId) throw new NotFoundException('Action introuvable');

    const self = this.access.isSelf(ctx, action.plan.employeeId);
    let data: any;
    if (self) {
      // L'employé ne touche qu'à l'avancement et à sa note
      const forbidden = ['type', 'title', 'description', 'dueDate', 'competencyId', 'courseId'] as const;
      if (forbidden.some((k) => (dto as any)[k] !== undefined))
        throw new ForbiddenException("Seul votre responsable peut modifier le contenu d'une action");
      const status = dto.status === undefined ? undefined : asEnum(dto.status, ACTION_STATUSES, 'Statut');
      const note = asText(dto.employeeNote, 'Note', 2000);
      data = {
        ...(status !== undefined && { status: status as any }),
        ...(note !== undefined && { employeeNote: note.trim() || null }),
      };
    } else {
      this.access.assertCanManage(ctx);
      await this.access.assertCanManageEmployee(ctx, action.plan.employeeId);
      const status = dto.status === undefined ? undefined : asEnum(dto.status, ACTION_STATUSES, 'Statut');
      data = {
        ...(await this.cleanAction(dto, ctx.companyId, false)),
        ...(status !== undefined && { status: status as any }),
      };
      if (data.dueDate === undefined) delete data.dueDate;
    }
    if (data.status !== undefined) data.completedAt = data.status === 'DONE' ? new Date() : null;

    await this.prisma.$transaction(async (tx: any) => {
      await tx.developmentAction.update({ where: { id: actionId }, data });
      await this.syncPlanStatus(tx, action.plan.id);
    });

    if (self && data.status === 'DONE')
      await this.notifyUser(action.plan.createdById, '✅ Action de développement terminée',
        `Une action du plan « ${action.plan.title} » a été marquée comme faite.`);
    return this.reload(action.plan.id);
  }

  async deleteAction(actionId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const action = await this.prisma.developmentAction.findUnique({
      where: { id: actionId },
      include: { plan: { select: { id: true, companyId: true, employeeId: true } } },
    });
    if (!action || action.plan.companyId !== ctx.companyId) throw new NotFoundException('Action introuvable');
    await this.access.assertCanManageEmployee(ctx, action.plan.employeeId);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.developmentAction.delete({ where: { id: actionId } });
      await this.syncPlanStatus(tx, action.plan.id);
    });
    return this.reload(action.plan.id);
  }

  /** ACTIVE ⇄ COMPLETED selon l'avancement (un plan annulé n'est jamais touché) */
  private async syncPlanStatus(tx: any, planId: string) {
    const plan = await tx.developmentPlan.findUnique({
      where: { id: planId }, select: { status: true, actions: { select: { status: true } } },
    });
    if (!plan || plan.status === 'CANCELLED') return;
    const all = plan.actions.length > 0 && plan.actions.every((a: any) => a.status === 'DONE');
    if (all && plan.status === 'ACTIVE')
      await tx.developmentPlan.update({ where: { id: planId }, data: { status: 'COMPLETED' } });
    else if (!all && plan.status === 'COMPLETED')
      await tx.developmentPlan.update({ where: { id: planId }, data: { status: 'ACTIVE' } });
  }

  private async reload(planId: string) {
    const p = await this.prisma.developmentPlan.findUnique({ where: { id: planId }, include: planInclude as any });
    return this.shape(p);
  }

  // ── Notifications (best effort) ───────────────────────────────────────────
  private async notifyUser(userId: string, title: string, message: string) {
    try {
      await this.prisma.notification.create({
        data: { userId, type: 'SYSTEM_ALERT' as any, title, message, link: '/performance/mon-espace' },
      });
    } catch (e) {
      this.logger.warn('Notification échouée', e as any);
    }
  }

  private async notifyEmployee(emp: { id: string; email: string }, companyId: string, title: string, message: string) {
    const u = await this.prisma.user.findFirst({
      where: { companyId, OR: [{ employeeId: emp.id }, { email: emp.email }] },
      select: { id: true },
    });
    if (u) await this.notifyUser(u.id, title, message);
  }
}