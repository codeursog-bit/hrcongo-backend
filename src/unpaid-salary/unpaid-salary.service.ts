// ============================================================================
// 📁 src/unpaid-salary/unpaid-salary.service.ts — VERSION V5
//
// LOGIQUE DE DÉTECTION :
//   PHASE 1 — J-3 avant la date de paiement       → alerte préventive
//   PHASE 2 — Jour J                               → rappel paiement aujourd'hui
//   PHASE 3 — Date dépassée + aucun bulletin       → 🔴 paie jamais lancée
//             → montant = baseSalary (APPROXIMATIF)
//   PHASE 4 — Date dépassée + bulletin DRAFT/VALIDATED mais paid:false
//             → montant = netSalary EXACT du bulletin
//   PHASE 5 — paid: true                           → ✅ OK
//
// On ne filtre JAMAIS sur le statut du bulletin pour détecter un retard.
// Le seul état "OK" = paid: true après la date prévue.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const MONTHS_FR = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
];

type AlertLevel = 'INFO' | 'WARNING' | 'CRITIQUE';

export interface MoisNonPaye {
  id:             string | null;
  month:          number;
  year:           number;
  montant:        number;           // baseSalary si approx, netSalary si exact
  isApproximate:  boolean;          // true = on a utilisé baseSalary
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
  alertLevel:      AlertLevel;
  moisNonPayes:    MoisNonPaye[];
  oldestUnpaid:    MoisNonPaye;
  phase:           'NO_BULLETIN' | 'UNPAID_BULLETIN' | 'MIXED';
}

interface MonthPeriod { month: number; year: number; }

@Injectable()
export class UnpaidSalaryService {
  private readonly logger = new Logger(UnpaidSalaryService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private computeDueDate(year: number, month: number, paymentDay: number): Date {
    return new Date(year, month, paymentDay);
  }

  private getPeriodsToCheck(now: Date, paymentDay: number): MonthPeriod[] {
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();
    const periods: MonthPeriod[] = [];
    for (let i = 1; i <= 3; i++) {
      let m = thisMonth - i;
      let y = thisYear;
      if (m <= 0) { m += 12; y -= 1; }
      const dueDate = this.computeDueDate(y, m, paymentDay);
      if (now > dueDate) periods.push({ month: m, year: y });
    }
    return periods;
  }

  @Cron('0 8 * * *')
  async checkAllCompanies() {
    this.logger.log('Verification quotidienne des salaires impayes...');
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const c of companies) {
      await this.checkCompany(c.id).catch(err =>
        this.logger.error(`Erreur company ${c.id}: ${err.message}`)
      );
    }
    this.logger.log(`${companies.length} entreprises verifiees`);
  }

  async checkCompany(companyId: string) {
    const now = new Date();

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { payrollPaymentDay: true },
    });
    const paymentDay = company?.payrollPaymentDay ?? 10;
    const periods    = this.getPeriodsToCheck(now, paymentDay);

    const activeEmployees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true, firstName: true, lastName: true,
        employeeNumber: true, position: true, baseSalary: true,
        department: { select: { name: true } },
      },
    });

    const upcomingDue = await this.detectUpcomingDue(companyId, now, paymentDay);

    if (activeEmployees.length === 0 || periods.length === 0) {
      return {
        companyId,
        unpaidCount: 0, employeeCount: 0,
        totalDu: 0, totalApproximate: 0, totalExact: 0,
        maxMonthsLate: 0, alertLevel: 'INFO' as AlertLevel,
        hasApproximateData: false,
        employees: [], noBulletinEmployees: [],
        unpaidBulletinEmployees: [], mixedEmployees: [],
        upcomingDue,
      };
    }

    // Tous les bulletins pour ces périodes (tous statuts)
    const allPayrolls = await this.prisma.payroll.findMany({
      where: {
        companyId,
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

    // Analyser chaque employé x période
    const byEmployee = new Map<string, {
      employee: typeof activeEmployees[0];
      moisNonPayes: MoisNonPaye[];
    }>();

    for (const period of periods) {
      const dueDate     = this.computeDueDate(period.year, period.month, paymentDay);
      const diffMs      = now.getTime() - dueDate.getTime();
      const daysOverdue = diffMs > 0 ? Math.floor(diffMs / 86_400_000) : 0;
      if (daysOverdue === 0) continue;

      for (const emp of activeEmployees) {
        const bulletin = payrollIndex.get(emp.id)?.get(`${period.month}-${period.year}`);
        if (bulletin?.paid === true) continue; // PHASE 5 → OK

        const phase: 'NO_BULLETIN' | 'UNPAID_BULLETIN' = bulletin ? 'UNPAID_BULLETIN' : 'NO_BULLETIN';
        const isApproximate  = !bulletin;
        const montant        = bulletin ? Number(bulletin.netSalary) : Number(emp.baseSalary);
        const bulletinStatus: 'NONE' | 'DRAFT' | 'VALIDATED' =
          !bulletin ? 'NONE' : bulletin.status === 'VALIDATED' ? 'VALIDATED' : 'DRAFT';

        if (!byEmployee.has(emp.id)) byEmployee.set(emp.id, { employee: emp, moisNonPayes: [] });
        byEmployee.get(emp.id)!.moisNonPayes.push({
          id: bulletin?.id ?? null,
          month: period.month, year: period.year,
          montant, isApproximate, bulletinStatus,
          dueDate, daysOverdue, phase,
        });
      }
    }

    const employees: EmployeeUnpaidSummary[] = Array.from(byEmployee.values()).map(data => {
      const monthsLate     = data.moisNonPayes.length;
      const maxDaysOverdue = Math.max(...data.moisNonPayes.map(m => m.daysOverdue));
      const totalDu        = data.moisNonPayes.reduce((s, m) => s + m.montant, 0);
      const hasApproximate = data.moisNonPayes.some(m => m.isApproximate);

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
        monthsLate, maxDaysOverdue, totalDu, hasApproximate,
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
    const maxMonthsLate    = employees.length > 0 ? Math.max(...employees.map(e => e.monthsLate)) : 0;
    const globalAlert: AlertLevel =
      maxMonthsLate >= 3 ? 'CRITIQUE' :
      maxMonthsLate >= 2 ? 'WARNING'  : 'INFO';

    if (upcomingDue.hasDue) await this.notifyUpcoming(companyId, upcomingDue, paymentDay, now);
    if (employees.length > 0 && (now.getDate() === 20 || maxMonthsLate >= 3)) {
      await this.notifyOverdue(companyId, employees, totalDu, now);
    }

    return {
      companyId,
      unpaidCount: employees.length, employeeCount: employees.length,
      totalDu, totalApproximate, totalExact,
      hasApproximateData: employees.some(e => e.hasApproximate),
      maxMonthsLate, alertLevel: globalAlert,
      employees,
      noBulletinEmployees:      employees.filter(e => e.phase === 'NO_BULLETIN'),
      unpaidBulletinEmployees:  employees.filter(e => e.phase === 'UNPAID_BULLETIN'),
      mixedEmployees:           employees.filter(e => e.phase === 'MIXED'),
      upcomingDue,
    };
  }

  private async detectUpcomingDue(companyId: string, now: Date, paymentDay: number) {
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
      select: { id: true, baseSalary: true },
    });
    const alreadyPaidIds = new Set(
      (await this.prisma.payroll.findMany({
        where: { companyId, month: salaryMonth, year: salaryYear, paid: true },
        select: { employeeId: true },
      })).map(p => p.employeeId)
    );
    const unpaid = activeEmployees.filter(e => !alreadyPaidIds.has(e.id));

    const existingNets = await this.prisma.payroll.findMany({
      where: {
        companyId, month: salaryMonth, year: salaryYear, paid: false,
        employeeId: { in: unpaid.map(e => e.id) },
      },
      select: { employeeId: true, netSalary: true },
    });
    const netByEmp = new Map(existingNets.map(p => [p.employeeId, Number(p.netSalary)]));
    const totalEstimate = unpaid.reduce((s, e) => s + (netByEmp.get(e.id) ?? Number(e.baseSalary)), 0);

    return {
      hasDue: unpaid.length > 0, count: unpaid.length,
      totalEstimate, daysUntilDue: Math.max(0, daysUntilDue),
      month: salaryMonth, year: salaryYear,
    };
  }

  async getDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) return {
      employees: [], noBulletinEmployees: [], unpaidBulletinEmployees: [], mixedEmployees: [],
      totalDu: 0, totalApproximate: 0, totalExact: 0, employeeCount: 0, unpaidCount: 0,
      maxMonthsLate: 0, alertLevel: 'INFO', hasApproximateData: false,
      upcomingDue: { hasDue: false },
    };
    return this.checkCompany(user.companyId);
  }

  async getCompanyStats(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { payrollPaymentDay: true },
    });
    const paymentDay = company?.payrollPaymentDay ?? 10;
    const now = new Date();
    const periods = this.getPeriodsToCheck(now, paymentDay);
    const totalEmployees = await this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } });
    let unpaidCount = 0;
    if (periods.length > 0) {
      const emps = await this.prisma.employee.findMany({ where: { companyId, status: 'ACTIVE' }, select: { id: true } });
      const paidSet = new Set(
        (await this.prisma.payroll.findMany({
          where: { companyId, paid: true, OR: periods.map(p => ({ month: p.month, year: p.year })) },
          select: { employeeId: true, month: true, year: true },
        })).map(p => `${p.employeeId}-${p.month}-${p.year}`)
      );
      const ids = new Set<string>();
      for (const emp of emps)
        for (const period of periods) {
          const due = this.computeDueDate(period.year, period.month, paymentDay);
          if (now > due && !paidSet.has(`${emp.id}-${period.month}-${period.year}`)) ids.add(emp.id);
        }
      unpaidCount = ids.size;
    }
    const upcoming = await this.detectUpcomingDue(companyId, now, paymentDay);
    return { unpaidEmployeeCount: unpaidCount, totalEmployees, hasAlert: unpaidCount > 0, hasUpcoming: upcoming.hasDue, upcoming };
  }

  async getEmployeeUnpaidTimeline(employeeId: string, companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId }, select: { payrollPaymentDay: true },
    });
    const paymentDay = company?.payrollPaymentDay ?? 10;
    const now = new Date();
    const payrolls = await this.prisma.payroll.findMany({
      where: { employeeId, companyId, status: { in: ['VALIDATED', 'DRAFT'] } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { id: true, month: true, year: true, netSalary: true, grossSalary: true, status: true, paid: true, paidAt: true, paymentReference: true },
    });
    return payrolls.map(p => {
      const dueDate     = this.computeDueDate(p.year, p.month, paymentDay);
      const diff        = now.getTime() - dueDate.getTime();
      const daysOverdue = !p.paid && diff > 0 ? Math.floor(diff / 86_400_000) : 0;
      return {
        id: p.id, mois: `${MONTHS_FR[p.month - 1]} ${p.year}`,
        netSalary: Number(p.netSalary), grossSalary: Number(p.grossSalary),
        status: p.paid ? 'PAID' : daysOverdue > 0 ? 'LATE' : 'PENDING',
        bulletinStatus: p.status, paidAt: p.paidAt, paymentReference: p.paymentReference,
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