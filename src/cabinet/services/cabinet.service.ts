import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CabinetWalletService } from './cabinet-wallet.service';
import { MailService } from '../../mail/mail.service';
import {
  CreateCabinetDto,
  UpdateCabinetDto,
  AddCabinetUserDto,
  AddCompanyToCabinetDto,
  UpdatePortalAccessDto,
} from '../dto/cabinet.dto';
import * as CONST from '../../payroll/settings/constants/settings.constants';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class CabinetService {
  constructor(
    private prisma: PrismaService,
    private walletService: CabinetWalletService,
    private mailService: MailService,
  ) {}

  // ─── Cabinet CRUD ─────────────────────────────────────────────────────────

  async create(dto: CreateCabinetDto, userId: string) {
    const existing = await this.prisma.cabinet.findUnique({
      where: { subdomain: dto.subdomain },
    });
    if (existing)
      throw new ConflictException(
        `Sous-domaine "${dto.subdomain}" déjà utilisé`,
      );

    const cabinet = await this.prisma.$transaction(async (tx) => {
      const cab = await tx.cabinet.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          subdomain: dto.subdomain,
        },
      });
      await tx.cabinetUser.create({
        data: { cabinetId: cab.id, userId, role: 'CABINET_ADMIN' },
      });
      return cab;
    });

    await this.walletService.createWalletWithTrial(cabinet.id);
    return cabinet;
  }

  async findById(cabinetId: string) {
    const cabinet = await this.prisma.cabinet.findUnique({
      where: { id: cabinetId },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        },
        companies: {
          where: { isActive: true },
          include: {
            company: {
              select: {
                id: true,
                legalName: true,
                tradeName: true,
                city: true,
                isActive: true,
              },
            },
          },
        },
        _count: { select: { companies: true, users: true } },
      },
    });

    if (!cabinet) throw new NotFoundException('Cabinet introuvable');
    return cabinet;
  }

  async update(cabinetId: string, dto: UpdateCabinetDto) {
    await this.findById(cabinetId);
    return this.prisma.cabinet.update({ where: { id: cabinetId }, data: dto });
  }

  // ─── Branding cabinet ─────────────────────────────────────────────────────

  async updateBranding(
    cabinetId: string,
    dto: { logo?: string; primaryColor?: string; secondaryColor?: string },
  ) {
    await this.findById(cabinetId);
    return this.prisma.cabinet.update({
      where: { id: cabinetId },
      data: {
        ...(dto.logo !== undefined && { logo: dto.logo }),
        ...(dto.primaryColor !== undefined && {
          primaryColor: dto.primaryColor,
        }),
        ...(dto.secondaryColor !== undefined && {
          secondaryColor: dto.secondaryColor,
        }),
      },
      select: {
        id: true,
        name: true,
        logo: true,
        primaryColor: true,
        secondaryColor: true,
      },
    });
  }

  async getBrandingBySubdomain(subdomain: string) {
    const cabinet = await this.prisma.cabinet.findUnique({
      where: { subdomain },
      select: {
        id: true,
        name: true,
        logo: true,
        primaryColor: true,
        secondaryColor: true,
        isActive: true,
      },
    });
    if (!cabinet?.isActive) throw new NotFoundException('Cabinet introuvable');
    return cabinet;
  }

  // ─── Gestionnaires ────────────────────────────────────────────────────────

  async addUser(cabinetId: string, dto: AddCabinetUserDto) {
    // Chercher si l'utilisateur existe
    let user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // S'il n'existe pas → créer le compte avec mot de passe temporaire
    if (!user) {
      const tempPassword = `Konza#${Math.random().toString(36).slice(2, 8)}`;
      const hashed = await bcrypt.hash(tempPassword, 10);
      user = await this.prisma.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          password: hashed,
          firstName: '',
          lastName: '',
          role:
            dto.role === 'CABINET_ADMIN'
              ? 'CABINET_ADMIN'
              : 'CABINET_GESTIONNAIRE',
          isActive: true,
          mustChangePassword: true,
        },
      });
      // Envoi email d'invitation (non bloquant)
      try {
        const cabinet = await this.prisma.cabinet.findUnique({
          where: { id: cabinetId },
          select: { name: true },
        });
        await this.mailService.sendCabinetInvitation({
          to: dto.email,
          cabinetName: cabinet?.name ?? '',
          tempPassword,
        });
      } catch {
        /* email non configuré – continuer */
      }
    }

    // Vérifier si déjà membre
    const existing = await this.prisma.cabinetUser.findUnique({
      where: { cabinetId_userId: { cabinetId, userId: user.id } },
    });

    if (existing) {
      if (existing.role !== dto.role) {
        return this.prisma.cabinetUser.update({
          where: { id: existing.id },
          data: { role: dto.role },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        });
      }
      throw new ConflictException('Utilisateur déjà membre du cabinet');
    }

    return this.prisma.cabinetUser.create({
      data: { cabinetId, userId: user.id, role: dto.role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
  }

  async removeUser(
    cabinetId: string,
    targetUserId: string,
    requesterId: string,
  ) {
    if (targetUserId === requesterId) {
      const adminCount = await this.prisma.cabinetUser.count({
        where: { cabinetId, role: 'CABINET_ADMIN' },
      });
      if (adminCount <= 1)
        throw new ForbiddenException(
          'Impossible de retirer le seul administrateur',
        );
    }
    return this.prisma.cabinetUser.delete({
      where: { cabinetId_userId: { cabinetId, userId: targetUserId } },
    });
  }

  // ─── PME clientes — Lier une PME existante ────────────────────────────────

  async addCompany(cabinetId: string, dto: AddCompanyToCabinetDto) {
    const canGen = await this.walletService.canGenerateBulletin(cabinetId);
    if (!canGen.allowed) throw new ForbiddenException(canGen.reason);

    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    const existing = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId: dto.companyId } },
    });

    if (existing?.isActive)
      throw new ConflictException('PME déjà liée à ce cabinet');

    if (existing && !existing.isActive) {
      return this.prisma.cabinetCompany.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
          endDate: null,
        },
      });
    }

    return this.prisma.cabinetCompany.create({
      data: {
        cabinetId,
        companyId: dto.companyId,
        startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
      },
      include: {
        company: {
          select: { id: true, legalName: true, tradeName: true, city: true },
        },
      },
    });
  }

  // ─── PME clientes — Créer + Lier une PME neuve ────────────────────────────

  async createAndLinkCompany(
    cabinetId: string,
    dto: {
      legalName: string;
      tradeName?: string;
      rccmNumber: string;
      cnssNumber?: string;
      address: string;
      city: string;
      phone: string;
      email: string;
      country?: string;
      industry?: string;
      startDate?: string;
    },
  ) {
    const existing = await this.prisma.company.findFirst({
      where: { rccmNumber: dto.rccmNumber },
    });
    if (existing) {
      return this.addCompany(cabinetId, {
        companyId: existing.id,
        startDate: dto.startDate,
      });
    }

    const { startDate, ...companyFields } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          ...companyFields,
          country: companyFields.country ?? 'CG',
          managedByCabinet: true,
          cabinetId,
          payrollSettings: {
            create: {
              officialStartHour: CONST.DEFAULT_START_HOUR,
              lateToleranceMinutes: CONST.DEFAULT_TOLERANCE_MINUTES,
              workDays: CONST.DEFAULT_WORK_DAYS,
              cnssSalarialRate: CONST.DEFAULT_CNSS_SALARIAL_RATE,
              cnssEmployerRate: CONST.DEFAULT_CNSS_EMPLOYER_RATE,
              cnssPensionCeiling:
                CONST.DEFAULT_CNSS_PENSION_CEILING ??
                CONST.DEFAULT_CNSS_CEILING,
              cnssSocialCeiling:
                CONST.DEFAULT_CNSS_SOCIAL_CEILING ?? CONST.DEFAULT_CNSS_CEILING,
              overtimeRate10: CONST.DEFAULT_OVERTIME_RATE_10,
              overtimeRate25: CONST.DEFAULT_OVERTIME_RATE_25,
              overtimeRate50: CONST.DEFAULT_OVERTIME_RATE_50,
              overtimeRate100: CONST.DEFAULT_OVERTIME_RATE_100,
              apprenticeshipTax: 1.5,
              fonerTax: 2000,
              workDaysPerMonth: CONST.DEFAULT_WORK_DAYS_PER_MONTH,
              workHoursPerDay: CONST.DEFAULT_WORK_HOURS_PER_DAY,
              cnssRounding: 'UP',
              itsRounding: 'UP',
              effectiveDate: new Date(),
            },
          },
        },
      });

      await tx.department.create({
        data: { name: 'Général', companyId: company.id },
      });

      const link = await tx.cabinetCompany.create({
        data: {
          cabinetId,
          companyId: company.id,
          startDate: startDate ? new Date(startDate) : new Date(),
        },
      });

      return { company, link };
    });

    return result;
  }

  // ─── PME — Recherche pour liaison ─────────────────────────────────────────

  async searchAvailableCompanies(cabinetId: string, q: string, limit = 10) {
    const alreadyLinked = await this.prisma.cabinetCompany.findMany({
      where: { cabinetId, isActive: true },
      select: { companyId: true },
    });
    const excludeIds = alreadyLinked.map((l) => l.companyId);

    const companies = await this.prisma.company.findMany({
      where: {
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
        ...(q?.trim()
          ? {
              OR: [
                { legalName: { contains: q.trim(), mode: 'insensitive' } },
                { tradeName: { contains: q.trim(), mode: 'insensitive' } },
                { rccmNumber: { contains: q.trim(), mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: limit,
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        city: true,
        isActive: true,
      },
      orderBy: { legalName: 'asc' },
    });

    return { data: companies };
  }

  async removeCompany(cabinetId: string, companyId: string) {
    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
    });
    if (!link) throw new NotFoundException('Liaison introuvable');
    return this.prisma.cabinetCompany.update({
      where: { id: link.id },
      data: { isActive: false, endDate: new Date() },
    });
  }

  async updatePortalAccess(
    cabinetId: string,
    companyId: string,
    dto: UpdatePortalAccessDto,
  ) {
    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
    });
    if (!link?.isActive)
      throw new NotFoundException('Liaison introuvable ou inactive');
    return this.prisma.cabinetCompany.update({
      where: { id: link.id },
      data: dto,
    });
  }

  // ─── Invitation admin PME ─────────────────────────────────────────────────

  async invitePmeAdmin(
    cabinetId: string,
    companyId: string,
    email: string,
    firstName: string,
    lastName: string,
    invitedByUserId: string,
  ) {
    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
      select: { isActive: true },
    });
    if (!link?.isActive)
      throw new NotFoundException('PME non gérée par ce cabinet');

    const cabinet = await this.prisma.cabinet.findUnique({
      where: { id: cabinetId },
      select: { name: true, logo: true, primaryColor: true },
    });
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { legalName: true, tradeName: true },
    });

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser)
      throw new ConflictException(`Un compte existe déjà pour ${email}`);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // ✅ FIX : stocker le résultat du create dans une variable
    const invitation = await this.prisma.userInvitation.create({
      data: {
        email,
        role: 'ADMIN',
        token,
        expiresAt,
        invitedBy: invitedByUserId,
        companyId,
        cabinetId,
        cabinetName: cabinet!.name,
      },
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { managedByCabinet: true, cabinetId },
    });

    // Envoi email (non bloquant — si email non configuré, le lien reste disponible)
    try {
      await this.mailService.sendPmeAdminInvitation({
        to: email,
        firstName,
        lastName,
        companyName: company?.tradeName || company?.legalName || '',
        cabinetName: cabinet!.name,
        cabinetLogo: cabinet?.logo,
        cabinetColor: cabinet?.primaryColor,
        invitationToken: token,
        expiresAt,
      });
    } catch {
      // Email non configuré → on continue, le front affichera le lien à copier
    }

    return {
      success: true,
      email,
      expiresAt,
      token, // ← retourné pour le "copier le lien" côté front
      invitationId: invitation.id,
    };
  }

  // ─── Info invitation (pour page accept) ───────────────────────────────────

  async getInvitationInfo(token: string) {
    const inv = await this.prisma.userInvitation.findUnique({
      where: { token },
    });
    if (!inv || inv.accepted)
      throw new BadRequestException('Lien invalide ou déjà utilisé');
    if (new Date() > inv.expiresAt)
      throw new BadRequestException('Lien expiré');

    const [cabinet, company] = await Promise.all([
      inv.cabinetId
        ? this.prisma.cabinet.findUnique({
            where: { id: inv.cabinetId },
            select: {
              name: true,
              logo: true,
              primaryColor: true,
              secondaryColor: true,
            },
          })
        : null,
      inv.companyId
        ? this.prisma.company.findUnique({
            where: { id: inv.companyId },
            select: { legalName: true, tradeName: true },
          })
        : null,
    ]);

    return {
      email: inv.email,
      cabinetName: inv.cabinetName ?? cabinet?.name ?? null,
      cabinetLogo: cabinet?.logo ?? null,
      cabinetColor: cabinet?.primaryColor ?? null,
      cabinetColor2: cabinet?.secondaryColor ?? null,
      companyName: company?.tradeName || company?.legalName || null,
    };
  }

  // ─── Accepter invitation ──────────────────────────────────────────────────

  async acceptInvitation(
    token: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ) {
    const inv = await this.prisma.userInvitation.findUnique({
      where: { token },
    });
    if (!inv || inv.accepted)
      throw new BadRequestException('Lien invalide ou déjà utilisé');
    if (new Date() > inv.expiresAt)
      throw new BadRequestException('Lien expiré. Contactez votre cabinet.');
    if (!inv.companyId)
      throw new BadRequestException(
        'Invitation invalide : aucune entreprise associée',
      );

    const existing = await this.prisma.user.findUnique({
      where: { email: inv.email },
    });
    if (existing)
      throw new ConflictException('Un compte existe déjà avec cet email');

    const hashedPwd = await bcrypt.hash(password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: inv.email,
          password: hashedPwd,
          firstName: firstName ?? inv.email.split('@')[0],
          lastName: lastName ?? '',
          role: 'ADMIN',
          companyId: inv.companyId!,
          isActive: true,
        },
      });
      await tx.userInvitation.update({
        where: { id: inv.id },
        data: { accepted: true, acceptedAt: new Date() },
      });
      return newUser;
    });

    return {
      success: true,
      userId: user.id,
      companyId: inv.companyId,
      cabinetId: inv.cabinetId,
    };
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  async getDashboard(cabinetId: string) {
    const [companies, pendingPayrolls, wallet] = await Promise.all([
      this.prisma.cabinetCompany.findMany({
        where: { cabinetId, isActive: true },
        include: {
          company: {
            select: {
              id: true,
              legalName: true,
              tradeName: true,
              city: true,
              _count: { select: { employees: true } },
              payrolls: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  month: true,
                  year: true,
                  status: true,
                  netSalary: true,
                },
              },
            },
          },
        },
        orderBy: { company: { legalName: 'asc' } },
      }),
      this.prisma.payroll.count({
        where: {
          status: 'DRAFT',
          company: {
            cabinetCompanies: { some: { cabinetId, isActive: true } },
          },
        },
      }),
      this.walletService.getWallet(cabinetId).catch(() => null),
    ]);

    return {
      totalCompanies: companies.length,
      pendingPayrolls,
      wallet,
      companies: (companies as any[]).map((cc) => ({
        linkId: cc.id,
        companyId: cc.company.id,
        legalName: cc.company.legalName,
        tradeName: cc.company.tradeName,
        city: cc.company.city,
        employeeCount: cc.company._count.employees,
        pmePortalEnabled: cc.pmePortalEnabled,
        employeeAccessEnabled: cc.employeeAccessEnabled,
        lastPayroll: cc.company.payrolls[0] ?? null,
      })),
    };
  }

  async resolveBySubdomain(subdomain: string) {
    const cabinet = await this.prisma.cabinet.findUnique({
      where: { subdomain },
      select: { id: true, name: true, subdomain: true, isActive: true },
    });
    if (!cabinet?.isActive) throw new NotFoundException('Cabinet introuvable');
    return cabinet;
  }

  async checkCompanyAccess(cabinetId: string, companyId: string) {
    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
      select: {
        pmePortalEnabled: true,
        employeeAccessEnabled: true,
        isActive: true,
      },
    });
    if (!link?.isActive)
      throw new ForbiddenException('PME non gérée par ce cabinet');
    return {
      pmePortalEnabled: link.pmePortalEnabled,
      employeeAccessEnabled: link.employeeAccessEnabled,
    };
  }

  // ── Liste des membres (gestionnaires) du cabinet ────────────────────────
  async getMembers(cabinetId: string) {
    const members = await this.prisma.cabinetUser.findMany({
      where: { cabinetId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      role: m.user.role,
      joinedAt: m.createdAt,
    }));
  }

  async countCompanies(cabinetId: string): Promise<number> {
    return this.prisma.cabinetCompany.count({
      where: { cabinetId, isActive: true },
    });
  }
}
