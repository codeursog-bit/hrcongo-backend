// ============================================================================
// 📁 src/leaves/leaves-history.service.ts
// ✅ NOUVEAU — Historique des départs en congé, historique des demandes et
//    données pour la vue en diagrammes (direction).
//
//  1) getDepartureHistory()   → congés APPROUVÉS dont la date de départ est
//     arrivée (startDate <= aujourd'hui, jour calendaire du Congo). Tant que
//     la date de départ n'est pas atteinte, le congé reste dans le
//     planning / programme et N'ENTRE PAS dans cet historique.
//  2) getEmployeeDepartureProfile() → fiche enrichie d'un employé (embauche,
//     ancienneté, tous ses départs passés, totaux).
//  3) getRequestsHistory()    → toutes les demandes (tous statuts) avec le
//     circuit de traitement (qui a validé/refusé, quand, délai de réponse).
//  4) getVisualOverview()     → données brutes d'une année pour les
//     diagrammes (Gantt, jauge d'absences par jour, etc.).
//
// 🔒 Accès : ADMIN, SUPER_ADMIN, HR_MANAGER, cabinet (via companyId vérifié),
//    et MANAGER limité à son département. Les EMPLOYEE n'ont pas accès.
//    Les montants (indemnités) ne sont exposés qu'aux rôles RH/Admin.
// ============================================================================

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getUserWithCompany, getManagerDepartmentId } from './leaves-common.util';
import { congoDateString } from '../common/utils/congo-time';
import { LeavesBalanceService } from './leaves-balance.service';
import { CONGO_LEAVE } from './leaves.constants';
import {
  LEAVE_SENIORITY_CONVENTIONS,
  DEFAULT_LEAVE_CONVENTION_KEY,
  getSeniorityDaysForConvention,
} from './config/leave-seniority-conventions';

const HR_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];
const ALLOWED_ROLES = [
  ...HR_ROLES,
  'MANAGER',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];

export interface HistoryFilters {
  year?: number;
  month?: number; // 1-12 (nécessite year)
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  type?: string;
  status?: string;
  departmentId?: string;
  search?: string;
}

@Injectable()
export class LeavesHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceService: LeavesBalanceService,
  ) {}

  // ───────────────────────── helpers ─────────────────────────

  /** Minuit UTC du jour calendaire du Congo (comparable aux colonnes @db.Date). */
  private todayUtc(): Date {
    return new Date(`${congoDateString()}T00:00:00.000Z`);
  }

  private async resolveScope(userId: string, companyIdOverride?: string) {
    const user = await getUserWithCompany(
      this.prisma,
      userId,
      companyIdOverride,
    );
    if (!ALLOWED_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à l'historique des congés",
      );
    }
    let managerDeptId: string | null = null;
    if (user.role === 'MANAGER') {
      managerDeptId = await getManagerDepartmentId(
        this.prisma,
        userId,
        user.companyId,
      );
      if (!managerDeptId) {
        throw new ForbiddenException('Aucun département rattaché à ce manager');
      }
    }
    return {
      companyId: user.companyId,
      role: user.role,
      canSeeAmounts: HR_ROLES.includes(user.role),
      managerDeptId,
    };
  }

  /**
   * Fenêtre [start, end] (inclusive, minuit UTC) à partir des filtres
   * year / month / from / to. `from`/`to` priment sur year/month.
   */
  private resolveRange(f: HistoryFilters): { start?: Date; end?: Date } {
    if (f.from || f.to) {
      return {
        start: f.from ? new Date(`${f.from}T00:00:00.000Z`) : undefined,
        end: f.to ? new Date(`${f.to}T00:00:00.000Z`) : undefined,
      };
    }
    if (f.year && f.month) {
      return {
        start: new Date(Date.UTC(f.year, f.month - 1, 1)),
        end: new Date(Date.UTC(f.year, f.month, 0)),
      };
    }
    if (f.year) {
      return {
        start: new Date(Date.UTC(f.year, 0, 1)),
        end: new Date(Date.UTC(f.year, 11, 31)),
      };
    }
    return {};
  }

  private searchClause(search?: string): Record<string, any> {
    const q = search?.trim();
    if (!q) return {};
    return {
      OR: [
        { firstName: { contains: q, mode: 'insensitive' as const } },
        { lastName: { contains: q, mode: 'insensitive' as const } },
        { employeeNumber: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  /** Ancienneté entre deux dates, en années + mois révolus. */
  private seniorityBetween(from: Date, to: Date) {
    let months =
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
      (to.getUTCMonth() - from.getUTCMonth());
    if (to.getUTCDate() < from.getUTCDate()) months -= 1;
    if (months < 0) months = 0;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts: string[] = [];
    if (years > 0) parts.push(`${years} an${years > 1 ? 's' : ''}`);
    if (rest > 0 || years === 0) parts.push(`${rest} mois`);
    return { years, months: rest, totalMonths: months, label: parts.join(' ') };
  }

  private employeeSelect() {
    return {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      position: true,
      hireDate: true,
      status: true,
      contractType: true,
      department: { select: { id: true, name: true } },
    };
  }

  private round1(n: number) {
    return Math.round(n * 10) / 10;
  }

  // ─────────────────── 1) Historique des départs ───────────────────

  async getDepartureHistory(
    userId: string,
    filters: HistoryFilters,
    companyIdOverride?: string,
  ) {
    const scope = await this.resolveScope(userId, companyIdOverride);
    const today = this.todayUtc();
    const { start, end } = this.resolveRange(filters);

    // Le départ doit être arrivé (<= aujourd'hui) ET dans la fenêtre filtrée.
    const startDateWhere: any = { lte: today };
    if (start) startDateWhere.gte = start;
    if (end) startDateWhere.lte = end < today ? end : today;

    const leaves = await this.prisma.leave.findMany({
      where: {
        companyId: scope.companyId,
        status: 'APPROVED',
        startDate: startDateWhere,
        ...(filters.type ? { type: filters.type as any } : {}),
        employee: {
          ...(scope.managerDeptId
            ? { departmentId: scope.managerDeptId }
            : filters.departmentId
              ? { departmentId: filters.departmentId }
              : {}),
          ...this.searchClause(filters.search),
        },
      },
      include: {
        employee: { select: this.employeeSelect() },
      },
      orderBy: { startDate: 'desc' },
      take: 2000,
    });

    // Noms des approbateurs (une seule requête)
    const approverIds = Array.from(
      new Set(leaves.map((l) => l.approvedBy).filter(Boolean)),
    ) as string[];
    const approvers = approverIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const approverName = new Map(
      approvers.map((a) => [a.id, `${a.firstName} ${a.lastName}`]),
    );

    const rows = leaves.map((l) => {
      const effectiveEnd =
        l.returnConfirmed && l.actualReturnDate
          ? l.actualReturnDate
          : l.endDate;
      const phase = effectiveEnd >= today ? 'IN_PROGRESS' : 'COMPLETED';
      return {
        id: l.id,
        employee: {
          ...l.employee,
          seniorityAtDeparture: this.seniorityBetween(
            l.employee.hireDate,
            l.startDate,
          ),
          seniorityToday: this.seniorityBetween(l.employee.hireDate, today),
        },
        type: l.type,
        startDate: l.startDate,
        endDate: l.endDate,
        daysCount: Number(l.daysCount),
        phase, // IN_PROGRESS = en congé actuellement | COMPLETED = terminé
        returnConfirmed: l.returnConfirmed,
        actualReturnDate: l.actualReturnDate,
        forfeitedDays: l.forfeitedDays ? Number(l.forfeitedDays) : 0,
        reason: l.reason,
        isCarryover: !!l.carriedFromLeaveId,
        isManual: l.isManual,
        approvedAt: l.approvedAt,
        approvedByName: l.approvedBy
          ? (approverName.get(l.approvedBy) ?? null)
          : null,
        ...(scope.canSeeAmounts
          ? {
              paidIndemnityAmount: l.paidIndemnityAmount
                ? Number(l.paidIndemnityAmount)
                : null,
            }
          : {}),
      };
    });

    // ── Statistiques / agrégats pour les petits graphiques de la page ──
    const totalDays = rows.reduce((s, r) => s + r.daysCount, 0);
    const byMonth = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      count: 0,
      totalDays: 0,
    }));
    const byType = new Map<string, { count: number; totalDays: number }>();
    const byDept = new Map<string, { count: number; totalDays: number }>();
    for (const r of rows) {
      const m = byMonth[new Date(r.startDate).getUTCMonth()];
      m.count += 1;
      m.totalDays += r.daysCount;

      const t = byType.get(r.type) ?? { count: 0, totalDays: 0 };
      t.count += 1;
      t.totalDays += r.daysCount;
      byType.set(r.type, t);

      const dn = r.employee.department?.name ?? 'Sans département';
      const d = byDept.get(dn) ?? { count: 0, totalDays: 0 };
      d.count += 1;
      d.totalDays += r.daysCount;
      byDept.set(dn, d);
    }

    return {
      rows,
      stats: {
        count: rows.length,
        uniqueEmployees: new Set(rows.map((r) => r.employee.id)).size,
        totalDays: this.round1(totalDays),
        averageDays: rows.length ? this.round1(totalDays / rows.length) : 0,
        inProgress: rows.filter((r) => r.phase === 'IN_PROGRESS').length,
        completed: rows.filter((r) => r.phase === 'COMPLETED').length,
        earlyReturns: rows.filter((r) => r.forfeitedDays > 0).length,
        byMonth: byMonth.map((m) => ({
          ...m,
          totalDays: this.round1(m.totalDays),
        })),
        byType: Array.from(byType.entries()).map(([type, v]) => ({
          type,
          count: v.count,
          totalDays: this.round1(v.totalDays),
        })),
        byDepartment: Array.from(byDept.entries())
          .map(([name, v]) => ({
            name,
            count: v.count,
            totalDays: this.round1(v.totalDays),
          }))
          .sort((a, b) => b.totalDays - a.totalDays),
      },
      truncated: leaves.length >= 2000,
    };
  }

  // ───────────── 2) Fiche enrichie d'un employé ─────────────

  async getEmployeeDepartureProfile(
    userId: string,
    employeeId: string,
    companyIdOverride?: string,
  ) {
    const scope = await this.resolveScope(userId, companyIdOverride);
    const today = this.todayUtc();

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        companyId: scope.companyId,
        ...(scope.managerDeptId ? { departmentId: scope.managerDeptId } : {}),
      },
      select: {
        ...this.employeeSelect(),
        email: true,
        phone: true,
        contractEndDate: true,
        terminationDate: true,
      } as any,
    });
    if (!employee) throw new ForbiddenException('Accès refusé');

    const leaves = await this.prisma.leave.findMany({
      where: { employeeId, companyId: scope.companyId, status: 'APPROVED' },
      orderBy: { startDate: 'desc' },
    });

    const departed = leaves.filter((l) => l.startDate <= today);
    const upcoming = leaves
      .filter((l) => l.startDate > today)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const hire = (employee as any).hireDate as Date;
    const lastAnnual = departed.find(
      (l) => l.type === 'ANNUAL' && !l.carriedFromLeaveId,
    );

    return {
      employee: {
        ...(employee as any),
        seniority: this.seniorityBetween(hire, today),
      },
      totals: {
        departures: departed.length,
        totalDaysTaken: this.round1(
          departed.reduce((s, l) => s + Number(l.daysCount), 0),
        ),
        totalForfeited: this.round1(
          departed.reduce((s, l) => s + Number(l.forfeitedDays ?? 0), 0),
        ),
        lastAnnualDeparture: lastAnnual?.startDate ?? null,
        nextDeparture: upcoming[0]?.startDate ?? null,
      },
      departures: departed.map((l) => ({
        id: l.id,
        type: l.type,
        startDate: l.startDate,
        endDate: l.endDate,
        daysCount: Number(l.daysCount),
        returnConfirmed: l.returnConfirmed,
        actualReturnDate: l.actualReturnDate,
        forfeitedDays: l.forfeitedDays ? Number(l.forfeitedDays) : 0,
        isCarryover: !!l.carriedFromLeaveId,
        seniorityAtDeparture: this.seniorityBetween(hire, l.startDate),
      })),
      upcoming: upcoming.map((l) => ({
        id: l.id,
        type: l.type,
        startDate: l.startDate,
        endDate: l.endDate,
        daysCount: Number(l.daysCount),
      })),
    };
  }

  // ─────────────────── 3) Historique des demandes ───────────────────

  async getRequestsHistory(
    userId: string,
    filters: HistoryFilters,
    companyIdOverride?: string,
  ) {
    const scope = await this.resolveScope(userId, companyIdOverride);
    const { start, end } = this.resolveRange(filters);

    // Ici la période porte sur la DATE DE LA DEMANDE (requestedAt).
    const requestedAt: any = {};
    if (start) requestedAt.gte = start;
    if (end) requestedAt.lt = new Date(end.getTime() + 24 * 3600 * 1000);

    const leaves = await this.prisma.leave.findMany({
      where: {
        companyId: scope.companyId,
        ...(Object.keys(requestedAt).length ? { requestedAt } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.type ? { type: filters.type as any } : {}),
        employee: {
          ...(scope.managerDeptId
            ? { departmentId: scope.managerDeptId }
            : filters.departmentId
              ? { departmentId: filters.departmentId }
              : {}),
          ...this.searchClause(filters.search),
        },
      },
      include: { employee: { select: this.employeeSelect() } },
      orderBy: { requestedAt: 'desc' },
      take: 2000,
    });

    const userIds = Array.from(
      new Set(
        leaves
          .flatMap((l) => [l.approvedBy, l.rejectedBy])
          .filter(Boolean) as string[],
      ),
    );
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const DAY = 24 * 3600 * 1000;

    const rows = leaves.map((l) => {
      const decidedAt = l.approvedAt ?? l.rejectedAt ?? null;
      const processingDays = decidedAt
        ? this.round1(
            Math.max(0, decidedAt.getTime() - l.requestedAt.getTime()) / DAY,
          )
        : null;
      return {
        id: l.id,
        employee: l.employee,
        type: l.type,
        status: l.status,
        requestedAt: l.requestedAt,
        startDate: l.startDate,
        endDate: l.endDate,
        daysCount: Number(l.daysCount),
        reason: l.reason,
        hasAttachment: !!l.attachmentUrl,
        isManual: l.isManual, // créé directement par le RH
        isCarryover: !!l.carriedFromLeaveId,
        approvedAt: l.approvedAt,
        approvedByName: l.approvedBy ? (nameOf.get(l.approvedBy) ?? null) : null,
        rejectedAt: l.rejectedAt,
        rejectedByName: l.rejectedBy ? (nameOf.get(l.rejectedBy) ?? null) : null,
        rejectionReason: l.rejectionReason,
        cancelledAt: l.cancelledAt,
        cancellationReason: l.cancellationReason,
        processingDays,
        returnConfirmed: l.returnConfirmed,
        actualReturnDate: l.actualReturnDate,
      };
    });

    const byStatus: Record<string, number> = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
      CANCELLED: 0,
    };
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const decided = byStatus.APPROVED + byStatus.REJECTED;
    const delays = rows
      .map((r) => r.processingDays)
      .filter((d): d is number => d !== null);

    return {
      rows,
      stats: {
        total: rows.length,
        byStatus,
        approvalRate: decided
          ? Math.round((byStatus.APPROVED / decided) * 100)
          : null,
        averageProcessingDays: delays.length
          ? this.round1(delays.reduce((a, b) => a + b, 0) / delays.length)
          : null,
        totalDaysRequested: this.round1(
          rows.reduce((s, r) => s + r.daysCount, 0),
        ),
      },
      truncated: leaves.length >= 2000,
    };
  }

  // ───────── 5) Mon solde expliqué (espace employé) ─────────

  /**
   * Tout ce qu'il faut pour AFFICHER le solde de façon compréhensible :
   * progression vers les 26 jours, d'où vient chaque chiffre (base + ancienneté),
   * ancienneté et convention, éligibilité, et date de départ (planifiée ou probable).
   * Lecture seule — aucun calcul de solde n'est modifié, on réutilise le moteur existant.
   */
  async getMyBalanceExplained(userId: string) {
    const user = await getUserWithCompany(this.prisma, userId);
    const employee = await this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
      select: {
        id: true,
        firstName: true,
        hireDate: true,
        company: {
          select: { leaveConventionKey: true, appliesSeniorityLeaveBonus: true, leaveCycleMode: true },
        },
      },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    const today = this.todayUtc();
    const bal: any = await this.balanceService.getEmployeeBalanceDetails(employee.id);

    const entitled = Number(bal.annualEntitled);
    const taken = Number(bal.annualTaken);
    const remaining = Number(bal.annualRemaining);
    const seniorityDays = Number(bal.seniorityDays ?? 0);
    const baseAcquired = Math.max(0, Math.round((entitled - seniorityDays) * 10) / 10);
    const baseMax = CONGO_LEAVE.ANNUAL_DAYS;

    const cycleStart = new Date(bal.cycleStartDate);
    const cycleEnd = new Date(bal.cycleEndDate);
    const monthsWorked = Math.max(
      0,
      Math.min(12, (today.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
    );

    // Date à partir de laquelle un congé annuel normal est possible (12 mois de cycle)
    const eligibleDate = new Date(cycleStart);
    eligibleDate.setUTCMonth(eligibleDate.getUTCMonth() + CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE);

    // Ancienneté & convention
    const hire = new Date(employee.hireDate);
    const seniority = this.seniorityBetween(hire, today);
    const conventionKey = employee.company?.leaveConventionKey ?? DEFAULT_LEAVE_CONVENTION_KEY;
    const convention = LEAVE_SENIORITY_CONVENTIONS.find((c) => c.key === conventionKey);
    const appliesBonus = employee.company?.appliesSeniorityLeaveBonus ?? true;
    const yearsFloat = (today.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    const currentBonus = appliesBonus
      ? getSeniorityDaysForConvention(conventionKey, Math.max(0, yearsFloat))
      : 0;
    const nextBracket = appliesBonus
      ? convention?.brackets.find((b) => b.minYears > yearsFloat)
      : undefined;
    let nextSeniority: null | { minYears: number; days: number; date: Date } = null;
    if (nextBracket) {
      const d = new Date(hire);
      d.setUTCFullYear(d.getUTCFullYear() + nextBracket.minYears);
      nextSeniority = { minYears: nextBracket.minYears, days: nextBracket.days, date: d };
    }

    // ── Congés ANTICIPÉS pris dans ce cycle (déduits du solde) ──
    const anticipatedRows = await this.prisma.leave.findMany({
      where: {
        employeeId: employee.id,
        type: 'ANNUAL_ANTICIPATED',
        status: 'APPROVED',
        startDate: { gte: cycleStart, lte: cycleEnd },
      },
      orderBy: { startDate: 'asc' },
    });
    const anticipatedDays = anticipatedRows.reduce((sum, l) => sum + Number(l.daysCount), 0);

    // ── Projection à la fin du cycle : le droit complet (26j + ancienneté) moins ce qui a déjà été
    //    pris (anticipé compris). C'est avec ce nombre-là que l'employé part à la date normale —
    //    le système n'attend jamais d'avoir 26 jours si une partie a déjà été prise.
    const fullEntitlement = this.round1(baseMax + seniorityDays);
    const projectedRemaining = this.round1(Math.max(0, fullEntitlement - taken));

    const startsOnHire = cycleStart.toISOString().slice(0, 10) === hire.toISOString().slice(0, 10);
    const startReason: 'HIRE' | 'ANNIVERSARY' | 'LAST_LEAVE_RETURN' = startsOnHire
      ? 'HIRE'
      : employee.company?.leaveCycleMode === 'ANNIVERSARY'
        ? 'ANNIVERSARY'
        : 'LAST_LEAVE_RETURN';

    // Prochain départ : planifié (réel) sinon probable (fin de cycle)
    const upcoming = await this.prisma.leave.findFirst({
      where: {
        employeeId: employee.id,
        type: { in: ['ANNUAL', 'ANNUAL_ANTICIPATED'] },
        status: { in: ['APPROVED', 'PENDING'] },
        endDate: { gte: today },
      },
      orderBy: { startDate: 'asc' },
    });

    let nextDeparture: any;
    if (upcoming) {
      const started = upcoming.startDate <= today;
      nextDeparture = {
        kind: started && upcoming.status === 'APPROVED' ? 'IN_PROGRESS' : 'PLANNED',
        status: upcoming.status, // APPROVED | PENDING
        startDate: upcoming.startDate,
        endDate: upcoming.endDate,
        days: Number(upcoming.daysCount),
      };
    } else if (remaining > 0 && bal.canTakeAnnualLeave) {
      nextDeparture = {
        kind: 'PROBABLE',
        startDate: cycleEnd > today ? cycleEnd : today,
        reason: cycleEnd > today ? 'END_OF_CYCLE' : 'AVAILABLE_NOW',
      };
    } else if (!bal.canTakeAnnualLeave) {
      nextDeparture = { kind: 'NOT_YET', startDate: eligibleDate };
    } else {
      nextDeparture = { kind: 'NONE' };
    }

    return {
      employee: {
        firstName: employee.firstName,
        hireDate: employee.hireDate,
        seniority,
      },
      cycle: {
        startDate: cycleStart,
        endDate: cycleEnd,
        monthsWorked: this.round1(monthsWorked),
        monthsElapsedFull: Math.floor(monthsWorked),
        startReason,
        monthsTotal: 12,
        progressPct: Math.round((monthsWorked / 12) * 100),
        eligibleDate,
        canTakeLeave: !!bal.canTakeAnnualLeave,
        monthsUntilEligible: bal.monthsUntilEligible ?? 0,
      },
      base: {
        acquired: baseAcquired,
        max: baseMax,
        missing: this.round1(Math.max(0, baseMax - baseAcquired)),
        perMonth: this.round1(CONGO_LEAVE.MONTHLY_RATE),
        daysUntilNextAccrual: bal.daysUntilNextAccrual ?? null,
      },
      seniority: {
        days: seniorityDays,
        applies: appliesBonus,
        currentBonus,
        conventionName: convention ? convention.label.split(' (')[0] : null,
        next: nextSeniority,
      },
      anticipated: {
        days: this.round1(anticipatedDays),
        leaves: anticipatedRows.map((l) => ({
          id: l.id,
          startDate: l.startDate,
          endDate: l.endDate,
          days: Number(l.daysCount),
        })),
      },
      projection: {
        fullEntitlement, // 26j + ancienneté, acquis en fin de cycle
        taken: this.round1(taken), // déjà pris (anticipé compris)
        remainingAtCycleEnd: projectedRemaining, // = avec quoi il partira à la date normale
        cycleEndDate: cycleEnd,
      },
      totals: {
        entitled: this.round1(entitled),
        taken: this.round1(taken),
        remaining: this.round1(remaining),
      },
      nextDeparture,
    };
  }

  // ─────────────────── 4) Vue en diagrammes ───────────────────

  /**
   * Données brutes d'une année civile pour les diagrammes de la direction.
   * Inclut les congés APPROUVÉS (passés et à venir) et EN ATTENTE (en
   * pointillés côté interface), jamais les refusés/annulés.
   */
  async getVisualOverview(
    userId: string,
    year: number,
    companyIdOverride?: string,
  ) {
    const scope = await this.resolveScope(userId, companyIdOverride);
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const today = this.todayUtc();

    const deptFilter = scope.managerDeptId
      ? { departmentId: scope.managerDeptId }
      : {};

    const [leaves, headcount, departments] = await Promise.all([
      this.prisma.leave.findMany({
        where: {
          companyId: scope.companyId,
          status: { in: ['APPROVED', 'PENDING'] },
          startDate: { lte: yearEnd },
          endDate: { gte: yearStart },
          employee: deptFilter,
        },
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
        },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.employee.groupBy({
        by: ['departmentId'],
        where: { companyId: scope.companyId, status: 'ACTIVE', ...deptFilter },
        _count: { _all: true },
      }),
      this.prisma.department.findMany({
        where: {
          companyId: scope.companyId,
          ...(scope.managerDeptId ? { id: scope.managerDeptId } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const totalHeadcount = headcount.reduce((s, h) => s + h._count._all, 0);

    return {
      year,
      today,
      totalHeadcount,
      departments: headcount.map((h) => ({
        id: h.departmentId,
        name: deptName.get(h.departmentId) ?? 'Sans département',
        headcount: h._count._all,
      })),
      leaves: leaves.map((l) => {
        const effectiveEnd =
          l.returnConfirmed && l.actualReturnDate
            ? l.actualReturnDate
            : l.endDate;
        return {
          id: l.id,
          employeeId: l.employeeId,
          employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
          position: l.employee.position,
          departmentId: l.employee.department?.id ?? null,
          departmentName: l.employee.department?.name ?? 'Sans département',
          type: l.type,
          status: l.status, // APPROVED | PENDING
          startDate: l.startDate,
          endDate: effectiveEnd, // tient compte d'un retour anticipé
          plannedEndDate: l.endDate,
          daysCount: Number(l.daysCount),
          phase:
            l.status === 'PENDING'
              ? 'PENDING'
              : l.startDate > today
                ? 'UPCOMING'
                : effectiveEnd >= today
                  ? 'IN_PROGRESS'
                  : 'COMPLETED',
        };
      }),
    };
  }
}