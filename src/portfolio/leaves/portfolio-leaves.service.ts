import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeavesService } from '../../leaves/leaves.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';
import { CreateLeaveDto } from '../../leaves/dto/create-leave.dto';

// 🆕 Vue transverse "portefeuille d'entreprises" pour les congés.
// Ce module était déjà quasi prêt : leaves.service.ts a un pattern
// "overrideCompanyId" construit pour le Cabinet sur quasiment toutes ses
// méthodes (create, findAll, updateStatus, cancel, deleteLeave,
// getMonthlyPlanning, getAllEmployeeBalances...). Le seul changement
// nécessaire a été d'élargir getUserWithCompany() (leaves-common.util.ts)
// à manageMultipleCompanies — rien d'autre à toucher côté leaves.service.ts.
//
// Comme pour les autres modules du portefeuille : jamais d'écriture directe,
// toujours une délégation après vérification d'appartenance.
@Injectable()
export class PortfolioLeavesService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
    private leavesService: LeavesService,
  ) {}

  // Liste transverse des demandes de congé, filtrable par entreprise/statut.
  async search(
    userId: string,
    filters: { companyId?: string; status?: string },
  ) {
    await this.membership.assertCanUsePortfolio(userId);

    let companyIds: string[];
    if (filters.companyId) {
      await this.membership.assertCompanyMembership(userId, filters.companyId);
      companyIds = [filters.companyId];
    } else {
      companyIds = await this.membership.getLinkedCompanyIds(userId);
    }
    if (companyIds.length === 0) return [];

    return this.prisma.leave.findMany({
      where: {
        companyId: { in: companyIds },
        ...(filters.status ? { status: filters.status as any } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            position: true,
          },
        },
        company: { select: { id: true, legalName: true, tradeName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async getLeaveCompanyId(id: string): Promise<string> {
    const leave = await this.prisma.leave.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!leave) throw new NotFoundException('Demande de congé introuvable.');
    return leave.companyId;
  }

  private async getEmployeeCompanyId(employeeId: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');
    return employee.companyId;
  }

  async create(userId: string, dto: CreateLeaveDto) {
    const companyId = await this.getEmployeeCompanyId(dto.employeeId);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.create(dto, userId, companyId);
  }

  async createManual(userId: string, dto: any) {
    const companyId = await this.getEmployeeCompanyId(dto.employeeId);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.createManual(dto, userId, companyId);
  }

  async findOne(userId: string, id: string) {
    const companyId = await this.getLeaveCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.findOne(id, userId, companyId);
  }

  async updateStatus(
    userId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
    extraDaysGranted?: number,
    resumptionNote?: string,
  ) {
    const companyId = await this.getLeaveCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.updateStatus(
      id,
      status,
      userId,
      rejectionReason,
      companyId,
      extraDaysGranted,
      resumptionNote,
    );
  }

  async cancel(userId: string, id: string, reason?: string) {
    const companyId = await this.getLeaveCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.cancel(id, userId, reason, companyId);
  }

  async deleteLeave(userId: string, id: string) {
    const companyId = await this.getLeaveCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.deleteLeave(id, userId, companyId);
  }

  // Planning mensuel — pour UNE entreprise du portefeuille à la fois.
  async getMonthlyPlanning(
    userId: string,
    companyId: string,
    month: number,
    year: number,
    mode: 'departures' | 'payable' = 'departures',
  ) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.getMonthlyPlanning(
      userId,
      month,
      year,
      companyId,
      mode,
    );
  }

  // Soldes de congé de tous les employés — pour UNE entreprise du portefeuille.
  async getAllEmployeeBalances(userId: string, companyId: string) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.leavesService.getAllEmployeeBalances(userId, companyId);
  }
}