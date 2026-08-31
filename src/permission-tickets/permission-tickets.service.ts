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
  EmployeeNotFoundException,
  CompanyNotFoundException,
} from '../exceptions/business.exceptions';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

const HR_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];
const APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER', 'MANAGER'];
const FULL_AUTHORITY_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

@Injectable()
export class PermissionTicketsService {
  private readonly logger = new Logger(PermissionTicketsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
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

  // ============================================================================
  // 📝 CRÉER UN TICKET
  // ============================================================================

  async create(dto: CreatePermissionTicketDto, userId: string) {
    const user = await this.getUserWithCompany(userId);
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

    const updated = await this.prisma.permissionTicket.update({
      where: { id },
      data: {
        status,
        reviewedBy: userId,
        reviewedAt: new Date(),
        rejectionReason: status === 'REJECTED' ? rejectionReason : undefined,
      },
    });

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
  // 🔙 MARQUER LE RETOUR
  // ============================================================================

  async markReturn(id: string, userId: string) {
    const user = await this.getUserWithCompany(userId);
    const ticket = await this.prisma.permissionTicket.findUnique({
      where: { id },
    });

    if (!ticket) throw new NotFoundException('Ticket introuvable');
    if (ticket.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (ticket.status !== 'APPROVED')
      throw new BadRequestException(
        'Seul un ticket approuvé peut être clôturé',
      );
    if (ticket.actualReturnTime)
      throw new BadRequestException('Le retour a déjà été enregistré');

    return this.prisma.permissionTicket.update({
      where: { id },
      data: { actualReturnTime: new Date() },
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

    return this.prisma.permissionTicket.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }
}
