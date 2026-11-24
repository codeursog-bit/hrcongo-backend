import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AbsenceRequestsService } from '../../absence-requests/absence-requests.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';
import { CreateAbsenceRequestDto } from '../../absence-requests/dto/create-absence-request.dto';

// 🆕 Vue transverse "portefeuille d'entreprises" pour les demandes d'absence.
// Même patron que les autres modules du portefeuille.
@Injectable()
export class PortfolioAbsenceRequestsService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
    private absenceRequestsService: AbsenceRequestsService,
  ) {}

  async search(userId: string, filters: { companyId?: string; status?: string }) {
    await this.membership.assertCanUsePortfolio(userId);

    let companyIds: string[];
    if (filters.companyId) {
      await this.membership.assertCompanyMembership(userId, filters.companyId);
      companyIds = [filters.companyId];
    } else {
      companyIds = await this.membership.getLinkedCompanyIds(userId);
    }
    if (companyIds.length === 0) return [];

    return this.prisma.absenceRequest.findMany({
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

  private async getEmployeeCompanyId(employeeId: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');
    return employee.companyId;
  }

  private async getRequestCompanyId(id: string): Promise<string> {
    const request = await this.prisma.absenceRequest.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');
    return request.companyId;
  }

  async create(userId: string, dto: CreateAbsenceRequestDto) {
    if (!dto.employeeId)
      throw new NotFoundException(
        'employeeId est requis pour créer une demande depuis le portefeuille.',
      );
    const companyId = await this.getEmployeeCompanyId(dto.employeeId);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.absenceRequestsService.create(dto, userId, companyId);
  }

  async findOne(userId: string, id: string) {
    const companyId = await this.getRequestCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.absenceRequestsService.findOne(id, userId, companyId);
  }

  async updateStatus(
    userId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
    isPaid?: boolean,
  ) {
    const companyId = await this.getRequestCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.absenceRequestsService.updateStatus(
      id,
      status,
      userId,
      rejectionReason,
      isPaid,
      companyId,
    );
  }

  async cancel(userId: string, id: string, reason?: string) {
    const companyId = await this.getRequestCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.absenceRequestsService.cancel(id, userId, reason, companyId);
  }

  async remove(userId: string, id: string) {
    const companyId = await this.getRequestCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.absenceRequestsService.remove(id, userId, companyId);
  }
}