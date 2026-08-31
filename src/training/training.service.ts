// src/training/training.service.ts
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppGateway } from '../app.gateway';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateTrainingRequestDto } from './dto/create-request.dto';
import { ReviewRequestDto, ReviewAction } from './dto/review-request.dto';
import { UpdatePfaDto } from './dto/update-pfa.dto';

const RH_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];

export const MENTIONS = [
  'SATISFAISANT',
  'BIEN',
  'TRES_BIEN',
  'EXCELLENT',
] as const;
export type Mention = (typeof MENTIONS)[number];

const MENTION_LABELS: Record<string, string> = {
  SATISFAISANT: 'Satisfaisant',
  BIEN: 'Bien',
  TRES_BIEN: 'Très Bien',
  EXCELLENT: 'Excellent',
};

@Injectable()
export class TrainingService {
  constructor(
    private prisma: PrismaService,
    private gateway: AppGateway,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        companyId: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!user || !user.companyId)
      throw new ForbiddenException(
        'Utilisateur non rattaché à une entreprise.',
      );
    return { ...user, companyId: user.companyId };
  }

  private async getEmployee(userId: string, companyId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, employeeId: true },
    });
    if (user?.employeeId) {
      return this.prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          departmentId: true,
          position: true,
          department: { select: { name: true } },
        },
      });
    }
    if (user?.email) {
      return this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          departmentId: true,
          position: true,
          department: { select: { name: true } },
        },
      });
    }
    return null;
  }

  private async getManagerDeptId(
    userId: string,
    companyId: string,
  ): Promise<string | null> {
    const dept = await this.prisma.department.findFirst({
      where: { managerId: userId, companyId },
      select: { id: true },
    });
    if (dept) return dept.id;
    const emp = await this.getEmployee(userId, companyId);
    return emp?.departmentId ?? null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CRÉER UN COURS
  // ══════════════════════════════════════════════════════════════════════════
  async createCourse(data: CreateCourseDto, userId: string) {
    const user = await this.getUser(userId);
    if (!RH_ROLES.includes(user.role))
      throw new ForbiddenException(
        'Seuls les RH et administrateurs peuvent créer des formations.',
      );
    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasTraining',
    );

    const course = await this.prisma.trainingCourse.create({
      data: {
        ...data,
        cost: data.cost ? data.cost : null,
        dateSchedule: data.dateSchedule ? new Date(data.dateSchedule) : null,
        companyId: user.companyId,
      },
    });
    this.gateway.sendCompanyNotification({
      type: 'INFO',
      title: '📚 Nouvelle formation disponible',
      message: `"${data.title}" est disponible dans le catalogue.`,
      time: new Date().toLocaleTimeString(),
      link: '/formation',
    });
    return course;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. CATALOGUE
  // ══════════════════════════════════════════════════════════════════════════
  async findAllCourses(userId: string, overrideCompanyId?: string) {
    const user = await this.getUser(userId);

    const isCabinet =
      user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
    const effectiveCompanyId =
      isCabinet && overrideCompanyId ? overrideCompanyId : user.companyId;

    // Pour cabinet → pas de filtre employé (il voit tout)
    const employee = isCabinet
      ? null
      : await this.getEmployee(userId, effectiveCompanyId);

    const courses = await this.prisma.trainingCourse.findMany({
      where: { companyId: effectiveCompanyId },
      include: {
        sessions: employee
          ? {
              where: { employeeId: employee.id },
              select: { id: true, status: true },
            }
          : { select: { id: true, status: true, employeeId: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map((c: any) => ({
      ...c,
      cost: c.cost ? Number(c.cost) : null,
      enrolledCount: c._count.sessions,
      status:
        !isCabinet && c.sessions?.length > 0
          ? c.sessions[0].status
          : 'NOT_STARTED',
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. AUTO-INSCRIPTION
  // ══════════════════════════════════════════════════════════════════════════
  async joinCourse(courseId: string, userId: string) {
    const user = await this.getUser(userId);
    const employee = await this.getEmployee(userId, user.companyId);
    if (!employee)
      throw new BadRequestException('Aucun profil employé associé.');

    const course = await this.prisma.trainingCourse.findUnique({
      where: { id: courseId },
      select: { companyId: true },
    });
    if (!course || course.companyId !== user.companyId)
      throw new NotFoundException('Formation introuvable.');

    const existing = await this.prisma.employeeTraining.findFirst({
      where: { employeeId: employee.id, courseId },
    });
    if (existing) return existing;

    return this.prisma.employeeTraining.create({
      data: {
        employeeId: employee.id,
        courseId,
        status: 'IN_PROGRESS',
        startDate: new Date(),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DEMANDE DE FORMATION
  // ══════════════════════════════════════════════════════════════════════════
  async createRequest(dto: CreateTrainingRequestDto, userId: string) {
    const user = await this.getUser(userId);
    const employee = await this.getEmployee(userId, user.companyId);
    if (!employee)
      throw new BadRequestException('Aucun profil employé associé.');

    const course = await this.prisma.trainingCourse.findUnique({
      where: { id: dto.courseId },
      select: { companyId: true, title: true },
    });
    if (!course || course.companyId !== user.companyId)
      throw new NotFoundException('Formation introuvable.');

    const existing = await this.prisma.employeeTraining.findFirst({
      where: {
        employeeId: employee.id,
        courseId: dto.courseId,
        status: {
          in: [
            'REQUESTED',
            'APPROVED',
            'PLANNED',
            'IN_PROGRESS',
            'COMPLETION_REQUESTED',
          ],
        },
      },
    });
    if (existing)
      throw new BadRequestException('Une demande est déjà en cours.');

    const request = await this.prisma.employeeTraining.create({
      data: {
        employeeId: employee.id,
        courseId: dto.courseId,
        status: 'REQUESTED',
        reason: dto.reason,
        startDate: new Date(),
      },
    });
    this.gateway.sendCompanyNotification({
      type: 'INFO',
      title: '📋 Nouvelle demande de formation',
      message: `${employee.firstName} ${employee.lastName} demande "${course.title}"`,
      time: new Date().toLocaleTimeString(),
      link: '/formation',
    });
    return request;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. LISTE DEMANDES — filtré par rôle
  // ══════════════════════════════════════════════════════════════════════════
  async findAllRequests(userId: string) {
    const user = await this.getUser(userId);
    const isRH = RH_ROLES.includes(user.role);
    const isManager = user.role === 'MANAGER';
    if (!isRH && !isManager)
      throw new ForbiddenException('Accès non autorisé.');

    const whereClause: any = { course: { companyId: user.companyId } };
    if (isManager) {
      const deptId = await this.getManagerDeptId(userId, user.companyId);
      if (!deptId) return [];
      whereClause.employee = { departmentId: deptId };
    }

    return this.prisma.employeeTraining.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            department: { select: { id: true, name: true } },
          },
        },
        course: {
          select: {
            id: true,
            title: true,
            format: true,
            cost: true,
            durationHours: true,
          },
        },
        reviewedBy: { select: { firstName: true, lastName: true } },
        validatedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. VALIDER / REFUSER DEMANDE
  // ══════════════════════════════════════════════════════════════════════════
  async reviewRequest(
    requestId: string,
    dto: ReviewRequestDto,
    userId: string,
  ) {
    const user = await this.getUser(userId);
    if (!RH_ROLES.includes(user.role))
      throw new ForbiddenException('Seul le RH peut valider les demandes.');

    const request = await this.prisma.employeeTraining.findUnique({
      where: { id: requestId },
      include: {
        employee: { select: { firstName: true, lastName: true } },
        course: { select: { title: true, companyId: true } },
      },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');
    if (request.course.companyId !== user.companyId)
      throw new ForbiddenException();
    if (request.status !== 'REQUESTED')
      throw new BadRequestException('Demande déjà traitée.');

    const updated = await this.prisma.employeeTraining.update({
      where: { id: requestId },
      data: {
        status: dto.status as any,
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote,
      },
    });
    this.gateway.sendCompanyNotification({
      type: dto.status === ReviewAction.APPROVED ? 'SUCCESS' : 'ALERT',
      title: `Demande ${dto.status === ReviewAction.APPROVED ? '✅ approuvée' : '❌ refusée'}`,
      message: `"${request.course.title}" — ${request.employee.firstName} ${request.employee.lastName}`,
      time: new Date().toLocaleTimeString(),
      link: '/formation',
    });
    return updated;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. EMPLOYÉ SIGNALE QU'IL A TERMINÉ
  // ══════════════════════════════════════════════════════════════════════════
  async requestCompletion(sessionId: string, userId: string) {
    const user = await this.getUser(userId);
    const employee = await this.getEmployee(userId, user.companyId);
    if (!employee) throw new BadRequestException('Profil employé introuvable.');

    const session = await this.prisma.employeeTraining.findUnique({
      where: { id: sessionId },
      include: { course: { select: { title: true, companyId: true } } },
    });
    if (!session) throw new NotFoundException('Session introuvable.');
    if (session.course.companyId !== user.companyId)
      throw new ForbiddenException();
    if (session.employeeId !== employee.id)
      throw new ForbiddenException("Ce n'est pas votre formation.");
    if (session.status !== 'IN_PROGRESS')
      throw new BadRequestException('La formation doit être en cours.');

    const updated = await this.prisma.employeeTraining.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETION_REQUESTED',
        completionRequestedAt: new Date(),
      },
    });
    this.gateway.sendCompanyNotification({
      type: 'INFO',
      title: '🎓 Validation demandée',
      message: `${employee.firstName} ${employee.lastName} a terminé "${session.course.title}"`,
      time: new Date().toLocaleTimeString(),
      link: '/formation',
    });
    return updated;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. RH/MANAGER VALIDE + MENTION → GÉNÈRE CERTIFICAT
  // ══════════════════════════════════════════════════════════════════════════
  async validateCompletion(
    sessionId: string,
    dto: { mention: string; validationNote?: string },
    userId: string,
  ) {
    const user = await this.getUser(userId);
    const isRH = RH_ROLES.includes(user.role);
    const isManager = user.role === 'MANAGER';
    if (!isRH && !isManager)
      throw new ForbiddenException('Accès non autorisé.');

    if (!MENTIONS.includes(dto.mention as Mention))
      throw new BadRequestException(
        `Mention invalide. Valeurs : ${MENTIONS.join(', ')}`,
      );

    const session = await this.prisma.employeeTraining.findUnique({
      where: { id: sessionId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            departmentId: true,
            department: { select: { name: true } },
          },
        },
        course: {
          select: {
            title: true,
            companyId: true,
            durationHours: true,
            providerName: true,
            format: true,
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Session introuvable.');
    if (session.course.companyId !== user.companyId)
      throw new ForbiddenException();

    if (isManager) {
      const deptId = await this.getManagerDeptId(userId, user.companyId);
      if (deptId && session.employee.departmentId !== deptId)
        throw new ForbiddenException(
          "Cet employé n'est pas dans votre département.",
        );
    }

    if (!['IN_PROGRESS', 'COMPLETION_REQUESTED'].includes(session.status))
      throw new BadRequestException('Statut invalide pour valider.');

    const year = new Date().getFullYear();
    const certRef = `CERT-${session.employee.id.slice(0, 4).toUpperCase()}-${session.course.title.slice(0, 4).toUpperCase().replace(/\s/g, '')}-${year}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const validator =
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'RH';

    const certificateData = {
      ref: certRef,
      employeeName: `${session.employee.firstName} ${session.employee.lastName}`,
      position: session.employee.position,
      department: session.employee.department?.name,
      courseTitle: session.course.title,
      durationHours: session.course.durationHours,
      providerName: session.course.providerName,
      format: session.course.format,
      mention: MENTION_LABELS[dto.mention] ?? dto.mention,
      validationNote: dto.validationNote ?? null,
      validatedBy: validator,
      validatedAt: new Date().toISOString(),
      year,
    };

    const updated = await this.prisma.employeeTraining.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        endDate: new Date(),
        mention: dto.mention,
        validationNote: dto.validationNote,
        validatedById: userId,
        validatedAt: new Date(),
        certificateRef: certRef,
        certificateUrl: Buffer.from(JSON.stringify(certificateData)).toString(
          'base64',
        ),
      },
    });

    this.gateway.sendCompanyNotification({
      type: 'SUCCESS',
      title: '🎓 Formation certifiée !',
      message: `"${session.course.title}" — Mention : ${MENTION_LABELS[dto.mention]}`,
      time: new Date().toLocaleTimeString(),
      link: '/formation',
    });
    return { ...updated, certificateData };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. MES FORMATIONS
  // ══════════════════════════════════════════════════════════════════════════
  async getMyTrainings(userId: string) {
    const user = await this.getUser(userId);
    const employee = await this.getEmployee(userId, user.companyId);
    if (!employee)
      return {
        assigned: [],
        inProgress: [],
        completionRequested: [],
        completed: [],
        requested: [],
      };

    const sessions = await this.prisma.employeeTraining.findMany({
      where: { employeeId: employee.id },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            description: true,
            format: true,
            durationHours: true,
            providerName: true,
            thumbnailUrl: true,
            category: true,
            location: true,
            dateSchedule: true,
            linkUrl: true,
          },
        },
        validatedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      assigned: sessions.filter((s) =>
        ['PLANNED', 'APPROVED'].includes(s.status),
      ),
      inProgress: sessions.filter((s) => s.status === 'IN_PROGRESS'),
      completionRequested: sessions.filter(
        (s) => s.status === 'COMPLETION_REQUESTED',
      ),
      completed: sessions.filter((s) => s.status === 'COMPLETED'),
      requested: sessions.filter((s) => s.status === 'REQUESTED'),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. PASSEPORT COMPÉTENCES — pour le profil
  // ══════════════════════════════════════════════════════════════════════════
  async getPasseport(targetEmployeeId: string, userId: string) {
    const user = await this.getUser(userId);
    const isRH = RH_ROLES.includes(user.role);
    const isManager = user.role === 'MANAGER';

    if (!isRH && !isManager) {
      const emp = await this.getEmployee(userId, user.companyId);
      if (!emp || emp.id !== targetEmployeeId)
        throw new ForbiddenException('Accès non autorisé.');
    }

    if (isManager) {
      const deptId = await this.getManagerDeptId(userId, user.companyId);
      const targetEmp = await this.prisma.employee.findUnique({
        where: { id: targetEmployeeId },
        select: { departmentId: true, companyId: true },
      });
      if (!targetEmp || targetEmp.companyId !== user.companyId)
        throw new NotFoundException('Employé introuvable.');
      if (deptId && targetEmp.departmentId !== deptId)
        throw new ForbiddenException(
          "Cet employé n'est pas dans votre département.",
        );
    }

    const sessions = await this.prisma.employeeTraining.findMany({
      where: { employeeId: targetEmployeeId, status: 'COMPLETED' },
      include: {
        course: {
          select: {
            title: true,
            category: true,
            durationHours: true,
            providerName: true,
            format: true,
          },
        },
        validatedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { validatedAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      courseTitle: s.course.title,
      category: s.course.category,
      durationHours: s.course.durationHours,
      providerName: s.course.providerName,
      format: s.course.format,
      mention: s.mention ? (MENTION_LABELS[s.mention] ?? s.mention) : null,
      mentionRaw: s.mention,
      validationNote: s.validationNote,
      validatedBy: s.validatedBy
        ? `${s.validatedBy.firstName} ${s.validatedBy.lastName}`
        : null,
      validatedAt: s.validatedAt,
      certificateUrl: s.certificateUrl,
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 11. DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════
  async getDashboard(userId: string) {
    const user = await this.getUser(userId);
    if (!RH_ROLES.includes(user.role) && user.role !== 'MANAGER')
      throw new ForbiddenException('Accès non autorisé.');

    let managerDeptId: string | null = null;
    if (user.role === 'MANAGER')
      managerDeptId = await this.getManagerDeptId(userId, user.companyId);

    const deptFilter = managerDeptId
      ? { employee: { departmentId: managerDeptId } }
      : {};
    const deptWhere = managerDeptId
      ? { companyId: user.companyId, id: managerDeptId }
      : { companyId: user.companyId };

    const [
      totalCourses,
      totalEnrolled,
      totalCompleted,
      pendingRequests,
      departments,
    ] = await Promise.all([
      this.prisma.trainingCourse.count({
        where: { companyId: user.companyId },
      }),
      this.prisma.employeeTraining.count({
        where: {
          course: { companyId: user.companyId },
          status: {
            in: ['IN_PROGRESS', 'APPROVED', 'PLANNED', 'COMPLETION_REQUESTED'],
          },
          ...deptFilter,
        },
      }),
      this.prisma.employeeTraining.count({
        where: {
          course: { companyId: user.companyId },
          status: 'COMPLETED',
          ...deptFilter,
        },
      }),
      this.prisma.employeeTraining.count({
        where: {
          course: { companyId: user.companyId },
          status: { in: ['REQUESTED', 'COMPLETION_REQUESTED'] },
          ...deptFilter,
        },
      }),
      this.prisma.department.findMany({
        where: deptWhere,
        select: {
          id: true,
          name: true,
          color: true,
          trainingBudget: true,
          _count: { select: { employees: true } },
          employees: {
            where: { status: 'ACTIVE' },
            select: {
              trainings: {
                select: { status: true, course: { select: { cost: true } } },
              },
            },
          },
        },
      }),
    ]);

    let totalBudget = 0,
      totalConsumed = 0;
    const deptBudgets = departments.map((dept: any) => {
      const allocated = Number(dept.trainingBudget ?? 0);
      let consumed = 0,
        completed = 0;
      dept.employees.forEach((emp: any) => {
        emp.trainings
          .filter((t: any) =>
            [
              'APPROVED',
              'PLANNED',
              'IN_PROGRESS',
              'COMPLETION_REQUESTED',
              'COMPLETED',
            ].includes(t.status),
          )
          .forEach((t: any) => {
            consumed += Number(t.course?.cost ?? 0);
          });
        completed += emp.trainings.filter(
          (t: any) => t.status === 'COMPLETED',
        ).length;
      });
      totalBudget += allocated;
      totalConsumed += consumed;
      return {
        departmentId: dept.id,
        name: dept.name,
        color: dept.color ?? '#0ea5e9',
        allocated,
        consumed,
        employeeCount: dept._count.employees,
        completedTrainings: completed,
        progressPct:
          allocated > 0 ? Math.round((consumed / allocated) * 100) : 0,
      };
    });

    const total = totalEnrolled + totalCompleted;
    const completionRate =
      total > 0 ? Math.round((totalCompleted / total) * 100) : 0;
    const certifiedEmployees = await this.prisma.employeeTraining
      .groupBy({
        by: ['employeeId'],
        where: {
          course: { companyId: user.companyId },
          status: 'COMPLETED',
          ...deptFilter,
        },
      })
      .then((r) => r.length);

    return {
      totalCourses,
      activeTrainings: totalEnrolled,
      pendingRequests,
      completionRate,
      certifiedEmployees,
      totalBudget,
      consumed: totalConsumed,
      deptBudgets,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 12. PFA
  // ══════════════════════════════════════════════════════════════════════════
  async getPfa(userId: string) {
    const user = await this.getUser(userId);
    if (!RH_ROLES.includes(user.role))
      throw new ForbiddenException('Accès réservé au RH.');

    const year = new Date().getFullYear();
    const departments = await this.prisma.department.findMany({
      where: { companyId: user.companyId },
      select: {
        id: true,
        name: true,
        color: true,
        trainingBudget: true,
        _count: { select: { employees: true } },
        employees: {
          where: { status: 'ACTIVE' },
          select: {
            trainings: {
              where: {
                createdAt: {
                  gte: new Date(`${year}-01-01`),
                  lte: new Date(`${year}-12-31`),
                },
              },
              select: { status: true, course: { select: { cost: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const result = departments.map((dept: any) => {
      const allocated = Number(dept.trainingBudget ?? 0);
      let consumed = 0,
        completed = 0,
        inProgress = 0;
      dept.employees.forEach((emp: any) => {
        emp.trainings.forEach((t: any) => {
          if (
            [
              'APPROVED',
              'PLANNED',
              'IN_PROGRESS',
              'COMPLETION_REQUESTED',
              'COMPLETED',
            ].includes(t.status)
          )
            consumed += Number(t.course?.cost ?? 0);
          if (t.status === 'COMPLETED') completed++;
          if (t.status === 'IN_PROGRESS') inProgress++;
        });
      });
      return {
        departmentId: dept.id,
        name: dept.name,
        color: dept.color ?? '#0ea5e9',
        allocated,
        consumed,
        remaining: Math.max(0, allocated - consumed),
        employeeCount: dept._count.employees,
        completedTrainings: completed,
        inProgressTrainings: inProgress,
        progressPct:
          allocated > 0 ? Math.round((consumed / allocated) * 100) : 0,
      };
    });

    const totalAllocated = result.reduce(
      (s: number, d: any) => s + d.allocated,
      0,
    );
    const totalConsumed = result.reduce(
      (s: number, d: any) => s + d.consumed,
      0,
    );
    const totalTrainings = await this.prisma.employeeTraining.count({
      where: {
        course: { companyId: user.companyId },
        createdAt: {
          gte: new Date(`${year}-01-01`),
          lte: new Date(`${year}-12-31`),
        },
      },
    });

    return {
      year,
      totalAllocated,
      totalConsumed,
      totalRemaining: Math.max(0, totalAllocated - totalConsumed),
      globalProgress:
        totalAllocated > 0
          ? Math.round((totalConsumed / totalAllocated) * 100)
          : 0,
      totalTrainings,
      departments: result,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 13. BUDGET DÉPARTEMENT
  // ══════════════════════════════════════════════════════════════════════════
  async updateDeptBudget(deptId: string, dto: UpdatePfaDto, userId: string) {
    const user = await this.getUser(userId);
    if (!RH_ROLES.includes(user.role))
      throw new ForbiddenException('Accès réservé au RH.');
    const dept = await this.prisma.department.findUnique({
      where: { id: deptId },
      select: { companyId: true },
    });
    if (!dept || dept.companyId !== user.companyId)
      throw new NotFoundException('Département introuvable.');
    return this.prisma.department.update({
      where: { id: deptId },
      data: { trainingBudget: dto.trainingBudget },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 14. ASSIGNER
  // ══════════════════════════════════════════════════════════════════════════
  async assignCourse(courseId: string, employeeId: string, userId: string) {
    const user = await this.getUser(userId);
    const isRH = RH_ROLES.includes(user.role);
    const isManager = user.role === 'MANAGER';
    if (!isRH && !isManager)
      throw new ForbiddenException('Accès non autorisé.');

    const [course, employee] = await Promise.all([
      this.prisma.trainingCourse.findUnique({
        where: { id: courseId },
        select: { companyId: true, title: true },
      }),
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: {
          id: true,
          companyId: true,
          firstName: true,
          lastName: true,
          departmentId: true,
        },
      }),
    ]);

    if (!course || course.companyId !== user.companyId)
      throw new NotFoundException('Formation introuvable.');
    if (!employee || employee.companyId !== user.companyId)
      throw new NotFoundException('Employé introuvable.');

    if (isManager) {
      const deptId = await this.getManagerDeptId(userId, user.companyId);
      if (deptId && employee.departmentId !== deptId)
        throw new ForbiddenException(
          "Vous ne pouvez assigner qu'aux membres de votre département.",
        );
    }

    const existing = await this.prisma.employeeTraining.findFirst({
      where: {
        employeeId,
        courseId,
        status: {
          in: [
            'REQUESTED',
            'APPROVED',
            'PLANNED',
            'IN_PROGRESS',
            'COMPLETION_REQUESTED',
          ],
        },
      },
    });
    if (existing)
      throw new BadRequestException('Cet employé est déjà inscrit.');

    const session = await this.prisma.employeeTraining.create({
      data: {
        employeeId,
        courseId,
        status: 'PLANNED',
        startDate: new Date(),
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNote: 'Assigné par responsable',
      },
    });

    this.gateway.sendCompanyNotification({
      type: 'INFO',
      title: '📚 Formation assignée',
      message: `"${course.title}" assignée à ${employee.firstName} ${employee.lastName}`,
      time: new Date().toLocaleTimeString(),
      link: '/formation',
    });
    return session;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VÉRIFICATION PUBLIQUE DE CERTIFICAT — sans JWT
  // ══════════════════════════════════════════════════════════════════════════
  async verifyCertificate(ref: string) {
    const session = await this.prisma.employeeTraining.findFirst({
      where: { certificateRef: ref, status: 'COMPLETED' },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            companyId: true,
            department: { select: { name: true } },
          },
        },
        course: {
          select: {
            title: true,
            durationHours: true,
            providerName: true,
            format: true,
          },
        },
        validatedBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!session) {
      return { valid: false, message: 'Certificat introuvable ou invalide.' };
    }

    // Récupérer le nom et logo de l'entreprise via companyId
    const company = await this.prisma.company.findUnique({
      where: { id: session.employee.companyId },
      select: { legalName: true, logo: true },
    });

    const MENTION_LABELS: Record<string, string> = {
      SATISFAISANT: 'Satisfaisant',
      BIEN: 'Bien',
      TRES_BIEN: 'Très Bien',
      EXCELLENT: 'Excellent',
    };

    return {
      valid: true,
      ref,
      employeeName: `${session.employee.firstName} ${session.employee.lastName}`,
      position: session.employee.position,
      department: session.employee.department?.name,
      company: company?.legalName,
      companyLogo: company?.logo,
      courseTitle: session.course.title,
      durationHours: session.course.durationHours,
      providerName: session.course.providerName,
      format: session.course.format,
      mention: session.mention
        ? (MENTION_LABELS[session.mention] ?? session.mention)
        : null,
      validationNote: session.validationNote,
      validatedBy: session.validatedBy
        ? `${session.validatedBy.firstName} ${session.validatedBy.lastName}`
        : null,
      validatedAt: session.validatedAt,
      verifiedAt: new Date().toISOString(),
    };
  }
}
