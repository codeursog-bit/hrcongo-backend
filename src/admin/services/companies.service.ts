// ============================================================================
// Fichier: backend/src/admin/services/companies.service.ts
// ============================================================================

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface CompanyFilters {
  status?: string;
  plan?: string;
  search?: string;
}

@Injectable()
export class AdminCompaniesService {
  private readonly logger = new Logger(AdminCompaniesService.name);

  constructor(private prisma: PrismaService) {}

  async getAllCompanies(filters?: CompanyFilters) {
    this.logger.log('🏢 Récupération de toutes les entreprises...');

    const where: any = {};

    if (filters?.status) {
      where.isActive = filters.status === 'Active';
    }

    if (filters?.plan) {
      where.subscription = {
        plan: filters.plan,
      };
    }

    if (filters?.search) {
      where.OR = [
        { legalName: { contains: filters.search, mode: 'insensitive' } },
        { tradeName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { rccmNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const companies = await this.prisma.company.findMany({
      where,
      include: {
        subscription: true,
        _count: {
          select: {
            employees: true,
            users: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return companies.map((c) => ({
      id: c.id,
      name: c.tradeName || c.legalName,
      tradeName: c.tradeName,
      logo: this.generateInitials(c.legalName),
      plan: c.subscription?.plan || 'FREE',
      employees: c._count.employees,
      users: c._count.users,
      lastActive: this.calculateLastActive(c.updatedAt),
      status: c.isActive ? 'Active' : 'Suspended',
      mrr: Number(c.subscription?.pricePerMonth) || 0,
      region: c.city,
      rccm: c.rccmNumber,
      email: c.email,
      joinedDate: c.createdAt.toISOString(),
      contactPerson: c.legalName,
      health: {
        payment: 'good',
        usage: 'good',
        support: 'good',
      },
    }));
  }

  async getCompanyDetails(id: string) {
    this.logger.log(`🔍 Récupération détails entreprise ${id}...`);

    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        subscription: true,
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
          },
        },
        employees: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
          },
        },
        departments: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            payrolls: true,
            leaves: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException(`Entreprise ${id} introuvable`);
    }

    return {
      id: company.id,
      legalName: company.legalName,
      tradeName: company.tradeName,
      logo: this.generateInitials(company.legalName),
      rccmNumber: company.rccmNumber,
      email: company.email,
      phone: company.phone,
      city: company.city,
      country: company.country,
      isActive: company.isActive,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      subscription: company.subscription,
      users: company.users,
      employees: company.employees,
      departments: company.departments,
      stats: {
        payrolls: company._count.payrolls,
        leaves: company._count.leaves,
      },
    };
  }

  private generateInitials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  private calculateLastActive(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "À l'instant";
    if (minutes < 60) return `${minutes} min`;
    if (hours < 24) return `${hours}h`;
    return `${days}j`;
  }
}
