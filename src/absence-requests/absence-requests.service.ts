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
import { getMotifsForCompany, findMotifByKey, getAnnualCeiling } from '../conventions/absence-motifs-grille';
import { EmployeeNotFoundException, CompanyNotFoundException } from '../exceptions/business.exceptions';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
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
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  // ============================================================================
  // 🔒 HELPERS PRIVÉS (identiques au pattern LeavesService)
  // ============================================================================

private async getUserWithCompany(userId: string, overrideCompanyId?: string): Promise<{
  id: string; companyId: string; role: string; email: string | null;
}> {
  const user = await this.prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, companyId: true, role: true, email: true, manageMultipleCompanies: true },
  });
  if (!user) throw new CompanyNotFoundException();
  // 🆕 Admin multi-entreprises : companyId fourni par l'appelant
  // (PortfolioAbsenceService), après vérification d'appartenance.
  if (overrideCompanyId && user.manageMultipleCompanies) {
    return { id: user.id, companyId: overrideCompanyId, role: user.role, email: user.email };
  }
  if (!user.companyId) throw new CompanyNotFoundException();
  return { id: user.id, companyId: user.companyId, role: user.role, email: user.email };
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
      MARIAGE: 'Mariage', DECES: 'Décès', NAISSANCE: 'Naissance',
      RETRAIT_DEUIL: 'Retrait de deuil', DEMENAGEMENT: 'Déménagement', AUTRE: 'Autre',
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

  async create(dto: CreateAbsenceRequestDto, userId: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    await this.subscriptionGuard.assertActionAllowed(user.companyId, user.role);

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

    // ✅ Catalogue calculé "Modèle 2" — la ligne vient de la convention
    // collective de l'entreprise (company.collectiveAgreement), calculée à
    // la volée : aucune table, aucune donnée dupliquée à maintenir. Dérive
    // type/subType/reason/endDate/workingDays automatiquement ; sinon
    // (motifKey absent) comportement DEFAULT strictement inchangé.
    let motif: { label: string; subType: string; days: number } | null = null;
    let companyConvention: string | null = null;
    if (dto.motifKey) {
      const companyForConvention = await this.prisma.company.findUnique({
        where: { id: employee.companyId },
        select: { collectiveAgreement: true },
      });
      companyConvention = companyForConvention?.collectiveAgreement ?? null;
      motif = findMotifByKey(companyConvention, dto.motifKey);
      if (!motif) throw new BadRequestException("Motif introuvable pour la convention de votre entreprise");
    } else if (!dto.type || !dto.subType || !dto.endDate || !dto.reason) {
      throw new BadRequestException('type, subType, endDate et reason sont obligatoires hors catalogue de motifs');
    }

    const type = motif ? 'EXCEPTIONNELLE' : dto.type!;
    const subType = motif ? (motif.subType as any) : dto.subType!;
    const reason = motif ? motif.label : dto.reason!;

    // ✅ Plafond annuel (convention collective) — seulement quand la
    // demande vient du catalogue ET que la convention en définit un.
    // Comportement DEFAULT (motif texte libre) jamais concerné.
    if (motif) {
      const ceiling = getAnnualCeiling(companyConvention);
      if (ceiling != null) {
        const yearStart = new Date(new Date(dto.startDate).getFullYear(), 0, 1);
        const yearEnd = new Date(new Date(dto.startDate).getFullYear(), 11, 31, 23, 59, 59);
        const usedThisYear = await this.prisma.absenceRequest.aggregate({
          where: {
            employeeId: employee.id,
            type: 'EXCEPTIONNELLE',
            status: { in: ['PENDING', 'APPROVED'] },
            startDate: { gte: yearStart, lte: yearEnd },
          },
          _sum: { workingDays: true },
        });
        const already = Number(usedThisYear._sum.workingDays ?? 0);
        if (already + motif.days > ceiling) {
          throw new BadRequestException(
            `Plafond annuel de permissions exceptionnelles dépassé : ${already} jour(s) déjà pris/en attente sur ${ceiling} autorisés cette année, cette demande (${motif.days}j) le dépasserait.`,
          );
        }
      }
    }

    const start = new Date(dto.startDate);
    // Avec un motif du catalogue, la date de reprise est déduite du nombre
    // de jours conventionnels fixes (jours calendaires consécutifs depuis le
    // départ) — l'employé ne saisit que la date de départ pour ce cas-là.
    const end = motif
      ? new Date(start.getTime() + (motif.days - 1) * 86400000)
      : new Date(dto.endDate!);
    if (end < start) throw new BadRequestException('La date de reprise doit être après la date de départ');

    const validSubTypes = SUBTYPES_BY_ABSENCE_TYPE[type as keyof typeof SUBTYPES_BY_ABSENCE_TYPE];
    if (!motif && !validSubTypes?.includes(subType)) {
      throw new BadRequestException(
        `Le sous-motif "${subType}" n'est pas valide pour le type "${type}". Sous-motifs acceptés : ${validSubTypes?.join(', ')}.`,
      );
    }

    // Motif du catalogue : le nombre de jours est un droit fixe (convention),
    // pas un calcul en jours ouvrables — on ne recalcule pas via WorkingDays.
    const workingDays = motif
      ? motif.days
      : await WorkingDays.calculateWorkingDays(this.prisma, employee.companyId, start, end);

    // ✅ RH/Admin qui crée une demande pour un autre employé (comme pour les congés
    // et permissions) : pas de circuit d'attente à faire suivre à soi-même, la
    // demande est directement validée. Un employé qui fait sa propre demande
    // reste en PENDING, comme avant.
    const autoApprove = !!dto.employeeId;

    const absenceRequest = await this.prisma.absenceRequest.create({
      data: {
        employeeId:    employee.id,
        companyId:     employee.companyId,
        type:          type as any,
        subType:       subType as any,
        startDate:     start,
        endDate:       end,
        workingDays,
        reason,
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
          message: `Une absence (${this.typeLabel(type as any)} — ${this.subTypeLabel(subType as any)}) a été enregistrée pour vous du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} — ${workingDays} jour(s)`,
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
      message: `${employee.firstName} ${employee.lastName} demande une autorisation d'absence (${this.typeLabel(type as any)} — ${this.subTypeLabel(subType as any)}) du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} — ${workingDays} jour(s)`,
      link:    '/presences/absences',
      metadata: { absenceRequestId: absenceRequest.id, employeeId: employee.id, type, startDate: start.toISOString(), endDate: end.toISOString(), workingDays },
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

  async findAll(userId: string, employeeId?: string, status?: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
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

  async findOne(id: string, userId: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
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

  async updateStatus(id: string, status: 'APPROVED' | 'REJECTED', userId: string, rejectionReason?: string, isPaid?: boolean, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
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

  async cancel(id: string, userId: string, reason?: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
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
   * Supprime définitivement une demande (contrairement à cancel(), qui ne
   * fait que passer le statut à CANCELLED). Utilisé par la page de gestion
   * pour nettoyer une demande créée par erreur — tous statuts confondus,
   * même logique d'accès que cancel()/updateStatus().
   */
  async remove(id: string, userId: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const absenceRequest = await this.prisma.absenceRequest.findUnique({ where: { id } });

    if (!absenceRequest) throw new NotFoundException('Demande introuvable');
    if (absenceRequest.companyId !== user.companyId) throw new ForbiddenException('Accès refusé');

    await this.prisma.absenceRequest.delete({ where: { id } });
    return { success: true };
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
            employeeNumber: true,
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
            country: true,
            phone: true,
            email: true,
            logo: true,
            cachetUrl: true,
            documentTemplate: true,
            documentFooterText: true,
            collectiveAgreement: true,
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

    // Catalogue calculé depuis la convention (pas de table à lire) — la
    // ligne cochée est retrouvée en comparant le motif texte enregistré
    // (= le libellé exact de la convention au moment de la demande).
    const catalog = request.company?.documentTemplate === 'STANDARD'
      ? getMotifsForCompany(request.company?.collectiveAgreement)
      : [];
    const motifKey = catalog.find((m) => m.label === request.reason)?.key;

    return {
      id: request.id,
      type: request.type,
      subType: request.subType,
      motifKey,
      catalog,
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
        employeeNumber: request.employee.employeeNumber,
        position: request.employee.position,
        departmentName: request.employee.department?.name ?? '',
      },
      responsableName,
      company: request.company,
    };
  }

  /** Catalogue calculé de l'entreprise — pour peupler le formulaire de demande (tous les rôles). */
  async listMotifs(userId: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { collectiveAgreement: true },
    });
    return getMotifsForCompany(company?.collectiveAgreement);
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