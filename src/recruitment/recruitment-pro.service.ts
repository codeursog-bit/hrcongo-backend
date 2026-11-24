// src/recruitment/recruitment-pro.service.ts
// ============================================================================
// RECRUTEMENT PRO — ce dont un département de recrutement se sert tous les jours
//   • Pipeline (kanban) avec ancienneté par étape, filtres, recherche, vivier
//   • Fiche candidat 360° : chronologie (qui a fait quoi, quand), notes d'équipe
//   • Plusieurs entretiens par candidat + grille d'évaluation + recommandation
//   • E-mails au candidat (modèles modifiables, réponse directe au recruteur)
//   • Offre d'embauche suivie (salaire, date de début, réponse du candidat)
//   • Embauche FIABLE : sans doublon, transactionnelle, onboarding automatique
//   • Tableau de bord : « à faire aujourd'hui », entonnoir, délai d'embauche, sources
// Réservé aux rôles RH (garde au niveau du contrôleur).
// ============================================================================
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import {
  assertCompanyAccess,
  resolveVerifiedCompanyId,
} from '../common/resolve-verified-company.util';
import {
  EMAIL_TEMPLATES,
  REJECTION_CODES,
  renderTemplate,
} from './recruitment-email-templates';

const DAY = 86_400_000;
const TZ = 'Africa/Brazzaville';
const ACTIVE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const MOVABLE_TO = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED'];
const INTERVIEW_KINDS = ['PHONE_SCREEN', 'HR', 'TECHNICAL', 'MANAGER', 'DIRECTION', 'OTHER'];
const INTERVIEW_MODES = ['ONSITE', 'VIDEO', 'PHONE'];
const RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_LABEL: Record<string, string> = {
  PHONE_SCREEN: 'Entretien téléphonique',
  HR: 'Entretien RH',
  TECHNICAL: 'Entretien technique',
  MANAGER: 'Entretien avec le responsable',
  DIRECTION: 'Entretien avec la direction',
  OTHER: 'Entretien',
};
const MODE_LABEL: Record<string, string> = {
  ONSITE: 'En présentiel',
  VIDEO: 'En visioconférence',
  PHONE: 'Par téléphone',
};
const STATUS_LABEL: Record<string, string> = {
  APPLIED: 'À traiter',
  EN_ATTENTE_TEST: 'Test en attente',
  EN_ATTENTE_ANALYSE: 'Analyse en attente',
  SCREENING: 'Présélection',
  INTERVIEW: 'Entretien',
  OFFER: 'Offre',
  HIRED: 'Embauché',
  REJECTED: 'Refusé',
  REFUSE: 'Refusé',
  DISQUALIFIED: 'Disqualifié',
};

const DEFAULT_ONBOARDING_TASKS = [
  { title: 'Préparer le contrat de travail', assigneeRole: 'RH' },
  { title: "Configurer l'adresse email", assigneeRole: 'IT' },
  { title: 'Préparer le poste de travail', assigneeRole: 'IT' },
  { title: 'Badge et accès locaux', assigneeRole: 'OFFICE_MGR' },
  { title: "Session d'accueil RH", assigneeRole: 'RH' },
  { title: "Présentation à l'équipe", assigneeRole: 'MANAGER' },
];

// ── Validation ───────────────────────────────────────────────────────────────
const asUuid = (v: unknown, label: string): string => {
  if (typeof v !== 'string' || !UUID_RE.test(v))
    throw new BadRequestException(`${label} invalide.`);
  return v;
};
const asText = (v: unknown, max: number, label = 'Texte'): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new BadRequestException(`${label} invalide.`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max)
    throw new BadRequestException(`${label} trop long (max ${max} caractères).`);
  return t;
};
const asDate = (v: unknown, label: string): Date => {
  if (typeof v !== 'string' || !v) throw new BadRequestException(`${label} requise.`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} invalide.`);
  return d;
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
  });
const fmtTime = (d: Date) =>
  d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtMoney = (n: any, cur = 'XAF') =>
  `${Number(n).toLocaleString('fr-FR')} ${cur === 'XAF' ? 'FCFA' : cur}`;
const daysSince = (d: Date | null | undefined, now = Date.now()) =>
  d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / DAY)) : 0;

type Actor = { id: string; name: string; email: string | null; companyId: string | null };

@Injectable()
export class RecruitmentProService {
  private readonly logger = new Logger(RecruitmentProService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════
  private async getActor(userId: string): Promise<Actor & { role: string; manageMultipleCompanies: boolean | null }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        companyId: true, role: true, manageMultipleCompanies: true,
      },
    });
    if (!u) throw new ForbiddenException('Utilisateur introuvable.');
    return {
      id: u.id,
      name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Recruteur',
      email: u.email ?? null,
      companyId: u.companyId ?? null,
      role: u.role,
      manageMultipleCompanies: u.manageMultipleCompanies ?? null,
    };
  }

  private async companyIdOf(userId: string, requested?: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, manageMultipleCompanies: true },
    });
    if (!u) throw new ForbiddenException('Accès refusé');
    return resolveVerifiedCompanyId(this.prisma, u, requested);
  }

  private async loadCandidate(candidateId: string, userId: string) {
    asUuid(candidateId, 'Candidat');
    const c = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        jobOffer: {
          select: {
            id: true, title: true, companyId: true, departmentId: true, type: true,
            salaryMin: true, salaryMax: true, salaryCurrency: true, location: true,
            processingMode: true, department: { select: { name: true } },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Candidat introuvable');
    await assertCompanyAccess(this.prisma, userId, c.jobOffer.companyId);
    return c;
  }

  private async companyName(companyId: string): Promise<string> {
    const c = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { tradeName: true, legalName: true },
    });
    return c?.tradeName || c?.legalName || 'Notre entreprise';
  }

  private async log(
    candidateId: string,
    actor: Actor | null,
    type: string,
    data: { title?: string | null; body?: string | null; fromStatus?: string | null; toStatus?: string | null; metadata?: any },
    tx?: any,
  ) {
    const db = tx ?? this.prisma;
    await db.candidateActivity.create({
      data: {
        candidateId,
        type: type as any,
        title: data.title ?? null,
        body: data.body ?? null,
        fromStatus: data.fromStatus ?? null,
        toStatus: data.toStatus ?? null,
        metadata: data.metadata ?? undefined,
        authorId: actor?.id ?? null,
        authorName: actor?.name ?? 'Système',
      },
    });
  }

  /** Variables des modèles d'e-mail pour un candidat. */
  private async buildVars(candidate: any, actor: Actor): Promise<Record<string, string>> {
    const [company, nextInterview] = await Promise.all([
      this.companyName(candidate.jobOffer.companyId),
      this.prisma.candidateInterview.findFirst({
        where: { candidateId: candidate.id, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: 'asc' },
      }),
    ]);
    const cur = candidate.jobOffer.salaryCurrency || 'XAF';
    return {
      prenom: candidate.firstName,
      nom: candidate.lastName,
      poste: candidate.jobOffer.title,
      entreprise: company,
      recruteur: actor.name,
      date_entretien: nextInterview ? fmtDate(nextInterview.scheduledAt) : '',
      heure_entretien: nextInterview ? fmtTime(nextInterview.scheduledAt) : '',
      lieu: nextInterview ? nextInterview.meetingUrl || nextInterview.location || '' : '',
      salaire: candidate.offerSalary != null ? fmtMoney(candidate.offerSalary, cur) : '',
      date_debut: candidate.offerStartDate ? fmtDate(candidate.offerStartDate) : '',
    };
  }

  private async sendToCandidate(
    candidate: any,
    actor: Actor,
    subject: string,
    body: string,
  ): Promise<boolean> {
    const companyName = await this.companyName(candidate.jobOffer.companyId);
    try {
      return await this.mail.sendRecruitmentMessage({
        to: candidate.email,
        subject,
        body,
        companyName,
        replyTo: actor.email,
      });
    } catch (e) {
      this.logger.warn(`Email candidat échoué: ${(e as Error).message}`);
      return false;
    }
  }

  /** Modèle d'e-mail : version personnalisée de l'entreprise si elle existe, sinon le modèle par défaut. */
  private async resolveTemplate(companyId: string, templateId: string) {
    const base = EMAIL_TEMPLATES.find((t) => t.id === templateId);
    if (!base) throw new NotFoundException('Modèle introuvable');
    const custom = await this.prisma.recruitmentEmailTemplate.findUnique({
      where: { companyId_templateId: { companyId, templateId } },
    });
    return custom
      ? { ...base, subject: custom.subject, body: custom.body, customized: true }
      : { ...base, customized: false };
  }

  private toCard(c: any, now: number) {
    const stageSince = c.stageChangedAt ?? c.updatedAt ?? c.createdAt;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      status: c.status,
      jobOfferId: c.jobOfferId,
      jobTitle: c.jobOffer?.title ?? '',
      createdAt: c.createdAt,
      daysInStage: daysSince(stageSince, now),
      daysSinceApplied: daysSince(c.createdAt, now),
      totalScore: c.totalScore ?? 0,
      cvScore: c.cvScore ?? 0,
      testScore: c.testScore ?? 0,
      aiSuggestion: c.aiSuggestion,
      hrDecision: c.hrDecision,
      rating: c.rating,
      source: c.source,
      talentPool: c.talentPool,
      autoDisqualified: c.autoDisqualified,
      suspiciousActivity: c.suspiciousActivity,
      offerSentAt: c.offerSentAt,
      offerAcceptedAt: c.offerAcceptedAt,
      offerDeclinedAt: c.offerDeclinedAt,
      hiredEmployeeId: c.hiredEmployeeId,
      processingMode: c.jobOffer?.processingMode ?? null,
      nextInterviewAt: c.interviews?.[0]?.scheduledAt ?? null,
      nextInterviewKind: c.interviews?.[0]?.kind ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. PIPELINE (kanban)
  // ══════════════════════════════════════════════════════════════════════════
  async pipeline(
    userId: string,
    query: { jobId?: string; q?: string; source?: string; talentPool?: string },
  ) {
    const companyId = await this.companyIdOf(userId);
    if (!companyId) return { candidates: [], jobs: [], sources: [] };

    const where: any = { jobOffer: { companyId } };
    if (query.jobId) where.jobOfferId = asUuid(query.jobId, 'Offre');
    if (query.source) where.source = String(query.source).slice(0, 60);
    if (query.talentPool === 'true') where.talentPool = true;
    const q = (query.q ?? '').trim().slice(0, 80);
    if (q) {
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, jobs, sourceRows] = await Promise.all([
      this.prisma.candidate.findMany({
        where,
        include: {
          jobOffer: { select: { title: true, processingMode: true } },
          interviews: {
            where: { status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
            orderBy: { scheduledAt: 'asc' },
            take: 1,
            select: { scheduledAt: true, kind: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 600,
      }),
      this.prisma.jobOffer.findMany({
        where: { companyId },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.candidate.findMany({
        where: { jobOffer: { companyId }, source: { not: null } },
        select: { source: true },
        distinct: ['source'],
        take: 50,
      }),
    ]);

    const now = Date.now();
    return {
      candidates: rows.map((c: any) => this.toCard(c, now)),
      jobs,
      sources: sourceRows.map((s: any) => s.source).filter(Boolean),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DÉPLACER UN CANDIDAT D'ÉTAPE
  // ══════════════════════════════════════════════════════════════════════════
  async move(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    const to = String(body?.status ?? '');
    if (!MOVABLE_TO.includes(to))
      throw new BadRequestException(
        to === 'HIRED'
          ? 'Pour embaucher, utilisez le bouton « Embaucher » (création de la fiche employé).'
          : 'Étape invalide.',
      );
    if (c.status === 'HIRED' || c.hiredEmployeeId)
      throw new BadRequestException('Ce candidat est déjà embauché.');
    if (c.status === to) return this.toCard({ ...c, jobOffer: c.jobOffer }, Date.now());

    let rejectionReason: string | null = null;
    if (to === 'REJECTED') {
      rejectionReason = String(body?.rejectionReason ?? '');
      if (!REJECTION_CODES.includes(rejectionReason))
        throw new BadRequestException('Indiquez le motif du refus.');
    }
    const note = asText(body?.note, 2000, 'Note');
    const from = c.status;

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const u = await tx.candidate.update({
        where: { id: c.id },
        data: {
          status: to as any,
          stageChangedAt: new Date(),
          rejectionReason: to === 'REJECTED' ? rejectionReason : null,
        },
        include: { jobOffer: { select: { title: true, processingMode: true } } },
      });
      await this.log(c.id, actor, 'STATUS_CHANGE', {
        title: `${STATUS_LABEL[from] ?? from} → ${STATUS_LABEL[to] ?? to}`,
        body: note,
        fromStatus: from,
        toStatus: to,
        metadata: rejectionReason ? { rejectionReason } : undefined,
      }, tx);
      return u;
    });

    // E-mail de refus courtois (optionnel, modifiable côté « Écrire »)
    let emailSent: boolean | null = null;
    if (to === 'REJECTED' && body?.sendEmail === true) {
      const hadInterview = (await this.prisma.candidateInterview.count({
        where: { candidateId: c.id, status: 'DONE' },
      })) > 0;
      const tpl = await this.resolveTemplate(c.jobOffer.companyId, hadInterview ? 'REJECT_INTERVIEW' : 'REJECT_SCREENING');
      const vars = await this.buildVars(c, actor);
      const subject = renderTemplate(tpl.subject, vars);
      const text = renderTemplate(tpl.body, vars);
      emailSent = await this.sendToCandidate(c, actor, subject, text);
      await this.log(c.id, actor, 'EMAIL', {
        title: `E-mail envoyé : ${subject}`, body: text, metadata: { sent: emailSent, template: tpl.id },
      });
    }

    return { ...this.toCard(updated, Date.now()), emailSent };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. FICHE 360°
  // ══════════════════════════════════════════════════════════════════════════
  async fiche(candidateId: string, userId: string) {
    const c = await this.loadCandidate(candidateId, userId);
    const [activities, interviews, others] = await Promise.all([
      this.prisma.candidateActivity.findMany({
        where: { candidateId: c.id },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.prisma.candidateInterview.findMany({
        where: { candidateId: c.id },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.candidate.findMany({
        where: {
          id: { not: c.id },
          email: { equals: c.email, mode: 'insensitive' },
          jobOffer: { companyId: c.jobOffer.companyId },
        },
        select: { id: true, status: true, createdAt: true, jobOffer: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    const { jobOffer, ...candidate } = c as any;
    return {
      candidate,
      job: {
        ...jobOffer,
        departmentName: jobOffer.department?.name ?? null,
      },
      daysInStage: daysSince(c.stageChangedAt ?? c.updatedAt ?? c.createdAt),
      activities,
      interviews,
      otherApplications: others.map((o: any) => ({
        id: o.id, status: o.status, createdAt: o.createdAt, jobTitle: o.jobOffer.title,
      })),
    };
  }

  async addNote(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    const text = asText(body?.text, 4000, 'Note');
    if (!text) throw new BadRequestException('La note est vide.');
    await this.log(c.id, actor, 'NOTE', { title: 'Note interne', body: text });
    return { ok: true };
  }

  async updateProfile(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    const data: any = {};
    if ('source' in (body ?? {})) data.source = asText(body.source, 60, 'Source');
    if ('rating' in (body ?? {})) {
      const r = body.rating === null ? null : Number(body.rating);
      if (r !== null && (!Number.isInteger(r) || r < 1 || r > 5))
        throw new BadRequestException('Note de 1 à 5.');
      data.rating = r;
    }
    if ('talentPool' in (body ?? {})) data.talentPool = body.talentPool === true;
    if (!Object.keys(data).length) return { ok: true };
    await this.prisma.candidate.update({ where: { id: c.id }, data });
    if ('talentPool' in data && data.talentPool !== c.talentPool) {
      await this.log(c.id, actor, 'SYSTEM', {
        title: data.talentPool ? 'Ajouté au vivier de talents' : 'Retiré du vivier de talents',
      });
    }
    return { ok: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. ENTRETIENS
  // ══════════════════════════════════════════════════════════════════════════
  private async syncNextInterview(candidateId: string) {
    const next = await this.prisma.candidateInterview.findFirst({
      where: { candidateId, status: 'SCHEDULED' },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    });
    await this.prisma.candidate.update({
      where: { id: candidateId },
      data: { interviewDate: next?.scheduledAt ?? null },
    });
  }

  private invitationBody(vars: Record<string, string>, itv: any): { subject: string; text: string } {
    const lines = [
      `Bonjour ${vars.prenom},`,
      '',
      `Nous avons le plaisir de vous inviter à un entretien (${(KIND_LABEL[itv.kind] ?? 'Entretien').toLowerCase()}) pour le poste de ${vars.poste} chez ${vars.entreprise}.`,
      '',
      `Date : ${fmtDate(itv.scheduledAt)}`,
      `Heure : ${fmtTime(itv.scheduledAt)} (durée prévue : ${itv.durationMin} min)`,
      `Format : ${MODE_LABEL[itv.mode] ?? ''}`,
    ];
    if (itv.location) lines.push(`Lieu : ${itv.location}`);
    if (itv.meetingUrl) lines.push(`Lien de connexion : ${itv.meetingUrl}`);
    if (itv.interviewers) lines.push(`Vous rencontrerez : ${itv.interviewers}`);
    lines.push(
      '',
      'Merci de confirmer votre présence en répondant directement à cet e-mail. En cas d’empêchement, prévenez-nous au plus tôt.',
      '',
      'Cordialement,',
      vars.recruteur,
      vars.entreprise,
    );
    return { subject: `Invitation à un entretien — ${vars.poste}`, text: lines.join('\n') };
  }

  async scheduleInterview(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    if (['HIRED', 'REJECTED', 'REFUSE', 'DISQUALIFIED'].includes(c.status))
      throw new BadRequestException('Ce dossier est clôturé : impossible de planifier un entretien.');
    const b = body ?? {};

    const kind = INTERVIEW_KINDS.includes(b.kind) ? b.kind : 'HR';
    const mode = INTERVIEW_MODES.includes(b.mode) ? b.mode : 'ONSITE';
    const scheduledAt = asDate(b.scheduledAt, 'Date et heure');
    const durationMin = Number(b.durationMin ?? 45);
    if (!Number.isInteger(durationMin) || durationMin < 10 || durationMin > 480)
      throw new BadRequestException('Durée invalide (10 à 480 minutes).');
    const location = asText(b.location, 255, 'Lieu');
    const meetingUrl = asText(b.meetingUrl, 500, 'Lien');
    const interviewers = asText(b.interviewers, 255, 'Intervieweurs');

    const end = new Date(scheduledAt.getTime() + durationMin * 60_000);
    const nearby = await this.prisma.candidateInterview.findMany({
      where: {
        status: 'SCHEDULED',
        candidate: { jobOffer: { companyId: c.jobOffer.companyId } },
        scheduledAt: { lt: end, gte: new Date(scheduledAt.getTime() - 8 * 3_600_000) },
      },
      include: { candidate: { select: { firstName: true, lastName: true } } },
      take: 30,
    });
    const overlapping = nearby.filter(
      (o: any) => o.scheduledAt.getTime() + o.durationMin * 60_000 > scheduledAt.getTime(),
    );
    if (overlapping.some((o: any) => o.candidateId === c.id))
      throw new BadRequestException('Ce candidat a déjà un entretien qui chevauche ce créneau.');
    const warnings: string[] = [];
    if (interviewers) {
      const key = interviewers.toLowerCase();
      for (const o of overlapping as any[]) {
        if (o.interviewers && o.interviewers.toLowerCase() === key)
          warnings.push(
            `Les mêmes intervieweurs ont déjà un entretien avec ${o.candidate.firstName} ${o.candidate.lastName} à ${fmtTime(o.scheduledAt)}.`,
          );
      }
    }

    const round =
      (await this.prisma.candidateInterview.count({
        where: { candidateId: c.id, status: { not: 'CANCELLED' } },
      })) + 1;

    const itv = await this.prisma.candidateInterview.create({
      data: {
        candidateId: c.id, round, kind, mode, scheduledAt, durationMin,
        location, meetingUrl, interviewers, createdById: actor.id,
      },
    });

    const moveToInterview = ['APPLIED', 'SCREENING', 'EN_ATTENTE_TEST', 'EN_ATTENTE_ANALYSE'].includes(c.status);
    await this.prisma.candidate.update({
      where: { id: c.id },
      data: {
        ...(moveToInterview ? { status: 'INTERVIEW' as any, stageChangedAt: new Date() } : {}),
        interviewScheduledBy: actor.id,
        interviewScheduledAt: new Date(),
      },
    });
    await this.syncNextInterview(c.id);
    await this.log(c.id, actor, 'INTERVIEW', {
      title: `${KIND_LABEL[kind]} planifié — ${fmtDate(scheduledAt)} à ${fmtTime(scheduledAt)}`,
      body: [MODE_LABEL[mode], location, interviewers && `Avec ${interviewers}`].filter(Boolean).join(' • '),
      metadata: { interviewId: itv.id, round },
    });

    let emailSent: boolean | null = null;
    if (b.sendInvitation !== false) {
      const vars = await this.buildVars(c, actor);
      const inv = this.invitationBody(vars, itv);
      emailSent = await this.sendToCandidate(c, actor, inv.subject, inv.text);
      if (emailSent)
        await this.prisma.candidateInterview.update({
          where: { id: itv.id }, data: { invitationSentAt: new Date() },
        });
      await this.log(c.id, actor, 'EMAIL', {
        title: `Invitation envoyée : ${inv.subject}`, body: inv.text, metadata: { sent: emailSent },
      });
    }
    return { interview: itv, warnings, emailSent };
  }

  async updateInterview(interviewId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    asUuid(interviewId, 'Entretien');
    const itv = await this.prisma.candidateInterview.findUnique({ where: { id: interviewId } });
    if (!itv) throw new NotFoundException('Entretien introuvable');
    const c = await this.loadCandidate(itv.candidateId, userId);
    const b = body ?? {};
    const data: any = {};

    if (b.status === 'CANCELLED' || b.status === 'NO_SHOW') {
      if (itv.status === 'DONE') throw new BadRequestException('Cet entretien est déjà évalué.');
      data.status = b.status;
    } else if (itv.status !== 'SCHEDULED') {
      throw new BadRequestException('Seul un entretien planifié peut être modifié.');
    } else {
      if ('scheduledAt' in b) data.scheduledAt = asDate(b.scheduledAt, 'Date et heure');
      if ('durationMin' in b) {
        const n = Number(b.durationMin);
        if (!Number.isInteger(n) || n < 10 || n > 480) throw new BadRequestException('Durée invalide.');
        data.durationMin = n;
      }
      if ('location' in b) data.location = asText(b.location, 255, 'Lieu');
      if ('meetingUrl' in b) data.meetingUrl = asText(b.meetingUrl, 500, 'Lien');
      if ('interviewers' in b) data.interviewers = asText(b.interviewers, 255, 'Intervieweurs');
      if (INTERVIEW_KINDS.includes(b.kind)) data.kind = b.kind;
      if (INTERVIEW_MODES.includes(b.mode)) data.mode = b.mode;
    }
    if (!Object.keys(data).length) return itv;
    // Entretien reporté : le rappel automatique doit repartir pour la nouvelle date
    if (data.scheduledAt && data.scheduledAt.getTime() !== itv.scheduledAt.getTime()) data.reminderSentAt = null;

    const updated = await this.prisma.candidateInterview.update({ where: { id: itv.id }, data });
    await this.syncNextInterview(c.id);

    const rescheduled = !!data.scheduledAt && data.scheduledAt.getTime() !== itv.scheduledAt.getTime();
    await this.log(c.id, actor, 'INTERVIEW', {
      title: data.status === 'CANCELLED'
        ? `${KIND_LABEL[itv.kind]} annulé`
        : data.status === 'NO_SHOW'
          ? 'Candidat absent à l’entretien'
          : rescheduled
            ? `${KIND_LABEL[itv.kind]} reporté — ${fmtDate(updated.scheduledAt)} à ${fmtTime(updated.scheduledAt)}`
            : `${KIND_LABEL[itv.kind]} modifié`,
      metadata: { interviewId: itv.id },
    });

    let emailSent: boolean | null = null;
    if (b.notify === true && !data.status) {
      const vars = await this.buildVars(c, actor);
      const inv = this.invitationBody(vars, updated);
      emailSent = await this.sendToCandidate(
        c, actor, `Mise à jour de votre entretien — ${vars.poste}`,
        `${inv.text.split('\n').slice(0, 2).join('\n')}\nLes informations de votre entretien ont changé :\n${inv.text.split('\n').slice(4).join('\n')}`,
      );
      await this.log(c.id, actor, 'EMAIL', { title: 'Mise à jour d’entretien envoyée', metadata: { sent: emailSent } });
    }
    return { interview: updated, emailSent };
  }

  async submitFeedback(interviewId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    asUuid(interviewId, 'Entretien');
    const itv = await this.prisma.candidateInterview.findUnique({ where: { id: interviewId } });
    if (!itv) throw new NotFoundException('Entretien introuvable');
    const c = await this.loadCandidate(itv.candidateId, userId);
    if (itv.status === 'CANCELLED' || itv.status === 'NO_SHOW')
      throw new BadRequestException('Cet entretien n’a pas eu lieu.');
    const b = body ?? {};

    const rawCriteria = Array.isArray(b.criteria) ? b.criteria : [];
    if (rawCriteria.length < 1 || rawCriteria.length > 12)
      throw new BadRequestException('La grille doit contenir de 1 à 12 critères.');
    const criteria = rawCriteria.map((k: any) => {
      const label = asText(k?.label, 80, 'Critère');
      const score = Number(k?.score);
      if (!label) throw new BadRequestException('Chaque critère doit avoir un intitulé.');
      if (!Number.isInteger(score) || score < 1 || score > 5)
        throw new BadRequestException(`Note du critère « ${label} » : de 1 à 5.`);
      return { label, score, comment: asText(k?.comment, 500, 'Commentaire') };
    });
    if (!RECOMMENDATIONS.includes(b.recommendation))
      throw new BadRequestException('Choisissez une recommandation.');
    const overall = Math.round(
      (criteria.reduce((s: number, k: any) => s + k.score, 0) / (criteria.length * 5)) * 100,
    );

    const updated = await this.prisma.candidateInterview.update({
      where: { id: itv.id },
      data: {
        status: 'DONE',
        criteria,
        overallScore: overall,
        recommendation: b.recommendation,
        summary: asText(b.summary, 3000, 'Synthèse'),
        feedbackAt: new Date(),
      },
    });
    await this.syncNextInterview(c.id);
    const RECO: Record<string, string> = {
      STRONG_YES: 'Fortement favorable', YES: 'Favorable', NO: 'Défavorable', STRONG_NO: 'Fortement défavorable',
    };
    await this.log(c.id, actor, 'INTERVIEW', {
      title: `Évaluation — ${KIND_LABEL[itv.kind]} : ${overall}/100 — ${RECO[b.recommendation]}`,
      body: updated.summary,
      metadata: { interviewId: itv.id, overall, recommendation: b.recommendation },
    });
    return updated;
  }

  async agenda(userId: string, from?: string, to?: string) {
    const companyId = await this.companyIdOf(userId);
    if (!companyId) return { interviews: [], pendingFeedback: [] };
    const start = from ? asDate(from, 'Date « du »') : new Date(Date.now() - DAY);
    const end = to ? asDate(to, 'Date « au »') : new Date(Date.now() + 21 * DAY);
    const include = {
      candidate: {
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          jobOffer: { select: { title: true } },
        },
      },
    };
    const [interviews, past] = await Promise.all([
      this.prisma.candidateInterview.findMany({
        where: {
          candidate: { jobOffer: { companyId } },
          scheduledAt: { gte: start, lte: end },
          status: { in: ['SCHEDULED', 'DONE'] },
        },
        include,
        orderBy: { scheduledAt: 'asc' },
        take: 300,
      }),
      this.prisma.candidateInterview.findMany({
        where: { candidate: { jobOffer: { companyId } }, status: 'SCHEDULED', scheduledAt: { lt: new Date() } },
        include,
        orderBy: { scheduledAt: 'desc' },
        take: 50,
      }),
    ]);
    const now = Date.now();
    return {
      interviews,
      pendingFeedback: past.filter((i: any) => i.scheduledAt.getTime() + i.durationMin * 60_000 < now),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. E-MAILS AU CANDIDAT
  // ══════════════════════════════════════════════════════════════════════════
  async listTemplates(userId: string) {
    const companyId = await this.companyIdOf(userId);
    const customs: any[] = companyId
      ? await this.prisma.recruitmentEmailTemplate.findMany({ where: { companyId } })
      : [];
    const byId = new Map(customs.map((c) => [c.templateId, c]));
    return EMAIL_TEMPLATES.map((t) => {
      const c: any = byId.get(t.id);
      return {
        id: t.id,
        label: t.label,
        description: t.description,
        subject: c?.subject ?? t.subject,
        body: c?.body ?? t.body,
        defaultSubject: t.subject,
        defaultBody: t.body,
        customized: !!c,
      };
    });
  }

  async saveTemplate(templateId: string, body: any, userId: string) {
    const companyId = await this.companyIdOf(userId);
    if (!companyId) throw new ForbiddenException('Utilisateur non rattaché à une entreprise.');
    if (!EMAIL_TEMPLATES.some((t) => t.id === templateId)) throw new NotFoundException('Modèle introuvable');
    const subject = asText(body?.subject, 255, 'Objet');
    const text = asText(body?.body, 6000, 'Message');
    if (!subject || !text) throw new BadRequestException("L'objet et le message sont obligatoires.");
    await this.prisma.recruitmentEmailTemplate.upsert({
      where: { companyId_templateId: { companyId, templateId } },
      create: { companyId, templateId, subject, body: text, updatedById: userId },
      update: { subject, body: text, updatedById: userId },
    });
    return { ok: true };
  }

  async resetTemplate(templateId: string, userId: string) {
    const companyId = await this.companyIdOf(userId);
    if (!companyId) throw new ForbiddenException('Utilisateur non rattaché à une entreprise.');
    await this.prisma.recruitmentEmailTemplate.deleteMany({ where: { companyId, templateId } });
    return { ok: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIONS GROUPÉES (ex. refuser 40 candidatures d'un coup, avec e-mail)
  // ══════════════════════════════════════════════════════════════════════════
  async bulkMove(body: any, userId: string) {
    const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids: string[] = Array.from(new Set(rawIds.map((i) => asUuid(i, 'Candidat'))));
    if (!ids.length) throw new BadRequestException('Aucun candidat sélectionné.');
    if (ids.length > 100) throw new BadRequestException('Maximum 100 candidats à la fois.');
    const status = String(body?.status ?? '');
    if (!['APPLIED', 'SCREENING', 'REJECTED'].includes(status))
      throw new BadRequestException('Action groupée non autorisée pour cette étape.');

    const result = { done: 0, emailsSent: 0, failed: [] as Array<{ id: string; message: string }> };
    for (let i = 0; i < ids.length; i += 5) {
      const batch = ids.slice(i, i + 5);
      const settled = await Promise.allSettled(
        batch.map((id) =>
          this.move(id, { status, rejectionReason: body?.rejectionReason, note: body?.note, sendEmail: body?.sendEmail === true }, userId),
        ),
      );
      settled.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          result.done++;
          if ((r.value as any)?.emailSent === true) result.emailsSent++;
        } else {
          result.failed.push({ id: batch[idx], message: (r.reason as Error)?.message ?? 'Échec' });
        }
      });
    }
    return result;
  }

  async previewEmail(candidateId: string, templateId: string, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    const tpl = await this.resolveTemplate(c.jobOffer.companyId, templateId);
    const vars = await this.buildVars(c, actor);
    return { subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars), to: c.email };
  }

  async sendEmail(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    const subject = asText(body?.subject, 200, 'Objet');
    const text = asText(body?.body, 6000, 'Message');
    if (!subject || !text) throw new BadRequestException('L’objet et le message sont obligatoires.');
    const sent = await this.sendToCandidate(c, actor, subject, text);
    await this.log(c.id, actor, 'EMAIL', {
      title: `${sent ? 'E-mail envoyé' : 'E-mail NON envoyé'} : ${subject}`,
      body: text,
      metadata: { sent },
    });
    return { sent };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. OFFRE D'EMBAUCHE
  // ══════════════════════════════════════════════════════════════════════════
  async makeOffer(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    if (['HIRED', 'REJECTED', 'REFUSE', 'DISQUALIFIED'].includes(c.status) || c.hiredEmployeeId)
      throw new BadRequestException('Ce dossier est clôturé : impossible de faire une offre.');
    const b = body ?? {};
    const salary = Number(b.salary);
    if (!Number.isFinite(salary) || salary <= 0 || salary > 1_000_000_000)
      throw new BadRequestException('Salaire proposé invalide.');
    const startDate = b.startDate ? asDate(b.startDate, 'Date de début') : null;
    const note = asText(b.note, 1000, 'Note');
    const from = c.status;

    const updated = await this.prisma.candidate.update({
      where: { id: c.id },
      data: {
        status: 'OFFER' as any,
        stageChangedAt: from === 'OFFER' ? undefined : new Date(),
        offerSalary: salary,
        offerStartDate: startDate,
        offerSentAt: new Date(),
        offerAcceptedAt: null,
        offerDeclinedAt: null,
        rejectionReason: null,
      },
      include: { jobOffer: { select: { title: true, processingMode: true } } },
    });
    await this.log(c.id, actor, 'OFFER', {
      title: `Offre : ${fmtMoney(salary, c.jobOffer.salaryCurrency || 'XAF')} / mois${startDate ? ` — début ${fmtDate(startDate)}` : ''}`,
      body: note,
      fromStatus: from,
      toStatus: 'OFFER',
    });

    let emailSent: boolean | null = null;
    if (b.sendEmail === true) {
      const tpl = await this.resolveTemplate(c.jobOffer.companyId, 'OFFER');
      const vars = await this.buildVars({ ...c, offerSalary: salary, offerStartDate: startDate }, actor);
      const subject = renderTemplate(tpl.subject, vars);
      const text = renderTemplate(tpl.body, vars);
      emailSent = await this.sendToCandidate(c, actor, subject, text);
      await this.log(c.id, actor, 'EMAIL', { title: `E-mail envoyé : ${subject}`, body: text, metadata: { sent: emailSent } });
    }
    return { candidate: this.toCard(updated, Date.now()), emailSent };
  }

  async offerResponse(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    if (!c.offerSentAt) throw new BadRequestException('Aucune offre envoyée à ce candidat.');
    if (c.hiredEmployeeId) throw new BadRequestException('Ce candidat est déjà embauché.');
    const accepted = body?.accepted === true;
    const note = asText(body?.note, 1000, 'Note');

    if (accepted) {
      await this.prisma.candidate.update({
        where: { id: c.id },
        data: { offerAcceptedAt: new Date(), offerDeclinedAt: null },
      });
      await this.log(c.id, actor, 'OFFER', { title: 'Offre acceptée par le candidat', body: note });
    } else {
      await this.prisma.candidate.update({
        where: { id: c.id },
        data: {
          offerDeclinedAt: new Date(), offerAcceptedAt: null,
          status: 'REJECTED' as any, stageChangedAt: new Date(), rejectionReason: 'OFFER_DECLINED',
        },
      });
      await this.log(c.id, actor, 'OFFER', {
        title: 'Offre déclinée par le candidat', body: note, fromStatus: c.status, toStatus: 'REJECTED',
      });
    }
    return { ok: true, accepted };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. EMBAUCHE FIABLE
  // ══════════════════════════════════════════════════════════════════════════
  async hire(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    const b = body ?? {};

    // Idempotent : un double-clic ne crée jamais un 2e employé
    if (c.hiredEmployeeId) {
      const existing = await this.prisma.employee.findUnique({
        where: { id: c.hiredEmployeeId },
        select: { id: true, employeeNumber: true, firstName: true, lastName: true },
      });
      return { alreadyHired: true, employee: existing, missingFields: [], onboardingCreated: false };
    }
    if (['REJECTED', 'REFUSE', 'DISQUALIFIED'].includes(c.status))
      throw new BadRequestException('Ce candidat a été refusé : rouvrez le dossier avant de l’embaucher.');

    const companyId = c.jobOffer.companyId;

    // Département : celui de l'offre, sinon celui choisi à l'embauche
    // (obligatoire pour la fiche employé, mais optionnel sur l'offre)
    const departmentId: string | null = b.departmentId
      ? asUuid(b.departmentId, 'Département')
      : c.jobOffer.departmentId ?? null;
    if (!departmentId)
      throw new BadRequestException(
        "Choisissez le département du nouvel employé (l'offre n'en avait pas).",
      );
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, companyId },
      select: { id: true },
    });
    if (!dept) throw new BadRequestException('Département non autorisé.');

    const dup = await this.prisma.employee.findFirst({
      where: { companyId, email: { equals: c.email, mode: 'insensitive' } },
      select: { firstName: true, lastName: true, employeeNumber: true },
    });
    if (dup)
      throw new BadRequestException(
        `Un employé avec cet e-mail existe déjà : ${dup.firstName} ${dup.lastName} (${dup.employeeNumber}).`,
      );

    const hireDate = b.startDate
      ? asDate(b.startDate, 'Date de début')
      : c.offerStartDate ?? new Date();
    const baseSalary = c.offerSalary ?? c.jobOffer.salaryMin ?? 0;

    // Le téléphone employé est unique : on ne met jamais de valeur factice
    let phone: string | null = c.phone ? c.phone.trim() : null;
    let phoneConflict = false;
    if (phone) {
      const taken = await this.prisma.employee.findFirst({ where: { phone }, select: { id: true } });
      if (taken) { phone = null; phoneConflict = true; }
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      const fresh = await tx.candidate.findUnique({ where: { id: c.id }, select: { hiredEmployeeId: true } });
      if (fresh?.hiredEmployeeId) return { employee: null, raced: true };

      let employeeNumber = '';
      for (let i = 0; i < 6; i++) {
        employeeNumber = `EMP-${Date.now().toString().slice(-6)}${i ? Math.floor(Math.random() * 90 + 10) : ''}`;
        const clash = await tx.employee.findFirst({ where: { employeeNumber, companyId }, select: { id: true } });
        if (!clash) break;
        if (i === 5) throw new BadRequestException('Impossible de générer un matricule, réessayez.');
      }

      const employee = await tx.employee.create({
        data: {
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone,
          departmentId,
          position: c.jobOffer.title,
          contractType: c.jobOffer.type,
          companyId,
          address: 'À compléter',
          city: c.jobOffer.location || 'Brazzaville',
          gender: 'MALE',
          maritalStatus: 'SINGLE',
          dateOfBirth: new Date('2000-01-01'),
          placeOfBirth: 'À compléter',
          hireDate,
          baseSalary,
          employeeNumber,
          createdById: userId,
          photoUrl: `https://ui-avatars.com/api/?background=random&name=${encodeURIComponent(c.firstName)}+${encodeURIComponent(c.lastName)}`,
        },
        select: { id: true, employeeNumber: true, firstName: true, lastName: true },
      });
      const from = c.status;
      await tx.candidate.update({
        where: { id: c.id },
        data: { status: 'HIRED', hiredEmployeeId: employee.id, hiredAt: new Date(), stageChangedAt: new Date() },
      });
      await this.log(c.id, actor, 'HIRE', {
        title: `Embauché — matricule ${employee.employeeNumber}`,
        fromStatus: from, toStatus: 'HIRED',
        metadata: { employeeId: employee.id },
      }, tx);
      return { employee, raced: false };
    });

    if (result.raced) {
      const fresh = await this.prisma.candidate.findUnique({ where: { id: c.id }, select: { hiredEmployeeId: true } });
      return { alreadyHired: true, employee: { id: fresh?.hiredEmployeeId }, missingFields: [], onboardingCreated: false };
    }

    // Onboarding automatique (si le forfait l'inclut) — n'échoue jamais l'embauche
    let onboardingCreated = false;
    if (b.createOnboarding !== false && result.employee) {
      try {
        await this.subscriptionGuard.checkFeatureAccess(companyId, 'hasOnboarding');
        await this.prisma.onboardingProcess.create({
          data: {
            employeeId: result.employee.id,
            type: 'ONBOARDING' as any,
            startDate: hireDate,
            tasks: { create: DEFAULT_ONBOARDING_TASKS },
          },
        });
        onboardingCreated = true;
      } catch (e) {
        this.logger.warn(`Onboarding non créé: ${(e as Error).message}`);
      }
    }

    // Postes pourvus ? (nombre de postes = celui de la demande liée, sinon 1)
    const requisition = await this.prisma.jobRequisition.findFirst({
      where: { jobOfferId: c.jobOfferId },
      select: { id: true, headcount: true, status: true },
    });
    const headcount = requisition?.headcount ?? 1;
    const hiredCount = await this.prisma.candidate.count({
      where: { jobOfferId: c.jobOfferId, status: 'HIRED' },
    });
    const jobNow = await this.prisma.jobOffer.findUnique({
      where: { id: c.jobOfferId },
      select: { status: true },
    });
    if (requisition && hiredCount >= headcount && requisition.status === 'APPROVED') {
      await this.prisma.jobRequisition.update({
        where: { id: requisition.id },
        data: { status: 'FULFILLED' },
      });
    }

    return {
      alreadyHired: false,
      employee: result.employee,
      headcount,
      hiredCount,
      canCloseJob: hiredCount >= headcount && jobNow?.status === 'PUBLISHED',
      onboardingCreated,
      missingFields: ['Date de naissance', 'Lieu de naissance', 'Sexe', 'Adresse', ...(phone ? [] : ['Téléphone'])],
      phoneConflict,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. VIVIER : proposer un candidat pour une autre offre
  // ══════════════════════════════════════════════════════════════════════════
  async reapply(candidateId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    const c = await this.loadCandidate(candidateId, userId);
    const jobId = asUuid(body?.jobOfferId, 'Offre');
    const job = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      select: { id: true, title: true, companyId: true, status: true, processingMode: true },
    });
    if (!job || job.companyId !== c.jobOffer.companyId) throw new NotFoundException('Offre introuvable');
    if (job.id === c.jobOfferId) throw new BadRequestException('Le candidat est déjà sur cette offre.');
    if (job.processingMode === 'AI_ASSISTED')
      throw new BadRequestException(
        'Cette offre est en mode IA (test obligatoire) : le candidat doit postuler via le lien public.',
      );
    const exists = await this.prisma.candidate.findFirst({
      where: { jobOfferId: job.id, email: { equals: c.email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (exists) throw new BadRequestException('Cette personne a déjà postulé à cette offre.');

    const created = await this.prisma.candidate.create({
      data: {
        firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
        resumeUrl: c.resumeUrl, additionalDocUrl: c.additionalDocUrl, coverLetter: c.coverLetter,
        jobOfferId: job.id, status: 'APPLIED' as any, source: 'Vivier de talents',
        stageChangedAt: new Date(), talentPool: true,
      },
    });
    await this.log(created.id, actor, 'SYSTEM', {
      title: `Proposé depuis le vivier (candidature « ${c.jobOffer.title} »)`,
    });
    await this.log(c.id, actor, 'SYSTEM', { title: `Proposé aussi pour « ${job.title} »` });
    return { id: created.id };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. TABLEAU DE BORD
  // ══════════════════════════════════════════════════════════════════════════
  async dashboard(userId: string) {
    const companyId = await this.companyIdOf(userId);
    const empty = {
      kpis: { openJobs: 0, activeCandidates: 0, interviewsThisWeek: 0, avgTimeToHireDays: null, hiredLast180: 0, offerAcceptanceRate: null },
      funnel: [], bySource: [], rejectionReasons: [],
      todo: { interviewsToday: [], interviewsWeek: [], feedbackPending: [], stalled: [], offersAwaiting: [], readyToHire: [], unansweredNew: [], jobsAttention: [] },
      pendingRequisitions: 0,
    };
    if (!companyId) return empty;

    const now = Date.now();
    const offset = 3_600_000; // Brazzaville = UTC+1
    const local = new Date(now + offset);
    local.setUTCHours(0, 0, 0, 0);
    const startToday = new Date(local.getTime() - offset);
    const endToday = new Date(startToday.getTime() + DAY);
    const endWeek = new Date(startToday.getTime() + 7 * DAY);
    const since = new Date(now - 180 * DAY);

    const [jobs, cands, upcoming, pastScheduled, pendingRequisitions] = await Promise.all([
      this.prisma.jobOffer.findMany({
        where: { companyId },
        select: { id: true, title: true, status: true, createdAt: true, expirationDate: true, isExpired: true, _count: { select: { candidates: true } } },
        take: 300,
      }),
      this.prisma.candidate.findMany({
        where: {
          jobOffer: { companyId },
          OR: [{ createdAt: { gte: since } }, { status: { in: ACTIVE_STAGES as any[] } }],
        },
        select: {
          id: true, firstName: true, lastName: true, status: true, createdAt: true, updatedAt: true,
          stageChangedAt: true, source: true, rejectionReason: true, hiredAt: true,
          offerSentAt: true, offerAcceptedAt: true, offerDeclinedAt: true, hiredEmployeeId: true,
          jobOffer: { select: { title: true } },
          _count: { select: { interviews: true } },
        },
        take: 3000,
      }),
      this.prisma.candidateInterview.findMany({
        where: { status: 'SCHEDULED', scheduledAt: { gte: startToday, lt: endWeek }, candidate: { jobOffer: { companyId } } },
        include: { candidate: { select: { id: true, firstName: true, lastName: true, jobOffer: { select: { title: true } } } } },
        orderBy: { scheduledAt: 'asc' },
        take: 100,
      }),
      this.prisma.candidateInterview.findMany({
        where: { status: 'SCHEDULED', scheduledAt: { lt: new Date(now) }, candidate: { jobOffer: { companyId } } },
        include: { candidate: { select: { id: true, firstName: true, lastName: true, jobOffer: { select: { title: true } } } } },
        orderBy: { scheduledAt: 'desc' },
        take: 40,
      }),
      this.prisma.jobRequisition.count({ where: { companyId, status: 'PENDING' } }),
    ]);

    const inPeriod = cands.filter((c: any) => c.createdAt >= since);
    const person = (c: any) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, jobTitle: c.jobOffer?.title ?? '' });

    // KPIs & entonnoir (180 derniers jours)
    const interviewed = inPeriod.filter((c: any) => ['INTERVIEW', 'OFFER', 'HIRED'].includes(c.status) || c._count.interviews > 0).length;
    const offered = inPeriod.filter((c: any) => ['OFFER', 'HIRED'].includes(c.status) || c.offerSentAt).length;
    const hired = inPeriod.filter((c: any) => c.status === 'HIRED').length;
    const hiredRows = cands.filter((c: any) => c.status === 'HIRED');
    const durations = hiredRows
      .map((c: any) => (c.hiredAt ?? c.updatedAt).getTime() - c.createdAt.getTime())
      .filter((n: number) => n >= 0);
    const avgTimeToHireDays = durations.length
      ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length / DAY)
      : null;
    const offersResolved = cands.filter((c: any) => c.offerAcceptedAt || c.offerDeclinedAt);
    const offerAcceptanceRate = offersResolved.length
      ? Math.round((offersResolved.filter((c: any) => c.offerAcceptedAt).length / offersResolved.length) * 100)
      : null;

    // Sources
    const srcMap = new Map<string, { candidates: number; hired: number }>();
    for (const c of inPeriod as any[]) {
      const k = c.source || 'Non renseignée';
      const e = srcMap.get(k) ?? { candidates: 0, hired: 0 };
      e.candidates++;
      if (c.status === 'HIRED') e.hired++;
      srcMap.set(k, e);
    }
    const bySource = [...srcMap.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.candidates - a.candidates);

    // Motifs de refus
    const reasonMap = new Map<string, number>();
    for (const c of inPeriod as any[]) {
      if (c.rejectionReason) reasonMap.set(c.rejectionReason, (reasonMap.get(c.rejectionReason) ?? 0) + 1);
    }
    const rejectionReasons = [...reasonMap.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);

    // À faire
    const stalled = (cands as any[])
      .filter((c) => ['SCREENING', 'INTERVIEW'].includes(c.status))
      .map((c) => ({ ...person(c), status: c.status, days: daysSince(c.stageChangedAt ?? c.updatedAt ?? c.createdAt, now) }))
      .filter((c) => c.days >= 5)
      .sort((a, b) => b.days - a.days)
      .slice(0, 10);
    const unansweredNew = (cands as any[])
      .filter((c) => c.status === 'APPLIED')
      .map((c) => ({ ...person(c), days: daysSince(c.createdAt, now) }))
      .filter((c) => c.days >= 3)
      .sort((a, b) => b.days - a.days)
      .slice(0, 10);
    const offersAwaiting = (cands as any[])
      .filter((c) => c.status === 'OFFER' && c.offerSentAt && !c.offerAcceptedAt && !c.offerDeclinedAt)
      .map((c) => ({ ...person(c), days: daysSince(c.offerSentAt, now) }))
      .sort((a, b) => b.days - a.days);
    const readyToHire = (cands as any[])
      .filter((c) => c.status === 'OFFER' && c.offerAcceptedAt && !c.hiredEmployeeId)
      .map((c) => person(c));

    const mapItv = (i: any) => ({
      id: i.id, scheduledAt: i.scheduledAt, durationMin: i.durationMin, kind: i.kind, mode: i.mode,
      candidateId: i.candidate.id, name: `${i.candidate.firstName} ${i.candidate.lastName}`,
      jobTitle: i.candidate.jobOffer?.title ?? '',
    });
    const interviewsToday = upcoming.filter((i: any) => i.scheduledAt < endToday).map(mapItv);
    const interviewsWeek = upcoming.map(mapItv);
    const feedbackPending = pastScheduled
      .filter((i: any) => i.scheduledAt.getTime() + i.durationMin * 60_000 < now)
      .map(mapItv);

    const jobsAttention: Array<{ id: string; title: string; reason: string }> = [];
    for (const j of jobs as any[]) {
      if (j.status !== 'PUBLISHED') continue;
      if (j._count.candidates === 0 && daysSince(j.createdAt, now) >= 7)
        jobsAttention.push({ id: j.id, title: j.title, reason: 'Aucune candidature depuis plus de 7 jours' });
      if (j.expirationDate && j.expirationDate.getTime() - now < 7 * DAY && j.expirationDate.getTime() > now)
        jobsAttention.push({ id: j.id, title: j.title, reason: `Expire le ${j.expirationDate.toLocaleDateString('fr-FR', { timeZone: TZ })}` });
    }

    return {
      kpis: {
        openJobs: (jobs as any[]).filter((j) => j.status === 'PUBLISHED').length,
        activeCandidates: (cands as any[]).filter((c) => ACTIVE_STAGES.includes(c.status)).length,
        interviewsThisWeek: interviewsWeek.length,
        avgTimeToHireDays,
        hiredLast180: hired,
        offerAcceptanceRate,
      },
      funnel: [
        { stage: 'Candidatures', count: inPeriod.length },
        { stage: 'Entretiens', count: interviewed },
        { stage: 'Offres', count: offered },
        { stage: 'Embauches', count: hired },
      ],
      bySource,
      rejectionReasons,
      todo: { interviewsToday, interviewsWeek, feedbackPending, stalled, offersAwaiting, readyToHire, unansweredNew, jobsAttention },
      pendingRequisitions,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. OFFRES : vue d'ensemble, clôture (+ prévenir les autres), réouverture
  // ══════════════════════════════════════════════════════════════════════════
  async jobsOverview(userId: string) {
    const companyId = await this.companyIdOf(userId);
    if (!companyId) return [];
    const [jobs, grouped, requisitions] = await Promise.all([
      this.prisma.jobOffer.findMany({
        where: { companyId },
        include: { department: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.prisma.candidate.groupBy({
        by: ['jobOfferId', 'status'],
        where: { jobOffer: { companyId } },
        _count: { _all: true },
      }),
      this.prisma.jobRequisition.findMany({
        where: { companyId, jobOfferId: { not: null } },
        select: { id: true, jobOfferId: true, headcount: true },
      }),
    ]);

    const bucket = (st: string) =>
      ['APPLIED', 'EN_ATTENTE_TEST', 'EN_ATTENTE_ANALYSE'].includes(st) ? 'new'
        : st === 'SCREENING' ? 'screening'
        : st === 'INTERVIEW' ? 'interview'
        : st === 'OFFER' ? 'offer'
        : st === 'HIRED' ? 'hired'
        : 'rejected';

    const counts = new Map<string, Record<string, number>>();
    for (const g of grouped as any[]) {
      const e = counts.get(g.jobOfferId) ?? { new: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0, total: 0 };
      const n = g._count._all as number;
      e[bucket(g.status)] += n;
      e.total += n;
      counts.set(g.jobOfferId, e);
    }
    const reqByJob = new Map((requisitions as any[]).map((r) => [r.jobOfferId, r]));
    const now = Date.now();

    return (jobs as any[]).map((j) => {
      const req: any = reqByJob.get(j.id) ?? null;
      const c = counts.get(j.id) ?? { new: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0, total: 0 };
      return {
        id: j.id,
        title: j.title,
        status: j.status,
        processingMode: j.processingMode,
        departmentName: j.department?.name ?? null,
        location: j.location,
        type: j.type,
        showOnPortal: j.showOnPortal,
        createdAt: j.createdAt,
        expirationDate: j.expirationDate,
        isExpired: j.isExpired,
        daysOpen: daysSince(j.publishedAt ?? j.createdAt, now),
        counts: c,
        positions: req?.headcount ?? 1,
        requisitionId: req?.id ?? null,
      };
    });
  }

  async closeJob(jobId: string, body: any, userId: string) {
    const actor = await this.getActor(userId);
    asUuid(jobId, 'Offre');
    const job = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      select: { id: true, companyId: true, status: true },
    });
    if (!job) throw new NotFoundException('Offre introuvable');
    await assertCompanyAccess(this.prisma, userId, job.companyId);
    if (job.status === 'CLOSED') throw new BadRequestException('Cette offre est déjà clôturée.');
    const b = body ?? {};

    const toReject: any[] =
      b.rejectRemaining === true
        ? await this.prisma.candidate.findMany({
            where: { jobOfferId: job.id, status: { in: ['APPLIED', 'SCREENING', 'INTERVIEW'] as any[] } },
            include: { jobOffer: { select: { title: true, companyId: true, salaryCurrency: true } } },
            take: 300,
          })
        : [];

    await this.prisma.$transaction(async (tx: any) => {
      await tx.jobOffer.update({ where: { id: job.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      if (toReject.length) {
        await tx.candidate.updateMany({
          where: { id: { in: toReject.map((c) => c.id) } },
          data: { status: 'REJECTED', stageChangedAt: new Date(), rejectionReason: 'POSITION_FILLED' },
        });
        await tx.candidateActivity.createMany({
          data: toReject.map((c) => ({
            candidateId: c.id,
            type: 'STATUS_CHANGE',
            title: `${STATUS_LABEL[c.status] ?? c.status} → Refusé`,
            body: 'Offre clôturée : poste pourvu',
            fromStatus: c.status,
            toStatus: 'REJECTED',
            metadata: { rejectionReason: 'POSITION_FILLED' },
            authorId: actor.id,
            authorName: actor.name,
          })),
        });
      }
    });

    // Prévenir les candidats restants (par lots, sans jamais faire échouer la clôture)
    let emailsSent = 0;
    if (toReject.length && b.sendEmail === true) {
      const tpl = await this.resolveTemplate(job.companyId, 'POSITION_FILLED');
      for (let i = 0; i < toReject.length; i += 5) {
        const batch = toReject.slice(i, i + 5);
        const results = await Promise.allSettled(
          batch.map(async (c) => {
            const vars = await this.buildVars(c, actor);
            const subject = renderTemplate(tpl.subject, vars);
            const text = renderTemplate(tpl.body, vars);
            const sent = await this.sendToCandidate(c, actor, subject, text);
            await this.log(c.id, actor, 'EMAIL', {
              title: `${sent ? 'E-mail envoyé' : 'E-mail NON envoyé'} : ${subject}`,
              body: text,
              metadata: { sent, template: tpl.id },
            });
            return sent;
          }),
        );
        emailsSent += results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
      }
    }

    // Demande de recrutement liée : pourvue si le nombre de postes est atteint
    const requisition = await this.prisma.jobRequisition.findFirst({
      where: { jobOfferId: job.id },
      select: { id: true, headcount: true, status: true },
    });
    if (requisition && requisition.status === 'APPROVED') {
      const hired = await this.prisma.candidate.count({ where: { jobOfferId: job.id, status: 'HIRED' } });
      if (hired >= requisition.headcount)
        await this.prisma.jobRequisition.update({ where: { id: requisition.id }, data: { status: 'FULFILLED' } });
    }

    return { closed: true, rejected: toReject.length, emailsSent };
  }

  async reopenJob(jobId: string, userId: string) {
    asUuid(jobId, 'Offre');
    const job = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      select: { id: true, companyId: true, status: true },
    });
    if (!job) throw new NotFoundException('Offre introuvable');
    await assertCompanyAccess(this.prisma, userId, job.companyId);
    await this.prisma.jobOffer.update({
      where: { id: job.id },
      data: { status: 'PUBLISHED', closedAt: null },
    });
    return { reopened: true };
  }
}