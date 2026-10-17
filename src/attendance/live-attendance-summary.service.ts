// ============================================================================
// 📁 src/attendance/live-attendance-summary.service.ts
// 🆕 Synthèses de présence EN TEMPS RÉEL — réservées aux dashboards (lecture seule).
//
// POURQUOI
//   Les dashboards (présences, effectifs, portefeuille, exports Excel) lisaient la
//   table `attendance_summaries`. Or :
//     • elle ne contient que les lignes de pointage RÉELLES : un jour ouvré sans
//       pointage n'y est jamais compté « absent » (ABSENT_UNPAID n'est jamais écrit
//       en base, la page Présences l'infère à la volée) → 100 % de présence / 0 %
//       d'absentéisme / « 21 j à travailler = 21 j travaillés » ;
//     • elle n'existe que si quelqu'un a lancé la génération du mois → « n/d » ou
//       chiffres périmés, et chaque écran pouvait lire un instantané différent.
//
// CE QUE FAIT CE SERVICE
//   Calcule les mêmes compteurs (présent / télétravail / retard / congé / absent payé /
//   absent non payé / férié / repos) avec LE MÊME moteur de statut que la page
//   Présences : AttendanceCalculationService.calculateDayStatusesOptimized().
//   → tous les écrans parlent la même langue, sans génération préalable.
//
// SÉCURITÉ / PAIE
//   • AUCUNE écriture en base, aucun appel à AttendanceSummaryService.
//   • La table `attendance_summaries` et tout le circuit paie restent strictement inchangés.
//
// RÈGLES
//   • Jours comptés : du max(1er du mois, date d'embauche) au min(fin du mois, date de
//     sortie, AUJOURD'HUI). Jamais de jour futur, jamais avant l'embauche.
//   • Aujourd'hui : un salarié sans pointage est absent dès l'heure officielle (ou le début de son
//     shift) ; avant, la journée n'est pas encore due (ni présent ni absent). Règle partagée avec la
//     page Présences et le suivi des absences (common/absence-rules.util.ts).
//   • Jours exclus des taux : congés, fériés, repos (comptés à part).
//   • Entreprise qui n'utilise pas le pointage un mois donné (aucun présent/retard/
//     télétravail enregistré dans tout le mois) → mois NON calculé (n/d + avertissement),
//     sinon tout le monde apparaîtrait « absent » à tort.
//
// PERFORMANCE
//   • 5 requêtes par entreprise pour TOUTE la période (pas par employé, pas par mois).
//   • Cache mémoire court (45 s si la période touche aujourd'hui, 5 min sinon) +
//     dédoublonnage des calculs simultanés → pas de surcharge serveur.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeWorkDays } from '../common/utils/work-days';
import { AttendanceCalculationService } from './services/attendance-calculation.service';
import { AttendanceUtilsService, DEFAULT_WORK_DAYS } from './services/attendance-utils.service';

const CACHE_TTL_LIVE_MS = 45_000; // période qui inclut aujourd'hui
const CACHE_TTL_PAST_MS = 300_000; // période entièrement passée
const CACHE_MAX_ENTRIES = 120;

export interface LiveSummaryRow {
  employeeId: string;
  month: number;
  year: number;
  key: string; // "2026-10"
  present: number;
  remote: number;
  late: number;
  leave: number;
  absPaid: number;
  absUnpaid: number;
  holiday: number;
  offDay: number;
  /** 🆕 Absences JUSTIFIÉES = jours couverts par une demande d'absence validée (ou absence payée saisie par la RH). */
  absJustified: number;
  /** 🆕 Absences NON justifiées = aucun pointage et aucune demande validée. absJustified + absUnjustified = absPaid + absUnpaid. */
  absUnjustified: number;
  /** 🆕 Détail des justifiées : clé « TYPE|SOUS-TYPE|P » (payé) ou « …|U » (non payé) → nombre de jours. */
  justifiedDetail: Record<string, number>;
}

export interface LiveSummaryResult {
  rows: LiveSummaryRow[];
  /** Mois (déjà commencés) où l'entreprise n'a enregistré AUCUN pointage : non calculés. */
  untracked: { companyId: string; key: string }[];
}

interface MonthRef {
  month: number;
  year: number;
}

interface CompanyComputation {
  rows: LiveSummaryRow[];
  trackedKeys: string[];
  startedKeys: string[]; // mois commencés (≤ aujourd'hui) couverts par la période
}

/**
 * 🆕 Une journée d'absence est JUSTIFIÉE si une demande d'absence VALIDÉE la couvre (maladie, mariage,
 * décès, naissance, conventionnelle, exceptionnelle…) — ou si la RH l'a saisie « payée » sans demande.
 * Sinon elle est NON justifiée. Le motif (type + sous-type) est conservé pour l'affichage.
 */
function classify(d: any, row: LiveSummaryRow, paidStatus: boolean): void {
  if (d.absenceType) {
    row.absJustified++;
    const k = `${d.absenceType}|${d.absenceSubType ?? ''}|${d.isPaid ? 'P' : 'U'}`;
    row.justifiedDetail[k] = (row.justifiedDetail[k] ?? 0) + 1;
  } else if (paidStatus) {
    row.absJustified++;
    const k = 'MANUEL||P';
    row.justifiedDetail[k] = (row.justifiedDetail[k] ?? 0) + 1;
  } else {
    row.absUnjustified++;
  }
}

const keyOf = (m: MonthRef) => `${m.year}-${String(m.month).padStart(2, '0')}`;
const utcDay = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

@Injectable()
export class LiveAttendanceSummaryService {
  private readonly logger = new Logger(LiveAttendanceSummaryService.name);

  private readonly cache = new Map<string, { at: number; ttl: number; value: CompanyComputation }>();
  private readonly inflight = new Map<string, Promise<CompanyComputation>>();

  constructor(
    private prisma: PrismaService,
    private calculation: AttendanceCalculationService,
    private utils: AttendanceUtilsService,
  ) {}

  // ───────────────────────────── API publique ─────────────────────────────────

  /**
   * @param companyIds   entreprises du périmètre
   * @param employeeIds  employés retenus par le dashboard (filtre final)
   * @param months       mois demandés, ordre chronologique (jamais de mois futur)
   */
  async getRows(opts: {
    companyIds: string[];
    employeeIds: string[];
    months: MonthRef[];
  }): Promise<LiveSummaryResult> {
    const { companyIds, employeeIds, months } = opts;
    if (months.length === 0 || employeeIds.length === 0) return { rows: [], untracked: [] };

    const wanted = new Set(employeeIds);
    const from = months[0];
    const to = months[months.length - 1];
    const asked = new Set(months.map(keyOf));

    const rows: LiveSummaryRow[] = [];
    const untracked: { companyId: string; key: string }[] = [];

    // Entreprise par entreprise (séquentiel) : on protège le serveur et la paie.
    for (const companyId of [...new Set(companyIds)]) {
      let comp: CompanyComputation;
      try {
        comp = await this.computeCompany(companyId, from, to);
      } catch (e: any) {
        this.logger.error(`Présences temps réel — entreprise ${companyId} : ${e?.message ?? e}`);
        continue;
      }
      for (const r of comp.rows) if (asked.has(r.key) && wanted.has(r.employeeId)) rows.push(r);
      const tracked = new Set(comp.trackedKeys);
      for (const k of comp.startedKeys) if (asked.has(k) && !tracked.has(k)) untracked.push({ companyId, key: k });
    }
    return { rows, untracked };
  }

  // ───────────────────────────── Calcul d'une entreprise ──────────────────────

  private computeCompany(companyId: string, from: MonthRef, to: MonthRef): Promise<CompanyComputation> {
    const cacheKey = `${companyId}|${keyOf(from)}|${keyOf(to)}`;

    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value);

    const running = this.inflight.get(cacheKey);
    if (running) return running;

    const p = this.doComputeCompany(companyId, from, to)
      .then(({ value, touchesToday }) => {
        if (this.cache.size >= CACHE_MAX_ENTRIES) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(cacheKey, {
          at: Date.now(),
          ttl: touchesToday ? CACHE_TTL_LIVE_MS : CACHE_TTL_PAST_MS,
          value,
        });
        return value;
      })
      .finally(() => this.inflight.delete(cacheKey));

    this.inflight.set(cacheKey, p);
    return p;
  }

  private async doComputeCompany(
    companyId: string,
    from: MonthRef,
    to: MonthRef,
  ): Promise<{ value: CompanyComputation; touchesToday: boolean }> {
    const todayStr = this.utils.getTodayString();
    const today = this.utils.createLocalDate(todayStr);

    const rangeStart = new Date(from.year, from.month - 1, 1);
    const fullEnd = new Date(to.year, to.month, 0);
    const rangeEnd = fullEnd.getTime() > today.getTime() ? today : fullEnd;
    const touchesToday = fullEnd.getTime() >= today.getTime();

    const empty = { value: { rows: [], trackedKeys: [], startedKeys: [] } as CompanyComputation, touchesToday };
    if (rangeStart.getTime() > rangeEnd.getTime()) return empty;

    const startStr = this.utils.formatDate(rangeStart);
    const endStr = this.utils.formatDate(rangeEnd);
    const years: number[] = [];
    for (let y = rangeStart.getFullYear(); y <= rangeEnd.getFullYear(); y++) years.push(y);

    // ── Employés concernés par la période ────────────────────────────────────
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        hireDate: { lte: utcDay(endStr) },
        OR: [
          { terminationDate: null, status: { notIn: ['TERMINATED', 'RETIRED'] as any } },
          { terminationDate: { gte: utcDay(startStr) } },
        ],
      },
      select: { id: true, hireDate: true, terminationDate: true },
    });

    // Règle « absent dès l'heure officielle » pour AUJOURD'HUI (par salarié, shift pris en compte)
    const todayCutoffs =
      startStr <= todayStr && endStr >= todayStr
        ? await this.calculation.getTodayCutoffs(companyId, employees.map((e) => e.id))
        : new Map<string, number>();

    // Mois commencés couverts par la période
    const startedKeys: string[] = [];
    {
      let y = from.year;
      let m = from.month;
      while (y < to.year || (y === to.year && m <= to.month)) {
        if (new Date(y, m - 1, 1).getTime() <= today.getTime()) startedKeys.push(keyOf({ month: m, year: y }));
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
    if (employees.length === 0) return { value: { rows: [], trackedKeys: [], startedKeys }, touchesToday };

    // ── Données (5 requêtes pour toute la période) ───────────────────────────
    const [settings, attendances, leaves, holidays, absenceRequests] = await Promise.all([
      this.prisma.payrollSettings.findFirst({
        where: { companyId },
        orderBy: { effectiveDate: 'desc' },
        select: { workDays: true },
      }),
      this.prisma.attendance.findMany({
        where: { companyId, date: { gte: startStr, lte: endStr } },
        select: { employeeId: true, date: true, status: true, checkIn: true },
      }),
      this.prisma.leave.findMany({
        where: {
          companyId,
          status: 'APPROVED',
          startDate: { lte: utcDay(endStr) },
          endDate: { gte: utcDay(startStr) },
        },
        select: { employeeId: true, startDate: true, endDate: true, type: true },
      }),
      this.prisma.publicHoliday.findMany({
        where: { companyId, year: { in: years } },
        select: { date: true },
      }),
      this.prisma.absenceRequest.findMany({
        where: {
          companyId,
          status: 'APPROVED',
          startDate: { lte: utcDay(endStr) },
          endDate: { gte: utcDay(startStr) },
        },
      }),
    ]);

    const workDays = normalizeWorkDays(settings?.workDays || DEFAULT_WORK_DAYS);
    const holidayDates = new Set<string>(holidays.map((h) => h.date as string));

    const attByEmp = new Map<string, any[]>();
    const punchedKeys = new Set<string>(); // mois où au moins un vrai pointage de travail existe
    for (const a of attendances) {
      (attByEmp.get(a.employeeId) ?? attByEmp.set(a.employeeId, []).get(a.employeeId)!).push(a);
      if (a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'REMOTE') punchedKeys.add(a.date.slice(0, 7));
    }
    const leavesByEmp = new Map<string, any[]>();
    for (const l of leaves) {
      (leavesByEmp.get(l.employeeId) ?? leavesByEmp.set(l.employeeId, []).get(l.employeeId)!).push(l);
    }
    const absenceDatesByEmp = await this.calculation.buildAbsenceDatesByEmployee(companyId, absenceRequests);

    // ── Statuts jour par jour (même moteur que la page Présences) ────────────
    const rows: LiveSummaryRow[] = [];
    const trackedKeys = startedKeys.filter((k) => punchedKeys.has(k));
    const trackedSet = new Set(trackedKeys);

    for (const emp of employees) {
      const hire = this.utils.createLocalDate(this.utils.formatDate(emp.hireDate));
      const exit = emp.terminationDate
        ? this.utils.createLocalDate(this.utils.formatDate(emp.terminationDate))
        : null;
      const atts = attByEmp.get(emp.id) ?? [];
      const empLeaves = leavesByEmp.get(emp.id) ?? [];
      const abs = absenceDatesByEmp.get(emp.id);

      for (const k of startedKeys) {
        if (!trackedSet.has(k)) continue; // mois sans pointage dans l'entreprise → non calculé
        const [yy, mm] = k.split('-').map(Number);
        const mStart = new Date(yy, mm - 1, 1);
        const mEnd = new Date(yy, mm, 0);

        let s = mStart;
        if (hire.getTime() > s.getTime()) s = hire;
        let e = mEnd.getTime() > rangeEnd.getTime() ? rangeEnd : mEnd;
        if (exit && exit.getTime() < e.getTime()) e = exit;
        if (s.getTime() > e.getTime()) continue;

        const days = this.calculation.calculateDayStatusesOptimized(
          emp.id, s, e, atts, empLeaves, holidayDates, workDays, abs,
          {
            hireDateStr: this.utils.formatDate(emp.hireDate),
            exitDateStr: emp.terminationDate ? this.utils.formatDate(emp.terminationDate) : null,
            todayCutoffMin: todayCutoffs.get(emp.id),
          },
        );

        const row: LiveSummaryRow = {
          employeeId: emp.id, month: mm, year: yy, key: k,
          present: 0, remote: 0, late: 0, leave: 0, absPaid: 0, absUnpaid: 0, holiday: 0, offDay: 0,
          absJustified: 0, absUnjustified: 0, justifiedDetail: {},
        };
        for (const d of days) {
          const st = d.status as string;
          switch (st) {
            case 'PRESENT': row.present++; break;
            case 'REMOTE': row.remote++; break;
            case 'LATE': row.late++; break;
            case 'LEAVE': row.leave++; break;
            case 'ABSENT_PAID': {
              row.absPaid++;
              classify(d, row, true);
              break;
            }
            case 'HOLIDAY': row.holiday++; break;
            case 'OFF_DAY': row.offDay++; break;
            case 'ABSENT':
            case 'ABSENT_UNPAID': {
              row.absUnpaid++;
              classify(d, row, false);
              break;
            }
            default: break; // FUTURE / inconnu : ignoré
          }
        }
        rows.push(row);
      }
    }

    return { value: { rows, trackedKeys, startedKeys }, touchesToday };
  }
}