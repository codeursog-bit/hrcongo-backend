// src/training/training-sessions.service.ts
// ============================================================================
// SESSIONS DE FORMATION
//   Une session = une édition datée d'un cours (dates, horaires, lieu,
//   formateur, capacité). Les participants sont des EmployeeTraining rattachés
//   à la session via `sessionId` → tout le flux existant (demande, validation,
//   mention, certificat, passeport) continue de fonctionner tel quel.
//
//   • Créer / modifier / annuler / supprimer une session           (RH)
//   • Ajouter / retirer des participants (capacité contrôlée)      (RH)
//   • Envoyer les convocations (notification ciblée par employé)   (RH)
//   • Émargement par jour (présent / absent / excusé / retard)     (RH)
//   • Clôturer : les présents passent en « validation en attente »  (RH)
//
// Accès : réservé aux rôles RH (SUPER_ADMIN, ADMIN, HR_MANAGER).
// ============================================================================
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';

const RH_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];

// Inscriptions « vivantes » (même liste que assignCourse dans training.service)
const OPEN_ENROLLMENT: any[] = [
  'REQUESTED',
  'APPROVED',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETION_REQUESTED',
];
const SESSION_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED', 'LATE'];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SESSION_DAYS = 62;
const DEFAULT_MIN_ATTENDANCE_PCT = 80;

// ── Validation / formatage ───────────────────────────────────────────────────
const asUuid = (v: unknown, label: string): string => {
  if (typeof v !== 'string' || !UUID_RE.test(v))
    throw new BadRequestException(`${label} invalide.`);
  return v;
};

const asText = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new BadRequestException('Texte invalide.');
  const t = v.trim();
  if (!t) return null;
  if (t.length > max)
    throw new BadRequestException(`Texte trop long (max ${max} caractères).`);
  return t;
};

const asTime = (v: unknown, label: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
    throw new BadRequestException(`${label} invalide (format HH:MM).`);
  return v;
};

const asDay = (v: unknown, label: string): Date => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v))
    throw new BadRequestException(`${label} invalide (format AAAA-MM-JJ).`);
  const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException(`${label} invalide.`);
  return d;
};

const asCapacity = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 500)
    throw new BadRequestException('Capacité invalide (entier de 1 à 500).');
  return n;
};

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

const frDate = (d: Date): string =>
  d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Liste des jours (AAAA-MM-JJ) de start à end inclus. */
const daysBetween = (start: Date, end: Date): string[] => {
  const out: string[] = [];
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime() && out.length <= MAX_SESSION_DAYS) {
    out.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
};

const fullName = (e: { firstName: string; lastName: string }) =>
  `${e.firstName} ${e.lastName}`;

@Injectable()
export class TrainingSessionsService {
  private readonly logger = new Logger(TrainingSessionsService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getRhUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        companyId: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
        manageMultipleCompanies: true,
      },
    });
    if (!user) throw new ForbiddenException('Utilisateur introuvable');
    const companyId = await resolveVerifiedCompanyId(this.prisma, user, undefined);
    if (!companyId)
      throw new ForbiddenException(
        'Utilisateur non rattaché à une entreprise.',
      );
    if (!RH_ROLES.includes(user.role))
      throw new ForbiddenException(
        'Seuls les RH et administrateurs gèrent les sessions de formation.',
      );
    return { ...user, companyId };
  }

  private async loadSession(sessionId: string, companyId: string) {
    asUuid(sessionId, 'Session');
    const s = await this.prisma.trainingSession.findUnique({
      where: { id: sessionId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            companyId: true,
            durationHours: true,
            format: true,
            category: true,
            location: true,
            providerName: true,
          },
        },
      },
    });
    if (!s || s.course.companyId !== companyId)
      throw new NotFoundException('Session introuvable.');
    return s;
  }

  private mapSession(s: any, participantsCount?: number) {
    return {
      id: s.id,
      courseId: s.courseId,
      course: s.course
        ? {
            id: s.course.id,
            title: s.course.title,
            durationHours: s.course.durationHours ?? null,
            format: s.course.format,
            category: s.course.category ?? null,
          }
        : undefined,
      label: s.label,
      startDate: ymd(s.startDate),
      endDate: ymd(s.endDate),
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location,
      trainerName: s.trainerName,
      capacity: s.capacity,
      status: s.status,
      notes: s.notes,
      convocationSentAt: s.convocationSentAt,
      participantsCount,
      createdAt: s.createdAt,
    };
  }

  /**
   * Notification ciblée (une ligne par utilisateur) — pas de diffusion à toute
   * l'entreprise. Les employés sans compte utilisateur sont renvoyés dans
   * `withoutAccount` pour que la RH les prévienne autrement (feuille imprimée…).
   */
  private async notifyEmployees(
    companyId: string,
    employees: Array<{
      id: string;
      email?: string | null;
      firstName: string;
      lastName: string;
    }>,
    title: string,
    message: string,
    metadata: Record<string, any>,
  ): Promise<{
    sent: number;
    withoutAccount: Array<{ employeeId: string; name: string }>;
  }> {
    if (!employees.length) return { sent: 0, withoutAccount: [] };

    const emails = Array.from(
      new Set(
        employees
          .map((e) => e.email)
          .filter((e): e is string => !!e)
          .flatMap((e) => [e, e.toLowerCase()]),
      ),
    );
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        OR: [
          { employeeId: { in: employees.map((e) => e.id) } },
          ...(emails.length ? [{ email: { in: emails } }] : []),
        ],
      },
      select: { id: true, employeeId: true, email: true },
    });

    const rows: any[] = [];
    const withoutAccount: Array<{ employeeId: string; name: string }> = [];
    for (const e of employees) {
      const u = users.find(
        (x: any) =>
          x.employeeId === e.id ||
          (!!e.email &&
            !!x.email &&
            x.email.toLowerCase() === e.email.toLowerCase()),
      );
      if (u) {
        rows.push({
          userId: u.id,
          type: 'SYSTEM_ALERT' as any,
          title,
          message,
          link: '/formation',
          metadata,
        });
      } else {
        withoutAccount.push({ employeeId: e.id, name: fullName(e) });
      }
    }

    let sent = 0;
    try {
      if (rows.length) {
        await this.prisma.notification.createMany({ data: rows });
        sent = rows.length;
      }
    } catch (e) {
      this.logger.warn('Notification formation échouée', e as any);
    }
    return { sent, withoutAccount };
  }

  /** Participants actifs d'une session (hors inscriptions annulées). */
  private async activeParticipants(sessionId: string) {
    return this.prisma.employeeTraining.findMany({
      where: { sessionId, status: { not: 'CANCELLED' } },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            position: true,
            department: { select: { name: true } },
          },
        },
        attendances: { select: { date: true, status: true, note: true } },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CRÉER UNE SESSION
  // ══════════════════════════════════════════════════════════════════════════
  async createSession(body: any, userId: string) {
    const user = await this.getRhUser(userId);
    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasTraining',
    );
    const b = body ?? {};

    const courseId = asUuid(b.courseId, 'Formation');
    const course = await this.prisma.trainingCourse.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        companyId: true,
        location: true,
        providerName: true,
      },
    });
    if (!course || course.companyId !== user.companyId)
      throw new NotFoundException('Formation introuvable.');

    const startDate = asDay(b.startDate, 'Date de début');
    const endDate = b.endDate ? asDay(b.endDate, 'Date de fin') : startDate;
    if (endDate.getTime() < startDate.getTime())
      throw new BadRequestException(
        'La date de fin doit être après la date de début.',
      );
    if (daysBetween(startDate, endDate).length > MAX_SESSION_DAYS)
      throw new BadRequestException(
        `Une session ne peut pas dépasser ${MAX_SESSION_DAYS} jours.`,
      );

    const session = await this.prisma.trainingSession.create({
      data: {
        courseId,
        label: asText(b.label, 120),
        startDate,
        endDate,
        startTime: asTime(b.startTime, 'Heure de début'),
        endTime: asTime(b.endTime, 'Heure de fin'),
        location: asText(b.location, 255) ?? course.location ?? null,
        trainerName: asText(b.trainerName, 120) ?? course.providerName ?? null,
        capacity: asCapacity(b.capacity),
        notes: asText(b.notes, 2000),
        createdById: user.id,
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            companyId: true,
            durationHours: true,
            format: true,
            category: true,
          },
        },
      },
    });
    return this.mapSession(session, 0);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. LISTE
  // ══════════════════════════════════════════════════════════════════════════
  async listSessions(
    query: { courseId?: string; status?: string; from?: string; to?: string },
    userId: string,
  ) {
    const user = await this.getRhUser(userId);

    const where: any = { course: { companyId: user.companyId } };
    if (query.courseId) where.courseId = asUuid(query.courseId, 'Formation');
    if (query.status) {
      if (!SESSION_STATUSES.includes(query.status))
        throw new BadRequestException('Statut invalide.');
      where.status = query.status;
    }
    if (query.from || query.to) {
      where.startDate = {};
      if (query.from) where.startDate.gte = asDay(query.from, 'Date « du »');
      if (query.to) where.startDate.lte = asDay(query.to, 'Date « au »');
    }

    const sessions = await this.prisma.trainingSession.findMany({
      where,
      include: {
        course: {
          select: {
            id: true,
            title: true,
            companyId: true,
            durationHours: true,
            format: true,
            category: true,
          },
        },
        participants: { select: { id: true, status: true } },
      },
      orderBy: { startDate: 'desc' },
      take: 300,
    });

    return sessions.map((s: any) =>
      this.mapSession(
        s,
        s.participants.filter((p: any) => p.status !== 'CANCELLED').length,
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. DÉTAIL (participants + émargement)
  // ══════════════════════════════════════════════════════════════════════════
  async getSession(sessionId: string, userId: string) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    const days = daysBetween(s.startDate, s.endDate);
    const participants = await this.activeParticipants(s.id);

    return {
      ...this.mapSession(s, participants.length),
      days,
      participants: participants.map((p: any) => {
        const byDay: Record<string, { status: string; note: string | null }> =
          {};
        for (const a of p.attendances)
          byDay[ymd(a.date)] = { status: a.status, note: a.note };
        const present = Object.values(byDay).filter(
          (a) => a.status === 'PRESENT' || a.status === 'LATE',
        ).length;
        return {
          employeeTrainingId: p.id,
          status: p.status,
          employee: {
            id: p.employee.id,
            firstName: p.employee.firstName,
            lastName: p.employee.lastName,
            position: p.employee.position,
            department: p.employee.department?.name ?? null,
          },
          attendance: byDay,
          daysPresent: present,
          attendanceRate: days.length
            ? Math.round((present / days.length) * 100)
            : 0,
        };
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. MODIFIER / ANNULER
  // ══════════════════════════════════════════════════════════════════════════
  async updateSession(sessionId: string, body: any, userId: string) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    const b = body ?? {};

    if (s.status === 'COMPLETED' || s.status === 'CANCELLED')
      throw new BadRequestException(
        s.status === 'COMPLETED'
          ? 'Cette session est clôturée.'
          : 'Cette session est annulée.',
      );

    const data: any = {};
    if ('label' in b) data.label = asText(b.label, 120);
    if ('location' in b) data.location = asText(b.location, 255);
    if ('trainerName' in b) data.trainerName = asText(b.trainerName, 120);
    if ('notes' in b) data.notes = asText(b.notes, 2000);
    if ('startTime' in b) data.startTime = asTime(b.startTime, 'Heure de début');
    if ('endTime' in b) data.endTime = asTime(b.endTime, 'Heure de fin');

    // Dates
    const newStart = 'startDate' in b ? asDay(b.startDate, 'Date de début') : s.startDate;
    const newEnd = 'endDate' in b ? asDay(b.endDate, 'Date de fin') : s.endDate;
    const datesChanged =
      ymd(newStart) !== ymd(s.startDate) || ymd(newEnd) !== ymd(s.endDate);
    if (datesChanged) {
      if (newEnd.getTime() < newStart.getTime())
        throw new BadRequestException(
          'La date de fin doit être après la date de début.',
        );
      if (daysBetween(newStart, newEnd).length > MAX_SESSION_DAYS)
        throw new BadRequestException(
          `Une session ne peut pas dépasser ${MAX_SESSION_DAYS} jours.`,
        );
      const outside = await this.prisma.trainingAttendance.count({
        where: {
          employeeTraining: { sessionId: s.id },
          OR: [{ date: { lt: newStart } }, { date: { gt: newEnd } }],
        },
      });
      if (outside > 0)
        throw new BadRequestException(
          'Des présences sont déjà saisies en dehors de cette période.',
        );
      data.startDate = newStart;
      data.endDate = newEnd;
    }

    // Capacité
    const participantCount = await this.prisma.employeeTraining.count({
      where: { sessionId: s.id, status: { not: 'CANCELLED' } },
    });
    if ('capacity' in b) {
      const cap = asCapacity(b.capacity);
      if (cap !== null && cap < participantCount)
        throw new BadRequestException(
          `${participantCount} participant(s) sont déjà inscrits : la capacité ne peut pas être inférieure.`,
        );
      data.capacity = cap;
    }

    // Statut (transitions manuelles autorisées : démarrer / annuler)
    let cancelling = false;
    if ('status' in b && b.status !== s.status) {
      if (b.status === 'IN_PROGRESS' && s.status === 'PLANNED') {
        data.status = 'IN_PROGRESS';
      } else if (b.status === 'CANCELLED') {
        const attendanceCount = await this.prisma.trainingAttendance.count({
          where: { employeeTraining: { sessionId: s.id } },
        });
        if (attendanceCount > 0)
          throw new BadRequestException(
            'Des présences sont déjà saisies : clôturez la session au lieu de l\'annuler.',
          );
        data.status = 'CANCELLED';
        cancelling = true;
      } else {
        throw new BadRequestException(
          'Changement de statut non autorisé (utilisez « Clôturer » pour terminer la session).',
        );
      }
    }

    if (!Object.keys(data).length) return this.getSession(s.id, userId);

    // Photo des participants AVANT le détachement (pour pouvoir les prévenir)
    const rosterBefore = (await this.activeParticipants(s.id)).map(
      (p: any) => p.employee,
    );

    await this.prisma.$transaction(async (tx: any) => {
      await tx.trainingSession.update({ where: { id: s.id }, data });
      if (cancelling) {
        // Les participants redeviennent « à placer » (inscription conservée)
        await tx.employeeTraining.updateMany({
          where: { sessionId: s.id, status: { not: 'CANCELLED' } },
          data: { sessionId: null },
        });
      }
    });

    // Prévenir les participants si la session les concerne déjà
    const planningChanged =
      datesChanged || 'location' in data || 'startTime' in data || 'endTime' in data;
    if (cancelling || (planningChanged && s.convocationSentAt)) {
      const people = rosterBefore;
      const title = cancelling
        ? 'Session de formation annulée'
        : 'Session de formation modifiée';
      const message = cancelling
        ? `La session « ${s.course.title} » du ${frDate(s.startDate)} est annulée. La RH vous recontactera pour une nouvelle date.`
        : `La session « ${s.course.title} » a été modifiée. Consultez les nouvelles informations dans Formation.`;
      await this.notifyEmployees(user.companyId, people, title, message, {
        sessionId: s.id,
      });
    }

    return this.getSession(s.id, userId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. SUPPRIMER (uniquement une session vide)
  // ══════════════════════════════════════════════════════════════════════════
  async deleteSession(sessionId: string, userId: string) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    const [participants, attendances] = await Promise.all([
      this.prisma.employeeTraining.count({ where: { sessionId: s.id } }),
      this.prisma.trainingAttendance.count({
        where: { employeeTraining: { sessionId: s.id } },
      }),
    ]);
    if (participants > 0 || attendances > 0)
      throw new BadRequestException(
        'Cette session a des participants ou des présences : annulez-la plutôt que de la supprimer.',
      );
    await this.prisma.trainingSession.delete({ where: { id: s.id } });
    return { deleted: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. AJOUTER DES PARTICIPANTS
  // ══════════════════════════════════════════════════════════════════════════
  async addParticipants(sessionId: string, body: any, userId: string) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED')
      throw new BadRequestException(
        'On ne peut plus inscrire sur une session clôturée ou annulée.',
      );

    const raw = Array.isArray(body?.employeeIds) ? body.employeeIds : [];
    if (!raw.length)
      throw new BadRequestException('Aucun employé sélectionné.');
    if (raw.length > 200)
      throw new BadRequestException('Maximum 200 employés à la fois.');
    const employeeIds: string[] = Array.from(
      new Set(raw.map((id: unknown) => asUuid(id, 'Employé'))),
    );

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId: user.companyId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true },
    });
    const empById = new Map(employees.map((e: any) => [e.id, e]));

    const existing = await this.prisma.employeeTraining.findMany({
      where: {
        employeeId: { in: employeeIds },
        courseId: s.courseId,
        status: { in: OPEN_ENROLLMENT },
      },
      include: { session: { select: { id: true, status: true } } },
    });
    const existingByEmp = new Map(existing.map((e: any) => [e.employeeId, e]));

    const skipped: Array<{ employeeId: string; name: string; reason: string }> = [];
    const toCreate: string[] = [];
    const toAttach: any[] = [];

    for (const id of employeeIds) {
      const emp: any = empById.get(id);
      if (!emp) {
        skipped.push({ employeeId: id, name: '—', reason: 'Employé introuvable ou inactif' });
        continue;
      }
      const name = fullName(emp);
      const ex: any = existingByEmp.get(id);
      if (!ex) {
        toCreate.push(id);
      } else if (ex.sessionId === s.id) {
        skipped.push({ employeeId: id, name, reason: 'Déjà inscrit à cette session' });
      } else if (ex.sessionId && ex.session?.status !== 'CANCELLED') {
        skipped.push({ employeeId: id, name, reason: 'Déjà placé dans une autre session de cette formation' });
      } else if (ex.status === 'COMPLETION_REQUESTED') {
        skipped.push({ employeeId: id, name, reason: 'Validation de fin déjà demandée' });
      } else {
        toAttach.push(ex);
      }
    }

    const toAddCount = toCreate.length + toAttach.length;
    if (s.capacity !== null && toAddCount > 0) {
      const current = await this.prisma.employeeTraining.count({
        where: { sessionId: s.id, status: { not: 'CANCELLED' } },
      });
      const left = s.capacity - current;
      if (toAddCount > left)
        throw new BadRequestException(
          left > 0
            ? `Capacité dépassée : il ne reste que ${left} place(s).`
            : 'Cette session est complète.',
        );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      for (const employeeId of toCreate) {
        await tx.employeeTraining.create({
          data: {
            employeeId,
            courseId: s.courseId,
            sessionId: s.id,
            status: 'PLANNED',
            startDate: s.startDate,
            endDate: s.endDate,
            reviewedById: user.id,
            reviewedAt: now,
            reviewNote: 'Inscrit par la RH à la session',
          },
        });
      }
      for (const ex of toAttach) {
        const fromRequest = ex.status === 'REQUESTED' || ex.status === 'APPROVED';
        await tx.employeeTraining.update({
          where: { id: ex.id },
          data: {
            sessionId: s.id,
            startDate: s.startDate,
            endDate: s.endDate,
            ...(fromRequest
              ? {
                  status: 'PLANNED',
                  reviewedById: user.id,
                  reviewedAt: now,
                  reviewNote: ex.reviewNote ?? 'Inscrit par la RH à la session',
                }
              : {}),
          },
        });
      }
    });

    return { added: toAddCount, skipped };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. RETIRER UN PARTICIPANT
  // ══════════════════════════════════════════════════════════════════════════
  async removeParticipant(
    sessionId: string,
    employeeTrainingId: string,
    userId: string,
  ) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    asUuid(employeeTrainingId, 'Participant');
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED')
      throw new BadRequestException(
        'Cette session est clôturée ou annulée.',
      );

    const p = await this.prisma.employeeTraining.findUnique({
      where: { id: employeeTrainingId },
      select: { id: true, sessionId: true, status: true },
    });
    if (!p || p.sessionId !== s.id)
      throw new NotFoundException('Participant introuvable dans cette session.');
    if (p.status === 'COMPLETION_REQUESTED' || p.status === 'COMPLETED')
      throw new BadRequestException(
        'Ce participant a déjà terminé la formation.',
      );

    await this.prisma.$transaction(async (tx: any) => {
      await tx.trainingAttendance.deleteMany({
        where: { employeeTrainingId: p.id },
      });
      await tx.employeeTraining.update({
        where: { id: p.id },
        data: {
          sessionId: null,
          // Pas encore commencée → l'inscription est annulée (peut être refaite)
          ...(p.status === 'IN_PROGRESS'
            ? {}
            : { status: 'CANCELLED', reviewNote: 'Retiré de la session' }),
        },
      });
    });
    return { removed: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. CONVOCATIONS
  // ══════════════════════════════════════════════════════════════════════════
  async sendConvocations(sessionId: string, userId: string) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED')
      throw new BadRequestException(
        'Impossible de convoquer : session clôturée ou annulée.',
      );

    const participants = (await this.activeParticipants(s.id)).filter(
      (p: any) => ['PLANNED', 'APPROVED', 'IN_PROGRESS'].includes(p.status),
    );
    if (!participants.length)
      throw new BadRequestException('Aucun participant à convoquer.');

    const sameDay = ymd(s.startDate) === ymd(s.endDate);
    const when = sameDay
      ? `le ${frDate(s.startDate)}`
      : `du ${frDate(s.startDate)} au ${frDate(s.endDate)}`;
    const hours =
      s.startTime && s.endTime
        ? ` (${s.startTime} – ${s.endTime})`
        : s.startTime
          ? ` (à partir de ${s.startTime})`
          : '';
    const place = s.location ? `, lieu : ${s.location}` : '';
    const message = `Vous êtes convoqué(e) à la formation « ${s.course.title} » ${when}${hours}${place}.`;

    const result = await this.notifyEmployees(
      user.companyId,
      participants.map((p: any) => p.employee),
      'Convocation à une formation',
      message,
      { sessionId: s.id, kind: 'CONVOCATION' },
    );

    await this.prisma.trainingSession.update({
      where: { id: s.id },
      data: { convocationSentAt: new Date() },
    });

    return {
      sent: result.sent,
      withoutAccount: result.withoutAccount,
      total: participants.length,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. ÉMARGEMENT (un jour à la fois)
  // ══════════════════════════════════════════════════════════════════════════
  async saveAttendance(sessionId: string, body: any, userId: string) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED')
      throw new BadRequestException(
        'Session clôturée ou annulée : les présences ne sont plus modifiables.',
      );

    const b = body ?? {};
    const date = asDay(b.date, 'Date');
    if (date.getTime() < s.startDate.getTime() || date.getTime() > s.endDate.getTime())
      throw new BadRequestException(
        'Cette date est en dehors de la période de la session.',
      );

    const records = Array.isArray(b.records) ? b.records : [];
    if (!records.length)
      throw new BadRequestException('Aucune présence à enregistrer.');
    if (records.length > 500)
      throw new BadRequestException('Trop de lignes.');

    const clean = records.map((r: any) => {
      if (!ATTENDANCE_STATUSES.includes(r?.status))
        throw new BadRequestException('Statut de présence invalide.');
      return {
        employeeTrainingId: asUuid(r.employeeTrainingId, 'Participant'),
        status: r.status as string,
        note: asText(r.note, 255),
      };
    });

    const ids = clean.map((r: any) => r.employeeTrainingId);
    const valid = await this.prisma.employeeTraining.findMany({
      where: { id: { in: ids }, sessionId: s.id, status: { not: 'CANCELLED' } },
      select: { id: true, status: true },
    });
    if (valid.length !== new Set(ids).size)
      throw new BadRequestException(
        'Un ou plusieurs participants n\'appartiennent pas à cette session.',
      );

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      for (const r of clean) {
        await tx.trainingAttendance.upsert({
          where: {
            employeeTrainingId_date: {
              employeeTrainingId: r.employeeTrainingId,
              date,
            },
          },
          create: {
            employeeTrainingId: r.employeeTrainingId,
            date,
            status: r.status,
            note: r.note,
            markedById: user.id,
          },
          update: {
            status: r.status,
            note: r.note,
            markedById: user.id,
            markedAt: now,
          },
        });
      }
      // La session démarre dès la première saisie ; les participants « à venir »
      // passent « en cours » (le flux existant de fin de formation s'appuie dessus).
      if (s.status === 'PLANNED') {
        await tx.trainingSession.update({
          where: { id: s.id },
          data: { status: 'IN_PROGRESS' },
        });
      }
      await tx.employeeTraining.updateMany({
        where: { id: { in: ids }, status: { in: ['PLANNED', 'APPROVED'] } },
        data: { status: 'IN_PROGRESS' },
      });
    });

    return { saved: clean.length };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. CLÔTURER LA SESSION
  //     Les participants assez présents passent en « validation en attente »
  //     (même file que la demande de fin de formation faite par l'employé).
  // ══════════════════════════════════════════════════════════════════════════
  async closeSession(sessionId: string, body: any, userId: string) {
    const user = await this.getRhUser(userId);
    const s = await this.loadSession(sessionId, user.companyId);
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED')
      throw new BadRequestException('Cette session est déjà clôturée ou annulée.');

    let minPct = DEFAULT_MIN_ATTENDANCE_PCT;
    if (body?.minAttendancePct !== undefined && body?.minAttendancePct !== null) {
      const n = Number(body.minAttendancePct);
      if (!Number.isFinite(n) || n < 0 || n > 100)
        throw new BadRequestException('Seuil de présence invalide (0 à 100).');
      minPct = n;
    }

    const days = daysBetween(s.startDate, s.endDate);
    const participants = await this.activeParticipants(s.id);

    const ready: any[] = [];
    const below: Array<{ employeeTrainingId: string; name: string; rate: number }> = [];
    for (const p of participants as any[]) {
      if (!['PLANNED', 'APPROVED', 'IN_PROGRESS'].includes(p.status)) continue;
      const present = p.attendances.filter(
        (a: any) => a.status === 'PRESENT' || a.status === 'LATE',
      ).length;
      const rate = days.length ? Math.round((present / days.length) * 100) : 0;
      if (rate >= minPct && present > 0) ready.push(p);
      else
        below.push({
          employeeTrainingId: p.id,
          name: fullName(p.employee),
          rate,
        });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      if (ready.length) {
        await tx.employeeTraining.updateMany({
          where: { id: { in: ready.map((p) => p.id) } },
          data: { status: 'COMPLETION_REQUESTED', completionRequestedAt: now },
        });
      }
      await tx.trainingSession.update({
        where: { id: s.id },
        data: { status: 'COMPLETED' },
      });
    });

    if (ready.length) {
      await this.notifyEmployees(
        user.companyId,
        ready.map((p) => p.employee),
        'Formation terminée',
        `Votre participation à « ${s.course.title} » est enregistrée. La validation de votre certificat est en attente.`,
        { sessionId: s.id, kind: 'SESSION_CLOSED' },
      );
    }

    return {
      closed: true,
      minAttendancePct: minPct,
      readyForCertification: ready.length,
      belowThreshold: below,
    };
  }
}
