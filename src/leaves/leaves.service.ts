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

  // ✅ Solde TOTAL réel (somme de tous les cycles non soldés) — à utiliser
  // partout où un solde doit être affiché/figé de façon fiable (bulletins,
  // simulation, vérification avant congé). Voir LeavesBalanceService pour
  // le détail du correctif.
  async getTotalLeaveBalanceSummary(employeeId: string) {
    return this.balanceService.getTotalLeaveBalanceSummary(employeeId);
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
        // ✅ Un rattrapage de reliquat (carriedFromLeaveId) n'est jamais payé
        // — voir createCarryoverLeave().
        isPaid: !l.carriedFromLeaveId,
        // ✅ Retour anticipé — exposé ici pour que la page Gestion puisse
        // signaler directement dans la liste (sans ouvrir le détail) qu'un
        // congé s'est terminé plus tôt que prévu et que des jours posés
        // n'ont pas été pris (voir confirmLeaveReturn / forfeitedDays).
        returnConfirmed: l.returnConfirmed,
        actualReturnDate: l.actualReturnDate,
        forfeitedDays: l.forfeitedDays ? Number(l.forfeitedDays) : 0,
        // ✅ Rattrapage de reliquat — voir createCarryoverLeave().
        isCarryover: !!l.carriedFromLeaveId,
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
        returnConfirmed: false,
        actualReturnDate: null,
        forfeitedDays: 0,
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

    // ✅ Retours anticipés en attente — PAS filtré par mois/année affiché :
    // c'est un pense-bête permanent pour le RH ("cet employé est rentré plus
    // tôt, il lui reste Xj à reprogrammer"), purement informatif. Les jours
    // restent légalement non reversés au solde (voir confirmLeaveReturn) —
    // ceci ne change rien à ça, ça évite juste de l'oublier. Limité aux 30
    // plus récents pour rester lisible.
    const earlyReturnLeaves = await this.prisma.leave.findMany({
      where: {
        companyId,
        returnConfirmed: true,
        forfeitedDays: { gt: 0 },
      },
      include: { employee: { select: employeeSelect } },
      orderBy: { actualReturnDate: 'desc' },
      take: 30,
    });
    const earlyReturns = earlyReturnLeaves.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      employee: l.employee,
      type: l.type,
      startDate: l.startDate,
      endDate: l.endDate,
      actualReturnDate: l.actualReturnDate,
      forfeitedDays: Number(l.forfeitedDays),
    }));

    return { period: { month, year }, kpis, events, earlyReturns };
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
        isPaid: !l.carriedFromLeaveId,
        reason: l.reason,
        // ✅ Retour anticipé (voir getManagementOverview pour le détail)
        returnConfirmed: l.returnConfirmed,
        actualReturnDate: l.actualReturnDate,
        forfeitedDays: l.forfeitedDays ? Number(l.forfeitedDays) : 0,
        // ✅ Rattrapage de reliquat — voir createCarryoverLeave().
        isCarryover: !!l.carriedFromLeaveId,
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
      await this.subscriptionGuard.assertActionAllowed(
        user.companyId,
        user.role,
      );
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

      // ============================================================================
      // ↩️ DEMANDE DE RATTRAPAGE D'UN RELIQUAT DE RETOUR ANTICIPÉ (demande
      // explicite) — chemin totalement séparé du congé annuel classique :
      // part en PENDING comme une demande normale (le RH valide/refuse comme
      // toujours), mais ne touche JAMAIS le solde/cycle en cours ni son
      // indemnité, et n'est jamais soumise aux règles ci-dessous (12 mois de
      // service, solde suffisant, motif obligatoire...) qui ne concernent
      // que le cycle normal.
      // ============================================================================
      if (createLeaveDto.carriedFromLeaveId) {
        return this.createCarryoverRequest(
          createLeaveDto,
          employee,
          start,
          end,
          userId,
          user.companyId,
        );
      }

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
      // ✅ CORRECTIF (demande explicite) : ce n'est plus jamais un blocage,
      // même pour une demande faite par l'employé lui-même — seulement un
      // avertissement (loggé + visible côté frontend via
      // `earlyDepartureWarning` dans la réponse). La demande part quand même
      // vers le RH, qui décide à la validation en fonction du solde réel à
      // ce moment-là (voir updateStatus, qui n'a jamais bloqué non plus).
      let earlyDepartureWarning: string | undefined;
      if (createLeaveDto.type === 'ANNUAL') {
        const monthsWorked =
          (today.getTime() - new Date(employee.hireDate).getTime()) /
          (1000 * 60 * 60 * 24 * 30.44);
        if (monthsWorked < CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE) {
          const remaining = Math.ceil(
            CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE - monthsWorked,
          );
          earlyDepartureWarning = `Conformément au Code du travail congolais, les congés annuels ne sont normalement accessibles qu'après 12 mois de service continu. Ancienneté actuelle : ${Math.floor(monthsWorked)} mois. Il manque ${remaining} mois. Pour un départ avant ce délai, le congé annuel anticipé est recommandé. La demande est tout de même transmise — le RH décidera à la validation.`;
          this.logger.warn(
            `⚠️ Demande de congé ANNUAL soumise avant 12 mois de service pour ${employee.firstName} ${employee.lastName} (${Math.floor(monthsWorked)} mois) — transmise pour validation RH (par ${user.role}, ${userId}), non bloquée.`,
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

      // ✅ CORRECTIF (demande explicite) : le solde n'est décrémenté qu'à la
      // VALIDATION (updateStatus), jamais ici — et on ne bloque plus non
      // plus la SOUMISSION d'une demande qui dépasse le solde actuel. Le
      // solde à la date de départ peut légitimement changer d'ici la
      // validation (autres congés annulés, cycle qui avance...) — c'est au
      // RH de trancher avec le solde réel au moment où il valide, pas à
      // l'employé/l'admin d'être bloqué à la saisie sur un solde qui n'est
      // qu'une photo du jour de la demande. On se contente d'un
      // avertissement (`insufficientBalanceWarning` dans la réponse).
      const balance = await this.getOrCreateLeaveBalance(
        createLeaveDto.employeeId,
      );
      let insufficientBalanceWarning: string | undefined;
      if (Number(balance.annualRemaining) < workingDays) {
        insufficientBalanceWarning =
          createLeaveDto.type === 'ANNUAL_ANTICIPATED'
            ? `Pas assez de jours accumulés pour l'instant : ${Math.round(Number(balance.annualRemaining))} jour(s) disponible(s) à ce jour, ${workingDays} jour(s) demandé(s). La demande est tout de même transmise — le RH décidera à la validation, selon le solde réel à ce moment-là.`
            : `Solde insuffisant à ce jour : ${Math.round(Number(balance.annualRemaining))} jour(s) disponible(s), ${workingDays} jour(s) demandé(s). La demande est tout de même transmise — le RH décidera à la validation, selon le solde réel à ce moment-là.`;
        this.logger.warn(
          `⚠️ Demande de congé au-delà du solde actuel pour ${employee.firstName} ${employee.lastName} (${workingDays}j demandés, ${Number(balance.annualRemaining)}j restants) — transmise pour validation RH (par ${user.role}, ${userId}), non bloquée.`,
        );
      }

      // ✅ CORRECTIF (demande explicite) : un congé ANNUAL (départ normal,
      // clôture de cycle) qui prend MOINS que le solde réellement dû
      // (26j + ancienneté) doit obligatoirement porter un motif — sinon le
      // reliquat non pris disparaît silencieusement sans trace explicable
      // sur la lettre de départ. Ne s'applique jamais à ANNUAL_ANTICIPATED
      // (partiel par nature, l'employé anticipe volontairement une partie
      // seulement de son solde avant la fin du cycle).
      if (
        createLeaveDto.type === 'ANNUAL' &&
        workingDays < Number(balance.annualRemaining) &&
        !createLeaveDto.reason?.trim()
      ) {
        throw new BadRequestException(
          `Ce congé (${workingDays}j) est inférieur au solde dû (${Math.round(Number(balance.annualRemaining))}j) — merci de préciser le motif de cette réduction (il apparaîtra sur la lettre de départ).`,
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
          message: `${employee.firstName} ${employee.lastName} demande ${Math.round(workingDays)} jour(s) de ${this.leaveTypeLabel(createLeaveDto.type)} du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}`,
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

      return earlyDepartureWarning || insufficientBalanceWarning
        ? { ...leave, earlyDepartureWarning, insufficientBalanceWarning }
        : leave;
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
  // ↩️ DEMANDE DE RATTRAPAGE (employé) — pendant de createCarryoverLeave(),
  // mais part en PENDING pour validation RH au lieu d'être auto-approuvée.
  // Mêmes garanties : jamais payé, jamais de débit du solde/cycle en cours,
  // plafonné au reliquat réellement disponible du congé source.
  // ============================================================================
  private async createCarryoverRequest(
    dto: CreateLeaveDto,
    employee: { firstName: string; lastName: string; email: string },
    start: Date,
    end: Date,
    userId: string,
    companyId: string,
  ) {
    const source = await this.prisma.leave.findUnique({
      where: { id: dto.carriedFromLeaveId },
    });
    if (!source)
      throw new NotFoundException('Congé source du reliquat introuvable');
    if (source.employeeId !== dto.employeeId)
      throw new BadRequestException(
        "Ce reliquat n'appartient pas à cet employé",
      );
    if (source.companyId !== companyId)
      throw new ForbiddenException('Accès refusé');
    if (!source.returnConfirmed || !(Number(source.forfeitedDays) > 0)) {
      throw new BadRequestException(
        "Ce congé n'a pas de reliquat de retour anticipé disponible",
      );
    }

    const workingDays = await this.calculateWorkingDays(
      start,
      end,
      companyId,
    );
    if (workingDays === 0)
      throw new BadRequestException('Aucun jour ouvré dans cette période');

    const remaining = await this.getRemainingCarryover(source.id);
    if (workingDays > remaining) {
      throw new BadRequestException(
        `Reliquat insuffisant : il reste ${Math.round(remaining * 10) / 10}j à rattraper sur ce congé (du ${new Date(source.startDate).toLocaleDateString('fr-FR')} au ${new Date(source.endDate).toLocaleDateString('fr-FR')}), ${workingDays}j demandés.`,
      );
    }

    const leave = await this.prisma.leave.create({
      data: {
        employeeId: dto.employeeId,
        companyId,
        type: 'ANNUAL',
        startDate: start,
        endDate: end,
        daysCount: workingDays,
        reason:
          dto.reason ||
          'Demande de rattrapage — reliquat de retour anticipé (repos non payé)',
        status: 'PENDING',
        carriedFromLeaveId: source.id,
        plannedPayrollMonth: null,
        plannedPayrollYear: null,
        payrollIndemnityDays: null,
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
      companyId,
      ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER', 'MANAGER'],
      {
        type: 'LEAVE_REQUEST',
        title: '↩️ Demande de rattrapage (reliquat non payé)',
        message: `${employee.firstName} ${employee.lastName} demande à rattraper ${Math.round(workingDays)} jour(s) non pris(s) suite à son retour anticipé du ${new Date(source.actualReturnDate ?? source.endDate).toLocaleDateString('fr-FR')}, du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}`,
        link: '/conges',
        metadata: {
          leaveId: leave.id,
          employeeId: dto.employeeId,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          daysCount: workingDays,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          carriedFromLeaveId: source.id,
        },
      },
    );

    this.logger.log(
      `↩️ Demande de rattrapage de ${workingDays}j soumise par ${employee.firstName} ${employee.lastName} sur le reliquat du congé ${source.id} (${Math.round((remaining - workingDays) * 10) / 10}j restants après cette demande).`,
    );

    return leave;
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
      extraDaysGranted?: number;
      resumptionNote?: string;
      // ✅ Rattrapage d'un reliquat de retour anticipé — id du congé source
      // (celui qui a un forfeitedDays > 0). Voir createCarryoverLeave().
      carriedFromLeaveId?: string;
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

    // ============================================================================
    // ↩️ RATTRAPAGE D'UN RELIQUAT DE RETOUR ANTICIPÉ (demande explicite)
    // Chemin totalement séparé : ce "congé" ne fait que planifier un repos
    // physique pour rattraper des jours déjà posés mais non pris lors d'un
    // retour anticipé (voir confirmLeaveReturn/forfeitedDays). Il ne doit
    // JAMAIS toucher le solde du cycle en cours, ni son cycle (leaveCycle
    // StartDate), ni générer d'indemnité — seulement du suivi d'absence.
    // ============================================================================
    if (dto.carriedFromLeaveId) {
      return this.createCarryoverLeave(
        dto,
        employee,
        workingDays,
        start,
        end,
        userId,
        user.companyId,
      );
    }

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

    // ✅ CORRECTIF (demande explicite) : même règle que create() — un congé
    // ANNUAL planifié directement par le RH pour MOINS que le solde dû doit
    // porter un motif explicite (jamais le fallback générique "Planifié
    // directement par le RH/Admin" ci-dessous, qui ne dit rien du POURQUOI
    // du reliquat non pris). On teste dto.reason AVANT que le fallback ne
    // s'applique.
    if (
      dto.type === 'ANNUAL' &&
      workingDays < Number(balance.annualRemaining) &&
      !dto.reason?.trim()
    ) {
      throw new BadRequestException(
        `Ce congé (${workingDays}j) est inférieur au solde dû (${Math.round(Number(balance.annualRemaining))}j) — merci de préciser le motif de cette réduction (il apparaîtra sur la lettre de départ).`,
      );
    }

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
        // ✅ CORRECTIF (demande explicite) : cette route (planification
        // directe RH, déjà APPROVED à la création) n'avait jamais ces 2
        // champs — la lettre ne pouvait donc jamais afficher ni le motif de
        // report, ni les jours d'ancienneté déjà reportés, pour un congé
        // planifié directement (par opposition à approuvé depuis une
        // demande employé, seul chemin qui les avait). Seulement pour
        // ANNUAL — même règle que updateStatus (jamais pour un anticipé).
        extraDaysGranted: dto.type === 'ANNUAL' ? dto.extraDaysGranted : undefined,
        resumptionNote: dto.type === 'ANNUAL' ? dto.resumptionNote : undefined,
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
        message: `Un congé du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} (${Math.round(workingDays)}j) a été planifié pour vous.`,
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
  // ↩️ RATTRAPAGE D'UN RELIQUAT DE RETOUR ANTICIPÉ (demande explicite)
  // Un employé qui reprend le travail avant la fin de son congé (retour
  // anticipé) "perd" légalement ces jours au sens du SOLDE/de l'indemnité —
  // mais l'entreprise peut choisir de les lui laisser reprendre plus tard,
  // en repos physique uniquement, sans jamais les payer une seconde fois.
  // Ce congé de rattrapage :
  //  - est toujours de type ANNUAL (même nature, juste non indemnisé)
  //  - ne débite JAMAIS le solde/cycle en cours (employee.leaveCycleStartDate
  //    reste inchangé — le décalage ne bouleverse pas le cycle normal)
  //  - n'a jamais d'indemnité (plannedPayrollMonth/Year/payrollIndemnityDays
  //    toujours null)
  //  - est plafonné au reliquat réellement restant du congé source, calculé
  //    à la volée (jamais stocké en dur, pour rester correct même si ce
  //    rattrapage est lui-même modifié/supprimé ensuite)
  // ============================================================================
  private async createCarryoverLeave(
    dto: {
      employeeId: string;
      carriedFromLeaveId?: string;
      startDate: string;
      endDate: string;
      reason?: string;
    },
    employee: { firstName: string; lastName: string; email: string },
    workingDays: number,
    start: Date,
    end: Date,
    userId: string,
    companyId: string,
  ) {
    const source = await this.prisma.leave.findUnique({
      where: { id: dto.carriedFromLeaveId },
    });
    if (!source)
      throw new NotFoundException('Congé source du reliquat introuvable');
    if (source.employeeId !== dto.employeeId)
      throw new BadRequestException(
        "Ce reliquat n'appartient pas à cet employé",
      );
    if (source.companyId !== companyId)
      throw new ForbiddenException('Accès refusé');
    if (!source.returnConfirmed || !(Number(source.forfeitedDays) > 0)) {
      throw new BadRequestException(
        "Ce congé n'a pas de reliquat de retour anticipé disponible",
      );
    }

    const remaining = await this.getRemainingCarryover(source.id);
    if (workingDays > remaining) {
      throw new BadRequestException(
        `Reliquat insuffisant : il reste ${Math.round(remaining * 10) / 10}j à rattraper sur ce congé (du ${new Date(source.startDate).toLocaleDateString('fr-FR')} au ${new Date(source.endDate).toLocaleDateString('fr-FR')}), ${workingDays}j demandés.`,
      );
    }

    const leave = await this.prisma.leave.create({
      data: {
        employeeId: dto.employeeId,
        companyId,
        type: 'ANNUAL',
        startDate: start,
        endDate: end,
        daysCount: workingDays,
        reason:
          dto.reason ||
          'Rattrapage — reliquat de retour anticipé (repos non payé)',
        status: 'APPROVED',
        isManual: true,
        approvedBy: userId,
        approvedAt: new Date(),
        carriedFromLeaveId: source.id,
        // ❌ Jamais d'indemnité, jamais de débit de cycle — voir le
        // commentaire du champ carriedFromLeaveId dans le schéma Prisma.
        plannedPayrollMonth: null,
        plannedPayrollYear: null,
        payrollIndemnityDays: null,
      },
      include: {
        employee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    // ✅ AUCUNE mutation de LeaveBalance ni de employee.leaveCycleStartDate
    // ici — c'est tout le principe du rattrapage : le cycle normal continue
    // sa vie sans être perturbé par ce repos de rattrapage non payé.

    const employeeUser = await this.prisma.user.findFirst({
      where: { email: employee.email, companyId },
      select: { id: true },
    });
    if (employeeUser) {
      await this.notificationsService.create({
        userId: employeeUser.id,
        type: 'LEAVE_APPROVED' as NotificationType,
        title: '📅 Rattrapage de congé planifié',
        message: `Un repos du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} (${Math.round(workingDays)}j) a été planifié pour rattraper votre congé non terminé.`,
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
      `↩️ Rattrapage de ${workingDays}j créé pour ${employee.firstName} ${employee.lastName} sur le reliquat du congé ${source.id} (${Math.round((remaining - workingDays) * 10) / 10}j restants).`,
    );

    return leave;
  }

  /**
   * Reliquat restant réellement disponible sur un congé source donné —
   * recalculé à la volée (jamais stocké) : forfeitedDays moins la somme des
   * rattrapages déjà pris/en attente sur ce même congé source.
   * `excludeLeaveId` : exclut un rattrapage en cours de modification de son
   * propre calcul (pour updateLeavePlanning).
   */
  private async getRemainingCarryover(
    sourceLeaveId: string,
    excludeLeaveId?: string,
  ): Promise<number> {
    const source = await this.prisma.leave.findUnique({
      where: { id: sourceLeaveId },
      select: { forfeitedDays: true },
    });
    if (!source) return 0;
    const children = await this.prisma.leave.findMany({
      where: {
        carriedFromLeaveId: sourceLeaveId,
        status: { in: ['PENDING', 'APPROVED'] },
        ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
      },
      select: { daysCount: true },
    });
    const consumed = children.reduce((s, c) => s + Number(c.daysCount), 0);
    return Math.max(0, Number(source.forfeitedDays) - consumed);
  }

  /**
   * Reliquats de retour anticipé encore disponibles pour un employé —
   * utilisé par "Mon espace" (l'employé voit ce qu'il lui reste à prendre de
   * son cycle précédent) et par le RH lors de la planification d'un
   * rattrapage (programme des départs / nouvelle demande).
   */
  async getCarryoverBalance(
    employeeId: string,
    userId: string,
    overrideCompanyId?: string,
  ) {
    await this.assertEmployeeAccess(employeeId, userId, overrideCompanyId);

    const sources = await this.prisma.leave.findMany({
      where: { employeeId, returnConfirmed: true, forfeitedDays: { gt: 0 } },
      orderBy: { actualReturnDate: 'desc' },
    });

    const results: Array<{
      sourceLeaveId: string;
      cycleLabel: string | null;
      originalStartDate: Date;
      originalEndDate: Date;
      actualReturnDate: Date | null;
      forfeitedDays: number;
      remainingDays: number;
    }> = [];

    for (const source of sources) {
      const remaining = await this.getRemainingCarryover(source.id);
      if (remaining <= 0) continue;

      let cycleLabel: string | null = null;
      if (source.debitedCycleStartDate) {
        const y1 = new Date(source.debitedCycleStartDate).getFullYear();
        cycleLabel = `${y1}-${y1 + 1}`;
      }

      results.push({
        sourceLeaveId: source.id,
        cycleLabel,
        originalStartDate: source.startDate,
        originalEndDate: source.endDate,
        actualReturnDate: source.actualReturnDate,
        forfeitedDays: Number(source.forfeitedDays),
        remainingDays: remaining,
      });
    }

    return results;
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
        // ✅ Rattrapage d'un reliquat — pour afficher le contexte du congé
        // source (dates, retour anticipé) directement sur le détail.
        carriedFromLeave: {
          select: { startDate: true, endDate: true, actualReturnDate: true },
        },
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

    if (status === 'APPROVED' && leave.carriedFromLeaveId) {
      // ✅ Rattrapage de reliquat — revalidation à la validation (le reliquat
      // a pu être partiellement consommé par un autre rattrapage entre la
      // demande et cette approbation). AUCUNE mutation de solde/cycle/
      // indemnité ici — voir createCarryoverLeave()/createCarryoverRequest().
      const remainingCarryover = await this.getRemainingCarryover(
        leave.carriedFromLeaveId,
        leave.id,
      );
      if (Number(leave.daysCount) > remainingCarryover) {
        throw new BadRequestException(
          `Reliquat insuffisant pour valider ce rattrapage : il reste ${Math.round(remainingCarryover * 10) / 10}j disponibles sur le congé source, ${Number(leave.daysCount)}j demandés.`,
        );
      }
    }

    if (status === 'APPROVED' && isAnnualFamily && !leave.carriedFromLeaveId) {
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

    if (status === 'APPROVED' && isAnnualFamily && !leave.carriedFromLeaveId) {
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
  // ✏️ MODIFIER UNE PLANIFICATION (RH/Admin) — édition complète EN PLACE d'un
  //    congé déjà existant (dates, type, motif, jours d'ancienneté...).
  //    ⚠️ Ne crée JAMAIS de nouvelle ligne : on met à jour la même ligne
  //    `leave.id` et on ajuste seulement l'ÉCART de solde entre l'ancien et
  //    le nouvel état — exactement le principe déjà utilisé par
  //    rescheduleLeave() pour les dates seules. C'est ce qui évite qu'une
  //    planification modifiée apparaisse en double (ancienne ligne encore
  //    là + nouvelle créée à côté) sur le programme des départs, le planning
  //    ou le calendrier, qui lisent tous la même table `leave`.
  // ============================================================================
  async updateLeavePlanning(
    id: string,
    dto: {
      type?: 'ANNUAL' | 'ANNUAL_ANTICIPATED';
      startDate?: string;
      endDate?: string;
      reason?: string;
      extraDaysGranted?: number;
      resumptionNote?: string;
    },
    userId: string,
    overrideCompanyId?: string,
  ) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Congé introuvable');
    if (leave.companyId !== user.companyId)
      throw new ForbiddenException("Vous n'avez pas accès à ce congé");
    if (!['APPROVED', 'PENDING'].includes(leave.status))
      throw new BadRequestException(
        'Seul un congé en attente ou déjà approuvé/planifié peut être modifié (pas un congé rejeté ou annulé).',
      );

    const newType = dto.type ?? leave.type;
    if (!['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(newType)) {
      throw new BadRequestException(
        "Ce type de congé n'est plus géré ici — utilisez le module Absences.",
      );
    }
    // ✅ Un congé de rattrapage (carriedFromLeaveId) reste toujours de type
    // ANNUAL — changer son type n'aurait aucun sens (il n'a jamais été
    // indemnisé ni débité, rien à "convertir").
    if (leave.carriedFromLeaveId && dto.type && dto.type !== 'ANNUAL') {
      throw new BadRequestException(
        'Un congé de rattrapage (reliquat de retour anticipé) reste toujours de type "Annuel".',
      );
    }

    const oldStart = new Date(leave.startDate);
    const oldEnd = new Date(leave.endDate);
    const newStart = dto.startDate ? new Date(dto.startDate) : oldStart;
    const newEnd = dto.endDate ? new Date(dto.endDate) : oldEnd;
    if (newEnd < newStart)
      throw new BadRequestException(
        'La date de fin doit être après la date de début',
      );

    const datesChanged =
      newStart.getTime() !== oldStart.getTime() ||
      newEnd.getTime() !== oldEnd.getTime();
    const typeChanged = newType !== leave.type;

    const oldWorkingDays = Number(leave.daysCount);
    let newWorkingDays = oldWorkingDays;
    if (datesChanged) {
      newWorkingDays = await this.calculateWorkingDays(
        newStart,
        newEnd,
        user.companyId,
      );
      if (newWorkingDays === 0)
        throw new BadRequestException('Aucun jour ouvré dans cette période');
      // ✅ Même garde-fou anti-chevauchement qu'à la création, en excluant
      // ce congé lui-même (sinon il se bloquerait tout seul).
      await this.assertNoOverlap(leave.employeeId, newStart, newEnd, id);

      // ✅ Un congé de rattrapage reste plafonné au reliquat réellement
      // disponible sur son congé source (en excluant SA PROPRE consommation
      // actuelle du calcul, sinon il se bloquerait lui-même).
      if (leave.carriedFromLeaveId) {
        const remaining = await this.getRemainingCarryover(
          leave.carriedFromLeaveId,
          id,
        );
        if (newWorkingDays > remaining) {
          throw new BadRequestException(
            `Reliquat insuffisant : il reste ${Math.round(remaining * 10) / 10}j disponibles sur le congé source, ${newWorkingDays}j demandés.`,
          );
        }
      }
    }

    const delta = newWorkingDays - oldWorkingDays;
    const isAnnualFamily = ['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(
      leave.type,
    );

    // ✅ La ligne de solde déjà débitée (debitedCycleStartDate) reste la
    // même — on ajuste juste l'écart dessus, jamais un re-décompte complet.
    let balanceAfter: { annualRemaining: number } | null = null;
    if (
      leave.status === 'APPROVED' &&
      isAnnualFamily &&
      leave.debitedCycleStartDate &&
      delta !== 0 &&
      !leave.carriedFromLeaveId
    ) {
      const balance = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_cycleStartDate: {
            employeeId: leave.employeeId,
            cycleStartDate: leave.debitedCycleStartDate,
          },
        },
      });
      if (balance) {
        const updatedBalance = await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: {
            annualTaken: { increment: delta },
            annualRemaining: { decrement: delta },
          },
        });
        balanceAfter = {
          annualRemaining: Number(updatedBalance.annualRemaining),
        };
      }
    }

    // ✅ Le type peut changer (ex: planifié par erreur en anticipé). On
    // recalcule alors l'indemnité paie comme createManual() — jamais un
    // simple report des anciennes valeurs, qui ne correspondraient plus au
    // congé réellement modifié. Règle inchangée : jamais d'indemnité propre
    // pour un ANNUAL_ANTICIPATED (absorbée dans le futur congé ANNUAL).
    let plannedPayrollMonth = leave.plannedPayrollMonth;
    let plannedPayrollYear = leave.plannedPayrollYear;
    let payrollIndemnityDays = leave.payrollIndemnityDays;
    if (
      leave.status === 'APPROVED' &&
      (typeChanged || datesChanged) &&
      !leave.carriedFromLeaveId
    ) {
      if (newType === 'ANNUAL') {
        plannedPayrollMonth =
          newStart.getMonth() === 0 ? 12 : newStart.getMonth();
        plannedPayrollYear =
          newStart.getMonth() === 0
            ? newStart.getFullYear() - 1
            : newStart.getFullYear();
        const balanceRow = leave.debitedCycleStartDate
          ? await this.prisma.leaveBalance.findUnique({
              where: {
                employeeId_cycleStartDate: {
                  employeeId: leave.employeeId,
                  cycleStartDate: leave.debitedCycleStartDate,
                },
              },
            })
          : null;
        payrollIndemnityDays = balanceRow
          ? balanceRow.annualEntitled
          : leave.payrollIndemnityDays;
      } else {
        plannedPayrollMonth = null;
        plannedPayrollYear = null;
        payrollIndemnityDays = null;
      }
    }

    const extraDaysGranted =
      newType === 'ANNUAL'
        ? (dto.extraDaysGranted ?? leave.extraDaysGranted)
        : null;
    const resumptionNote =
      newType === 'ANNUAL' ? (dto.resumptionNote ?? leave.resumptionNote) : null;

    const updated = await this.prisma.leave.update({
      where: { id },
      data: {
        type: newType as LeaveType,
        startDate: newStart,
        endDate: newEnd,
        daysCount: newWorkingDays,
        reason: dto.reason ?? leave.reason,
        extraDaysGranted,
        resumptionNote,
        plannedPayrollMonth,
        plannedPayrollYear,
        payrollIndemnityDays,
      },
    });

    // ✅ Si ce congé ANNUAL était celui qui avait fermé le cycle en cours
    // (employee.leaveCycleStartDate === son ancienne date de fin), on
    // répercute le décalage — sinon le cycle suivant resterait ancré sur
    // une date de fin qui n'existe plus après la modification.
    if (leave.type === 'ANNUAL' && leave.status === 'APPROVED' && !leave.carriedFromLeaveId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: leave.employeeId },
        select: { leaveCycleStartDate: true },
      });
      const wasClosingCycle =
        employee?.leaveCycleStartDate &&
        new Date(employee.leaveCycleStartDate).getTime() ===
          oldEnd.getTime();
      if (wasClosingCycle) {
        const newCycleAnchor =
          newType === 'ANNUAL' ? newEnd : leave.debitedCycleStartDate;
        if (newCycleAnchor) {
          await this.prisma.employee.update({
            where: { id: leave.employeeId },
            data: { leaveCycleStartDate: newCycleAnchor },
          });
        }
      }
    }

    this.logger.log(
      `✏️ Congé/planification ${id} modifié par ${userId} — ${oldWorkingDays}j → ${newWorkingDays}j` +
        (typeChanged ? `, type ${leave.type} → ${newType}` : ''),
    );

    return { ...updated, balanceAfter };
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
    // ✅ Un congé de rattrapage (carriedFromLeaveId non nul) n'a jamais
    // débité le solde/cycle en cours — rien à restaurer si on l'annule,
    // sinon on créditerait à tort le cycle normal de jours qu'il n'avait
    // jamais perdus (le reliquat redevient disponible tout seul, recalculé
    // à la volée par getRemainingCarryover).
    if (isAnnualFamily && leave.status === 'APPROVED' && !leave.carriedFromLeaveId) {
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
  // 🗑️ SUPPRIMER DÉFINITIVEMENT (RH/Admin) — distinct de cancel() : cancel()
  //    conserve la ligne (statut CANCELLED) pour garder un historique ; ici
  //    la ligne disparaît réellement des listes/du planning/du calendrier
  //    (toutes ces pages lisent la même table `leave`, donc rien d'autre à
  //    synchroniser). Avant de supprimer, on "vide" exactement ce que la
  //    planification avait débité — même restauration de solde/cycle que
  //    cancel(), pour ne jamais laisser un solde figé sur un congé qui n'existe
  //    plus.
  // ============================================================================
  async deleteLeave(id: string, userId: string, overrideCompanyId?: string) {
    const user = await this.getUserWithCompany(userId, overrideCompanyId);
    const leave = await this.prisma.leave.findUnique({ where: { id } });

    if (!leave) throw new NotFoundException('Demande de congé introuvable');
    if (leave.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');

    const isAnnualFamily = ['ANNUAL', 'ANNUAL_ANTICIPATED'].includes(
      leave.type,
    );
    // ✅ Un congé de rattrapage (carriedFromLeaveId non nul) n'a jamais
    // débité le solde/cycle en cours à sa création — rien à restaurer ici,
    // sinon on créditerait à tort le cycle normal de jours qu'il n'avait
    // jamais perdus. Le reliquat redevient disponible tout seul (recalculé
    // à la volée par getRemainingCarryover, jamais stocké en dur).
    if (isAnnualFamily && leave.status === 'APPROVED' && !leave.carriedFromLeaveId) {
      // ✅ Même règle que cancel() : on restaure sur le cycle exact mémorisé
      // à la validation (debitedCycleStartDate), pas sur "le cycle actuel"
      // qui a pu avancer depuis.
      const balance = leave.debitedCycleStartDate
        ? await this.prisma.leaveBalance.findUnique({
            where: {
              employeeId_cycleStartDate: {
                employeeId: leave.employeeId,
                cycleStartDate: leave.debitedCycleStartDate,
              },
            },
          })
        : await this.getOrCreateLeaveBalance(leave.employeeId);

      if (balance) {
        await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: {
            annualTaken: { decrement: leave.daysCount },
            annualRemaining: { increment: leave.daysCount },
          },
        });
      }

      // ✅ Rouvre le cycle si CE congé est bien celui qui l'avait fermé —
      // jamais si un congé plus récent l'a refermé depuis (voir cancel()).
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

    await this.prisma.leave.delete({ where: { id } });

    this.logger.log(
      `🗑️ Congé/planification ${id} supprimé définitivement par ${userId} (employé ${leave.employeeId})`,
    );

    return { success: true, id };
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
    // 🆕 Un seul fetch pour toute l'entreprise (pas par employé) — le mode
    // de cycle est une config entreprise, pas individuelle.
    const companyForMode = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { leaveCycleMode: true },
    });
    const cycleMode =
      (companyForMode?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
      'ROLLING';

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
        cycleMode,
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

  // ============================================================================
  // 🆕 ALERTE RH AVANT PAIE — appelée uniquement par le cron (voir
  //    LeaveAccrualCron), jamais par une route HTTP : pas de contexte
  //    utilisateur ici, on balaie TOUTES les entreprises actives.
  //    2 temps, valeurs fixes (pas de config par entreprise pour l'instant) :
  //    - HEADS_UP (J-10, jour 15 du mois) : tous les départs prévus le mois
  //      suivant (théoriques + déjà réellement posés), une seule notif
  //      groupée par entreprise.
  //    - FOLLOWUP (J-3, jour 22 du mois) : uniquement ceux encore
  //      théoriques (aucun Leave réel créé) — pas de bruit pour ce qui est
  //      déjà traité.
  //    Ancré sur le mois SUIVANT le mois courant : l'indemnité d'un départ
  //    de janvier se paie sur le bulletin de décembre (voir
  //    getLeaveImpactForPayroll), donc l'alerte doit arriver AVANT cette
  //    clôture, pas le mois du départ lui-même.
  // ============================================================================
  async sendDepartureAlerts(mode: 'HEADS_UP' | 'FOLLOWUP'): Promise<void> {
    const now = new Date();
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const month = nextMonthDate.getMonth() + 1;
    const year = nextMonthDate.getFullYear();
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59);
    const monthLabel = nextMonthDate.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });

    const companies = await this.prisma.company.findMany({
      select: { id: true },
    });

    let notified = 0;
    for (const company of companies) {
      try {
        await this.subscriptionGuard.checkFeatureAccess(
          company.id,
          'hasLeaveManagement',
        );

        let rows = await this.buildDepartureRows(
          company.id,
          periodStart,
          periodEnd,
        );
        if (mode === 'FOLLOWUP') {
          rows = rows.filter((r) => r.isTheoretical);
        }
        if (rows.length === 0) continue;

        const names = rows
          .map((r) =>
            `${r.employee?.firstName ?? ''} ${r.employee?.lastName ?? ''}`.trim(),
          )
          .filter(Boolean);
        const totalDays = Math.round(
          rows.reduce((s, r) => s + Number(r.daysCount || 0), 0),
        );

        const title =
          mode === 'HEADS_UP'
            ? `📅 ${rows.length} départ(s) en congé prévu(s) en ${monthLabel}`
            : `⚠️ ${rows.length} départ(s) de ${monthLabel} pas encore planifié(s)`;
        const message =
          mode === 'HEADS_UP'
            ? `${names.join(', ')} — ${totalDays}j au total. Préparez leurs indemnités sur la paie de ce mois-ci et planifiez officiellement leur départ.`
            : `${names.join(', ')} n'ont toujours pas de congé réellement planifié pour ${monthLabel} — la clôture de paie approche.`;

        await this.notificationsService.createForGroup(
          company.id,
          ['ADMIN', 'HR_MANAGER'],
          {
            type: 'LEAVE_REQUEST' as NotificationType,
            title,
            message,
            link: '/conges/planning',
            metadata: { month, year, count: rows.length, mode },
          },
        );
        notified++;
      } catch (err: any) {
        // Entreprise sans le module congé, sans abonnement actif, ou erreur
        // isolée — ne doit jamais bloquer l'alerte des AUTRES entreprises.
        this.logger.warn(
          `⚠️ Alerte départs ignorée pour l'entreprise ${company.id}: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      `✅ [${mode}] Alertes départs ${monthLabel} envoyées à ${notified} entreprise(s)`,
    );
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