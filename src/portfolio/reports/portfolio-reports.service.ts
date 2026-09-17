import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';

// 🆕 Rapports comparatifs du portefeuille — effectifs (vraie tendance
// historique), masse salariale, charges/cotisations patronales, salaire
// moyen, par entreprise et en série mensuelle.
//
// L'effectif historique est reconstruit à partir de hireDate/terminationDate
// de chaque employé (compté "actif à la fin du mois") plutôt qu'agrégé côté
// SQL, pour rester en une seule requête quel que soit le nombre de mois.
@Injectable()
export class PortfolioReportsService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
  ) {}

  private lastMonths(count: number): Array<{ month: number; year: number }> {
    const out: Array<{ month: number; year: number }> = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
    }
    return out;
  }

  // Dernier instant du mois (23:59:59.999 le dernier jour) — un employé
  // embauché ce mois-ci ou parti ce mois-ci compte donc bien dedans.
  private endOfMonth(month: number, year: number): Date {
    return new Date(year, month, 0, 23, 59, 59, 999);
  }

  async getOverview(userId: string, months = 6) {
    await this.membership.assertCanUsePortfolio(userId);
    const companyIds = await this.membership.getLinkedCompanyIds(userId);
    const span = Math.min(Math.max(months, 1), 12);
    const periods = this.lastMonths(span);

    if (companyIds.length === 0) {
      return { periods, companies: [], totals: this.emptyTotals(periods) };
    }

    const [companies, employees, payrollRows] = await Promise.all([
      this.prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: { id: true, legalName: true, tradeName: true, isActive: true },
      }),
      // Tous les employés (peu importe le statut actuel) avec leurs dates —
      // un employé aujourd'hui INACTIVE comptait bien dans l'effectif du
      // mois où il était encore là.
      this.prisma.employee.findMany({
        where: { companyId: { in: companyIds } },
        select: { companyId: true, hireDate: true, terminationDate: true },
      }),
      this.prisma.payroll.groupBy({
        by: ['companyId', 'month', 'year'],
        where: {
          companyId: { in: companyIds },
          OR: periods.map((p) => ({ month: p.month, year: p.year })),
        },
        _sum: {
          grossSalary: true,
          netSalary: true,
          totalEmployerCost: true,
          cnssSalarial: true,
          cnssEmployer: true,
          its: true,
        },
      }),
    ]);

    const periodEnds = periods.map((p) => this.endOfMonth(p.month, p.year));

    const companiesOut = companies.map((c) => {
      const name = c.tradeName || c.legalName;
      const companyEmployees = employees.filter((e) => e.companyId === c.id);

      const headcountByPeriod = periodEnds.map((end) =>
        companyEmployees.filter(
          (e) =>
            new Date(e.hireDate) <= end &&
            (!e.terminationDate || new Date(e.terminationDate) > end),
        ).length,
      );

      const series = periods.map((p, i) => {
        const row = payrollRows.find(
          (r) => r.companyId === c.id && r.month === p.month && r.year === p.year,
        );
        const net = Number(row?._sum.netSalary ?? 0);
        const headcount = headcountByPeriod[i];
        return {
          month: p.month,
          year: p.year,
          headcount,
          gross: Number(row?._sum.grossSalary ?? 0),
          net,
          employerCost: Number(row?._sum.totalEmployerCost ?? 0),
          cnss: Number(row?._sum.cnssSalarial ?? 0) + Number(row?._sum.cnssEmployer ?? 0),
          its: Number(row?._sum.its ?? 0),
          avgSalary: headcount > 0 ? Math.round(net / headcount) : 0,
        };
      });

      return {
        id: c.id,
        name,
        isActive: c.isActive,
        headcount: headcountByPeriod[headcountByPeriod.length - 1] ?? 0,
        payrollByMonth: series,
      };
    });

    const totals = periods.map((p, i) => {
      const acc = companiesOut.reduce(
        (sum, c) => {
          const m = c.payrollByMonth[i];
          return {
            headcount: sum.headcount + m.headcount,
            gross: sum.gross + m.gross,
            net: sum.net + m.net,
            employerCost: sum.employerCost + m.employerCost,
            cnss: sum.cnss + m.cnss,
            its: sum.its + m.its,
          };
        },
        { headcount: 0, gross: 0, net: 0, employerCost: 0, cnss: 0, its: 0 },
      );
      return {
        month: p.month,
        year: p.year,
        ...acc,
        avgSalary: acc.headcount > 0 ? Math.round(acc.net / acc.headcount) : 0,
      };
    });

    return {
      periods,
      companies: companiesOut,
      totals: {
        headcount: companiesOut.reduce((s, c) => s + c.headcount, 0),
        payrollByMonth: totals,
      },
    };
  }

  private emptyTotals(periods: Array<{ month: number; year: number }>) {
    return {
      headcount: 0,
      payrollByMonth: periods.map((p) => ({
        ...p, headcount: 0, gross: 0, net: 0, employerCost: 0, cnss: 0, its: 0, avgSalary: 0,
      })),
    };
  }
}