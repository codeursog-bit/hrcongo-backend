// ============================================================================
// 📄 src/performance/competencies.service.ts
// Phase 2 — Compétences
//   • Référentiel : compétences avec descripteurs par niveau (1–5) + formations liées
//   • Fiches de poste : niveau requis par compétence (poste = Employee.position)
//   • Niveau actuel d'un employé = dernière évaluation (revue soumise ou saisie manuelle)
//   • Écarts = requis − actuel → formations suggérées
//   • Un modèle d'évaluation peut être généré depuis une fiche de poste
// Accès : RH = tout · manager = son département · employé = lui-même
// ============================================================================

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PerfCtx, PerformanceAccessService } from './performance-access.service';
import { isValidScore } from './performance-scoring.util';
import {
  LIMITS, asArray, asBody, asEnum, asRequiredText, asText, asUuid, asUuidArray,
} from './performance-validation.util';

const CATEGORIES = ['TECHNICAL', 'BEHAVIORAL', 'MANAGERIAL'] as const;
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

export interface CompetencyDto {
  name: string;
  category?: (typeof CATEGORIES)[number];
  description?: string | null;
  levels?: Record<string, string> | null;
  isActive?: boolean;
  courseIds?: string[];
}

export interface JobProfileDto {
  title: string;
  description?: string | null;
  requirements?: Array<{ competencyId: string; requiredLevel: number }>;
}

export interface GapRow {
  competency: {
    id: string;
    name: string;
    category: string;
    description: string | null;
    levels: Record<string, string> | null;
  };
  required: number;
  current: number | null;
  gap: number; // > 0 = en dessous du requis ; 0 ou < 0 = atteint / dépassé
  assessedAt: Date | null;
  source: string | null;
  courses: Array<{ id: string; title: string; durationHours: number | null }>;
}

@Injectable()
export class CompetenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PerformanceAccessService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // VALIDATIONS
  // ──────────────────────────────────────────────────────────────────────────
  private cleanLevels(levels?: unknown) {
    if (levels === undefined || levels === null) return null;
    if (typeof levels !== 'object' || Array.isArray(levels))
      throw new BadRequestException('Niveaux : objet attendu');
    const out: Record<string, string> = {};
    for (const k of ['1', '2', '3', '4', '5']) {
      const v = (levels as any)[k];
      if (v === undefined || v === null || v === '') continue;
      out[k] = asText(v, `Niveau ${k}`, 500)!.trim();
    }
    return Object.keys(out).length ? out : null;
  }

  private async assertCoursesInCompany(ids: string[], companyId: string) {
    if (!ids.length) return;
    const found = await this.prisma.trainingCourse.count({
      where: { id: { in: ids }, companyId },
    });
    if (found !== new Set(ids).size)
      throw new BadRequestException('Formation introuvable dans votre entreprise');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RÉFÉRENTIEL
  // ──────────────────────────────────────────────────────────────────────────
  async listCompetencies(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const rows = await this.prisma.competency.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        courses: {
          include: { course: { select: { id: true, title: true } } },
        },
        _count: { select: { jobRequirements: true } },
      },
    });
    return rows.map(({ courses, ...c }) => ({
      ...c,
      courses: courses.map((x) => x.course),
    }));
  }

  async createCompetency(raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    await this.access.assertFeature(ctx);
    const name = asRequiredText(dto.name, 'Nom', 120);
    const category = dto.category === undefined ? 'TECHNICAL' : asEnum(dto.category, CATEGORIES, 'Catégorie');
    const courseIds = [...new Set(asUuidArray(dto.courseIds, 'Formations', 50))];
    await this.assertCoursesInCompany(courseIds, ctx.companyId);

    const dup = await this.prisma.competency.findFirst({
      where: { companyId: ctx.companyId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw new BadRequestException('Cette compétence existe déjà');

    return this.prisma.competency.create({
      data: {
        companyId: ctx.companyId,
        name,
        category,
        description: asText(dto.description, 'Description', 2000)?.trim() || null,
        levels: this.cleanLevels(dto.levels) as any,
        courses: { create: courseIds.map((courseId) => ({ courseId })) },
      },
    });
  }

  async updateCompetency(id: string, raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const existing = await this.prisma.competency.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new NotFoundException('Compétence introuvable');
    const category = dto.category === undefined ? undefined : asEnum(dto.category, CATEGORIES, 'Catégorie');
    const name = dto.name === undefined ? undefined : asRequiredText(dto.name, 'Nom', 120);

    if (name && norm(name) !== norm(existing.name)) {
      const dup = await this.prisma.competency.findFirst({
        where: {
          companyId: ctx.companyId,
          id: { not: id },
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (dup) throw new BadRequestException('Cette compétence existe déjà');
    }

    const courseIds = dto.courseIds !== undefined ? [...new Set(asUuidArray(dto.courseIds, 'Formations', 50))] : null;
    if (courseIds) await this.assertCoursesInCompany(courseIds, ctx.companyId);
    const description = asText(dto.description, 'Description', 2000);

    return this.prisma.$transaction(async (tx) => {
      if (courseIds) {
        await tx.competencyCourse.deleteMany({ where: { competencyId: id } });
        if (courseIds.length)
          await tx.competencyCourse.createMany({
            data: courseIds.map((courseId) => ({ competencyId: id, courseId })),
          });
      }
      return tx.competency.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(category !== undefined && { category }),
          ...(description !== undefined && { description: description.trim() || null }),
          ...(dto.levels !== undefined && { levels: this.cleanLevels(dto.levels) as any }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive === true }),
        },
      });
    });
  }

  /** Supprime si jamais utilisée ; sinon désactive (l'historique des niveaux est conservé) */
  async deleteCompetency(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const existing = await this.prisma.competency.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { _count: { select: { assessments: true, jobRequirements: true } } },
    });
    if (!existing) throw new NotFoundException('Compétence introuvable');
    if (existing._count.assessments > 0) {
      await this.prisma.competency.update({ where: { id }, data: { isActive: false } });
      return { success: true, archived: true };
    }
    await this.prisma.competency.delete({ where: { id } });
    return { success: true, archived: false };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FICHES DE POSTE
  // ──────────────────────────────────────────────────────────────────────────
  private async cleanRequirements(raw: unknown, companyId: string) {
    const list = asArray<any>(raw, 'Compétences requises', 100).map((r0) => {
      const r = asBody(r0);
      if (!isValidScore(r.requiredLevel))
        throw new BadRequestException('Le niveau requis doit être de 1 à 5');
      return { competencyId: asUuid(r.competencyId, 'Compétence'), requiredLevel: Number(r.requiredLevel) };
    });
    const ids = list.map((r) => r.competencyId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Une compétence est listée deux fois');
    if (ids.length) {
      const found = await this.prisma.competency.count({
        where: { id: { in: ids }, companyId, isActive: true },
      });
      if (found !== ids.length)
        throw new BadRequestException('Compétence introuvable ou archivée');
    }
    return list;
  }

  async listJobProfiles(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const [profiles, positions] = await Promise.all([
      this.prisma.jobProfile.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { title: 'asc' },
        include: {
          requirements: {
            include: {
              competency: { select: { id: true, name: true, category: true } },
            },
          },
        },
      }),
      this.prisma.employee.groupBy({
        by: ['position'],
        where: { companyId: ctx.companyId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    const headcount = new Map(
      positions.map((p) => [norm(p.position), p._count._all]),
    );
    return {
      profiles: profiles.map((p) => ({
        ...p,
        employeeCount: headcount.get(norm(p.title)) ?? 0,
      })),
      // Postes existants sans fiche (aide à la saisie)
      uncoveredPositions: positions
        .map((p) => p.position)
        .filter((t) => t && !profiles.some((p) => norm(p.title) === norm(t))),
    };
  }

  async createJobProfile(raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    await this.access.assertFeature(ctx);
    const title = asRequiredText(dto.title, 'Intitulé du poste', 120);
    const reqs = await this.cleanRequirements(dto.requirements, ctx.companyId);
    const dup = await this.prisma.jobProfile.findFirst({
      where: { companyId: ctx.companyId, title: { equals: title, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw new BadRequestException('Une fiche existe déjà pour ce poste');
    return this.prisma.jobProfile.create({
      data: {
        companyId: ctx.companyId,
        title,
        description: asText(dto.description, 'Description', 2000)?.trim() || null,
        requirements: { create: reqs },
      },
    });
  }

  async updateJobProfile(id: string, raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const existing = await this.prisma.jobProfile.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new NotFoundException('Fiche de poste introuvable');
    const title = dto.title === undefined ? undefined : asRequiredText(dto.title, 'Intitulé du poste', 120);
    if (title && norm(title) !== norm(existing.title)) {
      const dup = await this.prisma.jobProfile.findFirst({
        where: {
          companyId: ctx.companyId,
          id: { not: id },
          title: { equals: title, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (dup) throw new BadRequestException('Une fiche existe déjà pour ce poste');
    }
    const reqs = dto.requirements !== undefined
      ? await this.cleanRequirements(dto.requirements, ctx.companyId)
      : null;
    const description = asText(dto.description, 'Description', 2000);

    return this.prisma.$transaction(async (tx) => {
      if (reqs) {
        await tx.jobProfileCompetency.deleteMany({ where: { jobProfileId: id } });
        if (reqs.length)
          await tx.jobProfileCompetency.createMany({
            data: reqs.map((r) => ({ ...r, jobProfileId: id })),
          });
      }
      return tx.jobProfile.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description: description.trim() || null }),
        },
      });
    });
  }

  async deleteJobProfile(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const existing = await this.prisma.jobProfile.findFirst({
      where: { id, companyId: ctx.companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Fiche de poste introuvable');
    await this.prisma.jobProfile.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Génère (ou remplace) le modèle d'évaluation du poste : un critère par
   * compétence requise, poids répartis à parts égales, description = descripteur
   * du niveau requis. Le critère garde `competencyId` → à la soumission d'une
   * évaluation, la note met à jour le niveau de l'employé.
   */
  async generateTemplate(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    await this.access.assertFeature(ctx);
    const profile = await this.prisma.jobProfile.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { requirements: { include: { competency: true } } },
    });
    if (!profile) throw new NotFoundException('Fiche de poste introuvable');
    const reqs = profile.requirements.filter((r) => r.competency.isActive);
    if (!reqs.length)
      throw new BadRequestException(
        'Ajoutez au moins une compétence à cette fiche avant de générer le modèle',
      );

    const n = reqs.length;
    const base = Math.floor((100 / n) * 100) / 100;
    const criteria = reqs.map((r, i) => {
      const levels = (r.competency.levels as Record<string, string> | null) ?? {};
      return {
        id: `comp_${r.competencyId.replace(/-/g, '').slice(0, 12)}`,
        label: r.competency.name,
        ...(levels[String(r.requiredLevel)] && {
          description: `Niveau attendu (${r.requiredLevel}/5) : ${levels[String(r.requiredLevel)]}`,
        }),
        competencyId: r.competencyId,
        weight: i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base,
      };
    });

    const name = `Compétences — ${profile.title}`;
    const existing = await this.prisma.evaluationTemplate.findFirst({
      where: { companyId: ctx.companyId, name },
      select: { id: true },
    });
    const data = {
      name,
      description: `Généré depuis la fiche de poste « ${profile.title} »`,
      jobTitle: profile.title,
      criteria: criteria as any,
    };
    const template = existing
      ? await this.prisma.evaluationTemplate.update({ where: { id: existing.id }, data })
      : await this.prisma.evaluationTemplate.create({
          data: { ...data, companyId: ctx.companyId },
        });
    return { template, replaced: !!existing };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // NIVEAUX ACTUELS + ÉCARTS
  // ──────────────────────────────────────────────────────────────────────────
  /** Dernier niveau connu par compétence pour un lot d'employés */
  private async latestLevels(employeeIds: string[]) {
    const out = new Map<string, Map<string, { level: number; at: Date; source: string }>>();
    if (!employeeIds.length) return out;
    const rows = await this.prisma.competencyAssessment.findMany({
      where: { employeeId: { in: employeeIds } },
      orderBy: { assessedAt: 'desc' },
      select: { employeeId: true, competencyId: true, level: true, assessedAt: true, source: true },
    });
    for (const r of rows) {
      let m = out.get(r.employeeId);
      if (!m) out.set(r.employeeId, (m = new Map()));
      if (!m.has(r.competencyId))
        m.set(r.competencyId, { level: r.level, at: r.assessedAt, source: r.source });
    }
    return out;
  }

  private async profileForPosition(companyId: string, position: string) {
    const profiles = await this.prisma.jobProfile.findMany({
      where: { companyId },
      include: {
        requirements: {
          where: { competency: { isActive: true } },
          include: {
            competency: {
              select: {
                id: true, name: true, category: true, description: true, levels: true,
                courses: { select: { course: { select: { id: true, title: true, durationHours: true } } } },
              },
            },
          },
        },
      },
    });
    return profiles.find((p) => norm(p.title) === norm(position)) ?? null;
  }

  private buildRows(profile: any, latest: Map<string, { level: number; at: Date; source: string }> | undefined): GapRow[] {
    return profile.requirements.map((r: any) => {
      const cur = latest?.get(r.competencyId) ?? null;
      return {
        competency: {
          id: r.competency.id,
          name: r.competency.name,
          category: r.competency.category,
          description: r.competency.description,
          levels: r.competency.levels,
        },
        required: r.requiredLevel,
        current: cur?.level ?? null,
        gap: r.requiredLevel - (cur?.level ?? 0),
        assessedAt: cur?.at ?? null,
        source: cur?.source ?? null,
        courses: r.competency.courses.map((c: any) => c.course),
      };
    });
  }

  async getEmployeeCompetencies(employeeId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    const emp = await this.access.assertCanViewEmployee(ctx, employeeId);
    return this.employeeView(ctx, emp);
  }

  async getMyCompetencies(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    if (!ctx.employeeId) return { employee: null, profile: null, rows: [], summary: null };
    const emp = await this.access.loadEmployee(ctx, ctx.employeeId);
    return this.employeeView(ctx, emp);
  }

  private async employeeView(ctx: PerfCtx, emp: { id: string; firstName: string; lastName: string; position: string }) {
    const profile = await this.profileForPosition(ctx.companyId, emp.position);
    const base = {
      employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, position: emp.position },
      canAssess: this.access.isSupervisorOf(ctx, emp as any),
    };
    if (!profile) return { ...base, profile: null, rows: [], summary: null };

    const latest = (await this.latestLevels([emp.id])).get(emp.id);
    const rows = this.buildRows(profile, latest);
    return {
      ...base,
      profile: { id: profile.id, title: profile.title, description: profile.description },
      rows,
      summary: this.summarize(rows),
    };
  }

  private summarize(rows: GapRow[]) {
    const assessed = rows.filter((r) => r.current !== null);
    const met = rows.filter((r) => r.current !== null && r.gap <= 0).length;
    return {
      total: rows.length,
      assessed: assessed.length,
      met,
      gaps: rows.filter((r) => r.current !== null && r.gap > 0).length,
      notAssessed: rows.length - assessed.length,
      // Part des compétences requises atteintes (niveau actuel ≥ requis)
      coverage: rows.length ? Math.round((met / rows.length) * 100) : 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ÉVALUATION MANUELLE (supérieur / RH)
  // ──────────────────────────────────────────────────────────────────────────
  async assess(employeeId: string, raw: unknown, userId: string, companyId?: string) {
    const body = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    await this.access.assertCanManageEmployee(ctx, asUuid(employeeId, 'Employé'));
    const list = asArray<any>(body.assessments, 'Évaluations', 100).map((a0) => {
      const a = asBody(a0);
      if (!isValidScore(a.level)) throw new BadRequestException('Le niveau doit être de 1 à 5');
      return {
        competencyId: asUuid(a.competencyId, 'Compétence'),
        level: Number(a.level),
        comment: asText(a.comment, 'Commentaire', 1000),
      };
    });
    if (!list.length) throw new BadRequestException('Aucune évaluation à enregistrer');
    const ids = [...new Set(list.map((a) => a.competencyId))];
    const found = await this.prisma.competency.count({
      where: { id: { in: ids }, companyId: ctx.companyId, isActive: true },
    });
    if (found !== ids.length) throw new BadRequestException('Compétence introuvable');

    await this.prisma.competencyAssessment.createMany({
      data: list.map((a) => ({
        employeeId,
        competencyId: a.competencyId,
        level: a.level,
        source: 'MANUAL',
        assessedById: ctx.userId,
        comment: a.comment?.trim() || null,
      })),
    });
    return this.getEmployeeCompetencies(employeeId, userId, companyId);
  }

  /**
   * Appelée à la soumission d'une évaluation de cycle : chaque critère lié à une
   * compétence devient un niveau enregistré (historisé).
   */
  async recordFromReview(
    tx: any,
    review: { id: string; employeeId: string; criteria: any[]; reviewerId: string },
    companyId: string,
  ) {
    const linked = (review.criteria ?? []).filter(
      (c) => c.competencyId && isValidScore(c.score),
    );
    if (!linked.length) return 0;
    const valid = await tx.competency.findMany({
      where: { id: { in: linked.map((c) => c.competencyId) }, companyId },
      select: { id: true },
    });
    const ok = new Set<string>(valid.map((c: any) => c.id));
    const rows = linked
      .filter((c) => ok.has(c.competencyId))
      .map((c) => ({
        employeeId: review.employeeId,
        competencyId: c.competencyId,
        level: Number(c.score),
        source: 'REVIEW',
        reviewId: review.id,
        assessedById: review.reviewerId,
        comment: c.comment || null,
      }));
    if (rows.length) await tx.competencyAssessment.createMany({ data: rows });
    return rows.length;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VUE ÉQUIPE : qui a des écarts, et sur quelles compétences (besoins de formation)
  // ──────────────────────────────────────────────────────────────────────────
  async teamOverview(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const where = await this.access.superviseWhere(ctx);
    const employees = await this.prisma.employee.findMany({
      where: { ...where, status: 'ACTIVE' },
      select: {
        id: true, firstName: true, lastName: true, position: true, photoUrl: true,
        department: { select: { name: true } },
      },
      orderBy: { lastName: 'asc' },
    });
    const profiles = await this.prisma.jobProfile.findMany({
      where: { companyId: ctx.companyId },
      include: {
        requirements: {
          where: { competency: { isActive: true } },
          include: { competency: { select: { id: true, name: true } } },
        },
      },
    });
    const byTitle = new Map<string, (typeof profiles)[number]>(
      profiles.map((p) => [norm(p.title), p] as [string, (typeof profiles)[number]]),
    );
    const latest = await this.latestLevels(employees.map((e) => e.id));

    const needs = new Map<string, { competencyId: string; name: string; employees: number; totalGap: number }>();
    const people = employees.map((e) => {
      const profile = byTitle.get(norm(e.position));
      if (!profile) return { ...e, hasProfile: false, summary: null as any };
      const lv = latest.get(e.id);
      let met = 0, gaps = 0, assessed = 0;
      for (const r of profile.requirements) {
        const cur = lv?.get(r.competencyId)?.level;
        if (cur === undefined) continue;
        assessed++;
        if (cur >= r.requiredLevel) met++;
        else {
          gaps++;
          const n = needs.get(r.competencyId) ?? {
            competencyId: r.competencyId, name: r.competency.name, employees: 0, totalGap: 0,
          };
          n.employees++;
          n.totalGap += r.requiredLevel - cur;
          needs.set(r.competencyId, n);
        }
      }
      const total = profile.requirements.length;
      return {
        ...e,
        hasProfile: true,
        summary: {
          total, assessed, met, gaps, notAssessed: total - assessed,
          coverage: total ? Math.round((met / total) * 100) : 0,
        },
      };
    });

    return {
      employees: people,
      topNeeds: [...needs.values()].sort((a, b) => b.employees - a.employees || b.totalGap - a.totalGap).slice(0, 8),
      withoutProfile: people.filter((p) => !p.hasProfile).length,
    };
  }
}