// ============================================================================
// 📁 src/leaves/leaves.service.ts
// ✅ CONFORME CONGO BRAZZAVILLE — Code du travail Loi n°45-75
// ✅ CABINET SUPPORT — overrideCompanyId pattern (non-destructif)
// ✅ PHASE 7 — DÉCOUPAGE : ce fichier reste la FAÇADE PUBLIQUE du module congé
//    (mêmes noms de méthodes qu'avant, donc AUCUN changement nécessaire dans
//    leaves.controller.ts, leave-accrual.cron.ts, ni dans les 3 fichiers paie
//    qui injectent LeavesService). L'implémentation du solde/cycle vit dans
//    LeavesBalanceService, celle de l'indemnité dans LeavesIndemnityService —
//    ce fichier ne garde que l'orchestration propre aux demandes de congé
//    elles-mêmes (create/valider/refuser/annuler/documents/planning).
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { EmployeeNotFoundException } from '../exceptions/business.exceptions';
import { LeaveType, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { resolveResponsableName } from '../common/resolve-responsable.util';
import * as WorkingDays from '../common/working-days.util';
import {
  fillOrcaWordTemplate,
  swapCachetImage,
  fetchImageBuffer,
  getOrcaTemplateFile,
  ORCA_CACHET_MEDIA_FILE,
} from '../documents/orca-word.util';
import {
  fillOrcaPlanningTemplate,
  OrcaPlanningRow,
} from '../documents/orca-planning-excel.util';
import {
  getUserWithCompany,
  getManagerDepartmentId,
  resolveCycleWindow,
} from './leaves-common.util';
import { CONGO_LEAVE } from './leaves.constants';
import { LeavesBalanceService } from './leaves-balance.service';
import { LeavesIndemnityService } from './leaves-indemnity.service';

@Injectable()
export class LeavesService {
  private readonly logger = new Logger(LeavesService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private subscriptionGuard: SubscriptionGuard,
    private balanceService: LeavesBalanceService,
    private indemnityService: LeavesIndemnityService,
  ) {}

  // ============================================================================
  // 🔒 HELPERS PRIVÉS — délèguent à leaves-common.util.ts (Phase 7)
  // ============================================================================

  private async getUserWithCompany(userId: string, overrideCompanyId?: string) {
    return getUserWithCompany(this.prisma, userId, overrideCompanyId);
  }

  private async getManagerDepartmentId(
    userId: string,
    companyId: string,
  ): Promise<string | null> {
    return getManagerDepartmentId(this.prisma, userId, companyId);
  }

  // ============================================================================
  // ✅ CORRECTIF : garde-fou anti-chevauchement — appelé par create() et
  //    createManual(). Bloque toute nouvelle demande/planification dont la
  //    période recoupe une demande déjà PENDING ou APPROVED pour le même
  //    employé (deux intervalles [a,b] et [c,d] se chevauchent dès que
  //    a <= d ET c <= b). Les congés REJECTED/CANCELLED n'entrent jamais en
  //    conflit — ils n'occupent plus rien.
  // ============================================================================
  private async assertNoOverlap(
    employeeId: string,
    start: Date,
    end: Date,
    excludeLeaveId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.leave.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: end },
        endDate: { gte: start },
        ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        `Une demande de congé (${overlapping.status === 'APPROVED' ? 'déjà approuvée' : 'en attente'}) existe déjà du ${overlapping.startDate.toLocaleDateString('fr-FR')} au ${overlapping.endDate.toLocaleDateString('fr-FR')} pour cet employé.`,
      );
    }
  }

  // ============================================================================
  // 📅 CALCUL JOURS OUVRÉS / DATE DE RETOUR — délèguent à working-days.util.ts
  // ============================================================================

  async calculateWorkingDays(
    start: Date,
    end: Date,
    companyId: string,
  ): Promise<number> {
    return WorkingDays.calculateWorkingDays(this.prisma, companyId, start, end);
  }

  /**
   * Calcule automatiquement la date de retour à partir d'une date de départ
   * et d'un nombre de jours ouvrables souhaité. Voir working-days.util.ts.
   */
  async calculateReturnDate(
    employeeId: string,
    startDate: Date,
    workingDaysNeeded: number,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    return WorkingDays.calculateReturnDate(
      this.prisma,
      employee.companyId,
      startDate,
      workingDaysNeeded,
    );
  }

  // ============================================================================
  // 💰 SOLDE CONGÉS — délègue à LeavesBalanceService (Phase 7)
  // ============================================================================

  async getOrCreateLeaveBalance(
    employeeId: string,
    referenceDate: Date = new Date(),
  ) {
    return this.balanceService.getOrCreateLeaveBalance(
      employeeId,
      referenceDate,
    );
  }

  async getProjectedBalanceAsOf(employeeId: string, asOfDate: Date) {
    return this.balanceService.getProjectedBalanceAsOf(employeeId, asOfDate);
  }

  /**
   * ✅ CORRECTIF SÉCURITÉ : petit garde-fou réutilisable pour toutes les
   * routes indexées par :employeeId qui n'en avaient AUCUN — un utilisateur
   * authentifié de n'importe quelle entreprise pouvait lire/modifier le
   * solde, l'historique ou l'indemnité d'un employé d'une AUTRE entreprise
   * en devinant/trouvant son UUID.
   */
  async assertEmployeeAccess(
    employeeId: string,
    userId: string,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);
    if (employee.companyId !== user.companyId) {
      throw new ForbiddenException('Accès refusé');
    }
    return user;
  }

  async getEmployeeBalanceDetails(
    employeeId: string,
    userId: string,
    overrideCompanyId?: string,
  ) {
    await this.assertEmployeeAccess(employeeId, userId, overrideCompanyId);
    return this.balanceService.getEmployeeBalanceDetails(employeeId);
  }

  /**
   * 🔁 Soldes de TOUS les employés actifs d'une entreprise, en une seule
   * requête — appelé par la page /conges/soldes. Avant : le frontend faisait
   * un appel HTTP /leaves/balance/:id PAR employé (jusqu'à 100+ en parallèle),
   * ce qui déclenchait le rate-limiter du serveur (429 Too Many Requests) dès
   * qu'il y avait beaucoup d'employés. Ici, le calcul boucle en interne
   * (appels directs, pas de HTTP), donc aucune requête réseau supplémentaire.
   */
  async getAllEmployeeBalances(userId: string, companyIdOverride?: string) {
    const user = await this.getUserWithCompany(userId, companyIdOverride);

    const employees = await this.prisma.employee.findMany({
      where: { companyId: user.companyId, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        hireDate: true,
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const results = await Promise.all(
      employees.map(async (emp) => {
        try {
          const bal = await this.balanceService.getEmployeeBalanceDetails(emp.id);
          return {
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            position: emp.position,
            departmentName: emp.department?.name,
            hireDate: emp.hireDate,
            monthsWorked: bal?.monthsWorked ?? 0,
            canTakeAnnualLeave: bal?.canTakeAnnualLeave ?? true,
            monthsUntilEligible: bal?.monthsUntilEligible ?? 0,
            annualEntitled: Number(bal.annualEntitled ?? 0),
            annualTaken: Number(bal.annualTaken ?? 0),
            annualRemaining: Number(bal.annualRemaining ?? 0),
            carriedForward: Number(bal.carriedForward ?? 0),
            seniorityDays: Number(bal.seniorityDays ?? 0),
            cycleEndDate: bal?.cycleEndDate ?? null,
            year: bal?.year ?? new Date().getFullYear(),
          };
        } catch (e: any) {
          this.logger.warn(
            `⚠️ Solde non calculable pour ${emp.firstName} ${emp.lastName} (${emp.id}): ${e?.message ?? e}`,
          );
          return {
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            position: emp.position,
            departmentName: emp.department?.name,
            hireDate: emp.hireDate,
            monthsWorked: 0,
            canTakeAnnualLeave: false,
            monthsUntilEligible: 0,
            annualEntitled: 0,
            annualTaken: 0,
            annualRemaining: 0,
            carriedForward: 0,
            seniorityDays: 0,
            cycleEndDate: null,
            year: new Date().getFullYear(),
            loadError: e?.message || String(e),
          };
        }
      }),
    );

    return results;
  }

  async seedBalanceFromLastLeave(
    employeeId: string,
    lastLeaveType: 'ANNUAL' | 'ANNUAL_ANTICIPATED',
    startDate: Date,
    endDate: Date,
    remainingDays: number | undefined,
    userId: string,
    overrideCompanyId?: string,
  ) {
    await this.assertEmployeeAccess(employeeId, userId, overrideCompanyId);
    return this.balanceService.seedBalanceFromLastLeave(
      employeeId,
      lastLeaveType,
      startDate,
      endDate,
      remainingDays,
    );
  }

  async setManualBalance(
    employeeId: string,
    annualEntitled: number,
    annualTaken: number = 0,
    note: string | undefined,
    userId: string,
    overrideCompanyId?: string,
  ) {
    await this.assertEmployeeAccess(employeeId, userId, overrideCompanyId);
    return this.balanceService.setManualBalance(
      employeeId,
      annualEntitled,
      annualTaken,
      note,
    );
  }

  async getMyBalance(userId: string) {
    return this.balanceService.getMyBalance(userId);
  }

  async getYearlyLeaveTrend(
    userId: string,
    year: number,
    overrideCompanyId?: string,
  ) {
    return this.balanceService.getYearlyLeaveTrend(
      userId,
      year,
      overrideCompanyId,
    );
  }

  async accrueMonthlyLeaveForEmployee(
    employeeId: string,
    month: number,
    year: number,
  ): Promise<void> {
    return this.balanceService.accrueMonthlyLeaveForEmployee(
      employeeId,
      month,
      year,
    );
  }

  async checkAndSendLeaveAlerts(employeeId: string): Promise<void> {
    return this.balanceService.checkAndSendLeaveAlerts(employeeId);
  }

  async checkLeaveReturnReminders(): Promise<void> {
    return this.balanceService.checkLeaveReturnReminders();
  }

  async confirmLeaveReturn(
    leaveId: string,
    userId: string,
    actualReturnDate?: Date,
    overrideCompanyId?: string,
  ) {
    return this.balanceService.confirmLeaveReturn(
      leaveId,
      userId,
      actualReturnDate,
      overrideCompanyId,
    );
  }

  // ============================================================================
  // 💵 INDEMNITÉ CONGÉ — délègue à LeavesIndemnityService (Phase 7)
  // ============================================================================

  async calculateLeaveIndemnity(
    employeeId: string,
    daysCount: number,
    companyId?: string,
    anchorMonth?: number,
    anchorYear?: number,
  ) {
    return this.indemnityService.calculateLeaveIndemnity(
      employeeId,
      daysCount,
      companyId,
      anchorMonth,
      anchorYear,
    );
  }

  async getLeaveImpactForPayroll(
    employeeId: string,
    month: number,
    year: number,
    currentMonthWorkGross?: number,
  ) {
    return this.indemnityService.getLeaveImpactForPayroll(
      employeeId,
      month,
      year,
      currentMonthWorkGross,
    );
  }

  async clearOpeningCumulativeAfterUse(employeeId: string) {
    return this.indemnityService.clearOpeningCumulativeAfterUse(employeeId);
  }

  async getLeaveProvision(companyId: string) {
    return this.indemnityService.getLeaveProvision(companyId);
  }

  // ============================================================================
  // 📊 GESTION DES CONGÉS — vue combinée congé + absence pour la page admin
  // ============================================================================

  async getManagementOverview(
    userId: string,
    filters: {
      month?: number;
      year?: number;
      type?: string;
      subType?: string;
      status?: string;
    },
    companyIdOverride?: string,
  ) {
    const user = await this.getUserWithCompany(userId, companyIdOverride);
    const companyId = user.companyId;

    const now = new Date();
    const month = filters.month ?? now.getMonth() + 1;
    const year = filters.year ?? now.getFullYear();
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59);

    const isLeaveType =
      filters.type && ['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(filters.type);
    const isAbsenceType =
      filters.type &&
      ['CONVENTIONNELLE', 'EXCEPTIONNELLE'].includes(filters.type);

    const employeeSelect = {
      firstName: true,
      lastName: true,
      position: true,
      department: { select: { name: true } },
    };

    const [leaves, absences] = await Promise.all([
      isAbsenceType
        ? Promise.resolve([])
        : this.prisma.leave.findMany({
            where: {
              companyId,
              ...(isLeaveType ? { type: filters.type as any } : {}),
              ...(filters.status ? { status: filters.status as any } : {}),
              startDate: { lte: periodEnd },
              endDate: { gte: periodStart },
            },
            include: { employee: { select: employeeSelect } },
            orderBy: { startDate: 'asc' },
          }),
      isLeaveType
        ? Promise.resolve([])
        : this.prisma.absenceRequest.findMany({
            where: {
              companyId,
              ...(isAbsenceType ? { type: filters.type as any } : {}),
              ...(filters.subType ? { subType: filters.subType as any } : {}),
              ...(filters.status ? { status: filters.status as any } : {}),
              startDate: { lte: periodEnd },
              endDate: { gte: periodStart },
            },
            include: { employee: { select: employeeSelect } },
            orderBy: { startDate: 'asc' },
          }),
    ]);

    const events = [
      ...leaves.map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        kind: 'LEAVE' as const,
        employee: l.employee,
        type: l.type,
        subType: null,
        startDate: l.startDate,
        endDate: l.endDate,
        daysCount: Number(l.daysCount),
        status: l.status,
        isPaid: true,
      })),
      ...absences.map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        kind: 'ABSENCE' as const,
        employee: a.employee,
        type: a.type,
        subType: a.subType,
        startDate: a.startDate,
        endDate: a.endDate,
        daysCount: Number(a.workingDays),
        status: a.status,
        isPaid: a.isPaid,
      })),
    ].sort(
      (x, y) =>
        new Date(x.startDate).getTime() - new Date(y.startDate).getTime(),
    );

    const today = new Date();
    const isActiveToday = (e: (typeof events)[number]) =>
      e.status === 'APPROVED' &&
      new Date(e.startDate) <= today &&
      new Date(e.endDate) >= today;

    const kpis = {
      onLeaveToday: events.filter((e) => e.kind === 'LEAVE' && isActiveToday(e))
        .length,
      onAbsenceToday: events.filter(
        (e) => e.kind === 'ABSENCE' && isActiveToday(e),
      ).length,
      absencePaidToday: events.filter(
        (e) => e.kind === 'ABSENCE' && isActiveToday(e) && e.isPaid,
      ).length,
      absenceUnpaidToday: events.filter(
        (e) => e.kind === 'ABSENCE' && isActiveToday(e) && !e.isPaid,
      ).length,
      pendingRequests: events.filter((e) => e.status === 'PENDING').length,
      daysApprovedThisPeriod: events
        .filter((e) => e.status === 'APPROVED')
        .reduce((sum, e) => sum + e.daysCount, 0),
    };

    return { period: { month, year }, kpis, events };
  }

  /**
   * Historique complet d'un employé (congé + absence confondus) — utilisé
   * par la fiche employé de la page Gestion des congés.
   */
  async getEmployeeLeaveHistory(
    employeeId: string,
    userId: string,
    overrideCompanyId?: string,
  ) {
    await this.assertEmployeeAccess(employeeId, userId, overrideCompanyId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        firstName: true,
        lastName: true,
        position: true,
        department: { select: { name: true } },
      },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const [leaves, absences] = await Promise.all([
      this.prisma.leave.findMany({
        where: { employeeId },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.absenceRequest.findMany({
        where: { employeeId },
        orderBy: { startDate: 'desc' },
      }),
    ]);

    const history = [
      ...leaves.map((l) => ({
        id: l.id,
        kind: 'LEAVE' as const,
        type: l.type,
        subType: null,
        startDate: l.startDate,
        endDate: l.endDate,
        daysCount: Number(l.daysCount),
        status: l.status,
        isPaid: true,
        reason: l.reason,
      })),
      ...absences.map((a) => ({
        id: a.id,
        kind: 'ABSENCE' as const,
        type: a.type,
        subType: a.subType,
        startDate: a.startDate,
        endDate: a.endDate,
        daysCount: Number(a.workingDays),
        status: a.status,
        isPaid: a.isPaid,
        reason: a.reason,
      })),
    ].sort(
      (x, y) =>
        new Date(y.startDate).getTime() - new Date(x.startDate).getTime(),
    );

    return { employee, history };
  }

  /**
   * Génère le fichier "Programme des départs en congé" Orca rempli (2
   * onglets) — écrit directement dans leur fichier .xlsx original.
   */
  async generateOrcaPlanningDocument(
    userId: string,
    month: number,
    year: number,
    companyIdOverride?: string,
  ): Promise<Buffer> {
    const user = await this.getUserWithCompany(userId, companyIdOverride);

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { documentTemplate: true },
    });
    if (company?.documentTemplate !== 'ORCA') {
      throw new BadRequestException(
        "Cette entreprise n'utilise pas le modèle de document Orca.",
      );
    }

    const MONTH_NAMES = [
      'Janvier',
      'Février',
      'Mars',
      'Avril',
      'Mai',
      'Juin',
      'Juillet',
      'Août',
      'Septembre',
      'Octobre',
      'Novembre',
      'Décembre',
    ];
    const fmtDate = (d: any) => new Date(d).toLocaleDateString('fr-FR');

    const fetchMonthRows = async (
      m: number,
      y: number,
    ): Promise<{ raw: any[]; excel: OrcaPlanningRow[] }> => {
      const periodStart = new Date(y, m - 1, 1);
      const periodEnd = new Date(y, m, 0, 23, 59, 59);
      // ✅ Même moteur que /programme (réel validé + théorique prévisionnel) —
      // avant, l'Excel ne remontait QUE les congés déjà validés, donc restait
      // vide tant qu'aucune demande n'avait été soumise pour ce mois.
      const raw = await this.buildDepartureRows(
        user.companyId,
        periodStart,
        periodEnd,
      );

      const excel = raw.map((r) => ({
        employeeName: `${r.employee.lastName} ${r.employee.firstName}`,
        position: r.employee.position || '',
        leaveMonth: MONTH_NAMES[new Date(r.startDate).getMonth()],
        hireDate: fmtDate(r.employee.hireDate),
        contractType: r.employee.contractType || '',
        startDate: fmtDate(r.startDate),
        endDate: fmtDate(r.endDate),
      }));
      return { raw, excel };
    };

    const { raw: departRowsRaw, excel: departRows } = await fetchMonthRows(month, year);

    // ✅ CORRECTIF : l'onglet "à payer" doit lister les congés dont le
    // PAIEMENT (plannedPayrollMonth/Year) tombe sur ce mois précédent —
    // pas les départs qui ont eu lieu ce mois précédent (ça n'a aucun lien
    // avec ce qu'on paie ce mois-ci). Un départ en août est payé en
    // juillet : l'onglet "payable fin juillet" doit donc lister les
    // départs D'AOÛT, pas ceux de juillet.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const payablePeriodStart = new Date(prevYear, prevMonth - 1, 1);
    const payablePeriodEnd = new Date(prevYear, prevMonth, 0, 23, 59, 59);
    const payableLeaves = await this.prisma.leave.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ['APPROVED', 'PENDING'] },
        OR: [
          { plannedPayrollMonth: prevMonth, plannedPayrollYear: prevYear },
          // Filet de sécurité pour les congés créés avant l'ajout de ce
          // champ (encore null) : ancien comportement en repli.
          {
            plannedPayrollMonth: null,
            type: 'ANNUAL',
            startDate: { gte: payablePeriodStart, lte: payablePeriodEnd },
          },
        ],
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            hireDate: true,
            contractType: true,
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });
    const payableRealEmployeeIds = new Set(payableLeaves.map((l) => l.employeeId));
    const payableRows: OrcaPlanningRow[] = payableLeaves.map((l) => ({
      employeeName: `${l.employee.lastName} ${l.employee.firstName}`,
      position: l.employee.position || '',
      leaveMonth: MONTH_NAMES[new Date(l.startDate).getMonth()],
      hireDate: fmtDate(l.employee.hireDate),
      contractType: l.employee.contractType || '',
      startDate: fmtDate(l.startDate),
      endDate: fmtDate(l.endDate),
    }));

    // ✅ CORRECTIF (demande explicite) : mêmes départs théoriques que
    // l'onglet départs (departRowsRaw, mois de départ = `month`) — pas
    // encore planifiés, mais dont l'indemnité tombe quand même ce mois
    // précédent (`prevMonth`). Exclut les employés déjà couverts par un
    // vrai congé trouvé ci-dessus.
    for (const r of departRowsRaw) {
      if (!r.isTheoretical || payableRealEmployeeIds.has(r.employeeId)) continue;
      payableRows.push({
        employeeName: `${r.employee.lastName} ${r.employee.firstName}`,
        position: r.employee.position || '',
        leaveMonth: MONTH_NAMES[new Date(r.startDate).getMonth()],
        hireDate: fmtDate(r.employee.hireDate),
        contractType: r.employee.contractType || '',
        startDate: fmtDate(r.startDate),
        endDate: fmtDate(r.endDate),
      });
    }

    return fillOrcaPlanningTemplate(
      {
        title: `PROGRAMME DES DEPARTS EN CONGE DU MOIS DE ${MONTH_NAMES[month - 1].toUpperCase()} ${year}`,
        rows: departRows,
      },
      {
        title: `Planning congé à payer en fin ${MONTH_NAMES[prevMonth - 1]} ${year}`,
        rows: payableRows,
      },
    );
  }

  // ============================================================================
  // ✅ CRÉER UNE DEMANDE DE CONGÉ
  // overrideCompanyId : fourni par le cabinet controller, absent pour entreprise
  // ============================================================================

  async create(
    createLeaveDto: CreateLeaveDto,
    userId: string,
    overrideCompanyId?: string,
  ) {
    try {
      const user = await this.getUserWithCompany(userId, overrideCompanyId);
      await this.subscriptionGuard.checkFeatureAccess(
        user.companyId,
        'hasLeaveManagement',
      );

      const employee = await this.prisma.employee.findUnique({
        where: { id: createLeaveDto.employeeId },
        select: {
          id: true,
          companyId: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          departmentId: true,
          hireDate: true,
          gender: true,
        },
      });

      if (!employee)
        throw new EmployeeNotFoundException(createLeaveDto.employeeId);
      if (employee.companyId !== user.companyId)
        throw new ForbiddenException(
          "Cet employé n'appartient pas à votre entreprise",
        );

      if (user.role === 'MANAGER') {
        const deptId = await this.getManagerDepartmentId(
          userId,
          user.companyId,
        );
        if (!deptId || employee.departmentId !== deptId) {
          throw new ForbiddenException(
            'Vous ne pouvez soumettre des congés que pour votre département',
          );
        }
      }

      if (employee.status !== 'ACTIVE') {
        throw new BadRequestException(
          `L'employé ${employee.firstName} ${employee.lastName} n'est pas actif`,
        );
      }

      // ✅ CORRECTIF SÉCURITÉ : un EMPLOYEE authentifié pouvait soumettre une
      // demande de congé pour N'IMPORTE QUEL employé de son entreprise en
      // passant simplement son employeeId dans le body (le frontend limite
      // bien le champ à "soi-même" pour ce rôle, mais rien ne l'imposait
      // côté API). Seuls MANAGER (déjà restreint à son département
      // ci-dessus) et les rôles RH/Admin/Cabinet peuvent soumettre pour
      // quelqu'un d'autre — un EMPLOYEE ne peut soumettre que pour lui-même.
      if (user.role === 'EMPLOYEE') {
        const isOwnEmployee = user.email && user.email === employee.email;
        if (!isOwnEmployee) {
          throw new ForbiddenException(
            'Vous ne pouvez soumettre une demande de congé que pour vous-même',
          );
        }
      }

      const start = new Date(createLeaveDto.startDate);
      const end = new Date(createLeaveDto.endDate);

      if (end < start)
        throw new BadRequestException(
          'La date de fin doit être après la date de début',
        );

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start < today)
        throw new BadRequestException(
          'La date de début ne peut pas être dans le passé',
        );

      // ✅ CORRECTIF : aucun contrôle de chevauchement n'existait — un
      // employé pouvait soumettre deux demandes qui se recoupent, ou le
      // solde se faire décompter deux fois si les deux étaient approuvées.
      await this.assertNoOverlap(createLeaveDto.employeeId, start, end);

      // ✅ Depuis la restructuration des types de congé : le modèle "Leave" ne
      // couvre plus que le congé annuel (normal ou anticipé). Maladie,
      // Maternité, Paternité, Mariage, Décès, etc. passent désormais par le
      // module Absences (conventionnelle/exceptionnelle), qui ne touche
      // jamais le solde de congé annuel.
      if (!['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(createLeaveDto.type)) {
        throw new BadRequestException(
          "Ce type de congé n'est plus géré ici — utilisez le module Absences (maladie, maternité, paternité, mariage, etc.).",
        );
      }

      // Congé annuel "normal" : le Code du travail congolais exige 12 mois de
      // service continu. Le congé "anticipé" existe précisément pour déroger
      // à cette règle — plafonné plus bas au solde déjà accumulé.
      if (createLeaveDto.type === 'ANNUAL') {
        const monthsWorked =
          (today.getTime() - new Date(employee.hireDate).getTime()) /
          (1000 * 60 * 60 * 24 * 30.44);
        if (monthsWorked < CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE) {
          const remaining = Math.ceil(
            CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE - monthsWorked,
          );
          throw new BadRequestException(
            `Conformément au Code du travail congolais, les congés annuels ne sont accessibles qu'après 12 mois de service continu. Ancienneté actuelle : ${Math.floor(monthsWorked)} mois. Encore ${remaining} mois requis. Pour un départ avant ce délai, utilisez le congé annuel anticipé.`,
          );
        }
      }

      const workingDays = await this.calculateWorkingDays(
        start,
        end,
        user.companyId,
      );
      if (workingDays === 0)
        throw new BadRequestException('Aucun jour ouvré dans cette période');

      // ✅ Le solde n'est plus décrémenté ici — seulement à la VALIDATION (updateStatus).
      // On garde un contrôle informatif pour bloquer une demande déjà clairement
      // impossible (empêche de demander plus que le solde actuel), mais le vrai
      // décompte se fait au moment où l'admin approuve, pas à la soumission.
      // Pour l'anticipé, c'est ce même contrôle qui fait office de plafond
      // légal : impossible de demander plus que ce qui est déjà accumulé à
      // la date de la demande.
      const balance = await this.getOrCreateLeaveBalance(
        createLeaveDto.employeeId,
      );
      if (Number(balance.annualRemaining) < workingDays) {
        throw new BadRequestException(
          createLeaveDto.type === 'ANNUAL_ANTICIPATED'
            ? `Pas assez de jours accumulés pour l'instant : ${Math.round(Number(balance.annualRemaining))} jour(s) disponible(s) à ce jour, ${workingDays} jour(s) demandé(s).`
            : `Solde insuffisant : ${Math.round(Number(balance.annualRemaining))} jour(s) disponible(s), ${workingDays} jour(s) demandé(s).`,
        );
      }

      const leave = await this.prisma.leave.create({
        data: {
          employeeId: createLeaveDto.employeeId,
          type: createLeaveDto.type,
          startDate: start,
          endDate: end,
          daysCount: workingDays,
          reason: createLeaveDto.reason || '',
          companyId: user.companyId,
          status: 'PENDING',
        },
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              position: true,
              photoUrl: true,
            },
          },
        },
      });

      await this.notificationsService.createForGroup(
        user.companyId,
        ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER', 'MANAGER'],
        {
          type: 'LEAVE_REQUEST',
          title: '📅 Nouvelle demande de congé',
          message: `${employee.firstName} ${employee.lastName} demande ${workingDays} jour(s) de ${this.leaveTypeLabel(createLeaveDto.type)} du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}`,
          link: '/conges',
          metadata: {
            leaveId: leave.id,
            employeeId: employee.id,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            daysCount: workingDays,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            type: createLeaveDto.type,
          },
        },
      );

      return leave;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      this.logger.error('Erreur création congé:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Erreur lors de la création de la demande de congé';
      throw new BadRequestException(message);
    }
  }

  // ============================================================================
  // 🖊️ PLANIFICATION MANUELLE (RH/Admin) — congé posé directement pour un
  //    employé, sans passer par le flux demande → validation. Créé
  //    directement APPROVED : c'est un VRAI congé au sens du moteur (décompte
  //    le solde, ferme le cycle si Annuel normal, exclut l'employé du calcul
  //    théorique du programme des départs — voir buildDepartureRows) donc il
  //    prime automatiquement sur toute projection automatique pour ce mois.
  //    overrideCompanyId : fourni par le cabinet controller
  // ============================================================================
  async createManual(
    dto: {
      employeeId: string;
      type: 'ANNUAL' | 'ANNUAL_ANTICIPATED';
      startDate: string;
      endDate: string;
      reason?: string;
    },
    userId: string,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasLeaveManagement',
    );

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: {
        id: true,
        companyId: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        hireDate: true,
      },
    });
    if (!employee) throw new EmployeeNotFoundException(dto.employeeId);
    if (employee.companyId !== user.companyId)
      throw new ForbiddenException(
        "Cet employé n'appartient pas à votre entreprise",
      );
    if (employee.status !== 'ACTIVE')
      throw new BadRequestException(
        `L'employé ${employee.firstName} ${employee.lastName} n'est pas actif`,
      );

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start)
      throw new BadRequestException(
        'La date de fin doit être après la date de début',
      );
    // ✅ Pas de restriction "pas dans le passé" ici — contrairement à
    // create() (demande employé), le RH doit pouvoir saisir un congé déjà
    // en cours ou même déjà passé (planification/rattrapage).

    if (!['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(dto.type)) {
      throw new BadRequestException(
        "Ce type de congé n'est plus géré ici — utilisez le module Absences.",
      );
    }

    const workingDays = await this.calculateWorkingDays(
      start,
      end,
      user.companyId,
    );
    if (workingDays === 0)
      throw new BadRequestException('Aucun jour ouvré dans cette période');

    // ✅ CORRECTIF : même garde-fou anti-chevauchement que create() — le RH
    // peut planifier n'importe quand, mais pas deux fois sur la même période.
    await this.assertNoOverlap(dto.employeeId, start, end);

    // ✅ CORRECTIF : on ne compare plus au solde du JOUR DE LA PLANIFICATION,
    // mais au solde PROJETÉ à la date de DÉPART du congé — sinon planifier à
    // l'avance (ex: en janvier pour un départ en octobre) était bloqué à
    // tort, alors qu'à la date du départ l'employé aura largement de quoi
    // couvrir le congé. Voir LeavesBalanceService.getProjectedBalanceAsOf().
    const projection = await this.getProjectedBalanceAsOf(
      dto.employeeId,
      start,
    );
    if (!projection.reliable) {
      throw new BadRequestException(projection.reason);
    }
    // ✅ Le RH doit être totalement libre de planifier/déplacer un départ
    // n'importe quand dans le cycle déjà ouvert, sans blocage de solde —
    // le droit total (26j + ancienneté) est acquis EN BLOC à la création du
    // cycle, pas au prorata mensuel écoulé. La seule contrainte qui reste
    // est celle ci-dessus : ne pas planifier un cycle qui n'a pas encore
    // ouvert. Pas de vérification `projectedRemaining < workingDays` ici.
    // Le cycle ciblé peut différer du cycle ouvert aujourd'hui (ex: on
    // planifie loin devant dans le même cycle mais avant qu'il ait fini
    // d'accumuler) — on récupère/persiste la bonne ligne de solde pour
    // décompter dessus, pas celle du cycle courant au jour de la saisie.
    const balance = await this.getOrCreateLeaveBalance(dto.employeeId, start);

    // ✅ Règle métier : l'indemnité d'un congé ANNUAL est payée le mois qui
    // PRÉCÈDE le départ (déc. pour un départ en jan.), jamais le mois des
    // dates réelles — et jamais pour ANNUAL_ANTICIPATED (l'employé "prend
    // juste un repos", son coût est absorbé dans ce paiement unique du
    // congé ANNUAL qui clôt le cycle). Voir getLeaveImpactForPayroll().
    let plannedPayrollMonth: number | null = null;
    let plannedPayrollYear: number | null = null;
    let payrollIndemnityDays: number | null = null;
    if (dto.type === 'ANNUAL') {
      const payMonth = start.getMonth() === 0 ? 12 : start.getMonth();
      const payYear =
        start.getMonth() === 0 ? start.getFullYear() - 1 : start.getFullYear();
      plannedPayrollMonth = payMonth;
      plannedPayrollYear = payYear;
      // Droit TOTAL du cycle (26j + ancienneté), pas seulement les jours de
      // ce congé précis — couvre aussi tout congé anticipé déjà pris plus
      // tôt dans le même cycle, jamais indemnisé à sa propre date.
      payrollIndemnityDays = Number(balance.annualEntitled);
    }

    const leave = await this.prisma.leave.create({
      data: {
        employeeId: dto.employeeId,
        companyId: user.companyId,
        type: dto.type,
        startDate: start,
        endDate: end,
        daysCount: workingDays,
        reason: dto.reason || 'Planifié directement par le RH/Admin',
        status: 'APPROVED',
        isManual: true,
        approvedBy: userId,
        approvedAt: new Date(),
        debitedCycleStartDate: balance.cycleStartDate,
        plannedPayrollMonth,
        plannedPayrollYear,
        payrollIndemnityDays,
      },
      include: {
        employee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    // ✅ Même décompte/fermeture de cycle qu'une validation normale (updateStatus)
    await this.prisma.leaveBalance.update({
      where: { id: balance.id },
      data: {
        annualTaken: { increment: workingDays },
        annualRemaining: { decrement: workingDays },
      },
    });
    if (dto.type === 'ANNUAL') {
      await this.prisma.employee.update({
        where: { id: dto.employeeId },
        data: { leaveCycleStartDate: end },
      });
    }

    const employeeUser = await this.prisma.user.findFirst({
      where: { email: employee.email, companyId: user.companyId },
      select: { id: true },
    });
    if (employeeUser) {
      await this.notificationsService.create({
        userId: employeeUser.id,
        type: 'LEAVE_APPROVED' as NotificationType,
        title: '📅 Congé planifié par le RH',
        message: `Un congé du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} (${workingDays}j) a été planifié pour vous.`,
        link: '/conges/mon-espace',
        metadata: {
          leaveId: leave.id,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          daysCount: workingDays,
        },
      });
    }

    this.logger.log(
      `🖊️ Congé planifié manuellement par ${userId} pour ${employee.firstName} ${employee.lastName} : ${workingDays}j du ${start.toISOString().slice(0, 10)} au ${end.toISOString().slice(0, 10)}`,
    );

    return leave;
  }

  // ============================================================================
  // 📋 LISTE DES CONGÉS
  // overrideCompanyId : fourni par le cabinet controller
  // ============================================================================

  async findAll(
    userId: string,
    employeeId?: string,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const whereClause: any = { companyId: user.companyId };

    const isCabinet =
      user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
    if (!isCabinet && user.role === 'MANAGER') {
      const deptId = await this.getManagerDepartmentId(userId, user.companyId);
      if (!deptId) return [];
      whereClause.employee = { departmentId: deptId };
    }

    if (employeeId) whereClause.employeeId = employeeId;

    return this.prisma.leave.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            photoUrl: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============================================================================
  // 👤 MES CONGÉS (employé connecté — pas utilisé par cabinet)
  // ============================================================================

  async findMyLeaves(userId: string) {
    const user = await this.getUserWithCompany(userId);
    const employee = await this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
    });
    if (!employee) throw new EmployeeNotFoundException();
    return this.prisma.leave.findMany({
      where: { employeeId: employee.id, companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);

    const leave = await this.prisma.leave.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            employeeNumber: true,
            hireDate: true,
            gender: true,
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
            city: true,
            phone: true,
            cachetUrl: true,
            documentFooterText: true,
          },
        },
        approvedByUser: { select: { firstName: true, lastName: true } },
        rejectedByUser: { select: { firstName: true, lastName: true } },
      },
    });

    if (!leave) throw new NotFoundException('Demande de congé introuvable');
    if (leave.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');

    const isCabinet =
      user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
    if (!isCabinet && user.role === 'MANAGER') {
      const deptId = await this.getManagerDepartmentId(userId, user.companyId);
      const empDeptId = await this.prisma.employee.findUnique({
        where: { id: leave.employeeId },
        select: { departmentId: true },
      });
      if (!deptId || empDeptId?.departmentId !== deptId) {
        throw new ForbiddenException("Vous n'avez pas accès à cette demande");
      }
    }

    // Solde du cycle en cours — utile pour afficher "jours restants" dans la lettre
    const balance = await this.getOrCreateLeaveBalance(leave.employeeId).catch(
      () => null,
    );

    return { ...leave, balance };
  }

  // ============================================================================
  // ✅ APPROUVER / REJETER
  // overrideCompanyId : fourni par le cabinet controller
  // ============================================================================

  async updateStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    userId: string,
    rejectionReason?: string,
    overrideCompanyId?: string,
    extraDaysGranted?: number,
    resumptionNote?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const leave = await this.prisma.leave.findUnique({
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

    if (!leave) throw new NotFoundException('Demande de congé introuvable');
    if (leave.companyId !== user.companyId)
      throw new ForbiddenException("Vous n'avez pas accès à cette demande");

    // ✅ Pour l'instant, seuls RH/Admin valident (pas de délégation "chef de
    // service" — un manager gère son équipe, pas les validations/l'argent).
    // Sera revu quand le système d'autorisations (accès attribués par l'admin)
    // sera en place.
    const allowedRoles = [
      'ADMIN',
      'SUPER_ADMIN',
      'HR_MANAGER',
      'CABINET_ADMIN',
      'CABINET_GESTIONNAIRE',
    ];
    if (!allowedRoles.includes(user.role))
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour approuver/rejeter",
      );
    if (leave.status !== 'PENDING')
      throw new BadRequestException('Cette demande a déjà été traitée');

    // ✅ Le solde est maintenant décrémenté ICI, à la validation — plus à la demande.
    // REJECTED n'a donc plus rien à restaurer (rien n'a été déduit avant ce point).
    // S'applique à ANNUAL et ANNUAL_ANTICIPATED — les deux seuls types encore
    // gérés par ce module, tous deux toujours payés et déductibles du solde.
    const isAnnualFamily = ['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(
      leave.type,
    );
    let debitedCycleStartDate: Date | undefined;
    let plannedPayrollMonth: number | undefined;
    let plannedPayrollYear: number | undefined;
    let payrollIndemnityDays: number | undefined;

    if (status === 'APPROVED' && isAnnualFamily) {
      // ✅ Même correctif que createManual() : projeté à la date de DÉPART
      // du congé, pas au jour où le RH clique sur "Valider" — une demande
      // posée/validée en avance ne doit pas être bloquée à tort parce que
      // le solde d'aujourd'hui n'a pas encore atteint son niveau au moment
      // du départ réel.
      const projection = await this.getProjectedBalanceAsOf(
        leave.employeeId,
        leave.startDate,
      );
      if (!projection.reliable) {
        throw new BadRequestException(projection.reason);
      }
      // ✅ Même logique que createManual() : pas de blocage sur le solde
      // projeté ici — seule la contrainte "cycle pas encore ouvert"
      // ci-dessus reste appliquée.
      const balance = await this.getOrCreateLeaveBalance(
        leave.employeeId,
        leave.startDate,
      );
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          annualTaken: { increment: leave.daysCount },
          annualRemaining: { decrement: leave.daysCount },
        },
      });
      // ✅ Mémorise le cycle exact débité — indispensable pour restaurer le
      // bon solde si ce congé est annulé plus tard (voir cancel()) : une fois
      // employee.leaveCycleStartDate avancé plus bas, on ne peut plus
      // retrouver ce cycle en le recalculant "à l'instant présent".
      debitedCycleStartDate = balance.cycleStartDate;

      // ✅ Même règle que createManual() : indemnité ANNUAL programmée sur
      // le mois précédant le départ, jamais sur ANNUAL_ANTICIPATED. Voir
      // getLeaveImpactForPayroll().
      if (leave.type === 'ANNUAL') {
        plannedPayrollMonth =
          leave.startDate.getMonth() === 0 ? 12 : leave.startDate.getMonth();
        plannedPayrollYear =
          leave.startDate.getMonth() === 0
            ? leave.startDate.getFullYear() - 1
            : leave.startDate.getFullYear();
        payrollIndemnityDays = Number(balance.annualEntitled);
      }

      // ✅ Le cycle d'acquisition de 12 mois ne redémarre que sur un congé
      // ANNUEL normal (celui qui clôt le cycle) — pas sur un anticipé, qui
      // ne fait que puiser dans le cycle en cours sans le clôturer.
      if (leave.type === 'ANNUAL') {
        await this.prisma.employee.update({
          where: { id: leave.employeeId },
          data: { leaveCycleStartDate: leave.endDate },
        });
      }
    }

    if (status === 'APPROVED' && isAnnualFamily) {
      const { indemnity, basedOnAverage, monthsUsed, method } =
        await this.calculateLeaveIndemnity(
          leave.employeeId,
          Number(leave.daysCount),
          leave.companyId,
        );
      this.logger.log(
        `✅ Congé ${id} approuvé — Indemnité [${method}]: ${indemnity} F (base: ${Math.round(basedOnAverage)} F/mois sur ${monthsUsed} mois)`,
      );
    }

    const updatedLeave = await this.prisma.leave.update({
      where: { id },
      data: {
        status,
        approvedBy: status === 'APPROVED' ? userId : undefined,
        approvedAt: status === 'APPROVED' ? new Date() : undefined,
        rejectedBy: status === 'REJECTED' ? userId : undefined,
        rejectedAt: status === 'REJECTED' ? new Date() : undefined,
        rejectionReason: status === 'REJECTED' ? rejectionReason : undefined,
        extraDaysGranted: status === 'APPROVED' ? extraDaysGranted : undefined,
        resumptionNote: status === 'APPROVED' ? resumptionNote : undefined,
        debitedCycleStartDate,
        plannedPayrollMonth,
        plannedPayrollYear,
        payrollIndemnityDays,
      },
    });

    const notifType =
      status === 'APPROVED'
        ? ('LEAVE_APPROVED' as NotificationType)
        : ('LEAVE_REJECTED' as NotificationType);
    const notifTitle =
      status === 'APPROVED' ? '✅ Congé approuvé' : '❌ Congé refusé';
    const notifMessage =
      status === 'APPROVED'
        ? `Votre congé du ${new Date(leave.startDate).toLocaleDateString('fr-FR')} au ${new Date(leave.endDate).toLocaleDateString('fr-FR')} a été approuvé`
        : `Votre congé du ${new Date(leave.startDate).toLocaleDateString('fr-FR')} au ${new Date(leave.endDate).toLocaleDateString('fr-FR')} a été refusé${rejectionReason ? ` : ${rejectionReason}` : ''}`;

    const employeeUser = await this.prisma.user.findFirst({
      where: { email: leave.employee.email, companyId: leave.companyId },
      select: { id: true },
    });
    if (employeeUser) {
      await this.notificationsService.create({
        userId: employeeUser.id,
        type: notifType,
        title: notifTitle,
        message: notifMessage,
        link: '/conges/mon-espace',
        metadata: {
          leaveId: leave.id,
          status,
          startDate: leave.startDate.toISOString(),
          endDate: leave.endDate.toISOString(),
          daysCount: leave.daysCount,
        },
      });
    }

    if (status === 'APPROVED')
      await this.mailService.sendLeaveApproval(leave.employee, leave);
    else
      await this.mailService.sendLeaveRejection(
        leave.employee,
        leave,
        rejectionReason,
      );

    return updatedLeave;
  }

  // ============================================================================
  // 📅 REPLANIFIER — déplacer les dates d'un congé déjà planifié/approuvé
  // ============================================================================
  // ✅ Le RH est libre de bouger un départ quand il veut (ex: prévu le 2,
  // repoussé au 10) SANS blocage de solde et SANS que ça ajoute des jours en
  // plus au solde — ce n'est pas un nouveau congé, juste le même déplacé
  // dans le temps. On ajuste seulement l'ÉCART (nouveaux jours ouvrés moins
  // anciens), pas le total. Marche aussi bien sur un congé déjà validé que
  // sur une demande encore en attente (PENDING) — dans ce dernier cas rien
  // n'a encore été débité du solde, donc aucun ajustement n'est fait.
  // ⚠️ Volontairement PAS bloquant même si l'écart dépasse le solde restant
  // (le RH reste décideur) — on journalise juste un avertissement pour qu'il
  // le voie, sans l'empêcher d'agir.
  // ⚠️ Le mois de paiement de l'indemnité (plannedPayrollMonth/Year,
  // payrollIndemnityDays) N'EST PAS recalculé ici, volontairement — il reste
  // celui fixé à la planification initiale (règle : l'indemnité reste payée
  // au mois initialement prévu, même si les dates bougent ensuite).
  async rescheduleLeave(
    id: string,
    userId: string,
    newStart: Date,
    newEnd: Date,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Congé introuvable');
    if (leave.companyId !== user.companyId)
      throw new ForbiddenException("Vous n'avez pas accès à ce congé");
    if (!['APPROVED', 'PENDING'].includes(leave.status))
      throw new BadRequestException(
        'Seul un congé en attente ou déjà approuvé/planifié peut être déplacé (pas un congé rejeté ou annulé)',
      );
    if (newEnd < newStart)
      throw new BadRequestException(
        'La date de fin doit être après la date de début',
      );

    const newWorkingDays = await this.calculateWorkingDays(
      newStart,
      newEnd,
      user.companyId,
    );
    if (newWorkingDays === 0)
      throw new BadRequestException('Aucun jour ouvré dans cette période');

    const oldWorkingDays = Number(leave.daysCount);
    const delta = newWorkingDays - oldWorkingDays;

    // La ligne de solde déjà débitée reste la même (debitedCycleStartDate),
    // qu'importe où tombent les nouvelles dates — on ajuste juste l'écart
    // dessus, pas de re-décompte complet ni de nouvelle recherche de cycle.
    let updatedBalance: { annualRemaining: number } | null = null;
    if (leave.debitedCycleStartDate && delta !== 0) {
      const balance = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_cycleStartDate: {
            employeeId: leave.employeeId,
            cycleStartDate: leave.debitedCycleStartDate,
          },
        },
      });
      if (balance) {
        const updated = await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: {
            annualTaken: { increment: delta },
            annualRemaining: { decrement: delta },
          },
        });
        updatedBalance = {
          annualRemaining: Number(updated.annualRemaining),
        };
        if (Number(updated.annualRemaining) < 0) {
          this.logger.warn(
            `⚠️ Replanification de ${id} : solde restant négatif ` +
              `(${Number(updated.annualRemaining)}j) pour l'employé ${leave.employeeId} ` +
              `— autorisé (RH décideur), à surveiller.`,
          );
        }
      }
    }

    const updated = await this.prisma.leave.update({
      where: { id },
      data: {
        startDate: newStart,
        endDate: newEnd,
        daysCount: newWorkingDays,
      },
    });

    return { ...updated, balanceAfter: updatedBalance };
  }

  // ============================================================================
  // ❌ ANNULER
  // ============================================================================

  async cancel(
    id: string,
    userId: string,
    reason?: string,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const leave = await this.prisma.leave.findUnique({ where: { id } });

    if (!leave) throw new NotFoundException('Demande de congé introuvable');
    if (leave.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (!['PENDING', 'APPROVED'].includes(leave.status))
      throw new BadRequestException('Ce congé ne peut plus être annulé');

    // ✅ Restaurer le solde seulement si le congé était déjà APPROVED (donc déjà
    // déduit à la validation). Un congé encore PENDING annulé n'a jamais touché
    // le solde — rien à restaurer.
    // ✅ CORRECTIF (Claude, 12/08/2026) : restaurait auparavant sur le cycle
    // "actuel au moment de l'annulation" via getOrCreateLeaveBalance(now) — or
    // employee.leaveCycleStartDate a pu avancer depuis (nouveaux congés
    // validés entre-temps), donc "actuel" n'est plus forcément le cycle qui a
    // réellement été débité par CE congé. On restaure maintenant sur le cycle
    // exact mémorisé à la validation (debitedCycleStartDate).
    const isAnnualFamily = ['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(
      leave.type,
    );
    if (isAnnualFamily && leave.status === 'APPROVED') {
      const balance = leave.debitedCycleStartDate
        ? await this.prisma.leaveBalance.findUnique({
            where: {
              employeeId_cycleStartDate: {
                employeeId: leave.employeeId,
                cycleStartDate: leave.debitedCycleStartDate,
              },
            },
          })
        : // Congés créés avant ce correctif (pas de debitedCycleStartDate en
          // base) — on retombe sur l'ancien comportement en dernier recours.
          await this.getOrCreateLeaveBalance(leave.employeeId);

      if (balance) {
        await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: {
            annualTaken: { decrement: leave.daysCount },
            annualRemaining: { increment: leave.daysCount },
          },
        });
      }

      // ✅ Un congé ANNUAL (normal) ferme le cycle à sa validation
      // (leaveCycleStartDate = leave.endDate). On ne le rouvre que si AUCUN
      // congé plus récent n'a depuis refermé un nouveau cycle par-dessus —
      // sinon on écraserait un état plus récent et légitime.
      if (leave.type === 'ANNUAL' && leave.debitedCycleStartDate) {
        const employee = await this.prisma.employee.findUnique({
          where: { id: leave.employeeId },
          select: { leaveCycleStartDate: true },
        });
        const stillCurrent =
          employee?.leaveCycleStartDate &&
          leave.endDate &&
          new Date(employee.leaveCycleStartDate).getTime() ===
            new Date(leave.endDate).getTime();
        if (stillCurrent) {
          await this.prisma.employee.update({
            where: { id: leave.employeeId },
            data: { leaveCycleStartDate: leave.debitedCycleStartDate },
          });
        }
      }
    }

    return this.prisma.leave.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });
  }

  // ============================================================================
  // 🖨️ DOCUMENTS IMPRIMABLES
  // ============================================================================

  /**
   * Données entièrement résolues pour le rendu du document imprimable
   * (modèle générique ou modèle client type Orca) : employé, département,
   * responsable (chef de département ou admin par défaut), branding entreprise.
   */
  async getDocumentData(
    id: string,
    userId: string,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);

    const leave = await this.prisma.leave.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            position: true,
            department: { select: { id: true, name: true, managerId: true } },
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
    if (!leave) throw new NotFoundException('Demande de congé introuvable.');

    // ✅ CORRECTIF SÉCURITÉ : aucune vérification d'entreprise n'existait ici —
    // n'importe quel utilisateur authentifié (de N'IMPORTE QUELLE entreprise
    // sur toute la plateforme) pouvait récupérer les données/le .docx de la
    // demande de congé de N'IMPORTE QUELLE autre entreprise en devinant/
    // trouvant un UUID (nom, motif du congé, RCCM, adresse, logo...).
    if (leave.companyId !== user.companyId) {
      throw new ForbiddenException('Accès refusé');
    }

    const isHrOrAdmin = [
      'ADMIN',
      'SUPER_ADMIN',
      'HR_MANAGER',
      'CABINET_ADMIN',
      'CABINET_GESTIONNAIRE',
    ].includes(user.role);

    if (!isHrOrAdmin) {
      if (user.role === 'MANAGER') {
        const deptId = await this.getManagerDepartmentId(
          userId,
          user.companyId,
        );
        if (!deptId || leave.employee.department?.id !== deptId) {
          throw new ForbiddenException("Vous n'avez pas accès à ce document");
        }
      } else {
        // ✅ CORRECTIF SÉCURITÉ : le drapeau printAuthorized n'était vérifié
        // que côté front (boutons grisés) — un employé pouvait appeler cette
        // route directement (ou celle du .docx) pour récupérer le document
        // d'un AUTRE employé de sa propre entreprise, ou le sien avant même
        // que le RH n'ait autorisé l'impression.
        const isOwnLeave = user.email && user.email === leave.employee.email;
        if (!isOwnLeave) {
          throw new ForbiddenException("Vous n'avez pas accès à ce document");
        }
        if (!leave.printAuthorized) {
          throw new ForbiddenException(
            "L'impression de ce document n'a pas encore été autorisée par le RH.",
          );
        }
      }
    }

    const responsableName = await resolveResponsableName(
      this.prisma,
      leave.companyId,
      leave.employee.department?.managerId,
    );

    return {
      id: leave.id,
      type: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
      daysCount: leave.daysCount,
      reason: leave.reason,
      status: leave.status,
      printAuthorized: leave.printAuthorized,
      employee: {
        firstName: leave.employee.firstName,
        lastName: leave.employee.lastName,
        position: leave.employee.position,
        departmentName: leave.employee.department?.name ?? '',
      },
      responsableName,
      company: leave.company,
    };
  }

  /**
   * Génère le .docx "congé annuel" Orca rempli — écrit directement dans leur
   * fichier original (voir src/documents/orca-word.util.ts), pas une
   * reproduction HTML. Uniquement pour les entreprises documentTemplate=ORCA.
   */
  async generateOrcaDocument(
    leaveId: string,
    userId: string,
    overrideCompanyId?: string,
  ): Promise<Buffer> {
    const data = await this.getDocumentData(leaveId, userId, overrideCompanyId);
    if (data.company?.documentTemplate !== 'ORCA') {
      throw new BadRequestException(
        "Cette entreprise n'utilise pas le modèle de document Orca.",
      );
    }

    const CHECKED = ' ☑';
    const UNCHECKED = ' ☐';
    const fmtDate = (d: any) => {
      if (!d) return '……………………';
      const date = new Date(d);
      return isNaN(date.getTime())
        ? '……………………'
        : date.toLocaleDateString('fr-FR');
    };
    const validated = data.status === 'APPROVED';

    const fillData: Record<string, string> = {
      nom: (data.employee.lastName || '').toUpperCase(),
      prenoms: data.employee.firstName || '',
      departement: data.employee.departmentName || '',
      fonction: data.employee.position || '',
      responsable: data.responsableName || '',
      motif: data.reason || '',
      date_depart: fmtDate(data.startDate),
      date_retour: fmtDate(data.endDate),
      nombre_jours: String(data.daysCount ?? ''),
      check_annuel: CHECKED,
      check_matpat: UNCHECKED,
      check_exceptionnel: UNCHECKED,
      check_paye: CHECKED,
      check_nonpaye: UNCHECKED,
      check_accord: validated ? CHECKED : UNCHECKED,
      check_refus: data.status === 'REJECTED' ? CHECKED : UNCHECKED,
    };

    let buffer = fillOrcaWordTemplate(getOrcaTemplateFile('conge'), fillData);

    if (validated && data.company?.cachetUrl) {
      try {
        const cachetBuffer = await fetchImageBuffer(data.company.cachetUrl);
        buffer = swapCachetImage(
          buffer,
          cachetBuffer,
          ORCA_CACHET_MEDIA_FILE.conge,
        );
      } catch {
        // Cachet indisponible — le document sort quand même, juste sans cachet
      }
    }

    return buffer;
  }

  /**
   * Autorise (ou retire l'autorisation) l'impression du document de congé
   * par l'employé. Réservé RH/Admin, uniquement sur une demande déjà validée.
   */
  async setPrintAuthorization(
    id: string,
    authorized: boolean,
    userId: string,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Demande de congé introuvable.');
    // ✅ CORRECTIF SÉCURITÉ : aucune vérification d'entreprise n'existait ici —
    // un RH/Admin (de N'IMPORTE QUELLE entreprise) pouvait autoriser/retirer
    // l'impression d'une demande de congé appartenant à une AUTRE entreprise.
    if (leave.companyId !== user.companyId) {
      throw new ForbiddenException('Accès refusé');
    }
    if (leave.status !== 'APPROVED') {
      throw new BadRequestException(
        "La demande doit être validée avant d'autoriser l'impression.",
      );
    }

    return this.prisma.leave.update({
      where: { id },
      data: {
        printAuthorized: authorized,
        printAuthorizedBy: userId,
        printAuthorizedAt: new Date(),
      },
    });
  }

  // ============================================================================
  // 📆 PLANNING MENSUEL & DIVERS
  // ============================================================================

  async getTakenDaysInMonth(
    employeeId: string,
    month: number,
    year: number,
  ): Promise<number> {
    const impact = await this.getLeaveImpactForPayroll(employeeId, month, year);
    return impact?.leaveDays ?? 0;
  }

  private leaveTypeLabel(type: LeaveType): string {
    const labels: Record<string, string> = {
      ANNUAL: 'congé annuel',
      ANNUAL_ANTICIPATED: 'congé annuel anticipé',
      // Valeurs historiques — plus créables depuis la restructuration, conservées pour l'affichage de l'historique
      SICK: 'congé maladie',
      MATERNITY: 'congé maternité',
      PATERNITY: 'congé paternité',
      UNPAID: 'congé sans solde',
      COMPENSATORY: 'congé compensatoire',
    };
    return labels[type] ?? type;
  }

  async getMonthlyPlanning(
    userId: string,
    month: number,
    year: number,
    overrideCompanyId?: string,
    mode: 'departures' | 'payable' = 'departures',
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const companyId = user.companyId;

    let managerDeptId: string | null = null;
    if (user.role === 'MANAGER') {
      managerDeptId = await this.getManagerDepartmentId(userId, companyId);
      if (!managerDeptId) return [];
    }
    const inManagerDept = (row: any) =>
      !managerDeptId || (row.employee as any)?.department?.id === managerDeptId;

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);

    if (mode === 'departures') {
      // ✅ CORRECTIF (demande explicite) : cette page n'affichait QUE les
      // congés déjà planifiés/validés (table Leave) — on ne savait donc
      // rien des employés pas encore planifiés. On réutilise
      // buildDepartureRows() (déjà partagé avec /programme) qui fusionne
      // les congés réels ET les départs théoriques (cycle qui boucle ce
      // mois-ci, projeté sur le solde restant) — tout le monde apparaît,
      // planifié ou non. Une ligne théorique redevient automatiquement une
      // ligne réelle dès qu'un vrai congé est créé/validé pour cet employé
      // sur la période (buildDepartureRows exclut alors le théorique).
      const rows = await this.buildDepartureRows(companyId, startOfMonth, endOfMonth);
      return rows.filter(inManagerDept);
    }

    // ============================================================================
    // mode === 'payable' — fusion réel + théorique, chacun avec son ancrage
    // ============================================================================
    // 1) RÉEL : congés déjà planifiés/validés, montant ancré sur
    //    plannedPayrollMonth/Year — FIGÉ à la planification initiale, ne
    //    bouge jamais si le congé est repoussé ensuite (voir rescheduleLeave).
    const realWhere: any = {
      companyId,
      status: { in: ['APPROVED', 'PENDING'] },
      OR: [
        { plannedPayrollMonth: month, plannedPayrollYear: year },
        {
          plannedPayrollMonth: null,
          type: 'ANNUAL',
          startDate: { gte: startOfMonth, lte: endOfMonth },
        },
      ],
    };
    if (managerDeptId) realWhere.employee = { departmentId: managerDeptId };

    const realLeaves = await this.prisma.leave.findMany({
      where: realWhere,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            hireDate: true,
            contractType: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });
    const realEmployeeIds = new Set(realLeaves.map((l) => l.employeeId));

    const realRows = await Promise.all(
      realLeaves.map(async (leave) => {
        let indemnity = 0;
        let monthsKnown: number | null = null;
        try {
          const totalDays = leave.payrollIndemnityDays
            ? Number(leave.payrollIndemnityDays)
            : Number(leave.daysCount);
          const result = await this.calculateLeaveIndemnity(
            leave.employeeId,
            totalDays,
            companyId,
            month,
            year,
          );
          indemnity = result.indemnity;
          monthsKnown = result.monthsUsed;
        } catch {
          /* employé sans historique de paie suffisant — 0 par défaut */
        }
        return { ...leave, indemnityAmount: indemnity, monthsKnown, isTheoretical: false };
      }),
    );

    // 2) THÉORIQUE : employés PAS ENCORE planifiés, dont le cycle boucle le
    //    mois SUIVANT (donc payables CE mois-ci, la règle "indemnité payée
    //    le mois avant le départ" s'applique aussi aux départs projetés).
    //    ✅ Reste stable tant qu'aucun vrai congé n'est créé pour eux — le
    //    cycle (et donc ce mois de paiement projeté) ne bouge que si un
    //    congé ANNUAL est réellement validé, jamais par un simple brouillon.
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextPeriodStart = new Date(nextYear, nextMonth - 1, 1);
    const nextPeriodEnd = new Date(nextYear, nextMonth, 0, 23, 59, 59);

    const nextMonthRows = await this.buildDepartureRows(
      companyId,
      nextPeriodStart,
      nextPeriodEnd,
    );
    const theoreticalRows = await Promise.all(
      nextMonthRows
        .filter((r) => r.isTheoretical && !realEmployeeIds.has(r.employeeId))
        .filter(inManagerDept)
        .map(async (r) => {
          let indemnity = 0;
          let monthsKnown: number | null = null;
          try {
            const result = await this.calculateLeaveIndemnity(
              r.employeeId,
              r.daysCount,
              companyId,
              month,
              year,
            );
            indemnity = result.indemnity;
            monthsKnown = result.monthsUsed;
          } catch {
            /* employé sans historique de paie suffisant — 0 par défaut */
          }
          return {
            id: r.id,
            employeeId: r.employeeId,
            employee: r.employee,
            type: r.type,
            startDate: r.startDate,
            endDate: r.endDate,
            daysCount: r.daysCount,
            status: 'PREVU',
            isTheoretical: true,
            isManual: false,
            indemnityAmount: indemnity,
            monthsKnown,
          };
        }),
    );

    return [...realRows.filter(inManagerDept), ...theoreticalRows].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
  }

  // ============================================================================
  // 🆕 PROGRAMME DES DÉPARTS — page publique (tous les employés)
  // ✅ Distinct de getMonthlyPlanning (qui reste réservé RH/Admin, avec les
  //    montants à payer — confidentiel). Ici JAMAIS d'indemnityAmount dans
  //    la réponse.
  // ✅ Fusionne deux sources pour un mois donné :
  //    1) Les congés ANNUAL/ANNUAL_ANTICIPATED déjà APPROVED sur la période
  //       (départs anticipés validés, ou départs normaux déjà posés).
  //    2) Les départs "théoriques" : employés actifs dont le cycle
  //       d'acquisition boucle ce mois-ci (mois conventionnel, basé sur
  //       hireDate/leaveCycleStartDate) et qui n'ont PAS déjà un congé
  //       APPROVED sur la période. La durée affichée est le solde restant
  //       (annualRemaining) du cycle, pas le plafond de 26j — si l'employé a
  //       déjà anticipé une partie de son solde plus tôt dans l'année, il ne
  //       lui reste que le solde résiduel à poser sur son mois conventionnel.
  //       Si annualRemaining <= 0, l'employé n'apparaît pas (rare : suppose
  //       un solde reporté sur plusieurs années, cas à sécuriser plus tard).
  // ============================================================================
  /**
   * 🔁 Calcule les départs (réels validés + théoriques prévisionnels) pour un
   * mois donné — logique PARTAGÉE entre /programme (JSON pour le front) et
   * l'export Excel ORCA (.xlsx), pour que les deux rendus soient toujours
   * identiques et bénéficient des mêmes correctifs de calcul de cycle.
   */
  private async buildDepartureRows(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<
    Array<{
      id: string;
      employeeId: string;
      employee: any;
      type: string;
      startDate: Date;
      endDate: Date;
      daysCount: number;
      status: string;
      isTheoretical: boolean;
      isManual: boolean;
    }>
  > {
    const employeeSelect = {
      firstName: true,
      lastName: true,
      position: true,
      contractType: true,
      hireDate: true,
      department: { select: { id: true, name: true } },
    };

    // 1) Départs réels — congé annuel/anticipé déjà validés, dont le DÉPART
    //    tombe dans le mois demandé (pas juste un chevauchement de période —
    //    sinon un congé qui traverse 2 mois apparaîtrait dans les deux).
    const realLeaves = await this.prisma.leave.findMany({
      where: {
        companyId,
        type: { in: ['ANNUAL', 'ANNUAL_ANTICIPATED'] },
        status: 'APPROVED',
        startDate: { gte: periodStart, lte: periodEnd },
      },
      include: { employee: { select: employeeSelect } },
      orderBy: { startDate: 'asc' },
    });

    const realEmployeeIds = new Set(realLeaves.map((l) => l.employeeId));

    const rows: Array<{
      id: string;
      employeeId: string;
      employee: any;
      type: string;
      startDate: Date;
      endDate: Date;
      daysCount: number;
      status: string;
      isTheoretical: boolean;
      isManual: boolean;
    }> = realLeaves.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      employee: l.employee,
      type: l.type,
      startDate: l.startDate,
      endDate: l.endDate,
      daysCount: Number(l.daysCount),
      status: l.status,
      isTheoretical: false,
      isManual: l.isManual,
    }));

    // 2) Départs théoriques — employés actifs, cycle qui boucle ce mois-ci,
    //    pas déjà couverts par un congé validé trouvé à l'étape 1
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        id: { notIn: Array.from(realEmployeeIds) },
      },
      select: {
        id: true,
        leaveCycleStartDate: true,
        ...employeeSelect,
      },
    });

    for (const emp of employees) {
      const { cycleEndDate } = resolveCycleWindow(
        new Date(emp.hireDate),
        emp.leaveCycleStartDate ? new Date(emp.leaveCycleStartDate) : null,
        periodStart, // ✅ résout le cycle par rapport au mois filtré, pas à "aujourd'hui"
      );
      if (cycleEndDate < periodStart || cycleEndDate > periodEnd) continue;

      let remaining = 0;
      try {
        const balance = await this.balanceService.getOrCreateLeaveBalance(
          emp.id,
          cycleEndDate,
        );
        remaining = Number(balance.annualRemaining);
      } catch {
        continue; // pas de solde exploitable — on ignore plutôt que d'afficher une ligne fausse
      }
      if (remaining <= 0) continue; // solde déjà entièrement pris en anticipé

      let endDate: Date;
      try {
        const returnCalc = await WorkingDays.calculateReturnDate(
          this.prisma,
          companyId,
          cycleEndDate,
          remaining,
        );
        endDate = new Date(returnCalc.returnDate);
      } catch (e: any) {
        // ✅ Une valeur aberrante chez UN employé (solde corrompu, reprise
        // manuelle erronée, etc.) ne doit pas faire disparaître tout le
        // programme du mois pour tout le monde — on l'exclut et on logue
        // pour investigation au lieu de laisser l'exception remonter.
        this.logger.warn(
          `⚠️ Programme des départs : impossible de calculer la date de retour pour ${emp.firstName} ${emp.lastName} (${emp.id}), solde restant=${remaining}j, cycleEndDate=${cycleEndDate.toISOString().slice(0, 10)} — ligne ignorée. ${e?.message ?? e}`,
        );
        continue;
      }

      rows.push({
        id: `theoretical-${emp.id}`,
        employeeId: emp.id,
        employee: {
          firstName: emp.firstName,
          lastName: emp.lastName,
          position: emp.position,
          contractType: emp.contractType,
          department: emp.department,
        },
        type: 'ANNUAL',
        startDate: cycleEndDate,
        endDate,
        daysCount: remaining,
        status: 'PREVU',
        isTheoretical: true,
        isManual: false,
      });
    }

    rows.sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );

    return rows;
  }

  async getDepartureProgram(
    userId: string,
    month: number,
    year: number,
    companyIdOverride?: string,
  ) {
    const user = await this.getUserWithCompany(userId, companyIdOverride);
    const companyId = user.companyId;

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59);

    const rows = await this.buildDepartureRows(companyId, periodStart, periodEnd);

    const stats = {
      count: rows.length,
      totalDays: rows.reduce((s, r) => s + Number(r.daysCount || 0), 0),
    };

    return { period: { month, year }, rows, stats };
  }
}