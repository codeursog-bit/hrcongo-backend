import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { anniversaryMessage } from './anniversary-message';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveCompanyLimits } from '../subscriptions/entitlements.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import {
  atCongoTime,
  congoDateString,
  congoDayOfWeek,
} from '../common/utils/congo-time';
import {
  AnnouncementDto,
  AssignTaskDto,
  CompanyAppearanceDto,
  PersonalTaskDto,
  REACTIONS,
  EventCommentDto,
  TaskCommentDto,
  TaskStatusDto,
  UserAppearanceDto,
} from './daily-workspace.dto';

export interface DailyActor {
  id: string;
  companyId: string;
  role: string;
  employeeId: string | null;
  departmentId: string | null;
}
const admin = (actor: DailyActor) =>
  ['ADMIN', 'HR_MANAGER'].includes(actor.role);
const name = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`.trim();
const taskInclude = {
  owner: { select: { id: true, firstName: true, lastName: true } },
  assignees: { select: { userId: true } },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, authorId: true, text: true, createdAt: true },
  },
};
type TaskRow = Prisma.DailyTaskGetPayload<{ include: typeof taskInclude }>;
const checked = (value: string, max: number) => {
  const v = value?.trim();
  if (!v || v.length > max)
    throw new BadRequestException('Texte vide ou trop long.');
  return v;
};

@Injectable()
export class DailyWorkspaceService {
  private readonly logger = new Logger(DailyWorkspaceService.name);
  constructor(private readonly prisma: PrismaService) {}

  async actor(claims: {
    id?: string;
    userId?: string;
    companyId?: string;
  }): Promise<DailyActor> {
    const id = claims.userId || claims.id;
    if (!id || !claims.companyId)
      throw new ForbiddenException('Sélectionnez une entreprise.');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        isActive: true,
        role: true,
        companyId: true,
        manageMultipleCompanies: true,
        employee: {
          select: {
            id: true,
            companyId: true,
            departmentId: true,
            status: true,
          },
        },
      },
    });
    if (!user?.isActive) throw new ForbiddenException('Session indisponible.');
    const companyId = await resolveVerifiedCompanyId(
      this.prisma,
      user,
      claims.companyId,
    );
    if (!companyId || companyId !== claims.companyId)
      throw new ForbiddenException('Entreprise inaccessible.');
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, isActive: true },
      select: { id: true },
    });
    if (!company) throw new ForbiddenException('Entreprise inactive.');
    const employee =
      user.employee?.companyId === companyId &&
      user.employee.status === 'ACTIVE'
        ? user.employee
        : null;
    return {
      id: user.id,
      role: user.role,
      companyId,
      employeeId: employee?.id || null,
      departmentId: employee?.departmentId || null,
    };
  }
  private requireAdmin(a: DailyActor) {
    if (!admin(a))
      throw new ForbiddenException('Accès réservé aux administrateurs et RH.');
  }
  private recipient(a: DailyActor): Prisma.DailyTaskWhereInput {
    return {
      OR: [
        { assignees: { some: { userId: a.id } } },
        ...(a.departmentId ? [{ departmentId: a.departmentId }] : []),
      ],
    };
  }
  private visible(
    a: DailyActor,
    allowAdmin: boolean,
  ): Prisma.DailyTaskWhereInput {
    return {
      companyId: a.companyId,
      OR: [
        { scope: 'PERSONAL', ownerId: a.id },
        {
          scope: 'ASSIGNED',
          ...(allowAdmin && admin(a) ? {} : this.recipient(a)),
        },
      ],
    };
  }
  private taskView(t: TaskRow) {
    return {
      id: t.id,
      companyId: t.companyId,
      ownerId: t.ownerId,
      scope: t.scope,
      title: t.title,
      description: t.description || undefined,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate?.toISOString(),
      completedAt: t.completedAt?.toISOString(),
      blockedReason: t.blockedReason || undefined,
      departmentId: t.departmentId || undefined,
      assigneeIds: t.assignees.map((a) => a.userId),
      assignedBy:
        t.scope === 'ASSIGNED'
          ? { id: t.owner.id, name: name(t.owner) }
          : undefined,
      comments: t.comments.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
  async tasks(a: DailyActor, view: 'me' | 'admin') {
    if (view === 'admin') this.requireAdmin(a);
    const where =
      view === 'admin'
        ? { companyId: a.companyId, scope: 'ASSIGNED' }
        : this.visible(a, false);
    return (
      await this.prisma.dailyTask.findMany({
        where,
        include: taskInclude,
        orderBy: { createdAt: 'desc' },
      })
    ).map((t) => this.taskView(t));
  }
  async createTask(a: DailyActor, dto: PersonalTaskDto) {
    // Jour choisi → midi UTC : le jour reste le même quel que soit le fuseau (slice(0,10) côté front).
    const dueDate = dto.dueDate ? new Date(`${dto.dueDate}T12:00:00Z`) : null;
    if (dueDate && Number.isNaN(dueDate.getTime()))
      throw new BadRequestException('Date d’échéance invalide.');
    return this.taskView(
      await this.prisma.dailyTask.create({
        data: {
          companyId: a.companyId,
          ownerId: a.id,
          title: checked(dto.title, 200),
          scope: 'PERSONAL',
          ...(dueDate ? { dueDate } : {}),
        },
        include: taskInclude,
      }),
    );
  }
  async assignTask(a: DailyActor, dto: AssignTaskDto) {
    this.requireAdmin(a);
    if (!dto.assigneeIds.length && !dto.departmentId)
      throw new BadRequestException('Choisissez un destinataire.');
    return this.prisma.$transaction(async (tx) => {
      const users = await tx.user.count({
        where: {
          id: { in: dto.assigneeIds },
          isActive: true,
          OR: [
            { companyId: a.companyId },
            { ownedCompanies: { some: { companyId: a.companyId } } },
          ],
        },
      });
      if (users !== dto.assigneeIds.length)
        throw new BadRequestException('Destinataire inaccessible.');
      if (
        dto.departmentId &&
        !(await tx.department.findFirst({
          where: { id: dto.departmentId, companyId: a.companyId },
          select: { id: true },
        }))
      )
        throw new BadRequestException('Département inaccessible.');
      const task = await tx.dailyTask.create({
        data: {
          companyId: a.companyId,
          ownerId: a.id,
          title: checked(dto.title, 200),
          scope: 'ASSIGNED',
          departmentId: dto.departmentId,
          assignees: { create: dto.assigneeIds.map((userId) => ({ userId })) },
        },
        include: taskInclude,
      });
      return this.taskView(task);
    });
  }
  async taskStatus(a: DailyActor, id: string, dto: TaskStatusDto) {
    const reason =
      dto.status === 'BLOCKED' ? checked(dto.blockedReason || '', 2000) : null;
    const result = await this.prisma.dailyTask.updateMany({
      where: { id, ...this.visible(a, false) },
      data: {
        status: dto.status,
        blockedReason: reason,
        completedAt: dto.status === 'DONE' ? new Date() : null,
      },
    });
    if (!result.count) throw new NotFoundException('Tâche inaccessible.');
  }
  async comment(a: DailyActor, id: string, dto: TaskCommentDto) {
    const task = await this.prisma.dailyTask.findFirst({
      where: { id, ...this.visible(a, true) },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Tâche inaccessible.');
    await this.prisma.dailyTaskComment.create({
      data: { taskId: task.id, authorId: a.id, text: checked(dto.text, 2000) },
    });
  }
  announcements(a: DailyActor) {
    return this.prisma.dailyAnnouncement.findMany({
      where: { companyId: a.companyId },
      select: {
        id: true,
        companyId: true,
        title: true,
        body: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async announce(a: DailyActor, dto: AnnouncementDto) {
    this.requireAdmin(a);
    const today = congoDateString(),
      [, month, day] = today.split('-').map(Number);
    return this.prisma.dailyAnnouncement.create({
      data: {
        companyId: a.companyId,
        authorId: a.id,
        title: checked(dto.title, 200),
        body: checked(dto.body, 5000),
        event: {
          create: {
            companyId: a.companyId,
            eventKey: `announcement:${randomUUID()}`,
            type: 'ANNOUNCEMENT',
            day,
            month,
            expiresAt: new Date(Date.now() + 86400000),
          },
        },
      },
      select: {
        id: true,
        companyId: true,
        title: true,
        body: true,
        createdAt: true,
      },
    });
  }

  private async peopleOnDay(
    companyId: string,
    kind: 'birthday' | 'hire',
    now: Date,
  ) {
    const date = congoDateString(now),
      [, month, day] = date.split('-').map(Number);
    const field =
      kind === 'birthday' ? Prisma.sql`"dateOfBirth"` : Prisma.sql`"hireDate"`;
    return this.prisma.$queryRaw<
      Array<{ id: string; firstName: string; lastName: string; hireDate: Date }>
    >(Prisma.sql`
      SELECT "id", "firstName", "lastName", "hireDate" FROM "employees"
      WHERE "companyId"=${companyId}::uuid AND "status"='ACTIVE'
      AND EXTRACT(MONTH FROM ${field})=${month} AND EXTRACT(DAY FROM ${field})=${day}`);
  }
  private async seedEvents(companyId: string, now: Date) {
    const today = congoDateString(now),
      [, month, day] = today.split('-').map(Number),
      expiresAt = new Date(atCongoTime(today, 0).getTime() + 86400000);
    const birthday = await this.peopleOnDay(companyId, 'birthday', now);
    // 🎉 Arrivée : visible 3 jours (jour d'embauche + 2), un seul évènement par arrivée.
    const since = congoDateString(new Date(now.getTime() - 2 * 86400000));
    const newcomers = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        hireDate: {
          gte: new Date(`${since}T00:00:00Z`),
          lte: new Date(`${today}T00:00:00Z`),
        },
      },
      select: { id: true, hireDate: true },
    });
    const data = [
      ...birthday.map((e) => ({
        companyId,
        eventKey: `birthday:${e.id}:${today}`,
        type: 'BIRTHDAY',
        subjectId: e.id,
        day,
        month,
        expiresAt,
      })),
      ...newcomers.map((e) => {
        const hired = e.hireDate.toISOString().slice(0, 10);
        const [, hm, hd] = hired.split('-').map(Number);
        return {
          companyId,
          eventKey: `welcome:${e.id}`,
          type: 'WELCOME',
          subjectId: e.id,
          day: hd,
          month: hm,
          expiresAt: new Date(atCongoTime(hired, 0).getTime() + 3 * 86400000),
        };
      }),
    ];
    if (data.length)
      await this.prisma.dailyEvent.createMany({ data, skipDuplicates: true });
  }
  async events(a: DailyActor) {
    await this.seedEvents(a.companyId, new Date());
    const events = await this.prisma.dailyEvent.findMany({
      where: {
        companyId: a.companyId,
        expiresAt: { gt: new Date() },
        OR: [
          { type: 'ANNOUNCEMENT' },
          { subject: { companyId: a.companyId, status: 'ACTIVE' } },
        ],
      },
      include: {
        subject: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true },
        },
        announcement: { select: { title: true, body: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            authorId: true,
            text: true,
            createdAt: true,
            author: { select: { firstName: true, lastName: true } },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                isActive: true,
                companyId: true,
                ownedCompanies: {
                  where: { companyId: a.companyId },
                  select: { companyId: true },
                },
              },
            },
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
    });
    return events.map((e) => ({
      id: e.id,
      companyId: e.companyId,
      type: e.type,
      subject: e.subject
        ? {
            id: e.subject.id,
            name: name(e.subject),
            photoUrl: e.subject.photoUrl || undefined,
          }
        : undefined,
      title:
        e.announcement?.title ||
        (e.subject
          ? e.type === 'BIRTHDAY'
            ? `Bon anniversaire, ${e.subject.firstName} !`
            : `Bienvenue, ${e.subject.firstName} !`
          : ''),
      body: e.announcement?.body,
      // 💌 Messages : seule la personne concernée peut les LIRE ; les autres peuvent en écrire.
      canComment:
        !!e.subjectId &&
        e.subjectId !== a.employeeId &&
        (e.type === 'BIRTHDAY' || e.type === 'WELCOME'),
      sentCount: e.comments.filter((c) => c.authorId === a.id).length,
      comments:
        e.subjectId && e.subjectId === a.employeeId
          ? e.comments.map((c) => ({
              id: c.id,
              author: name(c.author),
              text: c.text,
              createdAt: c.createdAt.toISOString(),
            }))
          : undefined,
      day: e.day,
      month: e.month,
      expiresAt: e.expiresAt.toISOString(),
      reactions: REACTIONS.map((emoji) => {
        const votes = e.reactions.filter(
          (r) =>
            r.emoji === emoji &&
            r.user.isActive &&
            (r.user.companyId === a.companyId ||
              r.user.ownedCompanies.length > 0),
        );
        return {
          emoji,
          count: votes.length,
          mine: votes.some((r) => r.userId === a.id),
          userNames: votes.map((r) => name(r.user)),
        };
      }),
    }));
  }
  async react(a: DailyActor, id: string, emoji: string) {
    await this.prisma.$transaction(async (tx) => {
      const event = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "DailyEvent" WHERE "id"=${id}::uuid AND "companyId"=${a.companyId}::uuid AND "expiresAt">now() FOR UPDATE`,
      );
      if (
        !event.length ||
        !(await tx.dailyEvent.findFirst({
          where: {
            id,
            companyId: a.companyId,
            OR: [
              { type: 'ANNOUNCEMENT' },
              { subject: { companyId: a.companyId, status: 'ACTIVE' } },
            ],
          },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Événement indisponible.');
      // 1 seule réaction par personne : même emoji = retrait ; autre emoji = remplacement.
      const mine = await tx.dailyReaction.findMany({
        where: { eventId: id, userId: a.id },
        select: { emoji: true },
      });
      await tx.dailyReaction.deleteMany({
        where: { eventId: id, userId: a.id },
      });
      if (!mine.some((r) => r.emoji === emoji))
        await tx.dailyReaction.create({
          data: { eventId: id, userId: a.id, emoji },
        });
    });
  }

  /** Message à la personne fêtée (anniversaire / arrivée) : lisible uniquement par elle. */
  async commentEvent(a: DailyActor, id: string, dto: EventCommentDto) {
    const event = await this.prisma.dailyEvent.findFirst({
      where: {
        id,
        companyId: a.companyId,
        expiresAt: { gt: new Date() },
        type: { in: ['BIRTHDAY', 'WELCOME'] },
        subject: { companyId: a.companyId, status: 'ACTIVE' },
      },
      select: { id: true, subjectId: true },
    });
    if (!event) throw new NotFoundException('Événement indisponible.');
    if (event.subjectId && event.subjectId === a.employeeId)
      throw new BadRequestException('Ce message est pour les autres : vous le recevrez ici.');
    const sent = await this.prisma.dailyEventComment.count({
      where: { eventId: id, authorId: a.id },
    });
    if (sent >= 3)
      throw new BadRequestException('Vous avez déjà envoyé plusieurs messages à cette personne.');
    await this.prisma.dailyEventComment.create({
      data: { eventId: id, authorId: a.id, text: checked(dto.text, 1000) },
    });
    return { ok: true };
  }
  private async seedAnniversaries(
    companyId: string,
    now: Date,
    recipientId?: string,
  ) {
    const today = congoDateString(now),
      year = Number(today.slice(0, 4));
    const people = (await this.peopleOnDay(companyId, 'hire', now)).filter(
      (e) => e.hireDate.getUTCFullYear() < year,
    );
    if (!people.length) return;
    const [company, users] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { legalName: true, tradeName: true },
      }),
      this.prisma.user.findMany({
        where: {
          isActive: true,
          ...(recipientId ? { id: recipientId } : {}),
          OR: [{ companyId }, { ownedCompanies: { some: { companyId } } }],
        },
        select: { id: true, role: true, employeeId: true },
      }),
    ]);
    const data = users.flatMap((u) =>
      people
        .filter(
          (e) =>
            ['ADMIN', 'HR_MANAGER'].includes(u.role) || e.id === u.employeeId,
        )
        .map((e) => ({
          companyId,
          recipientId: u.id,
          subjectId: e.id,
          dateKey: today,
          message: anniversaryMessage(
            year - e.hireDate.getUTCFullYear(),
            year,
            company.tradeName || company.legalName,
            name(e),
            e.id === u.employeeId,
          ),
        })),
    );
    if (data.length)
      await this.prisma.anniversaryReceipt.createMany({
        data,
        skipDuplicates: true,
      });
  }
  async anniversaries(a: DailyActor) {
    await this.seedAnniversaries(a.companyId, new Date(), a.id);
    return this.prisma.anniversaryReceipt.findMany({
      where: { companyId: a.companyId, recipientId: a.id },
      select: {
        id: true,
        companyId: true,
        recipientId: true,
        subjectId: true,
        message: true,
        read: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async readAnniversary(a: DailyActor, id: string) {
    const r = await this.prisma.anniversaryReceipt.updateMany({
      where: { id, companyId: a.companyId, recipientId: a.id },
      data: { read: true },
    });
    if (!r.count) throw new NotFoundException('Notification inaccessible.');
  }

  async overview(a: DailyActor) {
    const day = congoDateString(),
      date = new Date(`${day}T00:00:00Z`),
      year = Number(day.slice(0, 4));
    const holidays = (
      await this.prisma.publicHoliday.findMany({
        where: {
          companyId: a.companyId,
          year: { gte: year - 1, lte: year + 1 },
        },
        select: { date: true, name: true },
        orderBy: { date: 'asc' },
      })
    ).map((h) => ({ date: h.date, label: h.name }));
    const employeeWhere: Prisma.EmployeeWhereInput = {
      companyId: a.companyId,
      status: 'ACTIVE',
      id: { not: a.employeeId || undefined },
      ...(!admin(a)
        ? {
            departmentId:
              a.departmentId || '00000000-0000-4000-8000-000000000000',
          }
        : {}),
    };
    const select = {
      employee: { select: { id: true, firstName: true, lastName: true } },
    };
    // Un simple employé ne voit que lui-même : pas d'absences de collègues (manager = son département, admin/RH = tous).
    const canSeeTeam = a.role !== 'EMPLOYEE';
    const [leaves, absences] = !canSeeTeam
      ? [[], []]
      : await Promise.all([
      this.prisma.leave.findMany({
        where: {
          status: 'APPROVED',
          startDate: { lte: date },
          endDate: { gte: date },
          employee: employeeWhere,
        },
        select,
      }),
      this.prisma.absenceRequest.findMany({
        where: {
          companyId: a.companyId,
          status: 'APPROVED',
          startDate: { lte: date },
          endDate: { gte: date },
          employee: employeeWhere,
        },
        select,
      }),
    ]);
    const absentColleagues = Array.from(
      new Map(
        [...leaves, ...absences].map((r) => [
          r.employee.id,
          {
            id: r.employee.id,
            name: name(r.employee),
            label: 'Absent aujourd’hui',
          },
        ]),
      ).values(),
    );
    const schedule: Array<{ label: string; start: string; end: string }> = [];
    if (a.employeeId) {
      const weekday = congoDayOfWeek(new Date());
      const specific = await this.prisma.employeeShiftAssignment.findFirst({
        where: {
          companyId: a.companyId,
          employeeId: a.employeeId,
          specificDate: day,
          shift: { companyId: a.companyId, isActive: true },
        },
        include: { shift: true },
        orderBy: { createdAt: 'desc' },
      });
      const recurring = specific
        ? null
        : await this.prisma.employeeShiftAssignment.findFirst({
            where: {
              companyId: a.companyId,
              employeeId: a.employeeId,
              specificDate: null,
              dayOfWeek: weekday,
              AND: [
                { OR: [{ validFrom: null }, { validFrom: { lte: date } }] },
                { OR: [{ validUntil: null }, { validUntil: { gte: date } }] },
              ],
              shift: { companyId: a.companyId, isActive: true },
            },
            include: { shift: true },
            orderBy: { createdAt: 'desc' },
          });
      const time = (hour: number, minute: number) =>
        `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const assigned = specific?.shift || recurring?.shift;
      if (assigned)
        schedule.push({
          label: assigned.name,
          start: time(assigned.startHour, assigned.startMinute),
          end: time(assigned.endHour, assigned.endMinute),
        });
      else {
        const settings = await this.prisma.payrollSettings.findFirst({
          where: { companyId: a.companyId },
        });
        if (
          settings &&
          Array.isArray(settings.workDays) &&
          settings.workDays.includes(weekday)
        ) {
          const shift = await this.prisma.workShift.findFirst({
            where: { companyId: a.companyId, isActive: true, isDefault: true },
            orderBy: { createdAt: 'desc' },
          });
          if (shift)
            schedule.push({
              label: shift.name,
              start: time(shift.startHour, shift.startMinute),
              end: time(shift.endHour, shift.endMinute),
            });
          else if (settings.officialStartHour !== null)
            schedule.push({
              label: 'Horaire de l’entreprise',
              start: time(
                settings.officialStartHour,
                settings.officialStartMinute,
              ),
              end: time(settings.officialEndHour, 0),
            });
        }
      }
    }
    // 📅 Semaine en cours (lundi → dimanche, heure du Congo) : même logique que « aujourd'hui »,
    // jour par jour (date précise > planning récurrent > horaire de l'entreprise > repos).
    const week: Array<{
      date: string;
      label: string;
      start?: string;
      end?: string;
      kind: 'shift' | 'company' | 'off';
      today: boolean;
    }> = [];
    if (a.employeeId) {
      const sinceMonday = (date.getUTCDay() + 6) % 7;
      const days = Array.from({ length: 7 }, (_, i) =>
        new Date(date.getTime() + (i - sinceMonday) * 86400000)
          .toISOString()
          .slice(0, 10),
      );
      const monday = new Date(`${days[0]}T00:00:00Z`);
      const sunday = new Date(`${days[6]}T00:00:00Z`);
      const [assigns, wsettings, defaultShift] = await Promise.all([
        this.prisma.employeeShiftAssignment.findMany({
          where: {
            companyId: a.companyId,
            employeeId: a.employeeId,
            shift: { companyId: a.companyId, isActive: true },
            OR: [
              { specificDate: { in: days } },
              {
                specificDate: null,
                AND: [
                  { OR: [{ validFrom: null }, { validFrom: { lte: sunday } }] },
                  { OR: [{ validUntil: null }, { validUntil: { gte: monday } }] },
                ],
              },
            ],
          },
          include: { shift: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.payrollSettings.findFirst({
          where: { companyId: a.companyId },
        }),
        this.prisma.workShift.findFirst({
          where: { companyId: a.companyId, isActive: true, isDefault: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const hhmm = (h: number, m: number) =>
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      for (const d of days) {
        const dd = new Date(`${d}T00:00:00Z`);
        const wd = dd.getUTCDay();
        const specific = assigns.find((x) => x.specificDate === d);
        const recurring = specific
          ? undefined
          : assigns.find(
              (x) =>
                !x.specificDate &&
                x.dayOfWeek === wd &&
                (!x.validFrom || x.validFrom <= dd) &&
                (!x.validUntil || x.validUntil >= dd),
            );
        const shift = (specific || recurring)?.shift;
        const entry = { date: d, label: '', kind: 'off' as const, today: d === day };
        if (shift) {
          week.push({
            ...entry,
            label: shift.name,
            kind: 'shift',
            start: hhmm(shift.startHour, shift.startMinute),
            end: hhmm(shift.endHour, shift.endMinute),
          });
        } else if (
          wsettings &&
          Array.isArray(wsettings.workDays) &&
          wsettings.workDays.includes(wd)
        ) {
          if (defaultShift)
            week.push({
              ...entry,
              label: defaultShift.name,
              kind: 'company',
              start: hhmm(defaultShift.startHour, defaultShift.startMinute),
              end: hhmm(defaultShift.endHour, defaultShift.endMinute),
            });
          else if (wsettings.officialStartHour !== null)
            week.push({
              ...entry,
              label: 'Horaire de l’entreprise',
              kind: 'company',
              start: hhmm(wsettings.officialStartHour, wsettings.officialStartMinute),
              end: hhmm(wsettings.officialEndHour, 0),
            });
          else week.push(entry);
        } else week.push(entry);
      }
    }
    return { holidays, absentColleagues, schedule, week };
  }

  async appearance(a: DailyActor) {
    const limits=await effectiveCompanyLimits(this.prisma,a.companyId);
    const customization=limits.hasAppearanceCustomization===true;
    const [company, user] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: a.companyId },
        select: { interfaceAppearance: true, allowEmployeeCustomization: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: a.id },
        select: { interfaceAppearance: true },
      }),
    ]);
    const companyColors =
      (customization ? company.interfaceAppearance : null) as unknown as CompanyAppearanceDto['colors'];
    const personal =
      (user.interfaceAppearance as unknown as UserAppearanceDto) || {
        mode: 'auto',
        colors: null,
      };
    const chosen = customization && company.allowEmployeeCustomization && !!personal.colors;
    return {
      company: {
        colors: companyColors,
        allowEmployeeCustomization: customization && company.allowEmployeeCustomization,
      },
      user: personal,
      effective: {
        colors: chosen
          ? personal.colors
          : companyColors || {
              accent: '#F7874B',
              ambianceLight: 'neutral',
              ambianceDark: 'anthracite',
            },
        mode: personal.mode,
        source: chosen ? 'USER' : companyColors ? 'COMPANY' : 'DEFAULT',
        canCustomize: customization && company.allowEmployeeCustomization,
      },
    };
  }
  async saveUserAppearance(a: DailyActor, dto: UserAppearanceDto) {
    const current = await this.appearance(a);
    const canonical = (c: UserAppearanceDto['colors']) =>
      c
        ? JSON.stringify([
            c.accent.toUpperCase(),
            c.ambianceLight,
            c.ambianceDark,
          ])
        : null;
    if (
      dto.colors &&
      !current.company.allowEmployeeCustomization &&
      canonical(dto.colors) !== canonical(current.user.colors)
    )
      throw new ForbiddenException(
        'Les couleurs sont définies par votre entreprise.',
      );
    await this.prisma.user.update({
      where: { id: a.id },
      data: {
        interfaceAppearance: {
          mode: dto.mode,
          colors: dto.colors,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  async saveCompanyAppearance(
    a: DailyActor,
    id: string,
    dto: CompanyAppearanceDto,
  ) {
    if ((await effectiveCompanyLimits(this.prisma,a.companyId)).hasAppearanceCustomization!==true)
      throw new ForbiddenException('La personnalisation des couleurs est disponible avec une offre supérieure ou une option.');
    if (a.role !== 'ADMIN' || id !== a.companyId)
      throw new ForbiddenException(
        'Réglage réservé à l’administrateur de l’entreprise active.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: a.companyId },
        data: {
          interfaceAppearance:
            dto.colors === null
              ? Prisma.DbNull
              : (dto.colors as unknown as Prisma.InputJsonValue),
          allowEmployeeCustomization: dto.allowEmployeeCustomization,
        },
      });
      await tx.activityLog.create({
        data: {
          userId: a.id,
          action: 'UPDATE',
          entity: 'COMPANY_APPEARANCE',
          entityId: a.companyId,
          description: 'Politique d’apparence mise à jour.',
          metadata: {
            companyId: a.companyId,
            allowEmployeeCustomization: dto.allowEmployeeCustomization,
          },
        },
      });
    });
  }
  @Cron('0 8 * * *', { timeZone: 'Africa/Brazzaville' })
  async dailyMessages() {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      try {
        await this.seedAnniversaries(company.id, new Date());
      } catch {
        this.logger.warn(
          'Échec de préparation des messages d’ancienneté ; nouvelle tentative à la prochaine lecture.',
        );
      }
    }
  }
}