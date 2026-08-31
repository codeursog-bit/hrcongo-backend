// import {
//   Injectable,
//   NotFoundException,
//   UnauthorizedException,
//   BadRequestException,
//   Logger,
// } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { CreateCompanyDto } from './dto/create-company.dto';
// import { UpdateCompanyDto } from './dto/update-company.dto';
// import { SubscriptionsService } from '../subscriptions/subscriptions.service';
// import { CloudinaryService } from '../cloudinary/cloudinary.service';
// import { AffiliateService } from '../affiliate/affiliate.service';
// import * as CONST from '../payroll/settings/constants/settings.constants';

// @Injectable()
// export class CompaniesService {
//   private readonly logger = new Logger(CompaniesService.name);

//   constructor(
//     private prisma: PrismaService,
//     private subscriptionsService: SubscriptionsService,
//     private cloudinary: CloudinaryService,
//     private affiliateService: AffiliateService,
//   ) {}

//   async create(createCompanyDto: CreateCompanyDto, userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true, role: true },
//     });

//     if (!user)          throw new NotFoundException('Utilisateur introuvable.');
//     if (user.companyId) throw new UnauthorizedException('Vous êtes déjà associé à une entreprise.');

//     // On extrait affiliateCode du DTO avant de passer le reste à Prisma
//     const { affiliateCode, ...companyData } = createCompanyDto;

//     const company = await this.prisma.$transaction(async (tx) => {
//       const newCompany = await tx.company.create({
//         data: {
//           ...companyData,
//           payrollSettings: {
//             create: {
//               officialStartHour:    CONST.DEFAULT_START_HOUR,
//               lateToleranceMinutes: CONST.DEFAULT_TOLERANCE_MINUTES,
//               workDays:             CONST.DEFAULT_WORK_DAYS,
//               cnssSalarialRate:     CONST.DEFAULT_CNSS_SALARIAL_RATE,
//               cnssEmployerRate:     CONST.DEFAULT_CNSS_EMPLOYER_RATE,
//               overtimeRate10:       CONST.DEFAULT_OVERTIME_RATE_10,
//               overtimeRate25:       CONST.DEFAULT_OVERTIME_RATE_25,
//               overtimeRate50:       CONST.DEFAULT_OVERTIME_RATE_50,
//               overtimeRate100:      CONST.DEFAULT_OVERTIME_RATE_100,
//               apprenticeshipTax:    1.5,
//               fonerTax:             2000,
//               workDaysPerMonth:     CONST.DEFAULT_WORK_DAYS_PER_MONTH,
//               workHoursPerDay:      CONST.DEFAULT_WORK_HOURS_PER_DAY,
//               cnssRounding:         'UP',
//               itsRounding:          'UP',
//               effectiveDate:        new Date(),
//             },
//           },
//         },
//       });

//       await tx.user.update({
//         where: { id: userId },
//         data: { companyId: newCompany.id, role: 'ADMIN' },
//       });

//       return newCompany;
//     });

//     // ─── TRIAL SUBSCRIPTION ────────────────────────────────────────────────
//     try {
//       await this.subscriptionsService.createTrialSubscription(company.id);
//     } catch (err) {
//       this.logger.error(
//         `[CompaniesService] Abonnement trial non créé pour company ${company.id}:`,
//         err,
//       );
//     }

//     // ─── LIEN AFFILIÉ ──────────────────────────────────────────────────────
//     // C'est ici qu'on a enfin le company.id — on peut faire le linkage
//     if (affiliateCode) {
//       try {
//         await this.affiliateService.linkCompany(affiliateCode, company.id);
//         this.logger.log(`[Affiliate] Company ${company.id} liée au code "${affiliateCode}"`);
//       } catch (err) {
//         // Non bloquant : une erreur d'affiliation ne doit pas casser l'inscription
//         this.logger.error(
//           `[Affiliate] Erreur linkage company ${company.id} avec code "${affiliateCode}":`,
//           err,
//         );
//       }
//     }

//     return company;
//   }

//   // ── Le reste du fichier est INCHANGÉ ─────────────────────────────────────

//   async findOne(id: string) {
//     return this.prisma.company.findUnique({
//       where: { id },
//       include: {
//         departments:     true,
//         payrollSettings: true,
//         subscription:    true,
//       },
//     });
//   }

//   async findByUser(userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) {
//       throw new NotFoundException("Aucune entreprise associée à cet utilisateur.");
//     }

//     return this.findOne(user.companyId);
//   }

//   async update(userId: string, updateCompanyDto: UpdateCompanyDto) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true, role: true },
//     });

//     if (!user || !user.companyId) throw new NotFoundException("Aucune entreprise associée.");
//     if (!['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'].includes(user.role)) {
//       throw new UnauthorizedException('Permissions insuffisantes.');
//     }

//     return this.prisma.company.update({
//       where: { id: user.companyId },
//       data:  updateCompanyDto,
//     });
//   }

//   async uploadLogo(companyId: string, file: Express.Multer.File): Promise<{ logo: string }> {
//     if (!file) throw new BadRequestException('Aucun fichier fourni.');

//     const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml'];
//     if (!allowed.includes(file.mimetype)) {
//       throw new BadRequestException(
//         `Format non autorisé : ${file.mimetype}. Acceptés : JPG, PNG, WEBP, SVG`,
//       );
//     }

//     const maxSize = 2 * 1024 * 1024;
//     if (file.size > maxSize) {
//       throw new BadRequestException(
//         `Logo trop volumineux : ${(file.size / 1024 / 1024).toFixed(2)} MB (max 2 MB)`,
//       );
//     }

//     const company = await this.prisma.company.findUnique({
//       where: { id: companyId },
//       select: { id: true, logo: true },
//     });
//     if (!company) throw new NotFoundException('Entreprise introuvable.');

//     if (company.logo) {
//       try {
//         const publicId = this.cloudinary.extractPublicId(company.logo);
//         if (publicId) await this.cloudinary.deleteFile(publicId, 'image');
//       } catch (e) {
//         this.logger.warn(`[CompaniesService] Impossible de supprimer l'ancien logo: ${e}`);
//       }
//     }

//     const logoUrl = await this.cloudinary.uploadPublicFile(file, `logos/${companyId}`);

//     await this.prisma.company.update({
//       where: { id: companyId },
//       data:  { logo: logoUrl },
//     });

//     return { logo: logoUrl };
//   }

//   async deleteLogo(companyId: string): Promise<{ logo: null }> {
//     const company = await this.prisma.company.findUnique({
//       where: { id: companyId },
//       select: { id: true, logo: true },
//     });
//     if (!company) throw new NotFoundException('Entreprise introuvable.');

//     if (company.logo) {
//       try {
//         const publicId = this.cloudinary.extractPublicId(company.logo);
//         if (publicId) await this.cloudinary.deleteFile(publicId, 'image');
//       } catch (e) {
//         this.logger.warn(`[CompaniesService] Suppression Cloudinary échouée: ${e}`);
//       }
//     }

//     await this.prisma.company.update({
//       where: { id: companyId },
//       data:  { logo: null },
//     });

//     return { logo: null };
//   }
// }

import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import * as CONST from '../payroll/settings/constants/settings.constants';
import { Prisma } from '@prisma/client';
import { ConventionsService } from '../conventions/conventions.service';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptionsService: SubscriptionsService,
    private cloudinary: CloudinaryService,
    private affiliateService: AffiliateService,
    private conventionsService: ConventionsService,
  ) {}

  async create(createCompanyDto: CreateCompanyDto, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });

    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.companyId)
      throw new UnauthorizedException(
        'Vous êtes déjà associé à une entreprise.',
      );

    // On extrait affiliateCode du DTO avant de passer le reste à Prisma
    const { affiliateCode, seniorityLinearConfig, ...companyData } =
      createCompanyDto;

    const company = await this.prisma.$transaction(async (tx) => {
      const newCompany = await tx.company.create({
        data: {
          ...companyData,
          // ✅ FIX : Prisma exige Prisma.JsonNull au lieu de null pour les champs Json?
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

      await tx.user.update({
        where: { id: userId },
        data: { companyId: newCompany.id, role: 'ADMIN' },
      });

      return newCompany;
    });

    // ─── TRIAL SUBSCRIPTION ────────────────────────────────────────────────
    try {
      await this.subscriptionsService.createTrialSubscription(company.id);
    } catch (err) {
      this.logger.error(
        `[CompaniesService] Abonnement trial non créé pour company ${company.id}:`,
        err,
      );
    }

    // ─── ACTIVATION CONVENTION COLLECTIVE ───────────────────────────────────
    // Même pipeline que l'activation depuis les paramètres : génère les
    // CollectiveAgreementRule + BonusTemplate suggérés. Non-bloquant : si ça
    // échoue, l'entreprise est quand même créée.
    if (companyData.collectiveAgreement) {
      try {
        await this.conventionsService.activateConventionForCompany(
          userId,
          companyData.collectiveAgreement,
        );
      } catch (err) {
        this.logger.error(
          `[CompaniesService] Convention ${companyData.collectiveAgreement} non activée pour company ${company.id}:`,
          err,
        );
      }
    }

    // ─── LIEN AFFILIÉ ──────────────────────────────────────────────────────
    if (affiliateCode) {
      try {
        await this.affiliateService.linkCompany(affiliateCode, company.id);
        this.logger.log(
          `[Affiliate] Company ${company.id} liée au code "${affiliateCode}"`,
        );
      } catch (err) {
        this.logger.error(
          `[Affiliate] Erreur linkage company ${company.id} avec code "${affiliateCode}":`,
          err,
        );
      }
    }

    return company;
  }

  async findOne(id: string) {
    return this.prisma.company.findUnique({
      where: { id },
      include: {
        departments: true,
        payrollSettings: true,
        subscription: true,
      },
    });
  }

  async findByUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) {
      throw new NotFoundException(
        'Aucune entreprise associée à cet utilisateur.',
      );
    }

    return this.findOne(user.companyId);
  }

  async update(userId: string, updateCompanyDto: UpdateCompanyDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });

    if (!user || !user.companyId)
      throw new NotFoundException('Aucune entreprise associée.');
    if (!['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'].includes(user.role)) {
      throw new UnauthorizedException('Permissions insuffisantes.');
    }

    // ✅ FIX : extraire seniorityLinearConfig et passer Prisma.JsonNull si null
    const { seniorityLinearConfig, ...rest } = updateCompanyDto;

    return this.prisma.company.update({
      where: { id: user.companyId },
      data: {
        ...rest,
        // documentTemplate arrive en string depuis le DTO ; Prisma attend l'enum généré DocumentTemplate
        documentTemplate: rest.documentTemplate as any,
        seniorityLinearConfig: seniorityLinearConfig ?? Prisma.JsonNull,
      },
    });
  }

  async uploadLogo(
    companyId: string,
    file: Express.Multer.File,
  ): Promise<{ logo: string }> {
    if (!file) throw new BadRequestException('Aucun fichier fourni.');

    const allowed = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/svg+xml',
    ];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `Format non autorisé : ${file.mimetype}. Acceptés : JPG, PNG, WEBP, SVG`,
      );
    }

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `Logo trop volumineux : ${(file.size / 1024 / 1024).toFixed(2)} MB (max 2 MB)`,
      );
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, logo: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable.');

    if (company.logo) {
      try {
        const publicId = this.cloudinary.extractPublicId(company.logo);
        if (publicId) await this.cloudinary.deleteFile(publicId, 'image');
      } catch (e) {
        this.logger.warn(
          `[CompaniesService] Impossible de supprimer l'ancien logo: ${e}`,
        );
      }
    }

    const logoUrl = await this.cloudinary.uploadPublicFile(
      file,
      `logos/${companyId}`,
    );

    await this.prisma.company.update({
      where: { id: companyId },
      data: { logo: logoUrl },
    });

    return { logo: logoUrl };
  }

  async deleteLogo(companyId: string): Promise<{ logo: null }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, logo: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable.');

    if (company.logo) {
      try {
        const publicId = this.cloudinary.extractPublicId(company.logo);
        if (publicId) await this.cloudinary.deleteFile(publicId, 'image');
      } catch (e) {
        this.logger.warn(
          `[CompaniesService] Suppression Cloudinary échouée: ${e}`,
        );
      }
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: { logo: null },
    });

    return { logo: null };
  }

  // ── CACHET / SIGNATURE (documents imprimables : congé, absence, prêt...) ───

  async uploadCachet(
    companyId: string,
    file: Express.Multer.File,
  ): Promise<{ cachetUrl: string }> {
    if (!file) throw new BadRequestException('Aucun fichier fourni.');

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `Format non autorisé : ${file.mimetype}. Acceptés : JPG, PNG, WEBP`,
      );
    }

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `Fichier trop volumineux : ${(file.size / 1024 / 1024).toFixed(2)} MB (max 2 MB)`,
      );
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, cachetUrl: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable.');

    if (company.cachetUrl) {
      try {
        const publicId = this.cloudinary.extractPublicId(company.cachetUrl);
        if (publicId) await this.cloudinary.deleteFile(publicId, 'image');
      } catch (e) {
        this.logger.warn(
          `[CompaniesService] Impossible de supprimer l'ancien cachet: ${e}`,
        );
      }
    }

    const cachetUrl = await this.cloudinary.uploadPublicFile(
      file,
      `cachets/${companyId}`,
    );

    await this.prisma.company.update({
      where: { id: companyId },
      data: { cachetUrl },
    });

    return { cachetUrl };
  }

  async deleteCachet(companyId: string): Promise<{ cachetUrl: null }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, cachetUrl: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable.');

    if (company.cachetUrl) {
      try {
        const publicId = this.cloudinary.extractPublicId(company.cachetUrl);
        if (publicId) await this.cloudinary.deleteFile(publicId, 'image');
      } catch (e) {
        this.logger.warn(
          `[CompaniesService] Suppression Cloudinary échouée: ${e}`,
        );
      }
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: { cachetUrl: null },
    });

    return { cachetUrl: null };
  }
}