import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PortfolioMembershipService } from './portfolio-membership.service';

// 🆕 Statistiques du tableau de bord portefeuille — uniquement des comptages
// (prisma.count), jamais de listes complètes : reste rapide même avec
// beaucoup d'entreprises/employés.
@Injectable()
export class PortfolioStatsService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
  ) {}

  async getStats(userId: string) {
    await this.membership.assertCanUsePortfolio(userId);
    const companyIds = await this.membership.getLinkedCompanyIds(userId);

    if (companyIds.length === 0) {
      return {
        companies: { total: 0, active: 0 },
        employees: { total: 0 },
        attendance: { presentToday: 0, totalEmployees: 0 },
        pendingRequests: { leaves: 0, absences: 0, loans: 0 },
        employeesByCompany: [],
        recentActivity: [],
      };
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const [
      totalCompanies,
      activeCompanies,
      totalEmployees,
      presentToday,
      pendingLeaves,
      pendingAbsences,
      pendingLoans,
      employeeGroups,
      companies,
      recentLeaves,
      recentAbsences,
      recentLoans,
      recentAdvances,
    ] = await Promise.all([
      this.prisma.company.count({ where: { id: { in: companyIds } } }),
      this.prisma.company.count({ where: { id: { in: companyIds }, isActive: true } }),
      this.prisma.employee.count({ where: { companyId: { in: companyIds }, status: 'ACTIVE' } }),
      this.prisma.attendance.count({
        where: {
          companyId: { in: companyIds },
          date: todayStr,
          status: { in: ['PRESENT', 'LATE', 'REMOTE'] as any },
        },
      }),
      this.prisma.leave.count({ where: { companyId: { in: companyIds }, status: 'PENDING' } }),
      this.prisma.absenceRequest.count({ where: { companyId: { in: companyIds }, status: 'PENDING' } }),
      this.prisma.loan.count({
        where: {
          employee: { companyId: { in: companyIds } },
          status: { in: ['PENDING', 'PENDING_DG'] as any },
        },
      }),
      this.prisma.employee.groupBy({
        by: ['companyId'],
        where: { companyId: { in: companyIds }, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: { id: true, legalName: true, tradeName: true },
      }),
      this.prisma.leave.findMany({
        where: { companyId: { in: companyIds } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          employee: { select: { firstName: true, lastName: true } },
          company: { select: { legalName: true, tradeName: true } },
        },
      }),
      this.prisma.absenceRequest.findMany({
        where: { companyId: { in: companyIds } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          employee: { select: { firstName: true, lastName: true } },
          company: { select: { legalName: true, tradeName: true } },
        },
      }),
      this.prisma.loan.findMany({
        where: { employee: { companyId: { in: companyIds } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          employee: { select: { firstName: true, lastName: true, company: { select: { legalName: true, tradeName: true } } } },
        },
      }),
      this.prisma.advance.findMany({
        where: { employee: { companyId: { in: companyIds } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          employee: { select: { firstName: true, lastName: true, company: { select: { legalName: true, tradeName: true } } } },
        },
      }),
    ]);

    const companyName = (c?: { legalName: string; tradeName: string | null } | null) =>
      c ? (c.tradeName || c.legalName) : '';

    const employeesByCompany = employeeGroups.map((g) => {
      const c = companies.find((co) => co.id === g.companyId);
      return {
        companyId: g.companyId,
        name: c ? (c.tradeName || c.legalName) : 'Entreprise',
        count: g._count._all,
      };
    }).sort((a, b) => b.count - a.count);

    const recentActivity = [
      ...recentLeaves.map((l) => ({
        type: 'leave' as const,
        label: `Demande de congé — ${l.employee.firstName} ${l.employee.lastName}`,
        company: companyName(l.company as any),
        status: l.status,
        date: l.createdAt,
      })),
      ...recentAbsences.map((a) => ({
        type: 'absence' as const,
        label: `Demande d'absence — ${a.employee.firstName} ${a.employee.lastName}`,
        company: companyName(a.company as any),
        status: a.status,
        date: a.createdAt,
      })),
      ...recentLoans.map((l) => ({
        type: 'loan' as const,
        label: `Demande de prêt — ${l.employee.firstName} ${l.employee.lastName}`,
        company: companyName(l.employee.company as any),
        status: l.status,
        date: l.createdAt,
      })),
      ...recentAdvances.map((a) => ({
        type: 'advance' as const,
        label: `Demande d'avance — ${a.employee.firstName} ${a.employee.lastName}`,
        company: companyName(a.employee.company as any),
        status: a.status,
        date: a.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);

    return {
      companies: { total: totalCompanies, active: activeCompanies },
      employees: { total: totalEmployees },
      attendance: { presentToday, totalEmployees },
      pendingRequests: {
        leaves: pendingLeaves,
        absences: pendingAbsences,
        loans: pendingLoans,
      },
      employeesByCompany,
      recentActivity,
    };
  }
}