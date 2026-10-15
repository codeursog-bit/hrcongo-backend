// ============================================================================
// 📁 src/permission-tickets/permission-tickets.service.ts
// ✅ Workflow "Permission de sortie" : urgence personnelle en cours de
//    journée OU mission d'entreprise à l'extérieur. Même architecture que
//    AbsenceRequestsService, avec une particularité : quand un RH/Admin crée
//    le ticket lui-même (pour lui ou pour un employé), il est auto-approuvé
//    — c'est déjà une décision d'autorité, pas une demande à valider.
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePermissionTicketDto } from './dto/create-permission-ticket.dto';
import {
  ConfirmReturnDto,
  RejectReturnDto,
  UpdateTimesDto,
} from './dto/permission-return.dto';
import {
  EmployeeNotFoundException,
  CompanyNotFoundException,
} from '../exceptions/business.exceptions';
import { PermissionEventType, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';

const HR_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];
const APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER', 'MANAGER'];
const FULL_AUTHORITY_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

@Injectable()
export class PermissionTicketsService {
  private readonly logger = new Logger(PermissionTicketsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  private async getUserWithCompany(userId: string): Promise<{
    id: string;
    companyId: string;
    role: string;
    email: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, email: true },
    });
    if (!user || !user.companyId) throw new CompanyNotFoundException();
    return { ...user, companyId: user.companyId };
  }

  private async getManagerDepartmentId(
    userId: string,
    companyId: string,
  ): Promise<string | null> {
    const dept = await this.prisma.department.findFirst({
      where: { managerId: userId, companyId },
      select: { id: true },
    });
    if (dept) return dept.id;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user?.email) {
      const emp = await this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
        select: { departmentId: true },
      });
      return emp?.departmentId ?? null;
    }
    return null;
  }

  private typeLabel(type: string): string {
    return type === 'URGENCE'
      ? 'Urgence'
      : type === 'MISSION'
        ? 'Mission d\u2019entreprise'
        : 'Autre';
  }

  private fmtTime(d: Date): string {
    // Heure de Brazzaville (UTC+1) — le serveur peut tourner dans un autre fuseau
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Brazzaville',
    });
  }

  /** Utilisateur (compte) rattaché à la fiche employé — pour le notifier */
  private async findEmployeeUserId(
    email: string | null,
    companyId: string,
  ): Promise<string | null> {
    if (!email) return null;
    const u = await this.prisma.user.findFirst({
      where: { email, companyId },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  private isOwner(userEmail: string | null, employeeEmail: string | null) {
    return (
      !!userEmail &&
      !!employeeEmail &&
      userEmail.trim().toLowerCase() === employeeEmail.trim().toLowerCase()
    );
  }

  private parseDate(value: string, label: string): Date {
    const d = new Date(value);
    if (isNaN(d.getTime()))
      throw new BadRequestException(`${label} : date invalide`);
    return d;
  }

  /** Une heure « effective » ne peut pas être dans le futur (tolérance 2 min) */
  private assertNotFuture(d: Date, label: string) {
    if (d.getTime() > Date.now() + 2 * 60 * 1000)
      throw new BadRequestException(`${label} ne peut pas être dans le futur`);
  }

  // ============================================================================
  // 📝 CRÉER UN TICKET
  // ============================================================================

  async create(dto: CreatePermissionTicketDto, userId: string) {
    const user = await this.getUserWithCompany(userId);
    await this.subscriptionGuard.assertActionAllowed(user.companyId, user.role);
    const isApprover = APPROVER_ROLES.includes(user.role);

    let targetEmployee;
    if (dto.employeeId && isApprover) {
      // Création "pour le compte de" — réservée aux RH/Admin/Manager
      targetEmployee = await this.prisma.employee.findFirst({
        where: { id: dto.employeeId, companyId: user.companyId },
        select: {
          id: true,
          companyId: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          departmentId: true,
          department: { select: { managerId: true } },
        },
      });
    } else {
      targetEmployee = await this.prisma.employee.findFirst({
        where: { email: user.email ?? undefined, companyId: user.companyId },
        select: {
          id: true,
          companyId: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          departmentId: true,
          department: { select: { managerId: true } },
        },
      });
    }

    if (!targetEmployee) throw new EmployeeNotFoundException();
    if (targetEmployee.status !== 'ACTIVE')
      throw new BadRequestException("Ce dossier employé n'est pas actif");

    const departure = new Date(dto.departureTime);
    const expectedReturn = new Date(dto.expectedReturnTime);
    if (expectedReturn <= departure) {
      throw new BadRequestException(
        "L'heure de retour prévue doit être après l'heure de sortie",
      );
    }

    const isOnBehalf = !!(dto.employeeId && isApprover);
    const autoApprove = isOnBehalf || FULL_AUTHORITY_ROLES.includes(user.role);

    const ticket = await this.prisma.permissionTicket.create({
      data: {
        employeeId: targetEmployee.id,
        companyId: targetEmployee.companyId,
        createdByUserId: userId,
        type: dto.type,
        missionType: dto.type === 'MISSION' ? dto.missionType : undefined,
        reason: dto.reason,
        destination: dto.destination,
        departureTime: departure,
        expectedReturnTime: expectedReturn,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        reviewedBy: autoApprove ? userId : undefined,
        reviewedAt: autoApprove ? new Date() : undefined,
        events: {
          create: [
            {
              type: PermissionEventType.CREATED,
              actorUserId: userId,
              actorRole: user.role,
              note: isOnBehalf
                ? 'Ticket créé par l’administration pour le compte de l’employé'
                : undefined,
            },
            ...(autoApprove
              ? [
                  {
                    type: PermissionEventType.APPROVED,
                    actorUserId: userId,
                    actorRole: user.role,
                    note: 'Autorisation automatique (créé par l’administration)',
                  },
                ]
              : []),
          ],
        },
      },
    });

    if (autoApprove) {
      // Ticket directement autorisé — on informe simplement l'employé si ce n'est pas lui qui a créé le ticket
      if (isOnBehalf) {
        const employeeUser = await this.prisma.user.findFirst({
          where: {
            email: targetEmployee.email,
            companyId: targetEmployee.companyId,
          },
          select: { id: true },
        });
        if (employeeUser) {
          await this.notificationsService.create({
            userId: employeeUser.id,
            type: 'PERMISSION_APPROVED',
            title: '🎫 Ticket de permission créé',
            message: `Un ticket de sortie (${this.typeLabel(dto.type)}) a été créé pour vous, départ prévu à ${departure.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
            link: '/presences/permissions/mon-espace',
            metadata: { ticketId: ticket.id },
          });
        }
      }
    } else {
      // Demande employé — à valider
      await this.notificationsService.createForGroup(
        targetEmployee.companyId,
        HR_ROLES,
        {
          type: 'PERMISSION_REQUEST',
          title: '🎫 Nouvelle demande de permission',
          message: `${targetEmployee.firstName} ${targetEmployee.lastName} demande une permission de sortie (${this.typeLabel(dto.type)}) — départ souhaité ${departure.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
          link: '/presences/permissions',
          metadata: { ticketId: ticket.id, employeeId: targetEmployee.id },
        },
      );

      if (targetEmployee.department?.managerId) {
        await this.notificationsService.create({
          userId: targetEmployee.department.managerId,
          type: 'PERMISSION_REQUEST',
          title: '🎫 Nouvelle demande de permission',
          message: `${targetEmployee.firstName} ${targetEmployee.lastName} demande une permission de sortie`,
          link: '/presences/permissions',
          metadata: { ticketId: ticket.id, employeeId: targetEmployee.id },
        });
      }
    }

    return ticket;
  }

  // ============================================================================
  // 📋 LISTE (RH / Manager / Admin)
  // ============================================================================

  async findAll(userId: string, status?: string) {
    const user = await this.getUserWithCompany(userId);
    const whereClause: any = { companyId: user.companyId };

    if (user.role === 'MANAGER') {
      const deptId = await this.getManagerDepartmentId(userId, user.companyId);
      if (!deptId) return [];
      whereClause.employee = { departmentId: deptId };
    }
    if (status) whereClause.status = status;

    return this.prisma.permissionTicket.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            photoUrl: true,
            employeeNumber: true,
            department: { select: { name: true } },
          },
        },
        reviewedByUser: { select: { id: true, email: true } },
        returnConfirmedByUser: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        createdByUser: { select: { id: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMine(userId: string) {
    const user = await this.getUserWithCompany(userId);
    const employee = await this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
    });
    if (!employee) throw new EmployeeNotFoundException();

    return this.prisma.permissionTicket.findMany({
      where: { employeeId: employee.id, companyId: user.companyId },
      include: {
        reviewedByUser: { select: { id: true, email: true } },
        returnConfirmedByUser: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const user = await this.getUserWithCompany(userId);
    const ticket = await this.prisma.permissionTicket.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            employeeNumber: true,
            department: { select: { name: true } },
          },
        },
        company: {
          select: {
            legalName: true,
            tradeName: true,
            logo: true,
            rccmNumber: true,
            taxNumber: true,
            address: true,
            phone: true,
          },
        },
        reviewedByUser: { select: { email: true } },
        returnConfirmedByUser: {
          select: { email: true, firstName: true, lastName: true },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');
    if (ticket.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    return ticket;
  }

  // ============================================================================
  // ✅ APPROUVER / REJETER
  // ============================================================================

  async updateStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    userId: string,
    rejectionReason?: string,
  ) {
    const user = await this.getUserWithCompany(userId);
    const ticket = await this.prisma.permissionTicket.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            departmentId: true,
          },
        },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket introuvable');
    if (ticket.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (!APPROVER_ROLES.includes(user.role))
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour approuver/refuser",
      );

    if (user.role === 'MANAGER') {
      const deptId = await this.getManagerDepartmentId(userId, user.companyId);
      if (!deptId || ticket.employee.departmentId !== deptId) {
        throw new ForbiddenException(
          'Vous ne pouvez traiter que les tickets de votre département',
        );
      }
    }

    if (ticket.status !== 'PENDING')
      throw new BadRequestException('Ce ticket a déjà été traité');
    if (status === 'REJECTED' && !rejectionReason?.trim())
      throw new BadRequestException('Un motif de refus est requis');

    const [updated] = await this.prisma.$transaction([
      this.prisma.permissionTicket.update({
        where: { id },
        data: {
          status,
          reviewedBy: userId,
          reviewedAt: new Date(),
          rejectionReason: status === 'REJECTED' ? rejectionReason : undefined,
        },
      }),
      this.prisma.permissionTicketEvent.create({
        data: {
          ticketId: id,
          type:
            status === 'APPROVED'
              ? PermissionEventType.APPROVED
              : PermissionEventType.REJECTED,
          actorUserId: userId,
          actorRole: user.role,
          note: status === 'REJECTED' ? rejectionReason?.trim() : undefined,
        },
      }),
    ]);

    const employeeUser = await this.prisma.user.findFirst({
      where: { email: ticket.employee.email, companyId: ticket.companyId },
      select: { id: true },
    });
    if (employeeUser) {
      await this.notificationsService.create({
        userId: employeeUser.id,
        type:
          status === 'APPROVED' ? 'PERMISSION_APPROVED' : 'PERMISSION_REJECTED',
        title:
          status === 'APPROVED'
            ? '✅ Permission accordée'
            : '❌ Permission refusée',
        message:
          status === 'APPROVED'
            ? `Votre permission de sortie a été accordée — le ticket est disponible dans votre espace`
            : `Votre demande de permission a été refusée${rejectionReason ? ` : ${rejectionReason}` : ''}`,
        link: '/presences/permissions/mon-espace',
        metadata: { ticketId: ticket.id, status },
      });
    }

    return updated;
  }

  // ============================================================================
  // 🔙 RETOUR — l'employé DÉCLARE, l'admin / RH VALIDE
  // ----------------------------------------------------------------------------
  //  • returnDeclaredAt  = heure du clic « Je suis de retour » (déclaratif)
  //  • actualReturnTime  = heure de retour VALIDÉE par l'administration
  //  • actualDepartureTime = sortie effective, uniquement si elle a été corrigée
  //    (sinon departureTime fait foi)
  // Chaque étape écrit un événement (PermissionTicketEvent) dans la même
  // transaction que la modification : pas de changement d'heure sans trace.
  // ============================================================================

  private readonly returnInclude = {
    returnConfirmedByUser: {
      select: { id: true, email: true, firstName: true, lastName: true },
    },
  };

  private assertHr(role: string) {
    if (!HR_ROLES.includes(role))
      throw new ForbiddenException(
        'Seuls les administrateurs et les RH peuvent valider ou corriger un retour.',
      );
  }

  private async loadTicketWithEmployee(id: string, companyId: string) {
    const ticket = await this.prisma.permissionTicket.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');
    if (ticket.companyId !== companyId)
      throw new ForbiddenException('Accès refusé');
    return ticket;
  }

  /**
   * Clic sur « Je suis de retour ».
   *  - Employé : l'heure est notée, le retour passe « en attente de validation »
   *    et les admins + RH sont notifiés. Rien n'est validé tant qu'ils n'ont pas confirmé.
   *  - Admin / RH : ils sont eux-mêmes l'autorité de validation (comme pour la
   *    création d'un ticket) → le retour est enregistré et confirmé directement.
   */
  async markReturn(id: string, userId: string) {
    const user = await this.getUserWithCompany(userId);
    const ticket = await this.loadTicketWithEmployee(id, user.companyId);

    if (ticket.status !== 'APPROVED')
      throw new BadRequestException(
        'Seul un ticket approuvé peut être clôturé',
      );
    if (ticket.actualReturnTime || ticket.returnStatus === 'CONFIRMED')
      throw new BadRequestException('Le retour a déjà été validé');
    if (ticket.returnStatus === 'PENDING_VALIDATION')
      throw new BadRequestException(
        'Le retour est déjà déclaré, en attente de validation',
      );

    const isHr = HR_ROLES.includes(user.role);
    const owner = this.isOwner(user.email, ticket.employee.email);
    if (!isHr && !owner)
      throw new ForbiddenException(
        "Seul l'employé concerné ou l'administration peut déclarer ce retour",
      );

    const now = new Date();
    const effectiveDeparture = ticket.actualDepartureTime ?? ticket.departureTime;
    if (now < effectiveDeparture)
      throw new BadRequestException(
        "Le retour ne peut pas être enregistré avant l'heure de sortie",
      );

    const who = `${ticket.employee.firstName} ${ticket.employee.lastName}`;

    // ── Admin / RH : enregistrement direct, déjà validé
    if (isHr) {
      const [updated] = await this.prisma.$transaction([
        this.prisma.permissionTicket.update({
          where: { id },
          data: {
            returnDeclaredAt: now,
            actualReturnTime: now,
            returnStatus: 'CONFIRMED',
            returnConfirmedBy: userId,
            returnConfirmedAt: now,
          },
          include: this.returnInclude,
        }),
        this.prisma.permissionTicketEvent.create({
          data: {
            ticketId: id,
            type: PermissionEventType.RETURN_CONFIRMED,
            actorUserId: userId,
            actorRole: user.role,
            note: 'Retour enregistré directement par l’administration',
            data: {
              direct: true,
              returnTime: now.toISOString(),
              departureTime: effectiveDeparture.toISOString(),
            },
          },
        }),
      ]);

      if (!owner) {
        const employeeUserId = await this.findEmployeeUserId(
          ticket.employee.email,
          ticket.companyId,
        );
        if (employeeUserId) {
          await this.notificationsService.create({
            userId: employeeUserId,
            type: 'PERMISSION_RETURN_CONFIRMED',
            title: '✅ Retour enregistré',
            message: `Votre retour a été enregistré : sorti de ${this.fmtTime(effectiveDeparture)} à ${this.fmtTime(now)}`,
            link: '/presences/permissions/mon-espace',
            metadata: { ticketId: id },
          });
        }
      }
      return updated;
    }

    // ── Employé : déclaration, à valider par l'administration
    const [updated] = await this.prisma.$transaction([
      this.prisma.permissionTicket.update({
        where: { id },
        data: { returnDeclaredAt: now, returnStatus: 'PENDING_VALIDATION' },
        include: this.returnInclude,
      }),
      this.prisma.permissionTicketEvent.create({
        data: {
          ticketId: id,
          type: PermissionEventType.RETURN_DECLARED,
          actorUserId: userId,
          actorRole: user.role,
          data: { declaredAt: now.toISOString() },
        },
      }),
    ]);

    // 🔔 Admins + RH managers (seuls habilités à valider)
    await this.notificationsService.createForGroup(
      ticket.companyId,
      HR_ROLES,
      {
        type: 'PERMISSION_RETURN_REQUEST',
        title: '🔙 Retour de permission à valider',
        message: `${who} indique être de retour à ${this.fmtTime(now)} (sortie ${this.fmtTime(effectiveDeparture)}, retour prévu ${this.fmtTime(ticket.expectedReturnTime)}) — à valider`,
        link: `/presences/permissions?ticket=${id}`,
        metadata: { ticketId: id, employeeId: ticket.employee.id },
      },
    );

    return updated;
  }

  /** ✅ Confirmer le retour déclaré — Admin / RH. Les heures peuvent être ajustées au passage (motif obligatoire). */
  async confirmReturn(id: string, dto: ConfirmReturnDto, userId: string) {
    const user = await this.getUserWithCompany(userId);
    this.assertHr(user.role);
    const ticket = await this.loadTicketWithEmployee(id, user.companyId);

    if (ticket.status !== 'APPROVED')
      throw new BadRequestException('Ce ticket n’est pas approuvé');
    if (ticket.returnStatus !== 'PENDING_VALIDATION' || !ticket.returnDeclaredAt)
      throw new BadRequestException(
        'Aucun retour en attente de validation pour ce ticket',
      );

    const declared = ticket.returnDeclaredAt;
    const currentDeparture = ticket.actualDepartureTime ?? ticket.departureTime;
    const returnTime = dto.actualReturnTime
      ? this.parseDate(dto.actualReturnTime, 'Heure de retour')
      : declared;
    const departure = dto.actualDepartureTime
      ? this.parseDate(dto.actualDepartureTime, 'Heure de sortie')
      : currentDeparture;

    this.assertNotFuture(returnTime, "L'heure de retour");
    if (dto.actualDepartureTime)
      this.assertNotFuture(departure, "L'heure de sortie");
    if (returnTime <= departure)
      throw new BadRequestException(
        "L'heure de retour doit être après l'heure de sortie",
      );

    const returnAdjusted =
      Math.abs(returnTime.getTime() - declared.getTime()) >= 60_000;
    const departureAdjusted =
      !!dto.actualDepartureTime &&
      departure.getTime() !== currentDeparture.getTime();
    const adjusted = returnAdjusted || departureAdjusted;
    if (adjusted && !dto.note?.trim())
      throw new BadRequestException(
        'Un motif est requis quand les heures diffèrent de la déclaration de l’employé',
      );

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.permissionTicket.update({
        where: { id },
        data: {
          actualReturnTime: returnTime,
          actualDepartureTime: departureAdjusted ? departure : undefined,
          returnStatus: 'CONFIRMED',
          returnConfirmedBy: userId,
          returnConfirmedAt: now,
          timesAdjusted: adjusted ? true : undefined,
        },
        include: this.returnInclude,
      }),
      this.prisma.permissionTicketEvent.create({
        data: {
          ticketId: id,
          type: PermissionEventType.RETURN_CONFIRMED,
          actorUserId: userId,
          actorRole: user.role,
          note: dto.note?.trim() || undefined,
          data: {
            declaredAt: declared.toISOString(),
            returnTime: returnTime.toISOString(),
            departureTime: departure.toISOString(),
            adjusted,
          },
        },
      }),
    ]);

    const employeeUserId = await this.findEmployeeUserId(
      ticket.employee.email,
      ticket.companyId,
    );
    if (employeeUserId) {
      await this.notificationsService.create({
        userId: employeeUserId,
        type: 'PERMISSION_RETURN_CONFIRMED',
        title: '✅ Retour validé',
        message: `Votre retour a été validé : sorti de ${this.fmtTime(departure)} à ${this.fmtTime(returnTime)}${adjusted ? ' (heures ajustées par l’administration)' : ''}`,
        link: '/presences/permissions/mon-espace',
        metadata: { ticketId: id },
      });
    }
    return updated;
  }

  /** ❌ Retour non validé (déclaré par erreur, incohérent…) — le ticket repasse « pas encore revenu » */
  async rejectReturn(id: string, dto: RejectReturnDto, userId: string) {
    const user = await this.getUserWithCompany(userId);
    this.assertHr(user.role);
    const ticket = await this.loadTicketWithEmployee(id, user.companyId);

    if (ticket.returnStatus !== 'PENDING_VALIDATION')
      throw new BadRequestException(
        'Aucun retour en attente de validation pour ce ticket',
      );
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('Un motif est requis');

    const [updated] = await this.prisma.$transaction([
      this.prisma.permissionTicket.update({
        where: { id },
        data: { returnStatus: 'NOT_RETURNED', returnDeclaredAt: null },
        include: this.returnInclude,
      }),
      this.prisma.permissionTicketEvent.create({
        data: {
          ticketId: id,
          type: PermissionEventType.RETURN_REJECTED,
          actorUserId: userId,
          actorRole: user.role,
          note: reason,
          data: { declaredAt: ticket.returnDeclaredAt?.toISOString() ?? null },
        },
      }),
    ]);

    const employeeUserId = await this.findEmployeeUserId(
      ticket.employee.email,
      ticket.companyId,
    );
    if (employeeUserId) {
      await this.notificationsService.create({
        userId: employeeUserId,
        type: 'PERMISSION_RETURN_REJECTED',
        title: '⚠️ Retour non validé',
        message: `Votre déclaration de retour n’a pas été validée : ${reason}. Vous pouvez la refaire quand vous êtes de retour.`,
        link: '/presences/permissions/mon-espace',
        metadata: { ticketId: id },
      });
    }
    return updated;
  }

  /** ✏️ Corriger les heures de sortie / retour (imprévus) — Admin / RH, motif obligatoire, tout est tracé */
  async updateTimes(id: string, dto: UpdateTimesDto, userId: string) {
    const user = await this.getUserWithCompany(userId);
    this.assertHr(user.role);
    const ticket = await this.loadTicketWithEmployee(id, user.companyId);

    if (ticket.status !== 'APPROVED')
      throw new BadRequestException(
        'Seules les heures d’un ticket approuvé peuvent être corrigées',
      );
    if (!dto.actualDepartureTime && !dto.actualReturnTime)
      throw new BadRequestException('Renseignez au moins une heure à corriger');
    const reason = dto.reason?.trim();
    if (!reason)
      throw new BadRequestException('Un motif de correction est requis');

    const currentDeparture = ticket.actualDepartureTime ?? ticket.departureTime;
    const currentReturn = ticket.actualReturnTime;
    const newDeparture = dto.actualDepartureTime
      ? this.parseDate(dto.actualDepartureTime, 'Heure de sortie')
      : currentDeparture;
    const newReturn = dto.actualReturnTime
      ? this.parseDate(dto.actualReturnTime, 'Heure de retour')
      : currentReturn;

    if (dto.actualDepartureTime)
      this.assertNotFuture(newDeparture, "L'heure de sortie");
    if (dto.actualReturnTime && newReturn)
      this.assertNotFuture(newReturn, "L'heure de retour");
    if (newReturn && newReturn <= newDeparture)
      throw new BadRequestException(
        "L'heure de retour doit être après l'heure de sortie",
      );

    const departureChanged =
      !!dto.actualDepartureTime &&
      newDeparture.getTime() !== currentDeparture.getTime();
    const returnChanged =
      !!dto.actualReturnTime &&
      newReturn!.getTime() !== (currentReturn?.getTime() ?? NaN);
    if (!departureChanged && !returnChanged)
      throw new BadRequestException(
        'Aucune modification : les heures saisies sont identiques',
      );

    const now = new Date();
    const data: Prisma.PermissionTicketUncheckedUpdateInput = {
      timesAdjusted: true,
    };
    if (departureChanged) data.actualDepartureTime = newDeparture;
    if (returnChanged) {
      data.actualReturnTime = newReturn;
      // Retour saisi par l'admin/RH alors qu'il n'était pas encore validé → il l'est de fait
      if (ticket.returnStatus !== 'CONFIRMED') {
        data.returnStatus = 'CONFIRMED';
        data.returnConfirmedBy = userId;
        data.returnConfirmedAt = now;
        if (!ticket.returnDeclaredAt) data.returnDeclaredAt = now;
      }
    }

    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    const [updated] = await this.prisma.$transaction([
      this.prisma.permissionTicket.update({
        where: { id },
        data,
        include: this.returnInclude,
      }),
      this.prisma.permissionTicketEvent.create({
        data: {
          ticketId: id,
          type: PermissionEventType.TIMES_EDITED,
          actorUserId: userId,
          actorRole: user.role,
          note: reason,
          data: {
            before: { departure: iso(currentDeparture), return: iso(currentReturn) },
            after: { departure: iso(newDeparture), return: iso(newReturn) },
            returnDeclaredAt: iso(ticket.returnDeclaredAt),
          },
        },
      }),
    ]);

    const employeeUserId = await this.findEmployeeUserId(
      ticket.employee.email,
      ticket.companyId,
    );
    if (employeeUserId) {
      await this.notificationsService.create({
        userId: employeeUserId,
        type: 'PERMISSION_TIMES_EDITED',
        title: '✏️ Heures de permission corrigées',
        message: `Vos heures ont été corrigées : sorti à ${this.fmtTime(newDeparture)}${newReturn ? `, retour à ${this.fmtTime(newReturn)}` : ''}. Motif : ${reason}`,
        link: '/presences/permissions/mon-espace',
        metadata: { ticketId: id },
      });
    }
    return updated;
  }

  // ============================================================================
  // 🧾 HISTORIQUE D'UN TICKET (timeline)
  // ============================================================================

  async findEvents(id: string, userId: string) {
    const user = await this.getUserWithCompany(userId);
    const ticket = await this.prisma.permissionTicket.findUnique({
      where: { id },
      include: { employee: { select: { email: true, departmentId: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');
    if (ticket.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');

    let allowed =
      HR_ROLES.includes(user.role) ||
      this.isOwner(user.email, ticket.employee.email);
    if (!allowed && user.role === 'MANAGER') {
      const deptId = await this.getManagerDepartmentId(userId, user.companyId);
      allowed = !!deptId && ticket.employee.departmentId === deptId;
    }
    if (!allowed) throw new ForbiddenException('Accès refusé');

    return this.prisma.permissionTicketEvent.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        actor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  // ============================================================================
  // ❌ ANNULER (tant que PENDING)
  // ============================================================================

  async cancel(id: string, userId: string) {
    const user = await this.getUserWithCompany(userId);
    const ticket = await this.prisma.permissionTicket.findUnique({
      where: { id },
    });

    if (!ticket) throw new NotFoundException('Ticket introuvable');
    if (ticket.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (ticket.status !== 'PENDING')
      throw new BadRequestException(
        'Seul un ticket en attente peut être annulé',
      );

    const [cancelled] = await this.prisma.$transaction([
      this.prisma.permissionTicket.update({
        where: { id },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.permissionTicketEvent.create({
        data: {
          ticketId: id,
          type: PermissionEventType.CANCELLED,
          actorUserId: userId,
          actorRole: user.role,
        },
      }),
    ]);
    return cancelled;
  }

  // ============================================================================
  // 🗑️ SUPPRIMER (ADMIN / RH) — tous statuts, avec trace d'audit
  // ============================================================================

  async remove(id: string, userId: string) {
    const user = await this.getUserWithCompany(userId);
    // 🔒 Défense en profondeur : le @Roles du contrôleur fait déjà le tri
    if (!HR_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'Seuls les administrateurs et les RH peuvent supprimer un ticket.',
      );
    }

    const ticket = await this.prisma.permissionTicket.findUnique({
      where: { id },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeNumber: true },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');
    if (ticket.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');

    // 🧾 Trace AVANT suppression : une fois le ticket parti, plus rien ne permet de savoir ce qu'il contenait
    await this.prisma.activityLog
      .create({
        data: {
          userId,
          action: 'PERMISSION_TICKET_DELETE',
          entity: 'PERMISSION_TICKET',
          entityId: ticket.id,
          description: `Suppression du ticket de permission de ${ticket.employee?.firstName ?? ''} ${ticket.employee?.lastName ?? ''} (${ticket.employee?.employeeNumber ?? '—'})`,
          metadata: {
            status: ticket.status,
            type: ticket.type,
            missionType: ticket.missionType,
            reason: ticket.reason,
            destination: ticket.destination,
            departureTime: ticket.departureTime,
            expectedReturnTime: ticket.expectedReturnTime,
            actualReturnTime: ticket.actualReturnTime,
            employeeId: ticket.employeeId,
            createdAt: ticket.createdAt,
          },
        },
      })
      .catch((e) =>
        this.logger.warn(`Audit suppression ticket ${id} : ${e?.message}`),
      );

    await this.prisma.permissionTicket.delete({ where: { id } });
    return { success: true, message: 'Ticket supprimé' };
  }
}