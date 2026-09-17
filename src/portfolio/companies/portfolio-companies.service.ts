import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { CreateCompanyDto } from '../../companies/dto/create-company.dto';
import * as CONST from '../../payroll/settings/constants/settings.constants';

// 🆕 Création d'entreprise depuis le portefeuille admin multi-entreprises.
// Différent de CompaniesService.create() qui est le flow d'inscription
// "premier compte, première entreprise" (il bloque si user.companyId existe
// déjà, et lie systématiquement l'entreprise créée comme entreprise
// unique du compte). Ici l'admin a déjà des entreprises liées — on ajoute
// une ligne UserCompany plutôt que d'écraser sa situation actuelle.
@Injectable()
export class PortfolioCompaniesService {
  private readonly logger = new Logger(PortfolioCompaniesService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptionsService: SubscriptionsService,
  ) {}

  async create(userId: string, dto: CreateCompanyDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, manageMultipleCompanies: true, maxCompanies: true },
    });
    if (!user) throw new ForbiddenException('Utilisateur introuvable.');
    if (user.role !== 'SUPER_ADMIN' && !user.manageMultipleCompanies) {
      throw new ForbiddenException(
        "Ce compte n'a pas accès au portefeuille multi-entreprises.",
      );
    }

    const currentCount = await this.prisma.userCompany.count({
      where: { userId },
    });
    const max = user.maxCompanies ?? 5;
    if (user.role !== 'SUPER_ADMIN' && currentCount >= max) {
      throw new BadRequestException(
        `Limite atteinte : ${max} entreprises maximum pour ce compte. Contactez le support pour l'augmenter.`,
      );
    }

    const { affiliateCode, seniorityLinearConfig, ...companyData } = dto;

    const company = await this.prisma.$transaction(async (tx) => {
      const newCompany = await tx.company.create({
        data: {
          ...companyData,
          seniorityLinearConfig: seniorityLinearConfig ?? Prisma.JsonNull,
          payrollSettings: {
            create: {
              officialStartHour: CONST.DEFAULT_START_HOUR,
              lateToleranceMinutes: CONST.DEFAULT_TOLERANCE_MINUTES,
              workDays: CONST.DEFAULT_WORK_DAYS,
              cnssSalarialRate: CONST.DEFAULT_CNSS_SALARIAL_RATE,
              cnssEmployerRate: CONST.DEFAULT_CNSS_EMPLOYER_RATE,
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

      // 🆕 Lien portefeuille — n'écrase jamais User.companyId (contrairement
      // à CompaniesService.create). L'admin garde son entreprise active
      // actuelle ; il basculera explicitement via /auth/switch-company.
      await tx.userCompany.create({
        data: { userId, companyId: newCompany.id },
      });

      return newCompany;
    });

    try {
      await this.subscriptionsService.createTrialSubscription(company.id);
    } catch (err) {
      this.logger.error(
        `[PortfolioCompaniesService] Abonnement trial non créé pour company ${company.id}:`,
        err,
      );
    }

    return company;
  }
}