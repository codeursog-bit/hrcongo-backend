// ============================================================================
// 📁 src/leaves/leaves-mass-planning.service.ts
// 🗓️ Planification des congés EN MASSE (RH/Admin) — sans IA.
//
//  1) suggest() : propose, pour une période (1 à 12 mois), la date de départ de chaque
//     employé dont le cycle de congé se termine dans la période. Départ = fin de cycle
//     (même calcul que le « programme des départs »), durée = droit restant (jours de base
//     + jours d'ancienneté, congés anticipés déjà pris déduits), retour = prochain jour
//     travaillé. Les congés déjà posés comptent comme occupation du département ; un départ
//     qui dépasserait 25 % d'un département absent en même temps est décalé au premier
//     créneau libre (règle partagée avec le conseiller de l'assistant).
//     LECTURE seule : aucune demande n'est créée.
//  2) apply()   : crée les congés choisis, un par un, via createManual() — donc exactement
//     les mêmes contrôles que la planification individuelle (solde, chevauchement, jours
//     ouvrés, éligibilité). Un échec n'empêche pas les autres ; le détail est renvoyé.
// ============================================================================
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeavesService } from './leaves.service';
import { getCompanyWorkDays } from '../common/working-days.util';
import { congoDateString } from '../common/utils/congo-time';
import { adviseRequest } from '../assistant/request-advisor';

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (v: string | Date) => new Date(typeof v === 'string' ? v.slice(0, 10) + 'T00:00:00Z' : v);

export interface MassPlanRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  position: string | null;
  startDate: string;
  endDate: string;
  returnDate: string | null;
  workingDays: number;
  baseDays: number;
  seniorityDays: number;
  anticipatedTaken: number;
  /** Date de départ théorique (fin de cycle) avant tout décalage. */
  theoreticalStart: string;
  status: 'OK' | 'SHIFTED' | 'OVERDUE' | 'WARN';
  note: string | null;
}

export interface MassPlanSkipped {
  employeeId: string;
  employeeName: string;
  reason: string;
}

@Injectable()
export class LeavesMassPlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaves: LeavesService,
  ) {}

  async suggest(
    userId: string,
    q: { from: string; months: number; maxAbsentRatio?: number },
    companyIdOverride?: string,
  ) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(q.from || '');
    if (!m) throw new BadRequestException('Période de départ invalide (AAAA-MM attendu).');
    const months = Math.floor(Number(q.months));
    if (!(months >= 1 && months <= 12))
      throw new BadRequestException('La durée doit être comprise entre 1 et 12 mois.');
    const ratio =
      q.maxAbsentRatio !== undefined && q.maxAbsentRatio >= 0.05 && q.maxAbsentRatio <= 1
        ? q.maxAbsentRatio
        : 0.25;

    // ---- Programme des départs, mois par mois (déjà borné à l'entreprise de l'utilisateur) ----
    const rows: any[] = [];
    for (let k = 0; k < months; k++) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + k, 1));
      const program = await this.leaves.getDepartureProgram(
        userId,
        d.getUTCMonth() + 1,
        d.getUTCFullYear(),
        companyIdOverride,
      );
      rows.push(...program.rows);
    }
    const real = rows.filter((r) => !r.isTheoretical);
    const planned = rows
      .filter((r) => r.isTheoretical && !r.isRemainder)
      .sort((a, b) => asDate(a.startDate).getTime() - asDate(b.startDate).getTime());
    if (!rows.length) return this.empty(q.from, months);

    const ids = [...new Set(rows.map((r) => r.employeeId as string))];
    const emps = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyId: true, departmentId: true },
    });
    const companyId = emps[0]?.companyId;
    if (!companyId) return this.empty(q.from, months);
    const deptOf = new Map(emps.map((e) => [e.id, e.departmentId as string]));

    const [deptCounts, workDays, holidays] = await Promise.all([
      this.prisma.employee.groupBy({
        by: ['departmentId'],
        where: { companyId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      getCompanyWorkDays(this.prisma as any, companyId),
      this.prisma.publicHoliday.findMany({
        where: {
          companyId,
          year: { in: [Number(m[1]) - 1, Number(m[1]), Number(m[1]) + 1, Number(m[1]) + 2] },
        },
        select: { date: true },
      }),
    ]);
    const deptSize = new Map(deptCounts.map((d) => [d.departmentId as string, d._count._all]));
    const worked = new Set<number>(workDays);
    const holidaySet = new Set(holidays.map((h) => String(h.date)));
    const isWorkingDay = (d: Date) => worked.has(d.getUTCDay()) && !holidaySet.has(iso(d));

    // Occupation par département : congés déjà posés, puis départs proposés au fil de l'eau.
    const occupied = new Map<string, { start: Date; end: Date }[]>();
    const occupy = (dept: string, start: Date, end: Date) => {
      const list = occupied.get(dept) || [];
      list.push({ start, end });
      occupied.set(dept, list);
    };
    for (const r of real) {
      const dept = deptOf.get(r.employeeId);
      if (dept) occupy(dept, asDate(r.startDate), asDate(r.endDate));
    }

    const today = asDate(congoDateString());
    const out: MassPlanRow[] = [];
    const skipped: MassPlanSkipped[] = [];
    const name = (r: any) => `${r.employee.firstName} ${r.employee.lastName}`.trim();

    for (const r of planned) {
      const dept = deptOf.get(r.employeeId) || '';
      const theoretical = asDate(r.startDate);
      let status: MassPlanRow['status'] = 'OK';
      let note: string | null = null;
      let start = theoretical;
      if (start < today) {
        start = today;
        status = 'OVERDUE';
        note = 'Congé dû depuis le ' + iso(theoretical).split('-').reverse().join('/') + ' : proposé à partir d’aujourd’hui.';
      }

      const preview = async (s: Date): Promise<any | null> => {
        try {
          const p: any = await this.leaves.getPlanningPreview(
            { employeeId: r.employeeId, startDate: iso(s) },
            userId,
            companyIdOverride,
          );
          return p?.reliable && p.endDate && p.workingDays > 0 ? p : null;
        } catch {
          return null;
        }
      };

      let p = await preview(start);
      if (!p) {
        skipped.push({
          employeeId: r.employeeId,
          employeeName: name(r),
          reason: 'Droit restant indisponible ou nul : ouvrez son dossier de congé.',
        });
        continue;
      }

      // ---- Couverture du département ----------------------------------------------------------
      const advise = (pp: any) =>
        adviseRequest(
          {
            kind: 'LEAVE',
            start: asDate(pp.startDate),
            end: asDate(pp.endDate),
            days: pp.workingDays,
            leaveType: 'ANNUAL',
          },
          {
            deptSize: deptSize.get(dept) || 1,
            colleagueAbsences: occupied.get(dept) || [],
            pendingOverlaps: 0,
            history: { absenceRequests90d: 0, absenceDays90d: 0, unjustifiedDays90d: 0, permissions30d: 0 },
            isWorkingDay,
          },
          {
            maxAbsentRatio: ratio,
            recentReturnDays: 45,
            frequentAbsenceRequests: 99,
            frequentAbsenceDays: 999,
            unjustifiedDays: 999,
            frequentPermissions: 99,
            longPermissionHours: 24,
            alternativeSearchDays: 120,
          },
        );
      let advice = advise(p);
      if (advice.verdict === 'DEFER' && advice.alternative) {
        const shifted = await preview(advice.alternative.start);
        if (shifted) {
          const days = Math.round((asDate(shifted.startDate).getTime() - theoretical.getTime()) / DAY);
          p = shifted;
          advice = advise(p);
          status = 'SHIFTED';
          note = `Décalé de ${days} jour(s) : trop de collègues du département seraient absents à la date théorique.`;
        }
      }
      if (advice.verdict === 'DEFER' && status !== 'SHIFTED') {
        status = 'WARN';
        note = 'Département chargé sur cette période et aucun créneau libre trouvé : à arbitrer.';
      } else if (advice.findings.some((f) => f.code === 'SOLE_MEMBER') && !note) {
        status = 'WARN';
        note = 'Seul(e) dans son département : prévoir un remplacement.';
      }

      occupy(dept, asDate(p.startDate), asDate(p.endDate));
      out.push({
        employeeId: r.employeeId,
        employeeName: name(r),
        department: r.employee.department?.name ?? null,
        position: r.employee.position ?? null,
        startDate: iso(asDate(p.startDate)),
        endDate: iso(asDate(p.endDate)),
        returnDate: p.returnDate ? iso(asDate(p.returnDate)) : null,
        workingDays: Number(p.workingDays),
        baseDays: Number(p.split?.usedBase ?? 0),
        seniorityDays: Number(p.split?.usedSeniority ?? 0),
        anticipatedTaken: Number(p.entitlement?.takenBefore ?? 0),
        theoreticalStart: iso(theoretical),
        status,
        note,
      });
    }

    out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName));
    return {
      period: { from: q.from, months },
      rows: out,
      skipped,
      alreadyPlanned: real.length,
      stats: {
        count: out.length,
        shifted: out.filter((r) => r.status === 'SHIFTED').length,
        warnings: out.filter((r) => r.status === 'WARN' || r.status === 'OVERDUE').length,
        totalDays: out.reduce((s, r) => s + r.workingDays, 0),
      },
    };
  }

  private empty(from: string, months: number) {
    return {
      period: { from, months },
      rows: [] as MassPlanRow[],
      skipped: [] as MassPlanSkipped[],
      alreadyPlanned: 0,
      stats: { count: 0, shifted: 0, warnings: 0, totalDays: 0 },
    };
  }

  /**
   * Crée les congés choisis (APPROVED, via createManual). Ne fait confiance à rien : chaque ligne
   * repasse par tous les contrôles de la planification individuelle.
   */
  async apply(
    userId: string,
    items: { employeeId: string; startDate: string; endDate: string }[],
    companyIdOverride?: string,
  ) {
    if (!Array.isArray(items) || !items.length)
      throw new BadRequestException('Aucun congé à planifier.');
    if (items.length > 100)
      throw new BadRequestException('Maximum 100 congés par planification.');
    const created: { employeeId: string; leaveId: string }[] = [];
    const failed: { employeeId: string; message: string }[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      if (
        !it ||
        typeof it.employeeId !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}/.test(String(it.startDate)) ||
        !/^\d{4}-\d{2}-\d{2}/.test(String(it.endDate))
      ) {
        failed.push({ employeeId: String(it?.employeeId ?? ''), message: 'Ligne invalide.' });
        continue;
      }
      if (seen.has(it.employeeId)) {
        failed.push({ employeeId: it.employeeId, message: 'Employé en double dans la sélection.' });
        continue;
      }
      seen.add(it.employeeId);
      try {
        const leave: any = await this.leaves.createManual(
          {
            employeeId: it.employeeId,
            type: 'ANNUAL',
            startDate: it.startDate.slice(0, 10),
            endDate: it.endDate.slice(0, 10),
            reason: 'Planification des congés en masse',
          },
          userId,
          companyIdOverride,
        );
        created.push({ employeeId: it.employeeId, leaveId: String(leave?.id ?? '') });
      } catch (e: any) {
        failed.push({
          employeeId: it.employeeId,
          message: String(e?.response?.message ?? e?.message ?? 'Échec de la planification.').slice(0, 200),
        });
      }
    }
    return { created, failed };
  }
}