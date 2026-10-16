// ============================================================================
// 📁 src/attendance-dashboard/attendance-dashboard.service.ts
// Charge les données réelles (synthèses de présence, demandes d'absence,
// tickets de permission) et alimente :
//   • l'écran (JSON : getView)
//   • l'Excel (generateExport)
// Une seule source de calcul : l'écran et le fichier ne peuvent pas diverger.
// Mêmes règles d'accès que le dashboard effectifs (entreprise vérifiée /
// appartenance au portefeuille).
// ============================================================================

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PortfolioMembershipService } from '../portfolio/portfolio-membership.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import { PeriodInput, buildPeriod, cleanText } from '../workforce-dashboard/workforce-calc';
import { WfScope } from '../workforce-dashboard/workforce-dashboard.types';
import { exportFileName } from '../workforce-dashboard/workforce-excel-common';
import {
  ABSENCE_SUBTYPE_LABEL, ABSENCE_TYPE_LABEL, MISSION_LABEL, PERMISSION_TYPE_LABEL, RETURN_LABEL, STATUS_LABEL,
  absenceStats, departmentRows, evolution, monthKeyOf, permissionStats, round2, topAbsent, topPermissions, totalsOf,
} from './attendance-dashboard.calc';
import {
  AdAbsence, AdEmployee, AdPermission, AdSummaryRow, AttendanceDashboardData, AttendanceDashboardView,
} from './attendance-dashboard.types';
import { buildAttendanceWorkbook } from './attendance-dashboard.excel';

const CONGO_OFFSET_MS = 3600_000; // Africa/Brazzaville = UTC+1 (pas d'heure d'été)
const DAY_MS = 86_400_000;
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'];

interface CompanyLite {
  id: string;
  legalName: string;
  tradeName: string | null;
  city: string | null;
}

export interface AttendanceQuery extends PeriodInput {
  companyId?: string; // mode entreprise
  companies?: string; // mode portefeuille : "ALL" ou ids séparés par des virgules
}

@Injectable()
export class AttendanceDashboardService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
  ) {}

  // ───────────────────────── Périmètre (qui voit quoi) ─────────────────────────

  private async resolveCompanyScope(userId: string, companyId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, manageMultipleCompanies: true },
    });
    if (!user) throw new ForbiddenException('Utilisateur introuvable.');
    // Données sensibles (motifs d'absence, permissions de toute l'entreprise) : mêmes rôles que
    // « Demande d'absence / Suivi » côté front (PresenceSubNav → canAdminAbsences).
    if (!ADMIN_ROLES.includes(user.role as string)) {
      throw new ForbiddenException('Accès réservé aux administrateurs et aux RH.');
    }
    const id = await resolveVerifiedCompanyId(this.prisma, user, companyId);
    if (!id) throw new NotFoundException('Entreprise introuvable.');
    return { companyIds: [id], available: [] as string[] };
  }

  private async resolvePortfolioScope(userId: string, companies?: string) {
    await this.membership.assertCanUsePortfolio(userId);
    const linked = await this.membership.getLinkedCompanyIds(userId);
    const raw = (companies ?? 'ALL').trim();
    let ids: string[];
    if (!raw || raw.toUpperCase() === 'ALL') {
      ids = linked;
    } else {
      ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
      for (const id of ids) await this.membership.assertCompanyMembership(userId, id);
    }
    if (ids.length === 0) throw new NotFoundException('Aucune entreprise dans le portefeuille.');
    return { companyIds: ids, available: linked };
  }

  // ───────────────────────────── Chargement ────────────────────────────────────

  async load(
    userId: string,
    mode: 'COMPANY' | 'PORTFOLIO',
    q: AttendanceQuery,
  ): Promise<{ data: AttendanceDashboardData; companies: { id: string; name: string }[] }> {
    let period;
    try {
      period = buildPeriod(q);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }

    const scopeRes = mode === 'PORTFOLIO'
      ? await this.resolvePortfolioScope(userId, q.companies)
      : await this.resolveCompanyScope(userId, q.companyId);
    const { companyIds } = scopeRes;

    const companyRows: CompanyLite[] = await this.prisma.company.findMany({
      where: { id: { in: [...new Set([...companyIds, ...scopeRes.available])] } },
      select: { id: true, legalName: true, tradeName: true, city: true },
    });
    const nameOf = (c: { tradeName: string | null; legalName: string }) => (c.tradeName || c.legalName).trim();
    const byId = new Map(companyRows.map((c) => [c.id, c]));

    // ── Employés présents au moins un jour de la période (hors sortis sans date) ──
    const empRows = await this.prisma.employee.findMany({
      where: {
        companyId: { in: companyIds },
        hireDate: { lte: period.last.eom },
        OR: [
          { terminationDate: null, status: { notIn: ['TERMINATED', 'RETIRED'] as any } },
          { terminationDate: { gte: period.first.bom } },
        ],
      },
      select: {
        id: true, companyId: true, employeeNumber: true, firstName: true, lastName: true, position: true,
        department: { select: { name: true } },
      },
    });
    const employees: AdEmployee[] = empRows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      companyName: byId.get(r.companyId) ? nameOf(byId.get(r.companyId)!) : '',
      matricule: cleanText(r.employeeNumber),
      fullName: `${cleanText(r.lastName).toUpperCase()} ${cleanText(r.firstName)}`.trim(),
      department: cleanText(r.department?.name) || 'Sans département',
      position: cleanText(r.position) || 'Non renseigné',
    }));
    employees.sort((a, b) => a.fullName.localeCompare(b.fullName));
    const ids = employees.map((e) => e.id);
    const idSet = new Set(ids);

    const monthKeys = new Set(period.months.map((m) => m.key));
    const monthOr = period.months.map((m) => ({ month: m.month, year: m.year }));
    const winStart = period.first.bom;
    const winEnd = new Date(period.last.eom.getTime() + DAY_MS); // exclusif

    // ── Présences (synthèses mensuelles) ──
    const summaries: AdSummaryRow[] = [];
    if (ids.length > 0) {
      const sums = await this.prisma.attendanceSummary.findMany({
        where: { employeeId: { in: ids }, OR: monthOr },
        select: {
          employeeId: true, month: true, year: true, daysPresent: true, daysRemote: true, daysOnLeave: true,
          daysAbsentPaid: true, daysAbsentUnpaid: true, daysHoliday: true, daysOffDay: true, daysLate: true,
        },
      });
      for (const s of sums) {
        summaries.push({
          employeeId: s.employeeId, month: s.month, year: s.year,
          key: `${s.year}-${String(s.month).padStart(2, '0')}`,
          present: s.daysPresent, remote: s.daysRemote, leave: s.daysOnLeave,
          absPaid: s.daysAbsentPaid, absUnpaid: s.daysAbsentUnpaid,
          holiday: s.daysHoliday, offDay: s.daysOffDay, late: s.daysLate,
        });
      }
    }

    // ── Demandes d'absence (rattachées au mois de début) ──
    const absences: AdAbsence[] = [];
    if (ids.length > 0) {
      const abs = await this.prisma.absenceRequest.findMany({
        where: { companyId: { in: companyIds }, employeeId: { in: ids }, startDate: { gte: winStart, lt: winEnd } },
        select: {
          id: true, employeeId: true, type: true, subType: true, isPaid: true, reason: true,
          startDate: true, endDate: true, workingDays: true, status: true,
        },
        orderBy: { startDate: 'asc' },
      });
      for (const a of abs) {
        const mk = monthKeyOf(a.startDate);
        if (!monthKeys.has(mk) || !idSet.has(a.employeeId)) continue;
        absences.push({
          id: a.id, employeeId: a.employeeId,
          type: a.type, typeLabel: ABSENCE_TYPE_LABEL[a.type] ?? a.type,
          subTypeLabel: a.subType ? ABSENCE_SUBTYPE_LABEL[a.subType] ?? a.subType : '',
          paid: a.isPaid, reason: cleanText(a.reason),
          start: a.startDate, end: a.endDate, workingDays: Number(a.workingDays),
          status: a.status, statusLabel: STATUS_LABEL[a.status] ?? a.status, monthKey: mk,
        });
      }
    }

    // ── Permissions (rattachées au mois de la sortie) ──
    const permissions: AdPermission[] = [];
    if (ids.length > 0) {
      const perms = await this.prisma.permissionTicket.findMany({
        where: { companyId: { in: companyIds }, employeeId: { in: ids }, departureTime: { gte: winStart, lt: winEnd } },
        select: {
          id: true, employeeId: true, type: true, missionType: true, reason: true, destination: true,
          departureTime: true, actualDepartureTime: true, expectedReturnTime: true, actualReturnTime: true,
          status: true, returnStatus: true,
        },
        orderBy: { departureTime: 'asc' },
      });
      for (const p of perms) {
        const departure = p.actualDepartureTime ?? p.departureTime;
        const mk = monthKeyOf(new Date(p.departureTime.getTime() + CONGO_OFFSET_MS));
        if (!monthKeys.has(mk) || !idSet.has(p.employeeId)) continue;
        // actualReturnTime = retour VALIDÉ ; tant qu'il ne l'est pas, pas de durée ni de retard.
        const confirmed = p.returnStatus === 'CONFIRMED' && p.actualReturnTime ? p.actualReturnTime : null;
        const durationHours = confirmed ? round2(Math.max(0, confirmed.getTime() - departure.getTime()) / 3600_000) : null;
        const lateMinutes = confirmed ? Math.max(0, Math.round((confirmed.getTime() - p.expectedReturnTime.getTime()) / 60_000)) : 0;
        permissions.push({
          id: p.id, employeeId: p.employeeId,
          type: p.type, typeLabel: PERMISSION_TYPE_LABEL[p.type] ?? p.type,
          missionLabel: p.missionType ? MISSION_LABEL[p.missionType] ?? p.missionType : '',
          destination: cleanText(p.destination), reason: cleanText(p.reason),
          departure, expectedReturn: p.expectedReturnTime, actualReturn: confirmed,
          status: p.status, statusLabel: STATUS_LABEL[p.status] ?? p.status,
          returnStatus: p.returnStatus, returnLabel: RETURN_LABEL[p.returnStatus] ?? p.returnStatus,
          durationHours, lateMinutes, monthKey: mk,
        });
      }
    }

    const warnings: string[] = [];
    const missing = period.months.filter((m) => !summaries.some((s) => s.key === m.key));
    if (missing.length > 0 && missing.length === period.months.length) {
      warnings.push('Aucune synthèse de présence sur cette période : les taux de présence et d’absentéisme ne peuvent pas être calculés.');
    } else if (missing.length > 0) {
      warnings.push(`Pas de synthèse de présence pour : ${missing.map((m) => m.label.toLowerCase()).join(', ')}. Ces mois ne sont pas comptés dans les taux.`);
    }

    const chosen = companyIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
    const multi = chosen.length > 1;
    const scope: WfScope = {
      companyIds,
      companyName: multi ? `Portefeuille — ${chosen.length} entreprises` : chosen[0] ? nameOf(chosen[0]) : 'Entreprise',
      city: multi ? '' : cleanText(chosen[0]?.city),
      multi,
    };

    return {
      data: { scope, period, employees, summaries, absences, permissions, warnings, generatedAt: new Date() },
      companies: scopeRes.available.length
        ? scopeRes.available.map((id) => ({ id, name: byId.get(id) ? nameOf(byId.get(id)!) : id }))
        : chosen.map((c) => ({ id: c.id, name: nameOf(c) })),
    };
  }

  // ───────────────────────────── Sorties ───────────────────────────────────────

  async getView(userId: string, mode: 'COMPANY' | 'PORTFOLIO', q: AttendanceQuery): Promise<AttendanceDashboardView> {
    const { data, companies } = await this.load(userId, mode, q);
    const slim = (m: { month: number; year: number; label: string; short: string }) => ({ month: m.month, year: m.year, label: m.label, short: m.short });
    return {
      companyName: data.scope.companyName,
      city: data.scope.city,
      multi: data.scope.multi,
      companies,
      warnings: data.warnings,
      period: { mode: data.period.mode, label: data.period.label, months: data.period.months.map(slim) },
      headcount: data.employees.length,
      totals: totalsOf(data.summaries),
      absences: absenceStats(data.absences),
      permissions: permissionStats(data.permissions),
      departments: departmentRows(data.employees, data.summaries),
      topAbsent: topAbsent(data),
      topPermissions: topPermissions(data),
      evolution: evolution(data),
    };
  }

  async generateExport(userId: string, mode: 'COMPANY' | 'PORTFOLIO', q: AttendanceQuery) {
    const { data } = await this.load(userId, mode, q);
    const buffer = await buildAttendanceWorkbook(data);
    const filename = exportFileName('Presences_Absences', data as any);
    return { buffer, filename };
  }
}
