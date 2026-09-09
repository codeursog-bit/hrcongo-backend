// ============================================================================
// Fichier: backend/src/admin/services/companies.service.ts
// ============================================================================

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UpdateCompanyStatusDto,
  ArchiveCompanyDto,
  UpdateCompanyDto,
} from '../dto/company-actions.dto';

interface CompanyFilters {
  status?: string;
  plan?: string;
  search?: string;
  includeArchived?: boolean;
}

@Injectable()
export class AdminCompaniesService {
  private readonly logger = new Logger(AdminCompaniesService.name);

  constructor(private prisma: PrismaService) {}

  // ==========================================================================
  // 📖 LECTURE
  // ==========================================================================

  async getAllCompanies(filters?: CompanyFilters) {
    this.logger.log('🏢 Récupération de toutes les entreprises...');

    const where: any = {};

    // Par défaut on masque les entreprises archivées, sauf demande explicite
    if (filters?.status === 'Archived') {
      where.archivedAt = { not: null };
    } else if (!filters?.includeArchived) {
      where.archivedAt = null;
    }

    if (filters?.status && filters.status !== 'Archived') {
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
      status: c.archivedAt ? 'Archived' : c.isActive ? 'Active' : 'Suspended',
      mrr: Number(c.subscription?.pricePerMonth) || 0,
      region: c.city,
      rccm: c.rccmNumber,
      email: c.email,
      joinedDate: c.createdAt.toISOString(),
      contactPerson: c.legalName,
      archivedAt: c.archivedAt,
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
      archivedAt: company.archivedAt,
      archivedReason: company.archivedReason,
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

  // ==========================================================================
  // ✍️ ÉCRITURE — réservé au SUPER_ADMIN (déjà gardé au niveau du controller)
  // ==========================================================================

  /**
   * Active ou suspend l'accès d'une entreprise (n'affecte pas l'abonnement).
   */
  async updateCompanyStatus(
    id: string,
    dto: UpdateCompanyStatusDto,
    actorUserId: string,
  ) {
    const company = await this.getRawCompanyOrThrow(id);

    if (company.archivedAt) {
      throw new BadRequestException(
        'Entreprise archivée — désarchivez-la avant de changer son statut.',
      );
    }

    const before = { isActive: company.isActive };

    const updated = await this.prisma.company.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    await this.logAction(actorUserId, {
      action: dto.isActive ? 'COMPANY_ACTIVATED' : 'COMPANY_SUSPENDED',
      entityId: id,
      description: dto.isActive
        ? `Entreprise "${company.legalName}" réactivée par le super admin`
        : `Entreprise "${company.legalName}" suspendue par le super admin`,
      changes: { before, after: { isActive: updated.isActive } },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    return { success: true, isActive: updated.isActive };
  }

  /**
   * Archive une entreprise (soft delete). Aucune suppression réelle de données.
   */
  async archiveCompany(id: string, dto: ArchiveCompanyDto, actorUserId: string) {
    const company = await this.getRawCompanyOrThrow(id);

    if (company.archivedAt) {
      throw new BadRequestException('Entreprise déjà archivée.');
    }

    const before = { isActive: company.isActive, archivedAt: company.archivedAt };

    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        isActive: false,
        archivedAt: new Date(),
        archivedReason: dto.reason ?? null,
        archivedByUserId: actorUserId,
      },
    });

    await this.logAction(actorUserId, {
      action: 'COMPANY_ARCHIVED',
      entityId: id,
      description: `Entreprise "${company.legalName}" archivée par le super admin`,
      changes: {
        before,
        after: { isActive: updated.isActive, archivedAt: updated.archivedAt },
      },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    return { success: true, archivedAt: updated.archivedAt };
  }

  /**
   * Restaure une entreprise archivée (redevient active).
   */
  async unarchiveCompany(id: string, actorUserId: string) {
    const company = await this.getRawCompanyOrThrow(id);

    if (!company.archivedAt) {
      throw new BadRequestException("Entreprise pas archivée.");
    }

    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        isActive: true,
        archivedAt: null,
        archivedReason: null,
        archivedByUserId: null,
      },
    });

    await this.logAction(actorUserId, {
      action: 'COMPANY_UNARCHIVED',
      entityId: id,
      description: `Entreprise "${company.legalName}" désarchivée par le super admin`,
      changes: { before: { archivedAt: company.archivedAt }, after: { archivedAt: null } },
    });

    return { success: true, isActive: updated.isActive };
  }

  /**
   * Édition des informations générales d'une entreprise par le super admin.
   */
  async updateCompany(id: string, dto: UpdateCompanyDto, actorUserId: string) {
    const company = await this.getRawCompanyOrThrow(id);

    const fields = Object.keys(dto) as (keyof UpdateCompanyDto)[];
    if (fields.length === 0) {
      throw new BadRequestException('Aucun champ à mettre à jour.');
    }

    const before: Record<string, any> = {};
    for (const f of fields) before[f] = (company as any)[f];

    const updated = await this.prisma.company.update({
      where: { id },
      data: dto,
    });

    const after: Record<string, any> = {};
    for (const f of fields) after[f] = (updated as any)[f];

    await this.logAction(actorUserId, {
      action: 'COMPANY_UPDATED',
      entityId: id,
      description: `Entreprise "${company.legalName}" modifiée par le super admin`,
      changes: { before, after },
    });

    return updated;
  }

  // ==========================================================================
  // 🔧 Helpers privés
  // ==========================================================================

  private async getRawCompanyOrThrow(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException(`Entreprise ${id} introuvable`);
    }
    return company;
  }

  private async logAction(
    userId: string,
    entry: {
      action: string;
      entityId: string;
      description: string;
      changes?: any;
      metadata?: any;
    },
  ) {
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: entry.action,
        entity: 'COMPANY',
        entityId: entry.entityId,
        description: entry.description,
        changes: entry.changes,
        metadata: entry.metadata,
      },
    });
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