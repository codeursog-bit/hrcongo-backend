import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeesService } from '../../employees/employees.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';
import { CreatePortfolioEmployeeDto } from './dto/create-portfolio-employee.dto';
import { UpdateEmployeeDto } from '../../employees/dto/update-employee.dto';

// 🆕 Vue transverse "portefeuille d'entreprises" pour l'employé.
// N'écrit jamais directement dans la table employee — délègue toujours à
// EmployeesService (mêmes règles métier que la vue mono-entreprise), après
// avoir vérifié que l'entreprise ciblée appartient bien à l'admin.
@Injectable()
export class PortfolioEmployeesService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
    private employeesService: EmployeesService,
  ) {}

  // Recherche par nom/prénom/matricule, optionnellement filtrée par entreprise,
  // parmi toutes les entreprises liées à l'admin.
  // 🆕 `limit` paramétrable (ex: paie en masse a besoin de la liste complète
  // d'une entreprise, pas juste 50) — plafonné à 300 pour rester rapide et
  // ne jamais charger une liste illimitée en une seule requête.
  async search(userId: string, query?: string, companyId?: string, limit = 50) {
    await this.membership.assertCanUsePortfolio(userId);
    const take = Math.min(Math.max(limit, 1), 300);

    let companyIds: string[];
    if (companyId) {
      await this.membership.assertCompanyMembership(userId, companyId);
      companyIds = [companyId];
    } else {
      companyIds = await this.membership.getLinkedCompanyIds(userId);
    }
    if (companyIds.length === 0) return [];

    return this.prisma.employee.findMany({
      where: {
        companyId: { in: companyIds },
        status: 'ACTIVE',
        ...(query
          ? {
              OR: [
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
                { employeeNumber: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        position: true,
        photoUrl: true,
        companyId: true,
        company: { select: { id: true, legalName: true, tradeName: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take,
    });
  }

  private async getEmployeeCompanyId(id: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');
    return employee.companyId;
  }

  async findOne(userId: string, id: string) {
    const companyId = await this.getEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.employeesService.findOne(id, userId, companyId);
  }

  async create(userId: string, dto: CreatePortfolioEmployeeDto) {
    const { companyId, ...employeeDto } = dto;
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.employeesService.create(employeeDto, userId, {
      overrideCompanyId: companyId,
    });
  }

  async update(userId: string, id: string, dto: UpdateEmployeeDto) {
    const companyId = await this.getEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.employeesService.update(id, dto, userId, companyId);
  }

  async remove(userId: string, id: string) {
    const companyId = await this.getEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.employeesService.remove(id, userId, companyId);
  }
}