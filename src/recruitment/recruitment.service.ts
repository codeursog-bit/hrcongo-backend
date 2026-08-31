// import { Injectable, NotFoundException } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { CreateJobDto } from './dto/create-job.dto';
// import { CreateCandidateDto } from './dto/create-candidate.dto';
// import { ContractType, JobOfferStatus, CandidateStatus, ProcessingMode } from '@prisma/client';
// import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';

// @Injectable()
// export class RecruitmentService {
//   constructor(
//     private prisma: PrismaService,
//     private subscriptionGuard: SubscriptionGuard,
//   ) {}

//   // ========================================
//   // 📋 JOB OFFERS - CRUD COMPLET
//   // ========================================

//   async createJobOffer(data: CreateJobDto, userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) throw new Error('Accès refusé');

//     await this.subscriptionGuard.checkLimit(
//       user.companyId,
//       'maxJobOffers',
//       "Vous avez atteint la limite d'offres d'emploi de votre plan. Veuillez upgrader pour publier plus d'offres.",
//     );

//     if (data.processingMode === 'AI_ASSISTED') {
//       await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasRecruitmentAI');
//     }

//     return this.prisma.jobOffer.create({
//       data: {
//         companyId: user.companyId,
//         status: data.status ? (data.status as JobOfferStatus) : JobOfferStatus.PUBLISHED,
//         title: data.title,
//         description: data.description,
//         requirements: data.requirements,
//         departmentId: data.departmentId,
//         location: data.location || 'Brazzaville',
//         type: data.contractType as ContractType,
//         imageUrl: data.imageUrl,
//         salaryMin: data.salaryMin || null,
//         salaryMax: data.salaryMax || null,
//         salaryCurrency: data.salaryCurrency || 'XAF',
//         showOnPortal: data.showOnPortal ?? false,
//         processingMode: data.processingMode
//           ? (data.processingMode as ProcessingMode)
//           : ProcessingMode.MANUAL,
//         requiredSkills: data.requiredSkills || [],
//         minExperience: data.minExperience || null,
//         educationLevel: data.educationLevel || null,
//         aiConfig: data.aiConfig ? data.aiConfig : undefined,
//         ...(data.startDate && { startDate: new Date(data.startDate) }),
//         ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
//       },
//     });
//   }

//   async findAllJobOffers(userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) return [];

//     return this.prisma.jobOffer.findMany({
//       where: { companyId: user.companyId },
//       include: {
//         department: { select: { id: true, name: true } },
//         _count: { select: { candidates: true } },
//       },
//       orderBy: { createdAt: 'desc' },
//     });
//   }

//   async findOneJobOffer(jobId: string, userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) throw new NotFoundException('Accès refusé');

//     const job = await this.prisma.jobOffer.findUnique({
//       where: { id: jobId },
//       include: {
//         department: true,
//         _count: { select: { candidates: true } },
//       },
//     });

//     if (!job || job.companyId !== user.companyId) {
//       throw new NotFoundException('Offre introuvable');
//     }

//     return job;
//   }

//   async updateJobOffer(jobId: string, data: Partial<CreateJobDto>, userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) throw new Error('Accès refusé');

//     const job = await this.prisma.jobOffer.findUnique({ where: { id: jobId } });

//     if (!job || job.companyId !== user.companyId) {
//       throw new NotFoundException('Offre introuvable');
//     }

//     return this.prisma.jobOffer.update({
//       where: { id: jobId },
//       data: {
//         ...(data.title && { title: data.title }),
//         ...(data.description && { description: data.description }),
//         ...(data.requirements !== undefined && { requirements: data.requirements }),
//         ...(data.hasOwnProperty('imageUrl') && { imageUrl: data.imageUrl }),
//         ...(data.departmentId && { departmentId: data.departmentId }),
//         ...(data.location && { location: data.location }),
//         ...(data.contractType && { type: data.contractType as ContractType }),
//         ...(data.salaryMin !== undefined && { salaryMin: data.salaryMin }),
//         ...(data.salaryMax !== undefined && { salaryMax: data.salaryMax }),
//         ...(data.salaryCurrency && { salaryCurrency: data.salaryCurrency }),
//         ...(data.showOnPortal !== undefined && { showOnPortal: data.showOnPortal }),
//         ...(data.isPremium !== undefined && { isPremium: data.isPremium }),
//         ...(data.processingMode && { processingMode: data.processingMode as ProcessingMode }),
//         ...(data.requiredSkills !== undefined && { requiredSkills: data.requiredSkills }),
//         ...(data.minExperience !== undefined && { minExperience: data.minExperience }),
//         ...(data.educationLevel !== undefined && { educationLevel: data.educationLevel }),
//         ...(data.aiConfig !== undefined && { aiConfig: data.aiConfig ? data.aiConfig : undefined }),
//         ...(data.startDate && { startDate: new Date(data.startDate) }),
//         ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
//       },
//     });
//   }

//   async deleteJobOffer(jobId: string, userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) throw new Error('Accès refusé');

//     const job = await this.prisma.jobOffer.findUnique({ where: { id: jobId } });

//     if (!job || job.companyId !== user.companyId) {
//       throw new NotFoundException('Offre introuvable');
//     }

//     return this.prisma.jobOffer.delete({ where: { id: jobId } });
//   }

//   // ========================================
//   // 👥 CANDIDATES - GESTION COMPLÈTE
//   // ========================================

//   async findAllCandidates(userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) return [];

//     return this.prisma.candidate.findMany({
//       where: { jobOffer: { companyId: user.companyId } },
//       include: {
//         jobOffer: {
//           select: {
//             id: true,              // ✅ FIX 1 — critique pour le filtre Kanban et la page Entretiens
//             title: true,
//             processingMode: true,
//             department: { select: { name: true } },
//           },
//         },
//       },
//       orderBy: { createdAt: 'desc' },
//     });
//   }

//   async findOneCandidate(candidateId: string, userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true },
//     });

//     if (!user || !user.companyId) throw new NotFoundException('Accès refusé');

//     const candidate = await this.prisma.candidate.findUnique({
//       where: { id: candidateId },
//       include: {
//         jobOffer: {
//           include: {
//             department: true, // ✅ department complet → expose departmentId pour convertToEmployee
//           },
//         },
//         testAnswers: {
//           include: {
//             question: true,
//           },
//         },
//       },
//     });

//     if (!candidate || candidate.jobOffer.companyId !== user.companyId) {
//       throw new NotFoundException('Candidat introuvable');
//     }

//     return candidate;
//   }

//   // ✅ FIX 2 — accepte maintenant les notes en plus du status
//   async updateCandidateStatus(candidateId: string, status: string, notes?: string) {
//     return this.prisma.candidate.update({
//       where: { id: candidateId },
//       data: {
//         status: status as CandidateStatus,
//         ...(notes !== undefined && { notes }),
//       },
//     });
//   }

//   async convertToEmployee(candidateId: string, userId: string) {
//     const candidate = await this.prisma.candidate.findUnique({
//       where: { id: candidateId },
//       include: { jobOffer: true },
//     });

//     if (!candidate) throw new NotFoundException('Candidat introuvable');

//     const matricule = `EMP-${Date.now().toString().slice(-6)}`;

//     const employee = await this.prisma.employee.create({
//       data: {
//         firstName: candidate.firstName,
//         lastName: candidate.lastName,
//         email: candidate.email,
//         phone: candidate.phone || 'À compléter',
//         departmentId: candidate.jobOffer.departmentId,
//         position: candidate.jobOffer.title,
//         contractType: candidate.jobOffer.type,
//         companyId: candidate.jobOffer.companyId,
//         address: 'À compléter',
//         city: 'Brazzaville',
//         gender: 'MALE',
//         maritalStatus: 'SINGLE',
//         dateOfBirth: new Date('2000-01-01'),
//         placeOfBirth: 'À compléter',
//         hireDate: new Date(),
//         baseSalary: candidate.jobOffer.salaryMin || 0,
//         employeeNumber: matricule,
//         createdById: userId,
//         photoUrl: `https://ui-avatars.com/api/?background=random&name=${candidate.firstName}+${candidate.lastName}`,
//       },
//     });

//     if (candidate.status !== CandidateStatus.HIRED) {
//       await this.prisma.candidate.update({
//         where: { id: candidateId },
//         data: { status: CandidateStatus.HIRED },
//       });
//     }

//     return employee;
//   }

//   // ========================================
//   // 🌐 PUBLIC API (pour candidats externes)
//   // ========================================

//   async findOnePublicJob(id: string) {
//     const job = await this.prisma.jobOffer.findUnique({
//       where: { id },
//       include: {
//         department: true,
//         company: {
//           select: {
//             legalName: true,
//             city: true,
//             logo: true,
//             industry: true,
//           },
//         },
//       },
//     });

//     if (!job || job.status !== JobOfferStatus.PUBLISHED) {
//       throw new NotFoundException('Offre introuvable ou non disponible');
//     }

//     return job;
//   }

//   async applyToJob(jobId: string, data: CreateCandidateDto) {
//     const job = await this.prisma.jobOffer.findUnique({
//       where: { id: jobId },
//       select: { status: true },
//     });

//     if (!job || job.status !== JobOfferStatus.PUBLISHED) {
//       throw new NotFoundException("Cette offre n'est plus disponible");
//     }

//     return this.prisma.candidate.create({
//       data: {
//         ...data,
//         jobOfferId: jobId,
//         status: CandidateStatus.APPLIED,
//       },
//     });
//   }
// }

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import {
  ContractType,
  JobOfferStatus,
  CandidateStatus,
  ProcessingMode,
} from '@prisma/client';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';

function generateSlug(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${base}-${suffix}`;
}

@Injectable()
export class RecruitmentService {
  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  async createJobOffer(data: CreateJobDto, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user || !user.companyId) throw new Error('Accès refusé');

    await this.subscriptionGuard.checkLimit(
      user.companyId,
      'maxJobOffers',
      "Vous avez atteint la limite d'offres d'emploi de votre plan.",
    );

    if (data.processingMode === 'AI_ASSISTED') {
      await this.subscriptionGuard.checkFeatureAccess(
        user.companyId,
        'hasRecruitmentAI',
      );
    }

    // ✅ Génère le slug entreprise si absent
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { id: true, legalName: true, slug: true },
    });
    if (company && !company.slug) {
      await this.prisma.company.update({
        where: { id: user.companyId },
        data: {
          slug: generateSlug(company.legalName, company.id.substring(0, 6)),
        },
      });
    }

    return this.prisma.jobOffer.create({
      data: {
        companyId: user.companyId,
        status: data.status
          ? (data.status as JobOfferStatus)
          : JobOfferStatus.PUBLISHED,
        title: data.title,
        description: data.description,
        requirements: data.requirements,
        departmentId: data.departmentId,
        location: data.location || 'Brazzaville',
        type: data.contractType as ContractType,
        imageUrl: data.imageUrl,
        salaryMin: data.salaryMin || null,
        salaryMax: data.salaryMax || null,
        salaryCurrency: data.salaryCurrency || 'XAF',
        showOnPortal: data.showOnPortal ?? false,
        isPremium:
          data.isPremium === true || (data.isPremium as any) === 'true',
        processingMode: data.processingMode
          ? (data.processingMode as ProcessingMode)
          : ProcessingMode.MANUAL,
        requiredSkills: data.requiredSkills || [],
        minExperience: data.minExperience || null,
        educationLevel: data.educationLevel || null,
        aiConfig: data.aiConfig ?? undefined,
        ...((data as any).additionalDocumentType !== undefined && {
          additionalDocumentType: (data as any).additionalDocumentType || null,
          additionalDocumentLabel:
            (data as any).additionalDocumentLabel || null,
        }),
        ...(data.startDate && { startDate: new Date(data.startDate) }),
        ...(data.expirationDate && {
          expirationDate: new Date(data.expirationDate),
        }),
      },
    });
  }

  async findAllJobOffers(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user || !user.companyId) return [];
    return this.prisma.jobOffer.findMany({
      where: { companyId: user.companyId },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { candidates: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneJobOffer(jobId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user || !user.companyId) throw new NotFoundException('Accès refusé');
    const job = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      include: { department: true, _count: { select: { candidates: true } } },
    });
    if (!job || job.companyId !== user.companyId)
      throw new NotFoundException('Offre introuvable');
    return job;
  }

  async updateJobOffer(
    jobId: string,
    data: Partial<CreateJobDto>,
    userId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user || !user.companyId) throw new Error('Accès refusé');
    const job = await this.prisma.jobOffer.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== user.companyId)
      throw new NotFoundException('Offre introuvable');

    return this.prisma.jobOffer.update({
      where: { id: jobId },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.description && { description: data.description }),
        ...(data.requirements !== undefined && {
          requirements: data.requirements,
        }),
        ...(data.hasOwnProperty('imageUrl') && { imageUrl: data.imageUrl }),
        ...(data.departmentId && { departmentId: data.departmentId }),
        ...(data.location && { location: data.location }),
        ...(data.contractType && { type: data.contractType as ContractType }),
        ...(data.salaryMin !== undefined && { salaryMin: data.salaryMin }),
        ...(data.salaryMax !== undefined && { salaryMax: data.salaryMax }),
        ...(data.salaryCurrency && { salaryCurrency: data.salaryCurrency }),
        ...(data.showOnPortal !== undefined && {
          showOnPortal: data.showOnPortal,
        }),
        ...(data.isPremium !== undefined && { isPremium: data.isPremium }),
        ...(data.processingMode && {
          processingMode: data.processingMode as ProcessingMode,
        }),
        ...(data.requiredSkills !== undefined && {
          requiredSkills: data.requiredSkills,
        }),
        ...(data.minExperience !== undefined && {
          minExperience: data.minExperience,
        }),
        ...(data.educationLevel !== undefined && {
          educationLevel: data.educationLevel,
        }),
        ...(data.aiConfig !== undefined && {
          aiConfig: data.aiConfig ?? undefined,
        }),
        ...((data as any).additionalDocumentType !== undefined && {
          additionalDocumentType: (data as any).additionalDocumentType || null,
          additionalDocumentLabel:
            (data as any).additionalDocumentLabel || null,
        }),
        ...(data.startDate && { startDate: new Date(data.startDate) }),
        ...(data.expirationDate && {
          expirationDate: new Date(data.expirationDate),
        }),
      },
    });
  }

  async deleteJobOffer(jobId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user || !user.companyId) throw new Error('Accès refusé');
    const job = await this.prisma.jobOffer.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== user.companyId)
      throw new NotFoundException('Offre introuvable');
    return this.prisma.jobOffer.delete({ where: { id: jobId } });
  }

  async findAllCandidates(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user || !user.companyId) return [];
    return this.prisma.candidate.findMany({
      where: { jobOffer: { companyId: user.companyId } },
      include: {
        jobOffer: {
          select: {
            id: true,
            title: true,
            processingMode: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneCandidate(candidateId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user || !user.companyId) throw new NotFoundException('Accès refusé');
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        jobOffer: { include: { department: true } },
        testAnswers: { include: { question: true } },
      },
    });
    if (!candidate || candidate.jobOffer.companyId !== user.companyId)
      throw new NotFoundException('Candidat introuvable');
    return candidate;
  }

  async updateCandidateStatus(
    candidateId: string,
    status: string,
    notes?: string,
  ) {
    return this.prisma.candidate.update({
      where: { id: candidateId },
      data: {
        status: status as CandidateStatus,
        ...(notes !== undefined && { notes }),
      },
    });
  }

  async convertToEmployee(candidateId: string, userId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { jobOffer: true },
    });
    if (!candidate) throw new NotFoundException('Candidat introuvable');
    const matricule = `EMP-${Date.now().toString().slice(-6)}`;
    const employee = await this.prisma.employee.create({
      data: {
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone: candidate.phone || 'À compléter',
        departmentId: candidate.jobOffer.departmentId,
        position: candidate.jobOffer.title,
        contractType: candidate.jobOffer.type,
        companyId: candidate.jobOffer.companyId,
        address: 'À compléter',
        city: 'Brazzaville',
        gender: 'MALE',
        maritalStatus: 'SINGLE',
        dateOfBirth: new Date('2000-01-01'),
        placeOfBirth: 'À compléter',
        hireDate: new Date(),
        baseSalary: candidate.jobOffer.salaryMin || 0,
        employeeNumber: matricule,
        createdById: userId,
        photoUrl: `https://ui-avatars.com/api/?background=random&name=${candidate.firstName}+${candidate.lastName}`,
      },
    });
    if (candidate.status !== CandidateStatus.HIRED) {
      await this.prisma.candidate.update({
        where: { id: candidateId },
        data: { status: CandidateStatus.HIRED },
      });
    }
    return employee;
  }

  async findOnePublicJob(id: string) {
    const job = await this.prisma.jobOffer.findUnique({
      where: { id },
      include: {
        department: { select: { name: true } },
        company: {
          select: {
            id: true,
            slug: true,
            legalName: true,
            city: true,
            logo: true,
            industry: true,
            careerPageLogo: true,
            careerPageBanner: true,
            careerPageColors: true,
          },
        },
      },
    });
    if (!job || job.status !== JobOfferStatus.PUBLISHED)
      throw new NotFoundException('Offre introuvable ou non disponible');
    return job;
  }

  async applyToJob(jobId: string, data: CreateCandidateDto) {
    const job = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (!job || job.status !== JobOfferStatus.PUBLISHED)
      throw new NotFoundException("Cette offre n'est plus disponible");
    return this.prisma.candidate.create({
      data: { ...data, jobOfferId: jobId, status: CandidateStatus.APPLIED },
    });
  }
}
