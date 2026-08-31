// ============================================================================
// 📁 src/absence-requests/absence-requests.service.ts
// ✅ Workflow "Demande d'autorisation d'absence" (Maladie / Conventionnelle /
//    Exceptionnelle) — distinct des congés annuels (module leaves)
// ✅ Même architecture que LeavesService : getUserWithCompany, department scope
//    pour les MANAGER, notifications RH, historique.
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAbsenceRequestDto, SUBTYPES_BY_ABSENCE_TYPE } from './dto/create-absence-request.dto';
import { EmployeeNotFoundException, CompanyNotFoundException } from '../exceptions/business.exceptions';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveResponsableName } from '../common/resolve-responsable.util';
import * as WorkingDays from '../common/working-days.util';
import {
  fillOrcaWordTemplate, swapCachetImage, fetchImageBuffer,
  getOrcaTemplateFile, ORCA_CACHET_MEDIA_FILE,
} from '../documents/orca-word.util';

const HR_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];
// ✅ Pour l'instant, seuls RH/Admin valident (pas de délégation "chef de
// service" — un manager gère son équipe, pas les validations/l'argent).
// Sera revu quand le système d'autorisations (accès attribués par l'admin)
// sera en place.
const APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

@Injectable()
export class AbsenceRequestsService {
  private readonly logger = new Logger(AbsenceRequestsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================================================
  // 🔒 HELPERS PRIVÉS (identiques au pattern LeavesService)
  // ============================================================================

private async getUserWithCompany(userId: string): Promise<{
  id: string; companyId: string; role: string; email: string | null;
}> {
  const user = await this.prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, companyId: true, role: true, email: true },
  });
  if (!user || !user.companyId) throw new CompanyNotFoundException();
  return { ...user, companyId: user.companyId };
}

  private async getManagerDepartmentId(userId: string, companyId: string): Promise<string | null> {
    const dept = await this.prisma.department.findFirst({
      where:  { managerId: userId, companyId },
      select: { id: true },
    });
    if (dept) return dept.id;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) {
      const emp = await this.prisma.employee.findFirst({
        where:  { email: user.email, companyId },
        select: { departmentId: true },
      });
      return emp?.departmentId ?? null;
    }
    return null;
  }

  /** Jours ouvrables (lundi → samedi, dimanche exclu) entre deux dates incluses. */
  // ✅ countWorkingDays() retiré — délègue désormais à WorkingDays.calculateWorkingDays()
  // (même moteur que le module congé : lun-sam, jours fériés de l'entreprise exclus ;
  // avant, ce module n'excluait que les dimanches, pas les fériés — incohérence corrigée)

  private typeLabel(type: string): string {
    const labels: Record<string, string> = {
      MALADIE: 'Maladie',
      CONVENTIONNELLE: 'Conventionnelle',
      EXCEPTIONNELLE: 'Exceptionnelle',
    };
    return labels[type] ?? type;
  }

  private subTypeLabel(subType?: string | null): string {
    const labels: Record<string, string> = {
      MALADIE: 'Maladie', MATERNITE: 'Maternité', PATERNITE: 'Paternité',
      MARIAGE: 'Mariage', DECES: 'Décès', NAISSANCE: 'Naissance', AUTRE: 'Autre',
    };
    return subType ? (labels[subType] ?? subType) : '';
  }

  async calculateReturnDate(employeeId: string, startDate: Date, workingDaysNeeded: number) {
    const employee = await this.prisma.employee.findUnique({
      where:  { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    return WorkingDays.calculateReturnDate(this.prisma, employee.companyId, startDate, workingDaysNeeded);
  }

  // ============================================================================
  // 📝 CRÉER UNE DEMANDE (depuis l'espace employé)
  // ============================================================================

  async create(dto: CreateAbsenceRequestDto, userId: string) {
    const user = await this.getUserWithCompany(userId);

    let employee: {
      id: string; companyId: string; firstName: string; lastName: string; email: string | null;
      position: string | null; status: string; departmentId: string | null;
      department: { name: string; managerId: string | null } | null;
    } | null;

    if (dto.employeeId) {
      // ✅ RH/Admin créant la demande pour un autre employé (bascule "Pour qui ?").
      // Le champ existait déjà dans le DTO mais n'était encore jamais lu ici —
      // c'est ce qui causait "Employé introuvable" quel que soit l'employé choisi.
      if (!HR_ROLES.includes(user.role)) {
        throw new ForbiddenException("Vous n'êtes pas autorisé à créer une demande pour un autre employé");
      }
      employee = await this.prisma.employee.findFirst({
        where:  { id: dto.employeeId, companyId: user.companyId },
        select: { id: true, companyId: true, firstName: true, lastName: true, email: true, position: true, status: true, departmentId: true, department: { select: { name: true, managerId: true } } },
      });
    } else {
      employee = await this.prisma.employee.findFirst({
        where:  { email: user.email ?? undefined, companyId: user.companyId },
        select: { id: true, companyId: true, firstName: true, lastName: true, email: true, position: true, status: true, departmentId: true, department: { select: { name: true, managerId: true } } },
      });
    }
    if (!employee) throw new EmployeeNotFoundException(dto.employeeId);
    if (employee.status !== 'ACTIVE') {
      throw new BadRequestException(dto.employeeId ? "Le dossier de cet employé n'est pas actif" : "Votre dossier n'est pas actif");
    }

    const start = new Date(dto.startDate);
    const end   = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('La date de reprise doit être après la date de départ');

    const validSubTypes = SUBTYPES_BY_ABSENCE_TYPE[dto.type];
    if (!validSubTypes?.includes(dto.subType)) {
      throw new BadRequestException(
        `Le sous-motif "${dto.subType}" n'est pas valide pour le type "${dto.type}". Sous-motifs acceptés : ${validSubTypes?.join(', ')}.`,
      );
    }

    const workingDays = await WorkingDays.calculateWorkingDays(this.prisma, employee.companyId, start, end);

    // ✅ RH/Admin qui crée une demande pour un autre employé (comme pour les congés
    // et permissions) : pas de circuit d'attente à faire suivre à soi-même, la
    // demande est directement validée. Un employé qui fait sa propre demande
    // reste en PENDING, comme avant.
    const autoApprove = !!dto.employeeId;

    const absenceRequest = await this.prisma.absenceRequest.create({
      data: {
        employeeId:    employee.id,
        companyId:     employee.companyId,
        type:          dto.type,
        subType:       dto.subType,
        startDate:     start,
        endDate:       end,
        workingDays,
        reason:        dto.reason,
        isPaid:        dto.isPaid ?? false,
        attachmentUrl: dto.attachmentUrl,
        status:        autoApprove ? 'APPROVED' : 'PENDING',
        reviewedBy:    autoApprove ? userId : undefined,
        reviewedAt:    autoApprove ? new Date() : undefined,
      },
    });

    if (autoApprove) {
      // Déjà tranché — on notifie directement l'employé, comme à une approbation classique.
      const employeeUser = await this.prisma.user.findFirst({
        where:  { email: employee.email ?? undefined, companyId: employee.companyId },
        select: { id: true },
      });
      if (employeeUser) {
        await this.notificationsService.create({
          userId:  employeeUser.id,
          type:    'ABSENCE_APPROVED' as NotificationType,
          title:   '✅ Absence enregistrée',
          message: `Une absence (${this.typeLabel(dto.type)} — ${this.subTypeLabel(dto.subType)}) a été enregistrée pour vous du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} — ${workingDays} jour(s) ouvrable(s)`,
          link:    '/presences/absences/mon-espace',
          metadata: { absenceRequestId: absenceRequest.id, status: 'APPROVED' },
        });
      }
      return absenceRequest;
    }

    // Notifier RH/Admin + le manager du département concerné
    await this.notificationsService.createForGroup(employee.companyId, HR_ROLES, {
      type:    'ABSENCE_REQUEST' as NotificationType,
      title:   '📋 Nouvelle demande d\'absence',
      message: `${employee.firstName} ${employee.lastName} demande une autorisation d'absence (${this.typeLabel(dto.type)} — ${this.subTypeLabel(dto.subType)}) du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} — ${workingDays} jour(s) ouvrable(s)`,
      link:    '/presences/absences',
      metadata: { absenceRequestId: absenceRequest.id, employeeId: employee.id, type: dto.type, startDate: start.toISOString(), endDate: end.toISOString(), workingDays },
    });

    if (employee.department?.managerId) {
      await this.notificationsService.create({
        userId:  employee.department.managerId,
        type:    'ABSENCE_REQUEST' as NotificationType,
        title:   '📋 Nouvelle demande d\'absence',
        message: `${employee.firstName} ${employee.lastName} demande une autorisation d'absence du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}`,
        link:    '/presences/absences',
        metadata: { absenceRequestId: absenceRequest.id, employeeId: employee.id },
      });
    }

    return absenceRequest;
  }

  // ============================================================================
  // 📋 LISTE (vue RH / Manager / Admin)
  // ============================================================================

  async findAll(userId: string, employeeId?: string, status?: string) {
    const user = await this.getUserWithCompany(userId);
    const whereClause: any = { companyId: user.companyId };

    if (user.role === 'MANAGER') {
      const deptId = await this.getManagerDepartmentId(userId, user.companyId);
      if (!deptId) return [];
      whereClause.employee = { departmentId: deptId };
    }

    if (employeeId) whereClause.employeeId = employeeId;
    if (status) whereClause.status = status;

    return this.prisma.absenceRequest.findMany({
      where:   whereClause,
      include: {
        employee: { select: { firstName: true, lastName: true, position: true, photoUrl: true, employeeNumber: true, department: { select: { name: true } } } },
        reviewedByUser: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============================================================================
  // 👤 MES DEMANDES (employé connecté)
  // ============================================================================

  async findMine(userId: string) {
    const user = await this.getUserWithCompany(userId);
    const employee = await this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
    });
    if (!employee) throw new EmployeeNotFoundException();

    return this.prisma.absenceRequest.findMany({
      where:   { employeeId: employee.id, companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const user = await this.getUserWithCompany(userId);
    const absenceRequest = await this.prisma.absenceRequest.findUnique({
      where:   { id },
      include: {
        employee: { select: { firstName: true, lastName: true, position: true, employeeNumber: true, department: { select: { name: true } } } },
        company:  { select: { legalName: true, tradeName: true, logo: true, rccmNumber: true, taxNumber: true, address: true, phone: true } },
      },
    });
    if (!absenceRequest) throw new NotFoundException('Demande introuvable');
    if (absenceRequest.companyId !== user.companyId) throw new ForbiddenException('Accès refusé');
    return absenceRequest;
  }

  // ============================================================================
  // ✅ APPROUVER / REJETER
  // ============================================================================

  async updateStatus(id: string, status: 'APPROVED' | 'REJECTED', userId: string, rejectionReason?: string, isPaid?: boolean) {
    const user = await this.getUserWithCompany(userId);
    const absenceRequest = await this.prisma.absenceRequest.findUnique({
      where:   { id },
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true, departmentId: true } } },
    });

    if (!absenceRequest) throw new NotFoundException('Demande introuvable');
    if (absenceRequest.companyId !== user.companyId) throw new ForbiddenException("Vous n'avez pas accès à cette demande");
    if (!APPROVER_ROLES.includes(user.role)) throw new ForbiddenException("Vous n'avez pas les droits pour approuver/refuser");

    if (absenceRequest.status !== 'PENDING') throw new BadRequestException('Cette demande a déjà été traitée');
    if (status === 'REJECTED' && !rejectionReason?.trim()) throw new BadRequestException('Un motif de refus est requis');

    const updated = await this.prisma.absenceRequest.update({
      where: { id },
      data: {
        status,
        reviewedBy:      userId,
        reviewedAt:      new Date(),
        rejectionReason: status === 'REJECTED' ? rejectionReason : undefined,
        // ✅ La RH peut trancher/écraser la proposition de l'employé ici même.
        //    Si non fourni, la valeur proposée à la création reste inchangée
        //    (Prisma ignore un champ `undefined` dans data).
        isPaid: typeof isPaid === 'boolean' ? isPaid : undefined,
      },
    });

    const notifType    = status === 'APPROVED' ? 'ABSENCE_APPROVED' as NotificationType : 'ABSENCE_REJECTED' as NotificationType;
    const notifTitle   = status === 'APPROVED' ? '✅ Absence approuvée' : '❌ Absence refusée';
    const notifMessage = status === 'APPROVED'
      ? `Votre demande d'absence du ${new Date(absenceRequest.startDate).toLocaleDateString('fr-FR')} au ${new Date(absenceRequest.endDate).toLocaleDateString('fr-FR')} a été approuvée`
      : `Votre demande d'absence du ${new Date(absenceRequest.startDate).toLocaleDateString('fr-FR')} au ${new Date(absenceRequest.endDate).toLocaleDateString('fr-FR')} a été refusée${rejectionReason ? ` : ${rejectionReason}` : ''}`;

    const employeeUser = await this.prisma.user.findFirst({
      where:  { email: absenceRequest.employee.email, companyId: absenceRequest.companyId },
      select: { id: true },
    });
    if (employeeUser) {
      await this.notificationsService.create({
        userId:  employeeUser.id,
        type:    notifType,
        title:   notifTitle,
        message: notifMessage,
        link:    '/presences/absences/mon-espace',
        metadata: { absenceRequestId: absenceRequest.id, status },
      });
    }

    return updated;
  }

  // ============================================================================
  // ❌ ANNULER (employé, tant que la demande est PENDING)
  // ============================================================================

  async cancel(id: string, userId: string, reason?: string) {
    const user = await this.getUserWithCompany(userId);
    const absenceRequest = await this.prisma.absenceRequest.findUnique({ where: { id } });

    if (!absenceRequest) throw new NotFoundException('Demande introuvable');
    if (absenceRequest.companyId !== user.companyId) throw new ForbiddenException('Accès refusé');
    if (absenceRequest.status !== 'PENDING') throw new BadRequestException('Seule une demande en attente peut être annulée');

    return this.prisma.absenceRequest.update({
      where: { id },
      data:  { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
    });
  }

  /**
   * Données entièrement résolues pour le rendu du document imprimable
   * (modèle générique ou modèle client type Orca).
   */
  async getDocumentData(id: string) {
    const request = await this.prisma.absenceRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            department: { select: { name: true, managerId: true } },
          },
        },
        company: {
          select: {
            legalName: true,
            tradeName: true,
            rccmNumber: true,
            taxNumber: true,
            address: true,
            city: true,
            phone: true,
            logo: true,
            cachetUrl: true,
            documentTemplate: true,
            documentFooterText: true,
          },
        },
      },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');

    const responsableName = await resolveResponsableName(
      this.prisma,
      request.companyId,
      request.employee.department?.managerId,
    );

    return {
      id: request.id,
      type: request.type,
      subType: request.subType,
      isPaid: request.isPaid,
      startDate: request.startDate,
      endDate: request.endDate,
      workingDays: request.workingDays,
      reason: request.reason,
      status: request.status,
      printAuthorized: request.printAuthorized,
      employee: {
        firstName: request.employee.firstName,
        lastName: request.employee.lastName,
        position: request.employee.position,
        departmentName: request.employee.department?.name ?? '',
      },
      responsableName,
      company: request.company,
    };
  }

  /**
   * Génère le .docx "absence" Orca rempli — écrit directement dans leur
   * fichier original. Uniquement pour les entreprises documentTemplate=ORCA.
   */
  async generateOrcaDocument(absenceId: string): Promise<Buffer> {
    const data = await this.getDocumentData(absenceId);
    if (data.company?.documentTemplate !== 'ORCA') {
      throw new BadRequestException("Cette entreprise n'utilise pas le modèle de document Orca.");
    }

    const CHECK = ' ✓';
    const fmtDate = (d: any) => {
      if (!d) return '……………………';
      const date = new Date(d);
      return isNaN(date.getTime()) ? '……………………' : date.toLocaleDateString('fr-FR');
    };
    const validated = data.status === 'APPROVED';

    // Type checkbox : Maladie / Conventionnel / Exceptionnel — dans le
    // template absence, ces 3 positions correspondent aux tags
    // check_annuel / check_matpat / check_exceptionnel (mêmes noms de tag
    // que le template congé — seuls les libellés imprimés diffèrent, déjà
    // en dur dans le fichier template absence.docx)
    const checks = { check_annuel: '', check_matpat: '', check_exceptionnel: '' };
    if (data.subType === 'MALADIE') checks.check_annuel = CHECK;
    else if (data.type === 'CONVENTIONNELLE') checks.check_matpat = CHECK;
    else checks.check_exceptionnel = CHECK;

    const fillData: Record<string, string> = {
      nom:          (data.employee.lastName || '').toUpperCase(),
      prenoms:      data.employee.firstName || '',
      departement:  data.employee.departmentName || '',
      fonction:     data.employee.position || '',
      responsable:  data.responsableName || '',
      motif:        data.reason || '',
      date_depart:  fmtDate(data.startDate),
      date_retour:  fmtDate(data.endDate),
      nombre_jours: String(data.workingDays ?? ''),
      ...checks,
      check_paye:    data.isPaid ? CHECK : '',
      check_nonpaye: data.isPaid ? '' : CHECK,
      check_accord:  validated ? CHECK : '',
      check_refus:   data.status === 'REJECTED' ? CHECK : '',
    };

    let buffer = fillOrcaWordTemplate(getOrcaTemplateFile('absence'), fillData);

    if (validated && data.company?.cachetUrl) {
      try {
        const cachetBuffer = await fetchImageBuffer(data.company.cachetUrl);
        buffer = swapCachetImage(buffer, cachetBuffer, ORCA_CACHET_MEDIA_FILE.absence);
      } catch {
        // Cachet indisponible — le document sort quand même, juste sans cachet
      }
    }

    return buffer;
  }

  /**
   * Autorise (ou retire l'autorisation) l'impression du document d'absence
   * par l'employé. Réservé RH/Admin, uniquement sur une demande déjà validée.
   */
  async setPrintAuthorization(id: string, authorized: boolean, userId: string) {
    const request = await this.prisma.absenceRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Demande introuvable.');
    if (request.status !== 'APPROVED') {
      throw new BadRequestException("La demande doit être validée avant d'autoriser l'impression.");
    }

    return this.prisma.absenceRequest.update({
      where: { id },
      data: {
        printAuthorized: authorized,
        printAuthorizedBy: userId,
        printAuthorizedAt: new Date(),
      },
    });
  }

  /**
   * Change le statut payé / non payé — réservé RH/Admin (contrôlé au niveau
   * du controller via @Roles). Contrairement à setPrintAuthorization, PAS de
   * restriction sur le statut de la demande : la RH peut changer d'avis à
   * tout moment, avant ou après validation, sur une demande déjà rejetée
   * y compris — elle garde toujours la main, jamais l'employé.
   */
  async setPaidStatus(id: string, isPaid: boolean, userId: string) {
    const user = await this.getUserWithCompany(userId);
    const request = await this.prisma.absenceRequest.findUnique({
      where: { id },
      include: { employee: { select: { email: true } } },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');
    if (request.companyId !== user.companyId) throw new ForbiddenException("Vous n'avez pas accès à cette demande");

    const updated = await this.prisma.absenceRequest.update({
      where: { id },
      data: { isPaid },
    });

    const employeeUser = await this.prisma.user.findFirst({
      where:  { email: request.employee.email, companyId: request.companyId },
      select: { id: true },
    });
    if (employeeUser) {
      await this.notificationsService.create({
        userId:  employeeUser.id,
        type:    'SYSTEM_ALERT',
        title:   isPaid ? '💰 Absence rémunérée' : '⚠️ Absence non rémunérée',
        message: isPaid
          ? `Votre absence du ${new Date(request.startDate).toLocaleDateString('fr-FR')} au ${new Date(request.endDate).toLocaleDateString('fr-FR')} sera rémunérée.`
          : `Votre absence du ${new Date(request.startDate).toLocaleDateString('fr-FR')} au ${new Date(request.endDate).toLocaleDateString('fr-FR')} ne sera pas rémunérée.`,
        link:    '/presences/absences/mon-espace',
        metadata: { absenceRequestId: id, isPaid },
      });
    }

    return updated;
  }
}