// src/recruitment/recruitment-requisitions.service.ts
// ============================================================================
// DEMANDES DE RECRUTEMENT — le besoin, AVANT l'offre
//   Manager : exprime le besoin (seul le titre est obligatoire)
//   RH / Direction : valide ou refuse, puis crée l'offre à partir du besoin
//   Quand la RH crée elle-même un besoin, il est validé d'office.
// Le lien offre ↔ demande permet de suivre « postes à pourvoir / pourvus ».
// ============================================================================
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';

const HR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ['REPLACEMENT', 'NEW_POSITION', 'REINFORCEMENT', 'SEASONAL'];
const PRIORITIES = ['NORMAL', 'URGENT'];
const CONTRACTS = ['CDI', 'CDD', 'STAGE', 'CONSULTANT', 'INTERIM', 'PRESTATAIRE'];
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED'];

const asUuid = (v: unknown, label: string): string => {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new BadRequestException(`${label} invalide.`);
  return v;
};
const asText = (v: unknown, max: number, label: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new BadRequestException(`${label} invalide.`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw new BadRequestException(`${label} trop long (max ${max} caractères).`);
  return t;
};
const asMoney = (v: unknown, label: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new BadRequestException(`${label} invalide.`);
  return n;
};

@Injectable()
export class RecruitmentRequisitionsService {
  private readonly logger = new Logger(RecruitmentRequisitionsService.name);

  constructor(private prisma: PrismaService) {}

  private async actor(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, firstName: true, lastName: true, role: true, companyId: true,
        manageMultipleCompanies: true, employeeId: true,
      },
    });
    if (!u) throw new ForbiddenException('Utilisateur introuvable.');
    const companyId = await resolveVerifiedCompanyId(this.prisma, u, undefined);
    if (!companyId) throw new ForbiddenException('Utilisateur non rattaché à une entreprise.');
    return {
      id: u.id,
      name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Utilisateur',
      role: u.role,
      companyId,
      employeeId: u.employeeId ?? null,
      isHr: HR_ROLES.includes(u.role),
    };
  }

  private async notify(userIds: string[], title: string, message: string, requisitionId: string) {
    if (!userIds.length) return;
    try {
      await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          userId,
          type: 'SYSTEM_ALERT' as any,
          title,
          message,
          link: '/recrutement/demandes',
          metadata: { requisitionId },
        })),
      });
    } catch (e) {
      this.logger.warn(`Notification demande échouée: ${(e as Error).message}`);
    }
  }

  private async hydrate(rows: any[], companyId: string) {
    const deptIds = [...new Set(rows.map((r) => r.departmentId).filter(Boolean))] as string[];
    const jobIds = [...new Set(rows.map((r) => r.jobOfferId).filter(Boolean))] as string[];
    const [depts, jobs, hiredGroups] = await Promise.all([
      deptIds.length
        ? this.prisma.department.findMany({ where: { id: { in: deptIds }, companyId }, select: { id: true, name: true } })
        : Promise.resolve([] as any[]),
      jobIds.length
        ? this.prisma.jobOffer.findMany({
            where: { id: { in: jobIds }, companyId },
            select: { id: true, title: true, status: true, _count: { select: { candidates: true } } },
          })
        : Promise.resolve([] as any[]),
      jobIds.length
        ? this.prisma.candidate.groupBy({
            by: ['jobOfferId'],
            where: { jobOfferId: { in: jobIds }, status: 'HIRED' },
            _count: { _all: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const dMap = new Map((depts as any[]).map((d) => [d.id, d.name]));
    const jMap = new Map((jobs as any[]).map((j) => [j.id, j]));
    const hMap = new Map((hiredGroups as any[]).map((g) => [g.jobOfferId, g._count._all as number]));
    return rows.map((r) => {
      const job: any = r.jobOfferId ? jMap.get(r.jobOfferId) : null;
      return {
        ...r,
        departmentName: r.departmentId ? dMap.get(r.departmentId) ?? null : null,
        job: job
          ? { id: job.id, title: job.title, status: job.status, candidates: job._count.candidates, hired: hMap.get(job.id) ?? 0 }
          : null,
      };
    });
  }

  // ── Créer ───────────────────────────────────────────────────────────────────
  async create(body: any, userId: string) {
    const a = await this.actor(userId);
    const b = body ?? {};
    const title = asText(b.title, 255, 'Intitulé');
    if (!title) throw new BadRequestException("L'intitulé du poste est obligatoire.");

    let departmentId: string | null = null;
    if (b.departmentId) {
      departmentId = asUuid(b.departmentId, 'Département');
      const d = await this.prisma.department.findFirst({ where: { id: departmentId, companyId: a.companyId }, select: { id: true } });
      if (!d) throw new BadRequestException('Département non autorisé.');
    }
    const headcount = b.headcount === undefined || b.headcount === '' ? 1 : Number(b.headcount);
    if (!Number.isInteger(headcount) || headcount < 1 || headcount > 100)
      throw new BadRequestException('Nombre de postes invalide (1 à 100).');
    const reason = REASONS.includes(b.reason) ? b.reason : 'NEW_POSITION';
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'NORMAL';
    const contractType = CONTRACTS.includes(b.contractType) ? b.contractType : null;
    const salaryMin = asMoney(b.salaryMin, 'Salaire minimum');
    const salaryMax = asMoney(b.salaryMax, 'Salaire maximum');
    if (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin)
      throw new BadRequestException('Le salaire maximum doit être supérieur au minimum.');
    let desiredStartDate: Date | null = null;
    if (b.desiredStartDate) {
      desiredStartDate = new Date(b.desiredStartDate);
      if (Number.isNaN(desiredStartDate.getTime())) throw new BadRequestException('Date souhaitée invalide.');
    }

    // La RH qui crée son propre besoin n'a pas à se l'auto-valider : validé d'office
    const autoApprove = a.isHr;
    const created = await this.prisma.jobRequisition.create({
      data: {
        companyId: a.companyId,
        departmentId,
        title,
        headcount,
        contractType: contractType as any,
        reason,
        priority,
        justification: asText(b.justification, 3000, 'Justification'),
        salaryMin,
        salaryMax,
        desiredStartDate,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        requestedById: a.id,
        requestedByName: a.name,
        ...(autoApprove ? { reviewedById: a.id, reviewedByName: a.name, reviewedAt: new Date(), reviewNote: 'Besoin créé par la RH' } : {}),
      } as any,
    });

    if (!autoApprove) {
      const hr = await this.prisma.user.findMany({
        where: { companyId: a.companyId, role: { in: HR_ROLES as any[] } },
        select: { id: true },
        take: 50,
      });
      await this.notify(
        hr.map((u: any) => u.id),
        'Nouvelle demande de recrutement',
        `${a.name} demande : ${title}${headcount > 1 ? ` (${headcount} postes)` : ''}${priority === 'URGENT' ? ' — URGENT' : ''}.`,
        created.id,
      );
    }
    return (await this.hydrate([created], a.companyId))[0];
  }

  // ── Lister (RH : toutes ; manager : les siennes) ────────────────────────────
  async list(userId: string, status?: string) {
    const a = await this.actor(userId);
    const where: any = { companyId: a.companyId };
    if (!a.isHr) where.requestedById = a.id;
    if (status) {
      if (!STATUSES.includes(status)) throw new BadRequestException('Statut invalide.');
      where.status = status;
    }
    const rows = await this.prisma.jobRequisition.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    });
    return this.hydrate(rows as any[], a.companyId);
  }

  private async load(id: string, a: { companyId: string; id: string; isHr: boolean }) {
    asUuid(id, 'Demande');
    const r = await this.prisma.jobRequisition.findUnique({ where: { id } });
    if (!r || r.companyId !== a.companyId) throw new NotFoundException('Demande introuvable');
    if (!a.isHr && r.requestedById !== a.id) throw new ForbiddenException('Cette demande ne vous appartient pas.');
    return r;
  }

  // ── Modifier (tant qu'elle est en attente) ──────────────────────────────────
  async update(id: string, body: any, userId: string) {
    const a = await this.actor(userId);
    const r = await this.load(id, a);
    if (r.status !== 'PENDING' && !(a.isHr && r.status === 'APPROVED' && !r.jobOfferId))
      throw new BadRequestException('Cette demande ne peut plus être modifiée.');
    const b = body ?? {};
    const data: any = {};
    if ('title' in b) {
      const t = asText(b.title, 255, 'Intitulé');
      if (!t) throw new BadRequestException("L'intitulé est obligatoire.");
      data.title = t;
    }
    if ('justification' in b) data.justification = asText(b.justification, 3000, 'Justification');
    if ('headcount' in b) {
      const h = Number(b.headcount);
      if (!Number.isInteger(h) || h < 1 || h > 100) throw new BadRequestException('Nombre de postes invalide.');
      data.headcount = h;
    }
    if ('priority' in b && PRIORITIES.includes(b.priority)) data.priority = b.priority;
    if ('reason' in b && REASONS.includes(b.reason)) data.reason = b.reason;
    if ('contractType' in b) data.contractType = CONTRACTS.includes(b.contractType) ? b.contractType : null;
    if ('salaryMin' in b) data.salaryMin = asMoney(b.salaryMin, 'Salaire minimum');
    if ('salaryMax' in b) data.salaryMax = asMoney(b.salaryMax, 'Salaire maximum');
    if ('departmentId' in b) {
      if (b.departmentId) {
        const d = await this.prisma.department.findFirst({ where: { id: asUuid(b.departmentId, 'Département'), companyId: a.companyId }, select: { id: true } });
        if (!d) throw new BadRequestException('Département non autorisé.');
        data.departmentId = d.id;
      } else data.departmentId = null;
    }
    if ('desiredStartDate' in b) {
      if (b.desiredStartDate) {
        const d = new Date(b.desiredStartDate);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('Date souhaitée invalide.');
        data.desiredStartDate = d;
      } else data.desiredStartDate = null;
    }
    await this.prisma.jobRequisition.update({ where: { id: r.id }, data });
    return (await this.hydrate([await this.prisma.jobRequisition.findUnique({ where: { id: r.id } }) as any], a.companyId))[0];
  }

  // ── Valider / refuser (RH) ──────────────────────────────────────────────────
  async review(id: string, body: any, userId: string) {
    const a = await this.actor(userId);
    if (!a.isHr) throw new ForbiddenException('Seule la RH ou la direction valide les demandes.');
    const r = await this.load(id, a);
    if (r.status !== 'PENDING') throw new BadRequestException('Cette demande a déjà été traitée.');
    const decision = body?.decision;
    if (decision !== 'APPROVED' && decision !== 'REJECTED')
      throw new BadRequestException('Décision invalide.');
    const note = asText(body?.note, 1000, 'Commentaire');
    if (decision === 'REJECTED' && !note)
      throw new BadRequestException('Indiquez la raison du refus : le demandeur la verra.');

    await this.prisma.jobRequisition.update({
      where: { id: r.id },
      data: {
        status: decision,
        reviewedById: a.id,
        reviewedByName: a.name,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });
    await this.notify(
      [r.requestedById],
      decision === 'APPROVED' ? 'Demande de recrutement validée' : 'Demande de recrutement refusée',
      decision === 'APPROVED'
        ? `Votre demande « ${r.title} » est validée. La RH va créer l'offre.`
        : `Votre demande « ${r.title} » est refusée : ${note}`,
      r.id,
    );
    return { ok: true, status: decision };
  }

  // ── Annuler ─────────────────────────────────────────────────────────────────
  async cancel(id: string, userId: string) {
    const a = await this.actor(userId);
    const r = await this.load(id, a);
    if (r.status !== 'PENDING' && r.status !== 'APPROVED')
      throw new BadRequestException('Cette demande ne peut plus être annulée.');
    if (r.jobOfferId) throw new BadRequestException('Une offre est déjà liée à cette demande.');
    await this.prisma.jobRequisition.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }

  // ── Lier à une offre (RH) : fait suivre « postes à pourvoir / pourvus » ─────
  async linkJob(id: string, body: any, userId: string) {
    const a = await this.actor(userId);
    if (!a.isHr) throw new ForbiddenException('Réservé à la RH.');
    const r = await this.load(id, a);
    if (r.status !== 'APPROVED') throw new BadRequestException('Seule une demande validée peut être liée à une offre.');
    const jobId = asUuid(body?.jobOfferId, 'Offre');
    const job = await this.prisma.jobOffer.findUnique({ where: { id: jobId }, select: { id: true, companyId: true } });
    if (!job || job.companyId !== a.companyId) throw new NotFoundException('Offre introuvable');
    const already = await this.prisma.jobRequisition.findFirst({
      where: { jobOfferId: jobId, id: { not: r.id }, status: { in: ['APPROVED', 'FULFILLED'] as any[] } },
      select: { id: true },
    });
    if (already) throw new BadRequestException('Cette offre est déjà liée à une autre demande.');
    await this.prisma.jobRequisition.update({ where: { id: r.id }, data: { jobOfferId: jobId } });
    await this.notify([r.requestedById], 'Votre recrutement est lancé', `Une offre a été créée pour « ${r.title} ».`, r.id);
    return { ok: true };
  }

  async get(id: string, userId: string) {
    const a = await this.actor(userId);
    const r = await this.load(id, a);
    return (await this.hydrate([r as any], a.companyId))[0];
  }
}
