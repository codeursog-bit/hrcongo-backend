// ============================================================================
// 📄 src/performance/career.service.ts — Phase 3 : parcours de carrière
//   • Chronologie d'un employé : embauche, événements de carrière, passages
//     d'échelon (module échelons, lu sans le modifier), formations terminées,
//     évaluations transmises
//   • Propositions d'avancement : un supérieur propose, la RH valide ou refuse
//     (décision toujours humaine). Confidentielles : l'employé ne voit que la
//     décision finale, sous forme d'événement de carrière.
// Accès : RH = tout · manager = son département · employé = lui-même
// ============================================================================

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PerfCtx, PerformanceAccessService, PERF_HR_ROLES } from './performance-access.service';
import { formatEchelonLabel, parseEchelonIndex } from '../common/utils/echelon.util';
import {
  LIMITS, asBody, asDate, asEnum, asOptUuid, asRequiredText, asText, asUuid,
} from './performance-validation.util';

const EVENT_TYPES = [
  'POSITION_CHANGE', 'DEPARTMENT_CHANGE', 'ECHELON_CHANGE',
  'CONTRACT_CHANGE', 'PROMOTION', 'CONFIRMATION', 'OTHER',
] as const;
const PROMO_TYPES = ['POSITION_CHANGE', 'ECHELON_MERIT', 'OTHER'] as const;
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

export type TimelineKind = 'HIRE' | 'CAREER' | 'ECHELON' | 'TRAINING' | 'REVIEW';

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  type?: string;
  date: Date;
  title: string;
  fromValue?: string | null;
  toValue?: string | null;
  detail?: string | null;
  notes?: string | null; // supérieurs / RH uniquement
  deletable?: boolean; // événement manuel, RH uniquement
  reviewId?: string;
}

export interface EventDto {
  type: (typeof EVENT_TYPES)[number];
  effectiveDate: string;
  title: string;
  fromValue?: string | null;
  toValue?: string | null;
  notes?: string | null;
}

export interface ProposalDto {
  employeeId: string;
  type: (typeof PROMO_TYPES)[number];
  targetValue: string;
  justification: string;
  reviewId?: string | null;
}

export interface DecisionDto {
  decision: 'APPROVED' | 'REJECTED';
  comment?: string;
  effectiveDate?: string;
  /** POSITION_CHANGE : met à jour le poste de la fiche employé (défaut : oui) */
  applyToEmployee?: boolean;
  notifyEmployee?: boolean;
}

@Injectable()
export class CareerService {
  private readonly logger = new Logger(CareerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PerformanceAccessService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // CHRONOLOGIE
  // ──────────────────────────────────────────────────────────────────────────
  async getEmployeeTimeline(employeeId: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    const emp = await this.access.assertCanViewEmployee(ctx, employeeId);
    return this.timeline(ctx, emp.id);
  }

  async getMyTimeline(userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    if (!ctx.employeeId) return { employee: null, items: [] as TimelineItem[], canEdit: false };
    return this.timeline(ctx, ctx.employeeId);
  }

  private async timeline(ctx: PerfCtx, employeeId: string) {
    const self = this.access.isSelf(ctx, employeeId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, firstName: true, lastName: true, position: true, hireDate: true, echelon: true,
        department: { select: { name: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    const [events, echelons, trainings, reviews] = await Promise.all([
      this.prisma.careerEvent.findMany({ where: { employeeId, companyId: ctx.companyId } }),
      this.prisma.echelonSuggestion.findMany({
        where: { employeeId, companyId: ctx.companyId, status: 'ACCEPTED' },
      }),
      this.prisma.employeeTraining.findMany({
        where: { employeeId, status: 'COMPLETED' },
        select: {
          id: true, endDate: true, validatedAt: true, startDate: true,
          course: { select: { title: true } },
        },
      }),
      this.prisma.performanceReview.findMany({
        where: { employeeId, status: { in: ['SUBMITTED', 'ACKNOWLEDGED'] } },
        select: { id: true, period: true, verdict: true, submittedAt: true, date: true },
      }),
    ]);

    const hire: TimelineItem = {
      id: `hire-${employee.id}`, kind: 'HIRE', date: employee.hireDate, title: 'Embauche',
    };
    const items: TimelineItem[] = [
      hire,
      ...events.map((e: any): TimelineItem => ({
        id: e.id, kind: 'CAREER', type: e.type, date: e.effectiveDate, title: e.title,
        fromValue: e.fromValue, toValue: e.toValue,
        // Les notes internes ne sont jamais envoyées à l'employé
        ...(self ? {} : { notes: e.notes }),
        deletable: !self && ctx.isHR && e.source === 'MANUAL',
      })),
      ...echelons.map((s: any): TimelineItem => ({
        id: `ech-${s.id}`, kind: 'ECHELON', date: s.decidedAt ?? s.anniversaryDate,
        title: "Passage d'échelon",
        fromValue: formatEchelonLabel(s.currentEchelonIndex),
        toValue: formatEchelonLabel(s.suggestedEchelonIndex),
        detail: `${s.yearsCompleted} an(s) d'ancienneté`,
      })),
      ...trainings.map((t: any): TimelineItem => ({
        id: `trn-${t.id}`, kind: 'TRAINING', date: t.validatedAt ?? t.endDate ?? t.startDate ?? new Date(),
        title: `Formation terminée : ${t.course?.title ?? '—'}`,
      })),
      ...reviews.map((r: any): TimelineItem => ({
        id: `rev-${r.id}`, kind: 'REVIEW', date: r.submittedAt ?? r.date,
        title: `Évaluation ${r.period}`, detail: r.verdict ?? null, reviewId: r.id,
      })),
    ].sort((a, b) => +new Date(b.date) - +new Date(a.date));

    return {
      employee: {
        id: employee.id, firstName: employee.firstName, lastName: employee.lastName,
        position: employee.position, department: employee.department?.name ?? null,
        echelon: employee.echelon ? formatEchelonLabel(parseEchelonIndex(employee.echelon)) : null,
      },
      items,
      canEdit: !self && ctx.isHR,
      canPropose: !self && (ctx.isHR || ctx.isManager),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ÉVÉNEMENTS MANUELS (RH) — pour reconstituer un historique antérieur à l'app
  // ──────────────────────────────────────────────────────────────────────────
  async createEvent(employeeId: string, raw: unknown, userId: string, companyId?: string) {
    const dto = asBody(raw);
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const emp = await this.access.loadEmployee(ctx, asUuid(employeeId, 'Employé'));
    const type = asEnum(dto.type, EVENT_TYPES, "Type d'événement");
    const title = asRequiredText(dto.title, 'Intitulé', 160);
    const date = asDate(dto.effectiveDate, 'Date');
    if (date.getTime() > Date.now() + 366 * 86400000)
      throw new BadRequestException('Date trop éloignée dans le futur');

    return this.prisma.careerEvent.create({
      data: {
        companyId: ctx.companyId,
        employeeId: emp.id,
        type: type as any,
        effectiveDate: date,
        title,
        fromValue: asText(dto.fromValue, 'Avant', 120)?.trim() || null,
        toValue: asText(dto.toValue, 'Après', 120)?.trim() || null,
        notes: asText(dto.notes, 'Note', 2000)?.trim() || null,
        source: 'MANUAL',
        createdById: ctx.userId,
      },
    });
  }

  async deleteEvent(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);
    const ev = await this.prisma.careerEvent.findFirst({
      where: { id, companyId: ctx.companyId },
      select: { id: true, source: true },
    });
    if (!ev) throw new NotFoundException('Événement introuvable');
    if (ev.source !== 'MANUAL')
      throw new BadRequestException("Cet événement découle d'une décision et ne peut pas être supprimé");
    await this.prisma.careerEvent.delete({ where: { id } });
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PROPOSITIONS D'AVANCEMENT
  // ──────────────────────────────────────────────────────────────────────────
  async createProposal(raw: unknown, userId: string, companyId?: string) {
    const b = asBody(raw);
    const dto = {
      employeeId: asUuid(b.employeeId, 'Employé'),
      type: asEnum(b.type, PROMO_TYPES, 'Type de proposition'),
      targetValue: asRequiredText(b.targetValue, "Poste ou échelon visé", 120),
      justification: asRequiredText(b.justification, 'Justification', LIMITS.COMMENT),
      reviewId: asOptUuid(b.reviewId, 'Évaluation'),
    };
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    await this.access.assertFeature(ctx);
    // supérieur de l'employé (jamais pour soi-même)
    await this.access.assertCanManageEmployee(ctx, dto.employeeId);

    const target = dto.targetValue;
    const justification = dto.justification;
    if (justification.length < 10)
      throw new BadRequestException('Expliquez votre proposition (10 caractères minimum)');

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { position: true, echelon: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    if (dto.reviewId) {
      const rv = await this.prisma.performanceReview.findFirst({
        where: { id: dto.reviewId, employeeId: dto.employeeId },
        select: { id: true },
      });
      if (!rv) throw new BadRequestException("Cette évaluation n'appartient pas à l'employé");
    }

    const pending = await this.prisma.promotionProposal.findFirst({
      where: { employeeId: dto.employeeId, type: dto.type as any, status: 'PENDING' },
      select: { id: true },
    });
    if (pending)
      throw new BadRequestException('Une proposition de ce type est déjà en attente pour cet employé');

    const currentValue =
      dto.type === 'POSITION_CHANGE'
        ? employee.position
        : dto.type === 'ECHELON_MERIT' && employee.echelon
          ? formatEchelonLabel(parseEchelonIndex(employee.echelon))
          : null;

    const created = await this.prisma.promotionProposal.create({
      data: {
        companyId: ctx.companyId,
        employeeId: dto.employeeId,
        type: dto.type as any,
        currentValue,
        targetValue: target.slice(0, 120),
        justification,
        reviewId: dto.reviewId ?? null,
        proposedById: ctx.userId,
      },
    });

    // Notifier la RH (sauf si c'est elle qui propose)
    try {
      const hr = await this.prisma.user.findMany({
        where: { companyId: ctx.companyId, role: { in: PERF_HR_ROLES as UserRole[] }, id: { not: ctx.userId } },
        select: { id: true },
      });
      if (hr.length)
        await this.prisma.notification.createMany({
          data: hr.map((u: any) => ({
            userId: u.id,
            type: 'SYSTEM_ALERT' as any,
            title: "📈 Proposition d'avancement",
            message: 'Une proposition attend votre décision.',
            link: '/performance/carriere',
          })),
        });
    } catch (e) {
      this.logger.warn('Notification RH échouée', e as any);
    }
    return created;
  }

  async listProposals(userId: string, status?: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const where: any = { companyId: ctx.companyId };
    // Un manager ne voit que SES propositions, et seulement pour les employés
    // qu'il supervise encore (jamais ceux d'un autre département).
    if (!ctx.isHR) {
      where.proposedById = ctx.userId;
      where.employee = await this.access.superviseWhere(ctx);
    }
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) where.status = status;

    const rows = await this.prisma.promotionProposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, position: true, photoUrl: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const userIds = [...new Set(rows.flatMap((r: any) => [r.proposedById, r.decidedById].filter(Boolean)))] as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const name = (id?: string | null) => {
      const u = users.find((x: any) => x.id === id);
      return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : null;
    };

    // Contexte décisionnel pour la RH : dernière évaluation liée
    const reviewIds = rows.map((r: any) => r.reviewId).filter(Boolean) as string[];
    const reviews = reviewIds.length
      ? await this.prisma.performanceReview.findMany({
          where: { id: { in: reviewIds } },
          select: { id: true, period: true, overallScore: true, verdict: true },
        })
      : [];

    return rows.map((r: any) => ({
      ...r,
      proposedByName: name(r.proposedById),
      decidedByName: name(r.decidedById),
      review: reviews.find((x: any) => x.id === r.reviewId) ?? null,
      canDecide: ctx.isHR && r.status === 'PENDING',
      canCancel: r.status === 'PENDING' && (ctx.isHR || r.proposedById === ctx.userId),
    }));
  }

  async decide(id: string, raw: unknown, userId: string, companyId?: string) {
    const b = asBody(raw);
    const dto: DecisionDto = {
      decision: asEnum(b.decision, ['APPROVED', 'REJECTED'] as const, 'Décision'),
      comment: asText(b.comment, 'Commentaire', 2000),
      effectiveDate: b.effectiveDate ? asDate(b.effectiveDate, "Date d'effet").toISOString() : undefined,
      applyToEmployee: b.applyToEmployee === false ? false : true,
      notifyEmployee: b.notifyEmployee === false ? false : true,
    };
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertHR(ctx);

    const p = await this.prisma.promotionProposal.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { employee: { select: { id: true, position: true, email: true, firstName: true, lastName: true } } },
    });
    if (!p) throw new NotFoundException('Proposition introuvable');
    if (p.status !== 'PENDING') throw new BadRequestException('Cette proposition a déjà été traitée');

    // Un RH ne valide pas sa propre proposition pour lui-même (cas d'un RH évalué par un autre RH)
    if (this.access.isSelf(ctx, p.employeeId))
      throw new ForbiddenException('Vous ne pouvez pas statuer sur une proposition qui vous concerne');

    const now = new Date();
    const comment = dto.comment?.trim() || null;

    if (dto.decision === 'REJECTED') {
      // 🔒 Transition atomique : une seule décision possible, même en cas de requêtes simultanées
      const flip = await this.prisma.promotionProposal.updateMany({
        where: { id, companyId: ctx.companyId, status: 'PENDING' },
        data: { status: 'REJECTED', decidedById: ctx.userId, decidedAt: now, decisionComment: comment },
      });
      if (flip.count !== 1) throw new BadRequestException('Cette proposition a déjà été traitée');
      await this.notify(p.proposedById, '📈 Proposition refusée',
        `Votre proposition pour ${p.employee.firstName} ${p.employee.lastName} n'a pas été retenue${comment ? ` : ${comment}` : '.'}`,
        '/performance/carriere');
      return { success: true, applied: false };
    }

    const effective = dto.effectiveDate ? new Date(dto.effectiveDate) : now;
    if (isNaN(effective.getTime())) throw new BadRequestException("Date d'effet invalide");

    // Mise à jour automatique du poste seulement s'il n'a pas changé depuis la proposition
    const wantsApply = p.type === 'POSITION_CHANGE' && dto.applyToEmployee !== false;
    const unchanged = norm(p.employee.position) === norm(p.currentValue);
    const apply = wantsApply && unchanged;

    const eventType =
      p.type === 'POSITION_CHANGE' ? 'PROMOTION' : p.type === 'ECHELON_MERIT' ? 'ECHELON_CHANGE' : 'OTHER';
    const title =
      p.type === 'POSITION_CHANGE' ? `Promotion : ${p.targetValue}`
      : p.type === 'ECHELON_MERIT' ? `Avancement au mérite : ${p.targetValue}`
      : p.targetValue;

    await this.prisma.$transaction(async (tx: any) => {
      // 🔒 Transition atomique PENDING → APPROVED : pas de double événement de carrière
      const flip = await tx.promotionProposal.updateMany({
        where: { id, companyId: ctx.companyId, status: 'PENDING' },
        data: {
          status: 'APPROVED', decidedById: ctx.userId, decidedAt: now,
          decisionComment: comment, effectiveDate: effective, appliedToEmployee: apply,
        },
      });
      if (flip.count !== 1) throw new BadRequestException('Cette proposition a déjà été traitée');
      await tx.careerEvent.create({
        data: {
          companyId: ctx.companyId, employeeId: p.employeeId, type: eventType,
          effectiveDate: effective, title: title.slice(0, 160),
          fromValue: p.currentValue, toValue: p.targetValue,
          notes: comment, source: 'PROPOSAL', proposalId: p.id, createdById: ctx.userId,
        },
      });
      if (apply)
        await tx.employee.updateMany({
          where: { id: p.employeeId, companyId: ctx.companyId },
          data: { position: p.targetValue },
        });
    });

    await this.notify(p.proposedById, '📈 Proposition acceptée',
      `Votre proposition pour ${p.employee.firstName} ${p.employee.lastName} a été validée.`,
      '/performance/carriere');
    if (dto.notifyEmployee !== false) {
      const u = await this.prisma.user.findFirst({
        where: { companyId: ctx.companyId, OR: [{ employeeId: p.employeeId }, { email: p.employee.email }] },
        select: { id: true },
      });
      if (u)
        await this.notify(u.id, '🎉 Évolution de carrière', `${title}. Retrouvez-la dans votre parcours.`,
          '/performance/mon-espace');
    }
    return { success: true, applied: apply, positionChangedSince: wantsApply && !unchanged };
  }

  async cancelProposal(id: string, userId: string, companyId?: string) {
    const ctx = await this.access.getCtx(userId, companyId);
    this.access.assertCanManage(ctx);
    const p = await this.prisma.promotionProposal.findFirst({
      where: { id, companyId: ctx.companyId },
      select: { id: true, status: true, proposedById: true },
    });
    if (!p) throw new NotFoundException('Proposition introuvable');
    if (!ctx.isHR && p.proposedById !== ctx.userId) throw new ForbiddenException('Accès refusé');
    if (p.status !== 'PENDING') throw new BadRequestException('Cette proposition a déjà été traitée');
    const flip = await this.prisma.promotionProposal.updateMany({
      where: { id, companyId: ctx.companyId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (flip.count !== 1) throw new BadRequestException('Cette proposition a déjà été traitée');
    return { success: true };
  }

  private async notify(userId: string, title: string, message: string, link?: string) {
    try {
      await this.prisma.notification.create({
        data: { userId, type: 'SYSTEM_ALERT' as any, title, message, link },
      });
    } catch (e) {
      this.logger.warn('Notification échouée', e as any);
    }
  }
}