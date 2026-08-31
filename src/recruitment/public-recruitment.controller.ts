// // src/recruitment/public-recruitment.controller.ts
// import {
//   Controller,
//   Get,
//   Post,
//   Body,
//   Param,
//   UseInterceptors,
//   UploadedFile,
//   BadRequestException,
//   NotFoundException,
//   Req,
//   Query
// } from '@nestjs/common';
// import { FileInterceptor } from '@nestjs/platform-express';
// import { RecruitmentService } from './recruitment.service';
// import { RecruitmentAIService } from './recruitment-ai.service';
// import { CreateCandidateDto } from './dto/create-candidate.dto';
// import { CloudinaryService } from '../cloudinary/cloudinary.service';
// import { PrismaService } from '../prisma/prisma.service';
// // ✅ APRÈS
// import type { Request } from 'express';

// // 🔒 SEUIL DE DISQUALIFICATION AUTO
// const MAX_TAB_SWITCHES = 5;

// @Controller('public/jobs')
// export class PublicRecruitmentController {
//   constructor(
//     private readonly recruitmentService: RecruitmentService,
//     private readonly recruitmentAIService: RecruitmentAIService,
//     private readonly cloudinaryService: CloudinaryService,
//     private readonly prisma: PrismaService
//   ) {}

//   // ========================================
//   // 🌐 PORTAIL PUBLIC
//   // ========================================

//   /**
//    * 📋 PORTAIL GLOBAL - Toutes les offres publiées
//    * Avec filtres avancés + tri premium
//    */
//   @Get('portal')
//   async getPortalJobs(
//     @Query('department') department?: string,
//     @Query('location') location?: string,
//     @Query('type') type?: string,
//     @Query('skills') skills?: string, // Comma-separated
//     @Query('page') page = '1',
//     @Query('limit') limit = '20'
//   ) {
//     const where: any = {
//       status: 'PUBLISHED',
//       showOnPortal: true
//     };

//     if (department) where.departmentId = department;
//     if (location) where.location = { contains: location, mode: 'insensitive' };
//     if (type) where.type = type;

//     // Filtre par compétences
//     if (skills) {
//       const skillArray = skills.split(',').map(s => s.trim());
//       where.requiredSkills = {
//         hasSome: skillArray
//       };
//     }

//     const pageNum = parseInt(page);
//     const limitNum = parseInt(limit);
//     const skip = (pageNum - 1) * limitNum;

//     // 🔥 TRI : Premium en premier, puis par date
//     const jobs = await this.prisma.jobOffer.findMany({
//       where,
//       include: {
//         company: {
//           select: {
//             legalName: true,
//             logo: true,
//             industry: true,
//             city: true,
//             careerPageLogo: true
//           }
//         },
//         department: {
//           select: { name: true }
//         },
//         _count: {
//           select: { candidates: true }
//         }
//       },
//       orderBy: [
//         { isPremium: 'desc' }, // ← Premium d'abord
//         { createdAt: 'desc' }
//       ],
//       skip,
//       take: limitNum
//     });

//     const total = await this.prisma.jobOffer.count({ where });

//     return {
//       success: true,
//       count: jobs.length,
//       total,
//       page: pageNum,
//       pages: Math.ceil(total / limitNum),
//       jobs: jobs.map(job => ({
//         id: job.id,
//         title: job.title,
//         company: job.company.legalName,
//         companyLogo: job.company.careerPageLogo || job.company.logo,
//         industry: job.company.industry,
//         location: job.location,
//         type: job.type,
//         department: job.department?.name,
//         imageUrl: job.imageUrl, // ← Image de l'offre
//         isPremium: job.isPremium, // ← Badge premium
//         salaryRange: job.salaryMin && job.salaryMax
//           ? `${job.salaryMin.toLocaleString()} - ${job.salaryMax.toLocaleString()} ${job.salaryCurrency}`
//           : null,
//         requiredSkills: job.requiredSkills,
//         candidatesCount: job._count.candidates,
//         createdAt: job.createdAt
//       }))
//     };
//   }

//   /**
//    * 🏢 PAGE ENTREPRISE - Toutes les offres + Personnalisation
//    */
//   @Get('company/:companyId')
//   async getCompanyJobs(@Param('companyId') companyId: string) {
//     const company = await this.prisma.company.findUnique({
//       where: { id: companyId },
//       select: {
//         legalName: true,
//         logo: true,
//         industry: true,
//         city: true,
//         // 🎨 Personnalisation carrière
//         careerPageBanner: true,
//         careerPageLogo: true,
//         careerPageColors: true,
//         careerPageAbout: true,
//         careerPageValues: true,
//         careerPagePhotos: true
//       }
//     });

//     if (!company) {
//       throw new NotFoundException('Entreprise introuvable');
//     }

//     const jobs = await this.prisma.jobOffer.findMany({
//       where: {
//         companyId,
//         status: 'PUBLISHED'
//       },
//       include: {
//         department: true,
//         _count: { select: { candidates: true } }
//       },
//       orderBy: { createdAt: 'desc' }
//     });

//     return {
//       success: true,
//       company: {
//         ...company,
//         colors: company.careerPageColors || { primary: '#2563eb', secondary: '#1e40af' }
//       },
//       jobs: jobs.map(job => ({
//         id: job.id,
//         title: job.title,
//         location: job.location,
//         type: job.type,
//         department: job.department?.name,
//         imageUrl: job.imageUrl, // ← Image de l'offre
//         salaryRange: job.salaryMin && job.salaryMax
//           ? `${job.salaryMin.toLocaleString()} - ${job.salaryMax.toLocaleString()} ${job.salaryCurrency}`
//           : null,
//         candidatesCount: job._count.candidates,
//         createdAt: job.createdAt
//       }))
//     };
//   }

//   /**
//    * 📄 DÉTAIL OFFRE + TRACKING VUE
//    */
//   @Get(':id')
//   async getJobDetails(
//     @Param('id') id: string,
//     @Query('source') source?: string,
//     @Req() request?: Request
//   ) {
//     const job = await this.recruitmentService.findOnePublicJob(id);

//     if (!job) {
//       throw new NotFoundException('Cette offre n\'existe pas ou n\'est plus disponible');
//     }

//     // 📊 Tracking de la vue
//     try {
//       await this.prisma.jobOfferView.create({
//         data: {
//           jobOfferId: id,
//           ipAddress: request?.ip || 'unknown',
//           userAgent: request?.headers['user-agent'] || null,
//           source: source || 'direct'
//         }
//       });
//     } catch (error) {
//       console.warn('⚠️ Analytics view non enregistrée:', error.message);
//     }

//     // Si mode IA, vérifier si test existe
//     if (job.processingMode === 'AI_ASSISTED') {
//       const testQuestionsCount = await this.prisma.jobOfferTestQuestion.count({
//         where: { jobOfferId: id }
//       });

//       const aiConfig = job.aiConfig as any || {};

//       return {
//         ...job,
//         hasTest: testQuestionsCount > 0,
//         testQuestionsCount,
//         testDuration: aiConfig.testDurationMinutes || 30
//       };
//     }

//     return job;
//   }

//   /**
//    * 📝 CANDIDATURE (avec protection anti-doublon + image upload)
//    */
//   @Post(':id/apply')
//   @UseInterceptors(FileInterceptor('resume'))
//   async apply(
//     @Param('id') id: string,
//     @Body() data: CreateCandidateDto,
//     @UploadedFile() file: Express.Multer.File
//   ) {
//     if (!file) {
//       throw new BadRequestException('Le CV est obligatoire');
//     }

//     const allowedMimeTypes = [
//       'application/pdf',
//       'application/msword',
//       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
//     ];

//     if (!allowedMimeTypes.includes(file.mimetype)) {
//       throw new BadRequestException('Format de fichier non supporté. Utilisez PDF, DOC ou DOCX.');
//     }

//     if (file.size > 5 * 1024 * 1024) {
//       throw new BadRequestException('Le fichier est trop volumineux. Taille maximale : 5MB.');
//     }

//     // ===================================
//     // 🔒 PROTECTION ANTI-DOUBLON
//     // ===================================
//     const existingCandidate = await this.prisma.candidate.findFirst({
//       where: {
//         email: data.email,
//         jobOfferId: id
//       },
//       select: {
//         id: true,
//         status: true,
//         canRetake: true,
//         firstName: true,
//         createdAt: true,
//         autoDisqualified: true
//       }
//     });

//     if (existingCandidate) {
//       if (existingCandidate.canRetake) {
//         console.log(`♻️ Candidat ${existingCandidate.id} autorisé à retenter`);

//         await this.prisma.candidate.delete({
//           where: { id: existingCandidate.id }
//         });
//       } else {
//         const statusMsg = existingCandidate.autoDisqualified
//           ? 'Disqualifié pour activité suspecte'
//           : this.translateStatus(existingCandidate.status);

//         throw new BadRequestException(
//           `Bonjour ${existingCandidate.firstName}, vous avez déjà postulé à cette offre le ${existingCandidate.createdAt.toLocaleDateString('fr-FR')}. ` +
//           `Statut actuel : ${statusMsg}. ` +
//           `Consultez votre email pour plus d'informations.`
//         );
//       }
//     }

//     // ===================================
//     // 🔍 RÉCUPÉRATION OFFRE
//     // ===================================
//     const jobOffer = await this.prisma.jobOffer.findUnique({
//       where: { id },
//       select: {
//         processingMode: true,
//         aiConfig: true,
//         status: true,
//         title: true,
//         questionsGeneratedByAI: true
//       }
//     });

//     if (!jobOffer) {
//       throw new NotFoundException('Offre introuvable');
//     }

//     if (jobOffer.status !== 'PUBLISHED') {
//       throw new BadRequestException('Cette offre n\'est plus disponible');
//     }

//     console.log('═══════════════════════════════════════════════');
//     console.log('🔍 DIAGNOSTIC CANDIDATURE');
//     console.log('Job:', jobOffer.title);
//     console.log('Mode:', jobOffer.processingMode);
//     console.log('Questions IA:', jobOffer.questionsGeneratedByAI);
//     console.log('═══════════════════════════════════════════════');

//     // ===================================
//     // MODE IA → PRÉ-SCREENING
//     // ===================================
//     if (jobOffer.processingMode === 'AI_ASSISTED') {
//       try {
//         const preScreening = await this.recruitmentAIService.preScreenCV(file, id);

//         const resumeUrl = await this.cloudinaryService.uploadPublicFile(file, 'resumes');

//         const candidate = await this.recruitmentService.applyToJob(id, {
//           ...data,
//           resumeUrl
//         });

//         await this.prisma.candidate.update({
//           where: { id: candidate.id },
//           data: {
//             cvScore: preScreening.cvScore,
//             cvAnalysis: {
//               cvScore: preScreening.cvScore,
//               strengths: preScreening.strengths,
//               weaknesses: preScreening.weaknesses,
//               reasoning: preScreening.reasoning
//             },
//             cvAnalyzedAt: new Date(),
//             status: preScreening.isEligible ? 'EN_ATTENTE_TEST' : 'REFUSE'
//           }
//         });

//         // Générer questions si besoin
//         if (preScreening.isEligible) {
//           const existingQuestions = await this.prisma.jobOfferTestQuestion.count({
//             where: { jobOfferId: id }
//           });

//           if (existingQuestions === 0) {
//             console.log('🤖 Génération automatique des questions...');

//             try {
//               const pdfExtraction = this.recruitmentAIService['pdfExtraction'];
//               const parsedCV = await pdfExtraction.extractAndParseCV(file.buffer);

//               await this.recruitmentAIService.generateTestQuestions(id, parsedCV);
//             } catch (genError) {
//               console.error('❌ Échec génération questions:', genError);
//             }
//           }
//         }

//         if (!preScreening.isEligible) {
//           return {
//             success: true,
//             candidateId: candidate.id,
//             message: `Merci ${data.firstName} pour votre candidature. Malheureusement, votre profil ne correspond pas aux critères minimum requis.`,
//             isEligible: false,
//             shouldTakeTest: false,
//             cvScore: preScreening.cvScore,
//             maxScore: 35,
//             reasoning: preScreening.reasoning
//           };
//         }

//         return {
//           success: true,
//           candidateId: candidate.id,
//           jobTitle: jobOffer.title,
//           message: `Félicitations ${data.firstName} ! Passez maintenant le test technique.`,
//           isEligible: true,
//           shouldTakeTest: true,
//           testUrl: `/jobs/${id}/test/${candidate.id}`,
//           cvScore: preScreening.cvScore,
//           maxScore: 35,
//           strengths: preScreening.strengths
//         };

//       } catch (error) {
//         console.error('❌ Erreur pré-screening:', error);

//         const resumeUrl = await this.cloudinaryService.uploadPublicFile(file, 'resumes');
//         const candidate = await this.recruitmentService.applyToJob(id, { ...data, resumeUrl });

//         await this.prisma.candidate.update({
//           where: { id: candidate.id },
//           data: { status: 'EN_ATTENTE_ANALYSE' }
//         });

//         return {
//           success: true,
//           candidateId: candidate.id,
//           message: 'Candidature reçue ! Analyse manuelle en cours.',
//           shouldTakeTest: false
//         };
//       }
//     }

//     // ===================================
//     // MODE MANUEL
//     // ===================================
//     const resumeUrl = await this.cloudinaryService.uploadPublicFile(file, 'resumes');
//     const candidate = await this.recruitmentService.applyToJob(id, { ...data, resumeUrl });

//     return {
//       success: true,
//       message: `Candidature envoyée avec succès pour ${jobOffer.title} !`,
//       candidateId: candidate.id,
//       shouldTakeTest: false
//     };
//   }

//   /**
//    * 📝 RÉCUPÉRER QUESTIONS DE TEST
//    */
//   @Get(':jobId/test-questions')
//   async getTestQuestions(@Param('jobId') jobId: string) {
//     const questions = await this.prisma.jobOfferTestQuestion.findMany({
//       where: { jobOfferId: jobId },
//       orderBy: { order: 'asc' },
//       select: {
//         id: true,
//         question: true,
//         questionType: true,
//         options: true,
//         points: true,
//         order: true
//       }
//     });

//     if (questions.length === 0) {
//       throw new NotFoundException('Aucun test disponible');
//     }

//     const jobOffer = await this.prisma.jobOffer.findUnique({
//       where: { id: jobId },
//       select: { aiConfig: true, title: true }
//     });

//     const config = (jobOffer?.aiConfig as any) || {};

//     return {
//       questions,
//       config: {
//         duration: config.testDurationMinutes || 30,
//         totalPoints: questions.reduce((sum, q) => sum + q.points, 0),
//         maxTabSwitches: MAX_TAB_SWITCHES
//       },
//       jobTitle: jobOffer?.title
//     };
//   }

//   /**
//    * ✅ SOUMETTRE TEST (avec disqualification auto si 5+ changements)
//    */
//   @Post(':jobId/candidates/:candidateId/submit-test')
//   async submitTest(
//     @Param('jobId') jobId: string,
//     @Param('candidateId') candidateId: string,
//     @Body() data: {
//       answers: Record<string, string>;
//       tabSwitchCount?: number;
//       testDuration?: number;
//     }
//   ) {
//     const candidate = await this.prisma.candidate.findFirst({
//       where: {
//         id: candidateId,
//         jobOfferId: jobId
//       }
//     });

//     if (!candidate) {
//       throw new NotFoundException('Candidat introuvable');
//     }

//     if (candidate.testCompletedAt) {
//       throw new BadRequestException('Vous avez déjà soumis ce test');
//     }

//     // 🔒 VÉRIFICATION ANTI-TRICHE
//     const tabSwitches = data.tabSwitchCount || 0;
//     const isDisqualified = tabSwitches >= MAX_TAB_SWITCHES;

//     if (isDisqualified) {
//       console.log(`🚨 DISQUALIFICATION AUTO : ${tabSwitches} changements d'onglet`);

//       await this.prisma.candidate.update({
//         where: { id: candidateId },
//         data: {
//           tabSwitchCount: tabSwitches,
//           suspiciousActivity: true,
//           autoDisqualified: true,
//           autoDisqualifiedAt: new Date(),
//           status: 'DISQUALIFIED',
//           testCompletedAt: new Date()
//         }
//       });

//       return {
//         success: false,
//         disqualified: true,
//         message: `Vous avez été disqualifié pour activité suspecte (${tabSwitches} changements d'onglet détectés). Maximum autorisé : ${MAX_TAB_SWITCHES - 1}.`,
//         tabSwitches,
//         maxAllowed: MAX_TAB_SWITCHES - 1
//       };
//     }

//     try {
//       // Enregistrer réponses
//       for (const [questionId, selectedOption] of Object.entries(data.answers)) {
//         await this.prisma.candidateTestAnswer.upsert({
//           where: {
//             candidateId_questionId: {
//               candidateId,
//               questionId
//             }
//           },
//           create: {
//             candidateId,
//             questionId,
//             selectedOption
//           },
//           update: {
//             selectedOption
//           }
//         });
//       }

//       await this.prisma.candidate.update({
//         where: { id: candidateId },
//         data: {
//           tabSwitchCount: tabSwitches,
//           suspiciousActivity: tabSwitches > 3,
//           testDuration: data.testDuration,
//           testCompletedAt: new Date()
//         }
//       });

//       console.log(`✅ Test soumis : ${tabSwitches} changements d'onglet (seuil: ${MAX_TAB_SWITCHES})`);

//       const grading = await this.recruitmentAIService.gradeTest(candidateId);
//       const finalResult = await this.recruitmentAIService.calculateFinalScore(candidateId);

//       return {
//         success: true,
//         message: 'Test complété avec succès !',
//         testScore: grading.testScore,
//         maxTestScore: 65,
//         totalScore: finalResult.totalScore,
//         maxTotalScore: 100,
//         breakdown: finalResult.breakdown,
//         tabSwitches,
//         warning: tabSwitches > 3 ? 'Activité suspecte détectée mais non disqualifiante' : null
//       };

//     } catch (error) {
//       console.error('❌ Erreur soumission test:', error);
//       throw new BadRequestException('Erreur lors de l\'enregistrement.');
//     }
//   }

//   /**
//    * 🔗 GÉNÉRER LIENS PARTAGEABLES
//    */
//   @Get(':jobId/share-links')
//   async generateShareLinks(@Param('jobId') jobId: string) {
//     const job = await this.prisma.jobOffer.findUnique({
//       where: { id: jobId },
//       include: {
//         company: {
//           select: { legalName: true, logo: true, careerPageLogo: true }
//         }
//       }
//     });

//     if (!job) {
//       throw new NotFoundException('Offre introuvable');
//     }

//     const baseUrl = process.env.FRONTEND_URL || 'https://rh.konza.com';

//     return {
//       success: true,
//       links: {
//         jobUrl: `${baseUrl}/jobs/${jobId}`,
//         companyJobsUrl: `${baseUrl}/company/${job.companyId}/jobs`,
//         portalUrl: job.showOnPortal ? `${baseUrl}/portal/jobs` : null,

//         shareData: {
//           title: `${job.title} - ${job.company.legalName}`,
//           description: job.description.substring(0, 160) + '...',
//           image: job.imageUrl || job.company.careerPageLogo || job.company.logo || `${baseUrl}/og-default.png`,
//           url: `${baseUrl}/jobs/${jobId}`
//         }
//       }
//     };
//   }

//   private translateStatus(status: string): string {
//     const translations: Record<string, string> = {
//       'APPLIED': 'En attente d\'examen',
//       'EN_ATTENTE_TEST': 'En attente du test',
//       'EN_ATTENTE_ANALYSE': 'En cours d\'analyse',
//       'SCREENING': 'Pré-sélection en cours',
//       'INTERVIEW': 'Convoqué en entretien',
//       'OFFER': 'Offre envoyée',
//       'HIRED': 'Recruté',
//       'REJECTED': 'Non retenu',
//       'REFUSE': 'Non retenu',
//       'DISQUALIFIED': 'Disqualifié'
//     };
//     return translations[status] || status;
//   }
// }

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  NotFoundException,
  Req,
  Query,
} from '@nestjs/common';
import {
  FileInterceptor,
  FileFieldsInterceptor,
} from '@nestjs/platform-express';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentAIService } from './recruitment-ai.service';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';

const MAX_TAB_SWITCHES = 3;

@Controller('public/jobs')
export class PublicRecruitmentController {
  constructor(
    private readonly recruitmentService: RecruitmentService,
    private readonly recruitmentAIService: RecruitmentAIService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('portal')
  async getPortalJobs(
    @Query('location') location?: string,
    @Query('type') type?: string,
    @Query('skills') skills?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const where: any = { status: 'PUBLISHED', showOnPortal: true };
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (type) where.type = type;
    if (skills)
      where.requiredSkills = {
        hasSome: skills.split(',').map((s) => s.trim()),
      };

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const jobs = await this.prisma.jobOffer.findMany({
      where,
      include: {
        company: {
          select: {
            id: true,
            slug: true,
            legalName: true,
            logo: true,
            industry: true,
            city: true,
            careerPageLogo: true,
          },
        },
        department: { select: { name: true } },
        _count: { select: { candidates: true } },
      },
      orderBy: [{ isPremium: 'desc' }, { createdAt: 'desc' }],
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    });

    const total = await this.prisma.jobOffer.count({ where });

    return {
      success: true,
      count: jobs.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company.legalName,
        companyId: job.company.id,
        companySlug: job.company.slug || job.company.id,
        companyLogo: job.company.careerPageLogo || job.company.logo,
        industry: job.company.industry,
        location: job.location,
        type: job.type,
        department: job.department?.name,
        imageUrl: job.imageUrl,
        isPremium: job.isPremium,
        salaryRange:
          job.salaryMin && job.salaryMax
            ? `${job.salaryMin.toLocaleString()} - ${job.salaryMax.toLocaleString()} ${job.salaryCurrency}`
            : null,
        requiredSkills: job.requiredSkills,
        candidatesCount: job._count.candidates,
        createdAt: job.createdAt,
      })),
    };
  }

  @Get('companies/all')
  async getAllCompanies() {
    const companies = await this.prisma.company.findMany({
      where: {
        jobOffers: { some: { status: 'PUBLISHED', showOnPortal: true } },
      },
      select: {
        id: true,
        slug: true,
        legalName: true,
        logo: true,
        industry: true,
        city: true,
        careerPageBanner: true,
        careerPageLogo: true,
        careerPageColors: true,
        _count: {
          select: {
            jobOffers: { where: { status: 'PUBLISHED', showOnPortal: true } },
          },
        },
      },
      orderBy: { legalName: 'asc' },
    });

    return {
      success: true,
      companies: companies.map((c) => ({
        id: c.id,
        slug: c.slug || c.id,
        legalName: c.legalName,
        logo: c.logo,
        careerPageLogo: c.careerPageLogo,
        careerPageBanner: c.careerPageBanner,
        careerPageColors: c.careerPageColors,
        industry: c.industry,
        city: c.city,
        jobCount: c._count.jobOffers,
      })),
    };
  }

  @Get('company/:slugOrId')
  async getCompanyJobs(@Param('slugOrId') slugOrId: string) {
    const selectFields = {
      id: true,
      slug: true,
      legalName: true,
      logo: true,
      industry: true,
      city: true,
      careerPageBanner: true,
      careerPageLogo: true,
      careerPageColors: true,
      careerPageAbout: true,
      careerPageValues: true,
      careerPagePhotos: true,
    };

    let company: any = await this.prisma.company.findFirst({
      where: { slug: slugOrId },
      select: selectFields,
    });

    if (!company) {
      company = await this.prisma.company.findUnique({
        where: { id: slugOrId },
        select: selectFields,
      });
    }

    if (!company) throw new NotFoundException('Entreprise introuvable');

    const jobs = await this.prisma.jobOffer.findMany({
      where: { companyId: company.id, status: 'PUBLISHED' },
      include: { department: true, _count: { select: { candidates: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      company: {
        id: company.id,
        slug: company.slug || company.id,
        legalName: company.legalName,
        logo: company.logo,
        industry: company.industry,
        city: company.city,
        careerPageBanner: company.careerPageBanner,
        careerPageLogo: company.careerPageLogo,
        careerPageColors: company.careerPageColors || {
          primary: '#06b6d4',
          secondary: '#0284c7',
          accent: '#06b6d4',
        },
        careerPageAbout: company.careerPageAbout,
        careerPageValues: company.careerPageValues,
        careerPagePhotos: company.careerPagePhotos,
      },
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        location: job.location,
        type: job.type,
        department: job.department?.name,
        salaryRange:
          job.salaryMin && job.salaryMax
            ? `${job.salaryMin.toLocaleString()} - ${job.salaryMax.toLocaleString()} ${job.salaryCurrency}`
            : null,
        candidatesCount: job._count.candidates,
        createdAt: job.createdAt,
      })),
    };
  }

  @Get(':id')
  async getJobDetails(
    @Param('id') id: string,
    @Query('source') source?: string,
    @Req() request?: Request,
  ) {
    const job = await this.recruitmentService.findOnePublicJob(id);
    if (!job) throw new NotFoundException("Cette offre n'existe pas");

    try {
      await this.prisma.jobOfferView.create({
        data: {
          jobOfferId: id,
          ipAddress: request?.ip || 'unknown',
          userAgent: request?.headers['user-agent'] || null,
          source: source || 'direct',
        },
      });
    } catch (e) {
      console.warn('⚠️ View non enregistrée:', (e as Error).message);
    }

    const enriched = {
      ...job,
      company: {
        ...job.company,
        id: job.company?.id || (job as any).companyId,
        slug: job.company?.slug || job.company?.id || (job as any).companyId,
      },
    };

    if (job.processingMode === 'AI_ASSISTED') {
      const testQuestionsCount = await this.prisma.jobOfferTestQuestion.count({
        where: { jobOfferId: id },
      });
      const aiConfig = (job.aiConfig as any) || {};
      return {
        ...enriched,
        hasTest: testQuestionsCount > 0,
        testQuestionsCount,
        testDuration: aiConfig.testDurationMinutes || 10,
      };
    }

    return enriched;
  }

  @Post(':id/apply')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'resume', maxCount: 1 },
      { name: 'additionalDoc', maxCount: 1 },
    ]),
  )
  async apply(
    @Param('id') id: string,
    @Body() data: CreateCandidateDto,
    @UploadedFiles()
    files: {
      resume?: Express.Multer.File[];
      additionalDoc?: Express.Multer.File[];
    },
  ) {
    const file = files?.resume?.[0];
    const additionalDocFile = files?.additionalDoc?.[0];

    if (!file) throw new BadRequestException('Le CV est obligatoire');

    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedMimeTypes.includes(file.mimetype))
      throw new BadRequestException(
        'Format non supporté. PDF, DOC ou DOCX uniquement.',
      );
    if (file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Fichier trop volumineux. Max 5MB.');

    const existingCandidate = await this.prisma.candidate.findFirst({
      where: { email: data.email, jobOfferId: id },
      select: {
        id: true,
        status: true,
        canRetake: true,
        firstName: true,
        createdAt: true,
        autoDisqualified: true,
      },
    });

    if (existingCandidate) {
      if (existingCandidate.canRetake) {
        await this.prisma.candidate.delete({
          where: { id: existingCandidate.id },
        });
      } else {
        const statusMsg = existingCandidate.autoDisqualified
          ? 'Disqualifié pour activité suspecte'
          : this.translateStatus(existingCandidate.status);
        throw new BadRequestException(
          `Bonjour ${existingCandidate.firstName}, vous avez déjà postulé le ${existingCandidate.createdAt.toLocaleDateString('fr-FR')}. Statut : ${statusMsg}.`,
        );
      }
    }

    const jobOffer = await this.prisma.jobOffer.findUnique({
      where: { id },
      select: {
        processingMode: true,
        aiConfig: true,
        status: true,
        title: true,
        questionsGeneratedByAI: true,
        additionalDocumentType: true,
        additionalDocumentLabel: true,
      },
    });

    if (!jobOffer) throw new NotFoundException('Offre introuvable');
    if (jobOffer.status !== 'PUBLISHED')
      throw new BadRequestException("Cette offre n'est plus disponible");

    // ── Vérifier document additionnel requis ──────────────────────────────────
    const requiresAdditionalDoc = !!jobOffer.additionalDocumentType;
    if (requiresAdditionalDoc && !additionalDocFile) {
      const label =
        jobOffer.additionalDocumentLabel || jobOffer.additionalDocumentType;
      throw new BadRequestException(
        `Le document "${label}" est obligatoire pour cette offre.`,
      );
    }

    // ── Upload du document additionnel si présent ─────────────────────────────
    let additionalDocUrl: string | undefined;
    if (additionalDocFile) {
      const allowedAdditionalTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/jpg',
      ];
      if (!allowedAdditionalTypes.includes(additionalDocFile.mimetype))
        throw new BadRequestException(
          'Format du document additionnel non supporté. PDF, DOC, DOCX, JPG ou PNG.',
        );
      if (additionalDocFile.size > 5 * 1024 * 1024)
        throw new BadRequestException(
          'Document additionnel trop volumineux. Max 5MB.',
        );
      additionalDocUrl = await this.cloudinaryService.uploadPublicFile(
        additionalDocFile,
        'additional-docs',
      );
    }

    // ── Traitement selon le mode ──────────────────────────────────────────────
    if (jobOffer.processingMode === 'AI_ASSISTED') {
      try {
        const preScreening = await this.recruitmentAIService.preScreenCV(
          file,
          id,
        );
        const resumeUrl = await this.cloudinaryService.uploadPublicFile(
          file,
          'resumes',
        );
        const candidate = await this.recruitmentService.applyToJob(id, {
          ...data,
          resumeUrl,
        });

        // Sauvegarder le doc additionnel
        if (additionalDocUrl) {
          await this.prisma.candidate.update({
            where: { id: candidate.id },
            data: { additionalDocUrl } as any,
          });
        }

        await this.prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            cvScore: preScreening.cvScore,
            cvAnalysis: {
              cvScore: preScreening.cvScore,
              strengths: preScreening.strengths,
              weaknesses: preScreening.weaknesses,
              reasoning: preScreening.reasoning,
            },
            cvAnalyzedAt: new Date(),
            status: preScreening.isEligible ? 'EN_ATTENTE_TEST' : 'REFUSE',
          },
        });

        if (preScreening.isEligible) {
          const existingQuestions =
            await this.prisma.jobOfferTestQuestion.count({
              where: { jobOfferId: id },
            });
          if (existingQuestions === 0) {
            try {
              const pdfExtraction = this.recruitmentAIService['pdfExtraction'];
              const parsedCV = await pdfExtraction.extractAndParseCV(
                file.buffer,
              );
              await this.recruitmentAIService.generateTestQuestions(
                id,
                parsedCV,
              );
            } catch (genError) {
              console.error('❌ Génération questions échouée:', genError);
            }
          }
        }

        if (!preScreening.isEligible) {
          return {
            success: true,
            candidateId: candidate.id,
            message: `Merci ${data.firstName}, votre profil ne correspond pas aux critères.`,
            isEligible: false,
            shouldTakeTest: false,
            cvScore: preScreening.cvScore,
          };
        }
        return {
          success: true,
          candidateId: candidate.id,
          jobTitle: jobOffer.title,
          message: `Félicitations ${data.firstName} ! Passez le test.`,
          isEligible: true,
          shouldTakeTest: true,
          testUrl: `/jobs/${id}/test/${candidate.id}`,
          cvScore: preScreening.cvScore,
          strengths: preScreening.strengths,
        };
      } catch (error) {
        const resumeUrl = await this.cloudinaryService.uploadPublicFile(
          file,
          'resumes',
        );
        const candidate = await this.recruitmentService.applyToJob(id, {
          ...data,
          resumeUrl,
        });
        if (additionalDocUrl) {
          await this.prisma.candidate.update({
            where: { id: candidate.id },
            data: { additionalDocUrl } as any,
          });
        }
        await this.prisma.candidate.update({
          where: { id: candidate.id },
          data: { status: 'EN_ATTENTE_ANALYSE' },
        });
        return {
          success: true,
          candidateId: candidate.id,
          message: 'Candidature reçue ! Analyse en cours.',
          shouldTakeTest: false,
        };
      }
    }

    // ── Mode MANUAL ───────────────────────────────────────────────────────────
    const resumeUrl = await this.cloudinaryService.uploadPublicFile(
      file,
      'resumes',
    );
    const candidate = await this.recruitmentService.applyToJob(id, {
      ...data,
      resumeUrl,
    });
    if (additionalDocUrl) {
      await this.prisma.candidate.update({
        where: { id: candidate.id },
        data: { additionalDocUrl } as any,
      });
    }
    return {
      success: true,
      message: `Candidature envoyée pour ${jobOffer.title} !`,
      candidateId: candidate.id,
      shouldTakeTest: false,
    };
  }

  @Get(':jobId/test-questions')
  async getTestQuestions(@Param('jobId') jobId: string) {
    const questions = await this.prisma.jobOfferTestQuestion.findMany({
      where: { jobOfferId: jobId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        question: true,
        questionType: true,
        options: true,
        points: true,
        order: true,
      },
    });
    if (questions.length === 0)
      throw new NotFoundException('Aucun test disponible');
    const jobOffer = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      select: { aiConfig: true, title: true },
    });
    const config = (jobOffer?.aiConfig as any) || {};
    return {
      questions,
      config: {
        duration: config.testDurationMinutes || 10,
        totalPoints: questions.reduce((sum, q) => sum + q.points, 0),
        maxTabSwitches: MAX_TAB_SWITCHES,
      },
      jobTitle: jobOffer?.title,
    };
  }

  @Post(':jobId/candidates/:candidateId/submit-test')
  async submitTest(
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
    @Body()
    data: {
      answers: Record<string, string>;
      tabSwitchCount?: number;
      testDuration?: number;
    },
  ) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, jobOfferId: jobId },
    });
    if (!candidate) throw new NotFoundException('Candidat introuvable');
    if (candidate.testCompletedAt)
      throw new BadRequestException('Vous avez déjà soumis ce test');

    const tabSwitches = data.tabSwitchCount || 0;
    if (tabSwitches >= MAX_TAB_SWITCHES) {
      await this.prisma.candidate.update({
        where: { id: candidateId },
        data: {
          tabSwitchCount: tabSwitches,
          suspiciousActivity: true,
          autoDisqualified: true,
          autoDisqualifiedAt: new Date(),
          status: 'DISQUALIFIED',
          testCompletedAt: new Date(),
        },
      });
      return {
        success: false,
        disqualified: true,
        message: `Disqualifié (${tabSwitches} changements). Max : ${MAX_TAB_SWITCHES - 1}.`,
        tabSwitches,
      };
    }

    try {
      for (const [questionId, selectedOption] of Object.entries(data.answers)) {
        await this.prisma.candidateTestAnswer.upsert({
          where: { candidateId_questionId: { candidateId, questionId } },
          create: { candidateId, questionId, selectedOption },
          update: { selectedOption },
        });
      }
      await this.prisma.candidate.update({
        where: { id: candidateId },
        data: {
          tabSwitchCount: tabSwitches,
          suspiciousActivity: tabSwitches > 3,
          testDuration: data.testDuration,
          testCompletedAt: new Date(),
        },
      });
      const grading = await this.recruitmentAIService.gradeTest(candidateId);
      const finalResult =
        await this.recruitmentAIService.calculateFinalScore(candidateId);
      return {
        success: true,
        message: 'Test complété !',
        testScore: grading.testScore,
        totalScore: finalResult.totalScore,
        breakdown: finalResult.breakdown,
        tabSwitches,
      };
    } catch (error) {
      throw new BadRequestException("Erreur lors de l'enregistrement.");
    }
  }

  @Get(':jobId/share-links')
  async generateShareLinks(@Param('jobId') jobId: string) {
    const job = await this.prisma.jobOffer.findUnique({
      where: { id: jobId },
      include: {
        company: {
          select: {
            id: true,
            slug: true,
            legalName: true,
            logo: true,
            careerPageLogo: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Offre introuvable');
    const baseUrl = process.env.FRONTEND_URL || 'https://rh.konza.com';
    const companySlug = job.company.slug || job.company.id;
    return {
      success: true,
      links: {
        jobUrl: `${baseUrl}/jobs/${jobId}`,
        companyJobsUrl: `${baseUrl}/entreprises/${companySlug}`,
        portalUrl: job.showOnPortal ? `${baseUrl}/jobs/portal` : null,
        shareData: {
          title: `${job.title} - ${job.company.legalName}`,
          description: job.description.substring(0, 160) + '...',
          url: `${baseUrl}/jobs/${jobId}`,
        },
      },
    };
  }

  private translateStatus(status: string): string {
    const t: Record<string, string> = {
      APPLIED: 'En attente',
      EN_ATTENTE_TEST: 'En attente du test',
      EN_ATTENTE_ANALYSE: "En cours d'analyse",
      SCREENING: 'Pré-sélection',
      INTERVIEW: 'Convoqué en entretien',
      OFFER: 'Offre envoyée',
      HIRED: 'Recruté',
      REJECTED: 'Non retenu',
      REFUSE: 'Non retenu',
      DISQUALIFIED: 'Disqualifié',
    };
    return t[status] || status;
  }
}
