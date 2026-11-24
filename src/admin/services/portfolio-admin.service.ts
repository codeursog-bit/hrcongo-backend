import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// 🆕 Gestion super admin du portefeuille multi-entreprises : rattacher une
// entreprise existante à un user, activer/désactiver le flag, créer un
// nouveau user multi-entreprises directement. Contourne volontairement le
// quota maxCompanies — c'est le super admin qui décide.
@Injectable()
export class PortfolioAdminService {
  constructor(private prisma: PrismaService) {}

  async searchUsers(query?: string) {
    const users = await this.prisma.user.findMany({
      where: query
        ? {
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
        manageMultipleCompanies: true,
        maxCompanies: true,
        company: { select: { id: true, legalName: true, tradeName: true } },
        _count: { select: { ownedCompanies: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      manageMultipleCompanies: u.manageMultipleCompanies,
      maxCompanies: u.maxCompanies,
      activeCompany: u.company ? (u.company.tradeName || u.company.legalName) : null,
      linkedCompaniesCount: u._count.ownedCompanies,
    }));
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
        manageMultipleCompanies: true,
        maxCompanies: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const links = await this.prisma.userCompany.findMany({
      where: { userId },
      include: { company: { select: { id: true, legalName: true, tradeName: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...user,
      companies: links.map((l) => ({
        id: l.company.id,
        name: l.company.tradeName || l.company.legalName,
        isActive: l.company.isActive,
        isCurrent: l.company.id === user.companyId,
      })),
    };
  }

  // Crée une ligne UserCompany pour l'entreprise active actuelle du user si
  // elle n'y est pas déjà — sinon il "disparaîtrait" de sa propre liste
  // portefeuille au moment où on le fait passer en multi-entreprises.
  private async bootstrapCurrentCompany(userId: string, companyId: string | null) {
    if (!companyId) return;
    const existing = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!existing) {
      await this.prisma.userCompany.create({ data: { userId, companyId } });
    }
  }

  async attachCompany(userId: string, companyId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Entreprise introuvable.');

    await this.bootstrapCurrentCompany(userId, user.companyId);

    const existing = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (existing) throw new ConflictException('Ce user est déjà lié à cette entreprise.');

    await this.prisma.userCompany.create({ data: { userId, companyId } });

    if (!user.manageMultipleCompanies) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { manageMultipleCompanies: true },
      });
    }

    return this.getUserDetail(userId);
  }

  async detachCompany(userId: string, companyId: string) {
    const link = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!link) throw new NotFoundException('Ce user n\'est pas lié à cette entreprise.');
    await this.prisma.userCompany.delete({ where: { id: link.id } });
    return this.getUserDetail(userId);
  }

  async toggleFlag(userId: string, enabled: boolean, maxCompanies?: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    if (enabled) {
      await this.bootstrapCurrentCompany(userId, user.companyId);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        manageMultipleCompanies: enabled,
        ...(maxCompanies !== undefined ? { maxCompanies } : {}),
      },
    });
    return this.getUserDetail(userId);
  }

  async createPortfolioUser(dto: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    companyIds: string[];
    maxCompanies?: number;
  }) {
    if (!dto.companyIds || dto.companyIds.length === 0)
      throw new BadRequestException('Sélectionnez au moins une entreprise.');

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException(`Un compte existe déjà pour ${dto.email}`);

    const companies = await this.prisma.company.findMany({
      where: { id: { in: dto.companyIds } },
      select: { id: true },
    });
    if (companies.length !== dto.companyIds.length)
      throw new BadRequestException('Une ou plusieurs entreprises sélectionnées sont introuvables.');

    const hashedPwd = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPwd,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'ADMIN',
          manageMultipleCompanies: true,
          maxCompanies: dto.maxCompanies ?? 5,
          companyId: dto.companyIds[0],
          isActive: true,
        },
      });
      await tx.userCompany.createMany({
        data: dto.companyIds.map((companyId) => ({ userId: newUser.id, companyId })),
      });
      return newUser;
    });

    return this.getUserDetail(user.id);
  }
}