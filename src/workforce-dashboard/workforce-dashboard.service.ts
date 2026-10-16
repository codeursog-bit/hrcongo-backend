// ============================================================================
// 📁 src/workforce-dashboard/workforce-dashboard.service.ts
// ✅ Charge les données réelles (employés, présences, paie), applique les
// règles de workforce-calc.ts et alimente :
//   • l'écran (JSON : getView)
//   • l'Excel ORCA / POWERMAN (generateExport)
// Une seule source de calcul : l'écran et le fichier ne peuvent pas diverger.
// ============================================================================

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PortfolioMembershipService } from '../portfolio/portfolio-membership.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import { normalizeNationality } from '../common/utils/nationality.util';
import {
  AttendanceAgg, NATIONAL_LABEL, PeriodInput, buildPeriod, cleanText, contractLabelPowerman, cspFromCategory,
  groupContract, CONTRACT_LABEL_ORCA, snapshotFor, toDateOnly,
} from './workforce-calc';
import {
  WfEmployee, WfScope, WorkforceDashboardData, WorkforceDashboardView, WorkforceModel,
} from './workforce-dashboard.types';
import { buildOrcaWorkbook } from './workforce-excel-orca';
import { buildPowermanWorkbook } from './workforce-excel-powerman';
import { exportFileName } from './workforce-excel-common';

const FINANCE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER']; // voir le net des salariés

const MARITAL: Record<string, string> = {
  SINGLE: 'Célibataire', MARRIED: 'Marié(e)', DIVORCED: 'Divorcé(e)', WIDOWED: 'Veuf(ve)',
};

interface CompanyLite {
  id: string;
  legalName: string;
  tradeName: string | null;
  city: string | null;
  logo: string | null;
}

export interface WorkforceQuery extends PeriodInput {
  companyId?: string; // mode entreprise
  companies?: string; // mode portefeuille : "ALL" ou ids séparés par des virgules
}

@Injectable()
export class WorkforceDashboardService {
  private readonly logger = new Logger(WorkforceDashboardService.name);

  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
  ) {}

  // ───────────────────────── Périmètre (qui voit quoi) ─────────────────────────

  /** Entreprise de l'utilisateur (page liste des employés) — même vérification que /reports. */
  private async resolveCompanyScope(userId: string, companyId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, manageMultipleCompanies: true },
    });
    if (!user) throw new ForbiddenException('Utilisateur introuvable.');
    const id = await resolveVerifiedCompanyId(this.prisma, user, companyId);
    if (!id) throw new NotFoundException('Entreprise introuvable.');
    return { user, companyIds: [id], available: [] as string[] };
  }

  /** Portefeuille : "ALL" (défaut) = toutes les entreprises liées, sinon une ou plusieurs. */
  private async resolvePortfolioScope(userId: string, companies?: string) {
    const user = await this.membership.assertCanUsePortfolio(userId);
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
    return { user: { ...user }, companyIds: ids, available: linked };
  }

  // ───────────────────────────── Chargement ────────────────────────────────────

  async load(
    userId: string,
    mode: 'COMPANY' | 'PORTFOLIO',
    model: WorkforceModel,
    q: WorkforceQuery,
  ): Promise<{ data: WorkforceDashboardData; companies: { id: string; name: string }[] }> {
    let period;
    try {
      period = buildPeriod(q);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }

    const scopeRes =
      mode === 'PORTFOLIO'
        ? await this.resolvePortfolioScope(userId, q.companies)
        : await this.resolveCompanyScope(userId, q.companyId);
    const { user, companyIds } = scopeRes;
    const canSeeNet = FINANCE_ROLES.includes((user as any).role);

    const companyRows: CompanyLite[] = await this.prisma.company.findMany({
      where: { id: { in: [...new Set([...companyIds, ...scopeRes.available])] } },
      select: { id: true, legalName: true, tradeName: true, city: true, logo: true },
    });
    const nameOf = (c: { tradeName: string | null; legalName: string }) => (c.tradeName || c.legalName).trim();
    const byId = new Map(companyRows.map((c) => [c.id, c]));

    // ── Employés présents au moins un jour de la période ──
    const rows = await this.prisma.employee.findMany({
      where: {
        companyId: { in: companyIds },
        hireDate: { lte: period.last.eom },
        OR: [{ terminationDate: null }, { terminationDate: { gte: period.first.bom } }],
      },
      select: {
        id: true, companyId: true, employeeNumber: true, firstName: true, lastName: true, position: true,
        contractType: true, gender: true, nationality: true, isResident: true, maritalStatus: true,
        numberOfChildren: true, phone: true, cnssNumber: true, dateOfBirth: true, placeOfBirth: true, city: true,
        hireDate: true, terminationDate: true, status: true, professionalCategory: true, echelon: true,
        department: { select: { name: true } },
      },
    });

    const warnings: string[] = [];
    let noExit = 0;
    const employees: WfEmployee[] = [];
    for (const r of rows) {
      const hire = toDateOnly(r.hireDate)!;
      const exit = toDateOnly(r.terminationDate);
      // Sorti sans date de sortie : on ne sait pas QUAND il a quitté → exclu plutôt que compté à tort.
      if (!exit && (r.status === 'TERMINATED' || r.status === 'RETIRED')) { noExit++; continue; }

      const label = normalizeNationality(r.nationality);
      const isNational = label ? label === 'Congo' : !!r.isResident;
      const nationalityLabel = isNational ? NATIONAL_LABEL : label || 'Non renseignée';
      const group = groupContract(r.contractType, isNational);
      const category = cleanText(r.professionalCategory ?? r.echelon ?? '');
      const gender = r.gender === 'MALE' ? 'M' : r.gender === 'FEMALE' ? 'F' : 'O';
      const company = byId.get(r.companyId);

      employees.push({
        id: r.id,
        companyId: r.companyId,
        companyName: company ? nameOf(company) : '',
        matricule: cleanText(r.employeeNumber),
        lastName: cleanText(r.lastName),
        firstName: cleanText(r.firstName),
        fullName: `${cleanText(r.lastName).toUpperCase()} ${cleanText(r.firstName)}`.trim(),
        position: cleanText(r.position) || 'Non renseigné',
        department: cleanText(r.department?.name) || 'Sans département',
        contractType: r.contractType,
        contractGroup: group,
        contractLabelOrca: CONTRACT_LABEL_ORCA[group],
        contractLabelPowerman: contractLabelPowerman(r.contractType),
        gender,
        genderLabel: gender === 'M' ? 'Masculin' : gender === 'F' ? 'Féminin' : 'Autre',
        nationalityLabel,
        isNational,
        maritalLabel: MARITAL[r.maritalStatus] ?? '',
        children: r.numberOfChildren ?? 0,
        phone: cleanText(r.phone),
        cnss: cleanText(r.cnssNumber),
        birthDate: toDateOnly(r.dateOfBirth),
        originCity: cleanText(r.placeOfBirth) || cleanText(r.city) || 'Non renseigné',
        hireDate: hire,
        exitDate: exit,
        csp: cspFromCategory(category),
        grade: category,
        netByMonth: {},
      });
    }
    if (noExit > 0) {
      warnings.push(`${noExit} salarié(s) au statut « sorti/retraité » sans date de sortie ont été exclus du calcul. Renseignez leur date de sortie pour les voir apparaître sur les mois concernés.`);
    }

    const ids = employees.map((e) => e.id);
    const monthOr = period.months.map((m) => ({ month: m.month, year: m.year }));

    // ── Présences (absentéisme) ──
    const attendance: AttendanceAgg = {};
    if (ids.length > 0) {
      const sums = await this.prisma.attendanceSummary.findMany({
        where: { employeeId: { in: ids }, OR: monthOr },
        select: { month: true, year: true, daysPresent: true, daysRemote: true, daysAbsentPaid: true, daysAbsentUnpaid: true },
      });
      for (const s of sums) {
        const key = `${s.year}-${String(s.month).padStart(2, '0')}`;
        const a = (attendance[key] ??= { present: 0, remote: 0, absPaid: 0, absUnpaid: 0, absentEmployees: 0 })!;
        a.present += s.daysPresent;
        a.remote += s.daysRemote;
        a.absPaid += s.daysAbsentPaid;
        a.absUnpaid += s.daysAbsentUnpaid;
        if (s.daysAbsentPaid + s.daysAbsentUnpaid > 0) a.absentEmployees++;
      }
    }

    // ── Net payé (réservé aux rôles finance/RH) ──
    if (canSeeNet && model === 'POWERMAN' && ids.length > 0) {
      const pays = await this.prisma.payroll.findMany({
        where: { employeeId: { in: ids }, status: { in: ['VALIDATED', 'PAID'] }, OR: monthOr },
        select: { employeeId: true, month: true, year: true, netSalary: true },
      });
      const idx = new Map(employees.map((e) => [e.id, e]));
      for (const p of pays) {
        const e = idx.get(p.employeeId);
        if (e) e.netByMonth[`${p.year}-${String(p.month).padStart(2, '0')}`] = Number(p.netSalary);
      }
    }

    const snapshots = period.months.map((m) => snapshotFor(employees, m, attendance, period.months));

    // ── Libellé / logo du périmètre ──
    const chosen = companyIds.map((id) => byId.get(id)).filter((c): c is CompanyLite => !!c);
    const multi = chosen.length > 1;
    const scope: WfScope = {
      companyIds,
      companyName: multi ? `Portefeuille — ${chosen.length} entreprises` : chosen[0] ? nameOf(chosen[0]) : 'Entreprise',
      city: multi ? '' : cleanText(chosen[0]?.city),
      multi,
    };
    if (!multi && chosen[0]?.logo) {
      const logo = await this.readLogo(chosen[0].logo);
      if (logo) { scope.logo = logo.buffer; scope.logoExt = logo.ext; }
    }

    return {
      data: { model, scope, period, employees, snapshots, canSeeNet, generatedAt: new Date(), warnings },
      companies: scopeRes.available.length
        ? scopeRes.available.map((id) => ({ id, name: byId.get(id) ? nameOf(byId.get(id)!) : id }))
        : chosen.map((c) => ({ id: c.id, name: nameOf(c) })),
    };
  }

  /** Logo (base64 ou URL http) → Buffer ; formats supportés par Excel : png/jpeg. Jamais bloquant. */
  private async readLogo(raw: string): Promise<{ buffer: Buffer; ext: 'png' | 'jpeg' } | null> {
    try {
      const m = raw.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
      if (m) return { buffer: Buffer.from(m[2], 'base64'), ext: m[1].toLowerCase() === 'png' ? 'png' : 'jpeg' };
      if (/^https?:\/\//i.test(raw)) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        try {
          const res = await fetch(raw, { signal: ctrl.signal });
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || !/image\/(png|jpe?g)/i.test(type)) return null;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 2_000_000) return null;
          return { buffer: buf, ext: /png/i.test(type) ? 'png' : 'jpeg' };
        } finally {
          clearTimeout(t);
        }
      }
    } catch (e: any) {
      this.logger.warn(`Logo ignoré : ${e?.message ?? e}`);
    }
    return null;
  }

  // ───────────────────────────── Sorties ───────────────────────────────────────

  async getView(userId: string, mode: 'COMPANY' | 'PORTFOLIO', model: WorkforceModel, q: WorkforceQuery): Promise<WorkforceDashboardView> {
    const { data, companies } = await this.load(userId, mode, model, q);
    const last = data.snapshots[data.snapshots.length - 1];
    const slim = (m: { month: number; year: number; label: string; short: string }) => ({ month: m.month, year: m.year, label: m.label, short: m.short });
    const { month, ...rest } = last;
    return {
      model,
      companyName: data.scope.companyName,
      city: data.scope.city,
      multi: data.scope.multi,
      companies,
      canSeeNet: data.canSeeNet,
      warnings: data.warnings,
      period: { mode: data.period.mode, label: data.period.label, months: data.period.months.map(slim) },
      current: { ...rest, month: slim(month) },
      evolution: data.snapshots.map((s) => ({
        ...slim(s.month), total: s.total, M: s.gender.M, F: s.gender.F, hires: s.hires, departures: s.departures,
      })),
    };
  }

  async generateExport(userId: string, mode: 'COMPANY' | 'PORTFOLIO', model: WorkforceModel, q: WorkforceQuery) {
    const { data } = await this.load(userId, mode, model, q);
    const buffer = model === 'ORCA' ? await buildOrcaWorkbook(data) : await buildPowermanWorkbook(data);
    const filename = exportFileName(model === 'ORCA' ? 'Effectif_ORCA' : 'TB_Effectifs_POWERMAN', data);
    return { buffer, filename };
  }
}