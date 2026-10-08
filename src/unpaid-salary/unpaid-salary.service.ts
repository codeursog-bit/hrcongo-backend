// ============================================================================
// 📁 src/unpaid-salary/unpaid-salary.service.ts — VERSION V7
//
// V7 = V6 + « léger pour le serveur » (fonctionnalité secondaire : elle ne doit jamais
// concurrencer la paie). Le calcul de la paie n'est JAMAIS modifié ici.
//
// LOGIQUE DE DÉTECTION
//   PHASE 1 — J-3 avant la date de paiement       → alerte préventive
//   PHASE 2 — Jour J                               → rappel paiement aujourd'hui
//   PHASE 3 — Date dépassée + aucun bulletin       → 🔴 paie jamais lancée
//             → montant = net que le moteur de paie calculerait (simulation lecture seule)
//   PHASE 4 — Date dépassée + bulletin DRAFT/VALIDATED non payé → net EXACT du bulletin
//   PHASE 5 — bulletin au statut PAID              → ✅ OK
//
// 🆕 V7
//   • Fenêtre : les 5 derniers mois (LOOKBACK_MONTHS), jamais avant la création de l'entreprise
//     sur la plateforme (Company.createdAt) ni avant l'embauche de l'employé.
//   • Seuls les mois SANS bulletin coûtent une simulation. Les bulletins existants sont juste lus.
//   • Estimations mises en cache ~30 h (le cron de 8 h les renouvelle) → ouvrir la page ne relance
//     pas de simulation. Le bouton « actualiser » force un recalcul (max 1 fois / 2 min / entreprise).
//   • Les résumés de présence sont régénérés UNE fois par mois (plus une fois par employé).
//   • Au plus MAX_CONCURRENT_ESTIMATIONS entreprises simulées en même temps sur le serveur ;
//     deux analyses simultanées de la même entreprise partagent le même calcul.
//   • Montant de repli (salaire de base) signalé : estimateSource = 'BASE_SALARY' + hasFallback.
//
// 🐛 (V6) Un bulletin est réglé quand `status = 'PAID'` (ou, par compatibilité, `paid = true`).
// TEMPS RÉEL : l'état des bulletins est relu en base à chaque appel (jamais en cache).
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PayrollsService } from '../payrolls/payrolls.service';

const MONTHS_FR = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
];

type AlertLevel = 'INFO' | 'WARNING' | 'CRITIQUE';
export type EstimateSource = 'BULLETIN' | 'SIMULATION' | 'BASE_SALARY';

export interface MoisNonPaye {
  id:             string | null;
  month:          number;
  year:           number;
  montant:        number;           // net du bulletin, ou net simulé (comme la paie), ou salaire de base en dernier repli
  isApproximate:  boolean;          // true = pas de bulletin (montant calculé par simulation)
  estimateSource: EstimateSource;   // 🆕 d'où vient le montant
  bulletinStatus: 'NONE' | 'DRAFT' | 'VALIDATED';
  dueDate:        Date;
  daysOverdue:    number;
  phase:          'NO_BULLETIN' | 'UNPAID_BULLETIN';
}

export interface EmployeeUnpaidSummary {
  employeeId:      string;
  nom:             string;
  matricule:       string;
  poste:           string;
  department:      string | null;
  monthsLate:      number;
  maxDaysOverdue:  number;
  totalDu:         number;
  hasApproximate:  boolean;
  hasFallback:     boolean;          // 🆕 au moins un mois estimé au simple salaire de base (repli)
  alertLevel:      AlertLevel;
  moisNonPayes:    MoisNonPaye[];
  oldestUnpaid:    MoisNonPaye;
  phase:           'NO_BULLETIN' | 'UNPAID_BULLETIN' | 'MIXED';
}

export interface UpcomingDue {
  hasDue:        boolean;
  count:         number;
  totalEstimate: number;
  daysUntilDue:  number;
  month:         number;
  year:          number;
}

export interface UnpaidDashboardData {
  companyId:               string;
  unpaidCount:             number;
  employeeCount:           number;
  totalDu:                 number;
  totalApproximate:        number;
  totalExact:              number;
  totalFallback:           number;   // 🆕 part du total estimée au simple salaire de base (repli)
  hasApproximateData:      boolean;
  hasFallbackData:         boolean;  // 🆕
  maxMonthsLate:           number;
  alertLevel:              AlertLevel;
  employees:               EmployeeUnpaidSummary[];
  noBulletinEmployees:     EmployeeUnpaidSummary[];
  unpaidBulletinEmployees: EmployeeUnpaidSummary[];
  mixedEmployees:          EmployeeUnpaidSummary[];
  upcomingDue:             UpcomingDue;
}

interface AnalysisResult { early: boolean; paymentDay: number; now: Date; data: UnpaidDashboardData }
type AnalysisMode = 'PAGE' | 'CRON';

interface MonthPeriod { month: number; year: number; }
interface Estimate { amount: number; source: EstimateSource; }
interface Budget { ms: number; deadline?: number }

// ── Réglages « léger pour le serveur » ──────────────────────────────────────
const LOOKBACK_MONTHS            = 5;                 // nombre de mois analysés en arrière
// Estimations (mois sans bulletin) : ~30 h → le cron de 8 h les renouvelle chaque jour.
// Les bulletins eux ne sont JAMAIS en cache.
const ESTIMATE_TTL_MS            = 30 * 60 * 60 * 1000;
const BUDGET_PAGE_MS             = 25_000;            // page / badge : au-delà → repli salaire de base (jamais bloquée)
const BUDGET_CRON_MS             = 120_000;           // cron de nuit : personne n'attend, on laisse plus de temps
const ESTIMATE_CHUNK             = 5;                 // simulations lancées en parallèle
const SUMMARIES_REUSE_MS         = 10 * 60 * 1000;    // résumés de présence réutilisés 10 min (1 régénération / mois)
const MAX_CONCURRENT_ESTIMATIONS = 2;                 // entreprises simulées en même temps, tout le serveur
const REFRESH_MIN_INTERVAL_MS    = 2 * 60 * 1000;     // « actualiser » : 1 recalcul forcé / 2 min / entreprise

@Injectable()
export class UnpaidSalaryService {
  private readonly logger = new Logger(UnpaidSalaryService.name);
  private readonly estimateCache = new Map<string, { at: number; net: number }>();
  private readonly inflightAnalyses = new Map<string, Promise<AnalysisResult>>(); // même entreprise = même calcul
  private readonly lastForcedRefresh = new Map<string, number>();
  private activeEstimations = 0;                 // semaphore : simulations en cours sur tout le serveur
  private readonly estimationWaiters: Array<() => void> = [];

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private payrolls: PayrollsService, // 🆕 simulation de paie (lecture seule, ne crée aucun bulletin)
  ) {}

  // ── Bulletin réglé ? (status PAID = ce que fait « Marquer comme payé » / paie en masse) ──
  // Pour considérer aussi « Validé » comme réglé, ajouter 'VALIDATED' ici.
  private isSettled(p: { status: string; paid: boolean | null }): boolean {
    return p.status === 'PAID' || p.paid === true;
  }

  private computeDueDate(year: number, month: number, paymentDay: number): Date {
    return new Date(year, month, paymentDay);
  }

  // Mois à vérifier : les LOOKBACK_MONTHS derniers mois dont l'échéance est dépassée, du plus récent
  // au plus ancien, sans jamais remonter avant le mois de création de l'entreprise sur la plateforme.
  private getPeriodsToCheck(now: Date, paymentDay: number, notBefore: Date | null): MonthPeriod[] {
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();
    const minIndex  = notBefore ? notBefore.getFullYear() * 12 + notBefore.getMonth() : -Infinity;
    const periods: MonthPeriod[] = [];
    for (let i = 1; i <= LOOKBACK_MONTHS; i++) {
      let m = thisMonth - i;
      let y = thisYear;
      while (m <= 0) { m += 12; y -= 1; }
      if (y * 12 + (m - 1) < minIndex) break; // avant la création de l'entreprise : rien à comptabiliser
      const dueDate = this.computeDueDate(y, m, paymentDay);
      if (now > dueDate) periods.push({ month: m, year: y });
    }
    return periods;
  }

  // ── Semaphore : limite les entreprises simulées en même temps (protège la paie) ──
  private async acquireEstimationSlot(): Promise<void> {
    if (this.activeEstimations < MAX_CONCURRENT_ESTIMATIONS) { this.activeEstimations++; return; }
    await new Promise<void>((resolve) => this.estimationWaiters.push(resolve)); // le slot nous est transmis
  }
  private releaseEstimationSlot(): void {
    const next = this.estimationWaiters.shift();
    if (next) next();               // transmission directe du slot (le compteur ne bouge pas)
    else this.activeEstimations--;
  }

  // ── Vide les estimations en cache d'une entreprise (bouton « actualiser ») ──
  private clearCompanyEstimates(companyId: string): void {
    const prefix = `${companyId}:`;
    for (const k of this.estimateCache.keys()) if (k.startsWith(prefix)) this.estimateCache.delete(k);
  }

  // ── Utilisateur « de simulation » : la simulation de paie lit l'entreprise de l'utilisateur ──
  private async resolveSimUserId(companyId: string, preferredUserId?: string | null): Promise<string | null> {
    if (preferredUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: preferredUserId }, select: { companyId: true },
      });
      if (u?.companyId === companyId) return preferredUserId;
    }
    const admin = await this.prisma.user.findFirst({
      where: { companyId, isActive: true, role: { in: ['ADMIN', 'HR_MANAGER'] } },
      select: { id: true },
    });
    return admin?.id ?? null;
  }

  // ── Montant dû pour des employés SANS bulletin : même calcul que la paie (simulation) ──
  // Cache d'abord ; seules les absences de cache déclenchent une simulation, sous semaphore,
  // avec les résumés de présence régénérés une seule fois (SUMMARIES_REUSE_MS).
  private async estimateNets(
    companyId: string,
    simUserId: string | null,
    employees: Array<{ id: string; baseSalary: any }>,
    month: number,
    year: number,
    budget: Budget,
  ): Promise<Map<string, Estimate>> {
    const out = new Map<string, Estimate>();
    const fallback = (e: { id: string; baseSalary: any }) =>
      out.set(e.id, { amount: Number(e.baseSalary), source: 'BASE_SALARY' });

    const now = Date.now();
    const todo: Array<{ id: string; baseSalary: any }> = [];
    for (const e of employees) {
      const hit = this.estimateCache.get(`${companyId}:${e.id}:${month}-${year}`);
      if (hit && now - hit.at < ESTIMATE_TTL_MS) out.set(e.id, { amount: hit.net, source: 'SIMULATION' });
      else todo.push(e);
    }
    if (todo.length === 0) return out;

    await this.acquireEstimationSlot();
    try {
      // Le temps d'attente du slot ne compte pas dans le budget : il démarre à la 1re simulation réelle
      if (budget.deadline === undefined) budget.deadline = Date.now() + budget.ms;
      const deadline = budget.deadline;

      for (let i = 0; i < todo.length; i += ESTIMATE_CHUNK) {
        const chunk = todo.slice(i, i + ESTIMATE_CHUNK);
        if (!simUserId || Date.now() > deadline) { chunk.forEach(fallback); continue; }
        try {
          const res = await this.payrolls.simulateBatchPayroll(
            chunk.map(e => e.id), month, year, simUserId,
            { summariesMaxAgeMs: SUMMARIES_REUSE_MS },
          );
          const byId = new Map<string, any>(res.results.map((r: any) => [r.employeeId, r]));
          for (const e of chunk) {
            const r = byId.get(e.id);
            const net = r?.success ? Number(r.data?.netSalary) : NaN;
            if (Number.isFinite(net)) {
              const amount = Math.round(net);
              this.estimateCache.set(`${companyId}:${e.id}:${month}-${year}`, { at: Date.now(), net: amount });
              out.set(e.id, { amount, source: 'SIMULATION' });
            } else {
              fallback(e);
            }
          }
        } catch (err: any) {
          this.logger.warn(`Simulation de paie indisponible (${month}/${year}) : ${err?.message ?? err}`);
          chunk.forEach(fallback);
        }
      }
    } finally {
      this.releaseEstimationSlot();
    }

    if (this.estimateCache.size > 5000) {
      for (const [k, v] of this.estimateCache) if (now - v.at > ESTIMATE_TTL_MS) this.estimateCache.delete(k);
    }
    return out;
  }

  @Cron('0 8 * * *', { timeZone: 'Africa/Brazzaville' })
  async checkAllCompanies() {
    this.logger.log('Verification quotidienne des salaires impayes...');
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const c of companies) {
      await this.checkCompany(c.id, null, 'CRON').catch(err =>
        this.logger.error(`Erreur company ${c.id}: ${err.message}`)
      );
    }
    this.logger.log(`${companies.length} entreprises verifiees`);
  }

  // ── Analyse pure (aucune notification) — partagée par la page, le badge et le cron ──
  // Deux demandes simultanées pour la même entreprise (page + badge + cron…) partagent le même calcul.
  private analyze(companyId: string, preferredUserId?: string | null, mode: AnalysisMode = 'PAGE'): Promise<AnalysisResult> {
    const running = this.inflightAnalyses.get(companyId);
    if (running) return running;
    const job = this.doAnalyze(companyId, preferredUserId, mode).finally(() => {
      this.inflightAnalyses.delete(companyId);
    });
    this.inflightAnalyses.set(companyId, job);
    return job;
  }

  private async doAnalyze(companyId: string, preferredUserId: string | null | undefined, mode: AnalysisMode): Promise<AnalysisResult> {
    const now = new Date();
    const budget: Budget = { ms: mode === 'CRON' ? BUDGET_CRON_MS : BUDGET_PAGE_MS };

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { payrollPaymentDay: true, createdAt: true },
    });
    const paymentDay = company?.payrollPaymentDay ?? 10;
    const periods    = this.getPeriodsToCheck(now, paymentDay, company?.createdAt ?? null);
    const simUserId  = await this.resolveSimUserId(companyId, preferredUserId);

    const activeEmployees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true, firstName: true, lastName: true,
        employeeNumber: true, position: true, baseSalary: true, hireDate: true,
        department: { select: { name: true } },
      },
    });

    const upcomingDue = await this.detectUpcomingDue(companyId, now, paymentDay, simUserId, budget);

    if (activeEmployees.length === 0 || periods.length === 0) {
      return {
        early: true, paymentDay, now,
        data: {
          companyId,
          unpaidCount: 0, employeeCount: 0,
          totalDu: 0, totalApproximate: 0, totalExact: 0, totalFallback: 0,
          maxMonthsLate: 0, alertLevel: 'INFO' as AlertLevel,
          hasApproximateData: false, hasFallbackData: false,
          employees: [] as EmployeeUnpaidSummary[], noBulletinEmployees: [] as EmployeeUnpaidSummary[],
          unpaidBulletinEmployees: [] as EmployeeUnpaidSummary[], mixedEmployees: [] as EmployeeUnpaidSummary[],
          upcomingDue,
        },
      };
    }

    // Tous les bulletins pour ces périodes — relus en base à chaque appel (temps réel).
    // Un bulletin ANNULÉ compte comme « pas de bulletin » (comme s'il était supprimé).
    const allPayrolls = await this.prisma.payroll.findMany({
      where: {
        companyId,
        status: { not: 'CANCELLED' },
        OR: periods.map(p => ({ month: p.month, year: p.year })),
      },
      select: {
        id: true, month: true, year: true,
        netSalary: true, paid: true, status: true, employeeId: true,
      },
    });

    // Index : empId -> "month-year" -> bulletin
    const payrollIndex = new Map<string, Map<string, typeof allPayrolls[0]>>();
    for (const p of allPayrolls) {
      if (!payrollIndex.has(p.employeeId)) payrollIndex.set(p.employeeId, new Map());
      payrollIndex.get(p.employeeId)!.set(`${p.month}-${p.year}`, p);
    }

    const byEmployee = new Map<string, {
      employee: typeof activeEmployees[0];
      moisNonPayes: MoisNonPaye[];
    }>();
    const push = (emp: typeof activeEmployees[0], m: MoisNonPaye) => {
      if (!byEmployee.has(emp.id)) byEmployee.set(emp.id, { employee: emp, moisNonPayes: [] });
      byEmployee.get(emp.id)!.moisNonPayes.push(m);
    };

    for (const period of periods) {
      const dueDate     = this.computeDueDate(period.year, period.month, paymentDay);
      const diffMs      = now.getTime() - dueDate.getTime();
      const daysOverdue = diffMs > 0 ? Math.floor(diffMs / 86_400_000) : 0;
      if (daysOverdue === 0) continue;

      const periodEnd = new Date(period.year, period.month, 0, 23, 59, 59); // dernier jour du mois de paie
      const withBulletin: Array<{ emp: typeof activeEmployees[0]; bulletin: typeof allPayrolls[0] }> = [];
      const withoutBulletin: Array<typeof activeEmployees[0]> = [];

      for (const emp of activeEmployees) {
        if (emp.hireDate && new Date(emp.hireDate) > periodEnd) continue; // pas encore embauché ce mois-là
        const bulletin = payrollIndex.get(emp.id)?.get(`${period.month}-${period.year}`);
        if (bulletin && this.isSettled(bulletin)) continue; // PHASE 5 → OK (payé)
        if (bulletin) withBulletin.push({ emp, bulletin });
        else withoutBulletin.push(emp);
      }

      // Bulletin existant non payé → montant EXACT du bulletin
      for (const { emp, bulletin } of withBulletin) {
        push(emp, {
          id: bulletin.id,
          month: period.month, year: period.year,
          montant: Number(bulletin.netSalary),
          isApproximate: false, estimateSource: 'BULLETIN',
          bulletinStatus: bulletin.status === 'VALIDATED' ? 'VALIDATED' : 'DRAFT',
          dueDate, daysOverdue, phase: 'UNPAID_BULLETIN',
        });
      }

      // Pas de bulletin → montant que la paie calculerait (simulation)
      if (withoutBulletin.length > 0) {
        const estimates = await this.estimateNets(
          companyId, simUserId, withoutBulletin, period.month, period.year, budget,
        );
        for (const emp of withoutBulletin) {
          const est = estimates.get(emp.id) ?? { amount: Number(emp.baseSalary), source: 'BASE_SALARY' as EstimateSource };
          if (!(est.amount > 0)) continue; // rien à payer ce mois-là (ex. aucun jour travaillé) : la paie ne le payerait pas non plus
          push(emp, {
            id: null,
            month: period.month, year: period.year,
            montant: est.amount,
            isApproximate: true, estimateSource: est.source,
            bulletinStatus: 'NONE',
            dueDate, daysOverdue, phase: 'NO_BULLETIN',
          });
        }
      }
    }

    const employees: EmployeeUnpaidSummary[] = Array.from(byEmployee.values()).map(data => {
      const monthsLate     = data.moisNonPayes.length;
      const maxDaysOverdue = Math.max(...data.moisNonPayes.map(m => m.daysOverdue));
      const totalDu        = data.moisNonPayes.reduce((s, m) => s + m.montant, 0);
      const hasApproximate = data.moisNonPayes.some(m => m.isApproximate);
      const hasFallback    = data.moisNonPayes.some(m => m.estimateSource === 'BASE_SALARY');

      const alertLevel: AlertLevel =
        monthsLate >= 3 || maxDaysOverdue > 45 ? 'CRITIQUE' :
        monthsLate >= 2 || maxDaysOverdue > 15 ? 'WARNING'  : 'INFO';

      const hasNoBulletin = data.moisNonPayes.some(m => m.phase === 'NO_BULLETIN');
      const hasUnpaid     = data.moisNonPayes.some(m => m.phase === 'UNPAID_BULLETIN');
      const phase: 'NO_BULLETIN' | 'UNPAID_BULLETIN' | 'MIXED' =
        hasNoBulletin && hasUnpaid ? 'MIXED' :
        hasNoBulletin ? 'NO_BULLETIN' : 'UNPAID_BULLETIN';

      return {
        employeeId:    data.employee.id,
        nom:           `${data.employee.firstName} ${data.employee.lastName}`,
        matricule:     data.employee.employeeNumber,
        poste:         data.employee.position,
        department:    data.employee.department?.name ?? null,
        monthsLate, maxDaysOverdue, totalDu, hasApproximate, hasFallback,
        alertLevel, phase,
        moisNonPayes:  data.moisNonPayes,
        oldestUnpaid:  data.moisNonPayes[data.moisNonPayes.length - 1],
      };
    });

    const order: Record<AlertLevel, number> = { CRITIQUE: 0, WARNING: 1, INFO: 2 };
    employees.sort((a, b) => order[a.alertLevel] - order[b.alertLevel]);

    const totalDu          = employees.reduce((s, e) => s + e.totalDu, 0);
    const totalApproximate = employees.reduce((s, e) =>
      s + e.moisNonPayes.filter(m => m.isApproximate).reduce((ss, m) => ss + m.montant, 0), 0);
    const totalExact       = totalDu - totalApproximate;
    const totalFallback    = employees.reduce((s, e) =>
      s + e.moisNonPayes.filter(m => m.estimateSource === 'BASE_SALARY').reduce((ss, m) => ss + m.montant, 0), 0);
    const maxMonthsLate    = employees.length > 0 ? Math.max(...employees.map(e => e.monthsLate)) : 0;
    const globalAlert: AlertLevel =
      maxMonthsLate >= 3 ? 'CRITIQUE' :
      maxMonthsLate >= 2 ? 'WARNING'  : 'INFO';

    return {
      early: false, paymentDay, now,
      data: {
        companyId,
        unpaidCount: employees.length, employeeCount: employees.length,
        totalDu, totalApproximate, totalExact, totalFallback,
        hasApproximateData: employees.some(e => e.hasApproximate),
        hasFallbackData: employees.some(e => e.hasFallback),
        maxMonthsLate, alertLevel: globalAlert,
        employees,
        noBulletinEmployees:      employees.filter(e => e.phase === 'NO_BULLETIN'),
        unpaidBulletinEmployees:  employees.filter(e => e.phase === 'UNPAID_BULLETIN'),
        mixedEmployees:           employees.filter(e => e.phase === 'MIXED'),
        upcomingDue,
      },
    };
  }

  // ── Analyse + notifications (page, cron) ───────────────────────────────────
  async checkCompany(companyId: string, preferredUserId?: string | null, mode: AnalysisMode = 'PAGE') {
    const { early, data, paymentDay, now } = await this.analyze(companyId, preferredUserId, mode);
    if (early) return data;

    if (data.upcomingDue.hasDue) await this.notifyUpcoming(companyId, data.upcomingDue, paymentDay, now);
    if (data.employees.length > 0 && (now.getDate() === 20 || data.maxMonthsLate >= 3)) {
      await this.notifyOverdue(companyId, data.employees, data.totalDu, now);
    }
    return data;
  }

  private async detectUpcomingDue(companyId: string, now: Date, paymentDay: number, simUserId: string | null, budget: Budget): Promise<UpcomingDue> {
    const thisMonth   = now.getMonth() + 1;
    const thisYear    = now.getFullYear();
    const salaryMonth = thisMonth === 1 ? 12 : thisMonth - 1;
    const salaryYear  = thisMonth === 1 ? thisYear - 1 : thisYear;
    const nextDueDate = this.computeDueDate(salaryYear, salaryMonth, paymentDay);
    const daysUntilDue = Math.floor((nextDueDate.getTime() - now.getTime()) / 86_400_000);

    if (daysUntilDue < 0 || daysUntilDue > 3) {
      return { hasDue: false, count: 0, totalEstimate: 0, daysUntilDue: 0, month: 0, year: 0 };
    }

    const activeEmployees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true, baseSalary: true, hireDate: true },
    });
    const periodEnd = new Date(salaryYear, salaryMonth, 0, 23, 59, 59);
    const eligible  = activeEmployees.filter(e => !(e.hireDate && new Date(e.hireDate) > periodEnd));

    // Tous les bulletins non annulés du mois (réglés ou non)
    const bulletins = await this.prisma.payroll.findMany({
      where: { companyId, month: salaryMonth, year: salaryYear, status: { not: 'CANCELLED' } },
      select: { employeeId: true, netSalary: true, paid: true, status: true },
    });
    const bulletinByEmp = new Map(bulletins.map(b => [b.employeeId, b]));

    const unpaid = eligible.filter(e => {
      const b = bulletinByEmp.get(e.id);
      return !(b && this.isSettled(b));
    });

    const withoutBulletin = unpaid.filter(e => !bulletinByEmp.has(e.id));
    const estimates = withoutBulletin.length
      ? await this.estimateNets(companyId, simUserId, withoutBulletin, salaryMonth, salaryYear, budget)
      : new Map<string, Estimate>();

    let totalEstimate = 0;
    let count = 0;
    for (const e of unpaid) {
      const b = bulletinByEmp.get(e.id);
      const amount = b ? Number(b.netSalary) : (estimates.get(e.id)?.amount ?? Number(e.baseSalary));
      if (!(amount > 0)) continue;
      totalEstimate += amount;
      count++;
    }

    return {
      hasDue: count > 0, count,
      totalEstimate, daysUntilDue: Math.max(0, daysUntilDue),
      month: salaryMonth, year: salaryYear,
    };
  }

  async getDashboard(userId: string, forceRefresh = false) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) return {
      employees: [], noBulletinEmployees: [], unpaidBulletinEmployees: [], mixedEmployees: [],
      totalDu: 0, totalApproximate: 0, totalExact: 0, totalFallback: 0, employeeCount: 0, unpaidCount: 0,
      maxMonthsLate: 0, alertLevel: 'INFO', hasApproximateData: false, hasFallbackData: false,
      upcomingDue: { hasDue: false },
    };
    // « Actualiser » : recalcul forcé, mais au plus 1 fois / 2 min / entreprise (anti-spam du bouton)
    if (forceRefresh) {
      const last = this.lastForcedRefresh.get(user.companyId) ?? 0;
      if (Date.now() - last >= REFRESH_MIN_INTERVAL_MS) {
        this.lastForcedRefresh.set(user.companyId, Date.now());
        this.clearCompanyEstimates(user.companyId);
      }
    }
    return this.checkCompany(user.companyId, userId);
  }

  // Badge : même analyse que la page → les deux chiffres sont toujours cohérents
  async getCompanyStats(companyId: string) {
    const totalEmployees = await this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } });
    const { data } = await this.analyze(companyId);
    const unpaidCount = data.employeeCount;
    return {
      unpaidEmployeeCount: unpaidCount, totalEmployees,
      hasAlert: unpaidCount > 0, hasUpcoming: data.upcomingDue.hasDue, upcoming: data.upcomingDue,
    };
  }

  async getEmployeeUnpaidTimeline(employeeId: string, companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId }, select: { payrollPaymentDay: true },
    });
    const paymentDay = company?.payrollPaymentDay ?? 10;
    const now = new Date();
    // 🐛 Avant : seuls DRAFT/VALIDATED étaient listés → les bulletins PAYÉS n'apparaissaient jamais.
    const payrolls = await this.prisma.payroll.findMany({
      where: { employeeId, companyId, status: { not: 'CANCELLED' } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: {
        id: true, month: true, year: true, netSalary: true, grossSalary: true,
        status: true, paid: true, paidAt: true, paymentReference: true, updatedAt: true,
      },
    });
    return payrolls.map(p => {
      const isPaid      = this.isSettled(p);
      const dueDate     = this.computeDueDate(p.year, p.month, paymentDay);
      const diff        = now.getTime() - dueDate.getTime();
      const daysOverdue = !isPaid && diff > 0 ? Math.floor(diff / 86_400_000) : 0;
      return {
        id: p.id, mois: `${MONTHS_FR[p.month - 1]} ${p.year}`,
        netSalary: Number(p.netSalary), grossSalary: Number(p.grossSalary),
        status: isPaid ? 'PAID' : daysOverdue > 0 ? 'LATE' : 'PENDING',
        bulletinStatus: p.status,
        // le workflow de paie ne renseigne pas paidAt : à défaut, date de dernière mise à jour du bulletin payé
        paidAt: p.paidAt ?? (isPaid ? p.updatedAt : null),
        paymentReference: p.paymentReference,
        dueDate, daysOverdue,
      };
    });
  }

  private async notifyUpcoming(companyId: string, upcoming: any, paymentDay: number, now: Date) {
    if (!upcoming.hasDue) return;
    const fmt      = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
    const mois     = `${MONTHS_FR[(upcoming.month ?? 1) - 1]} ${upcoming.year}`;
    const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 🐛 CORRIGÉ : un simple SELECT "déjà créé ?" sur la table `notifications`
    // ne suffit pas comme garde anti-doublon, car lire une notification la
    // SUPPRIME (comportement demandé) — la preuve "déjà notifié ce mois-ci"
    // disparaît alors avec elle, et le prochain passage recrée aussitôt un
    // doublon. On utilise désormais un registre d'idempotence séparé, jamais
    // supprimé par une action utilisateur (voir NotificationsService.tryClaim).
    const claimed = await this.notifications.tryClaim(
      `unpaid-salary:upcoming:${companyId}:${periodKey}`,
    );
    if (!claimed) return; // déjà notifié ce mois-ci pour cette entreprise

    const recipients = await this.prisma.user.findMany({
      where: { companyId, role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] }, isActive: true },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        type: 'UNPAID_SALARY' as const,
        title: upcoming.daysUntilDue === 0 ? `Paiement des salaires prevu aujourd'hui` : `Paiement des salaires dans ${upcoming.daysUntilDue} jour(s)`,
        message: upcoming.daysUntilDue === 0
          ? `${upcoming.count} employe(s) pour ${mois} a payer aujourd'hui. Estime : ${fmt(upcoming.totalEstimate)} FCFA.`
          : `Dans ${upcoming.daysUntilDue} jour(s), ${upcoming.count} employe(s) pour ${mois} (le ${paymentDay}). Estime : ${fmt(upcoming.totalEstimate)} FCFA.`,
        link: '/paie/impayes',
        metadata: { subtype: 'UPCOMING_DUE', companyId, ...upcoming },
        read: false,
      })),
    });
  }

  private async notifyOverdue(companyId: string, employees: EmployeeUnpaidSummary[], totalDu: number, now: Date) {
    if (employees.length === 0) return;
    const maxMonths  = Math.max(...employees.map(e => e.monthsLate));
    const critiques  = employees.filter(e => e.alertLevel === 'CRITIQUE').length;
    const noBulletin = employees.filter(e => e.phase === 'NO_BULLETIN').length;
    const fmt        = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
    const periodKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // ✅ Même correctif anti-doublon que notifyUpcoming — voir commentaire ci-dessus
    const claimed = await this.notifications.tryClaim(
      `unpaid-salary:overdue:${companyId}:${periodKey}`,
    );
    if (!claimed) return;

    const recipients = await this.prisma.user.findMany({
      where: { companyId, role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] }, isActive: true },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        type: 'UNPAID_SALARY' as const,
        title: critiques > 0 ? `Retard critique — ${critiques} salarie(s) avec ${maxMonths}+ mois` : `Retard de paie — ${employees.length} salarie(s)`,
        message: `${noBulletin > 0 ? `${noBulletin} employe(s) sans bulletin genere. ` : ''}Total estime : ${fmt(totalDu)} FCFA. Retard max : ${maxMonths} mois. Art. 95 CT Congo.`,
        link: '/paie/impayes',
        metadata: { subtype: 'OVERDUE', companyId, employeeCount: employees.length, noBulletin, totalDu, maxMonthsLate: maxMonths, critiques },
        read: false,
      })),
    });
  }
}