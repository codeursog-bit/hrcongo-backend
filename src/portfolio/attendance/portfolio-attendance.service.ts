import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../../attendance/attendance.service';
import { AttendanceSummaryService } from '../../attendance/attendance-summary.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';

// 🆕 Vue transverse "portefeuille d'entreprises" pour les présences.
// Périmètre volontairement limité à la CONSULTATION (suivi), comme décrit
// par l'utilisateur : "suivre les présences de toutes ces entreprises sans
// même aller dans leur page". Le pointage lui-même (checkIn/checkOut),
// les corrections et la gestion des shifts restent des actions faites
// depuis l'interface de chaque entreprise — hors périmètre ici.
@Injectable()
export class PortfolioAttendanceService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
    private attendanceService: AttendanceService,
    private summaryService: AttendanceSummaryService,
  ) {}

  async findToday(userId: string, companyId: string) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.attendanceService.findToday(userId, companyId);
  }

  async findAll(userId: string, companyId: string, month: number, year: number) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.attendanceService.findAll(userId, month, year, companyId);
  }

  async getLogs(userId: string, companyId: string, month: number, year: number) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.attendanceService.getLogs(userId, month, year, companyId);
  }

  async generateMonthlyReport(userId: string, companyId: string, month: number, year: number) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.attendanceService.generateMonthlyReport(userId, month, year, companyId);
  }

  async generateMonthlyAttendanceGrid(userId: string, companyId: string, month: number, year: number) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.attendanceService.generateMonthlyAttendanceGrid(companyId, month, year);
  }

  private async getEmployeeCompanyId(employeeId: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');
    return employee.companyId;
  }

  async getEmployeeDayStatuses(userId: string, employeeId: string, month: number, year: number) {
    const companyId = await this.getEmployeeCompanyId(employeeId);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.attendanceService.getEmployeeDayStatuses(userId, employeeId, month, year, companyId);
  }

  async getEmployeeSummary(userId: string, employeeId: string, month: number, year: number) {
    const companyId = await this.getEmployeeCompanyId(employeeId);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.attendanceService.getEmployeeSummarySecure(
      userId,
      employeeId,
      month,
      year,
      this.summaryService,
      companyId,
    );
  }
}