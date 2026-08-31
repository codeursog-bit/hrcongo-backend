// // src/recruitment/recruitment.controller.ts
// // VERSION COMPLÈTE — remplace l'existant intégralement

// // src/recruitment/recruitment.controller.ts

// import {
//   Controller, Get, Post, Put, Delete, Body, Param,
//   UseGuards, Request, Patch, UseInterceptors, UploadedFile,
//   BadRequestException, Query
// } from '@nestjs/common';
// import { AuthGuard } from '@nestjs/passport';
// import { FileInterceptor } from '@nestjs/platform-express';
// import { RecruitmentService } from './recruitment.service';
// import { RecruitmentAIService } from './recruitment-ai.service';
// import { CreateJobDto } from './dto/create-job.dto';
// import { CreateQuestionDto } from './dto/create-question.dto';
// import { CloudinaryService } from '../cloudinary/cloudinary.service';
// import { PrismaService } from '../prisma/prisma.service';
// import { AISuggestion } from '@prisma/client';
// import { JobExpirationService } from './job-expiration.service';
// import { MailService } from '../mail/mail.service';

// @Controller('recruitment')
// @UseGuards(AuthGuard('jwt'))
// export class RecruitmentController {
//   constructor(
//     private readonly recruitmentService: RecruitmentService,
//     private readonly recruitmentAIService: RecruitmentAIService,
//     private readonly cloudinaryService: CloudinaryService,
//     private readonly prisma: PrismaService,
//     private readonly jobExpirationService: JobExpirationService,
//     private readonly mailService: MailService,
//   ) {}

//   // ══════════════════════════════════════════════════════════
//   // 📋 JOB OFFERS — CRUD
//   // ══════════════════════════════════════════════════════════

//   @Post('jobs')
//   @UseInterceptors(FileInterceptor('image'))
//   async createJob(
//     @Body() data: CreateJobDto,
//     @Request() req,
//     @UploadedFile() image?: Express.Multer.File
//   ) {
//     let imageUrl: string | null = null;
//     if (image) {
//       const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
//       if (!allowedMimes.includes(image.mimetype))
//         throw new BadRequestException('Format d\'image non supporté (JPG, PNG, WEBP)');
//       if (image.size > 2 * 1024 * 1024)
//         throw new BadRequestException('Image trop volumineuse (max 2MB)');
//       imageUrl = await this.cloudinaryService.uploadPublicFile(image, 'job-offers');
//     }
//     return this.recruitmentService.createJobOffer(
//       { ...data, imageUrl: imageUrl || undefined },
//       req.user.userId
//     );
//   }

//   @Get('jobs')
//   findAllJobs(@Request() req) {
//     return this.recruitmentService.findAllJobOffers(req.user.userId);
//   }

//   @Get('jobs/:id')
//   findOneJob(@Param('id') id: string, @Request() req) {
//     return this.recruitmentService.findOneJobOffer(id, req.user.userId);
//   }

//   @Put('jobs/:id')
//   @UseInterceptors(FileInterceptor('image'))
//   async updateJob(
//     @Param('id') id: string,
//     @Body() data: CreateJobDto & { removeImage?: string },
//     @Request() req,
//     @UploadedFile() image?: Express.Multer.File
//   ) {
//     const existingJob = await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     let imageUrl: string | undefined;
//     let shouldRemoveImage = false;

//     if (image) {
//       const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
//       if (!allowedMimes.includes(image.mimetype))
//         throw new BadRequestException('Format d\'image non supporté');
//       if (image.size > 2 * 1024 * 1024)
//         throw new BadRequestException('Image trop volumineuse (max 2MB)');
//       imageUrl = await this.cloudinaryService.uploadPublicFile(image, 'job-offers');
//       if (existingJob.imageUrl) {
//         try { await this.cloudinaryService.deleteFile(existingJob.imageUrl); } catch (_) { /* ignore */ }
//       }
//     } else if (data.removeImage === 'true') {
//       shouldRemoveImage = true;
//       imageUrl = null as any;
//       if (existingJob.imageUrl) {
//         try { await this.cloudinaryService.deleteFile(existingJob.imageUrl); } catch (_) { /* ignore */ }
//       }
//     }

//     if (data.expirationDate) {
//       const d = new Date(data.expirationDate);
//       if (isNaN(d.getTime())) throw new BadRequestException('Format de date invalide');
//       if (d <= new Date()) throw new BadRequestException('La date d\'expiration doit être dans le futur');
//     }

//     const updateData: any = { ...data };
//     delete updateData.removeImage;
//     if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
//     else if (shouldRemoveImage) updateData.imageUrl = null;

//     return this.recruitmentService.updateJobOffer(id, updateData, req.user.userId);
//   }

//   @Delete('jobs/:id')
//   async deleteJob(@Param('id') id: string, @Request() req) {
//     const job = await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     if (job.imageUrl) {
//       try { await this.cloudinaryService.deleteFile(job.imageUrl); } catch (_) { /* ignore */ }
//     }
//     return this.recruitmentService.deleteJobOffer(id, req.user.userId);
//   }

//   @Get('jobs/:id/share-links')
//   async getShareLinks(@Param('id') id: string, @Request() req) {
//     const job = await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     const company = await this.prisma.company.findUnique({
//       where: { id: job.companyId },
//       select: { legalName: true, logo: true, careerPageLogo: true }
//     });
//     const baseUrl = process.env.FRONTEND_URL || 'https://rh.konza.com';
//     return {
//       success: true,
//       links: {
//         jobUrl: `${baseUrl}/jobs/${job.id}`,
//         companyJobsUrl: `${baseUrl}/company/${job.companyId}/jobs`,
//         portalUrl: job.showOnPortal ? `${baseUrl}/portal/jobs` : null,
//         facebookShare: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(baseUrl + '/jobs/' + job.id)}`,
//         linkedinShare: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(baseUrl + '/jobs/' + job.id)}`,
//         twitterShare: `https://twitter.com/intent/tweet?url=${encodeURIComponent(baseUrl + '/jobs/' + job.id)}&text=${encodeURIComponent(job.title)}`,
//         whatsappShare: `https://wa.me/?text=${encodeURIComponent(job.title + ' - ' + baseUrl + '/jobs/' + job.id)}`,
//         shareData: {
//           title: `${job.title} - ${company?.legalName || 'Offre d\'emploi'}`,
//           description: job.description.substring(0, 160) + '...',
//           image: job.imageUrl || company?.careerPageLogo || company?.logo || `${baseUrl}/og-default.png`
//         }
//       }
//     };
//   }

//   @Put('jobs/:id/toggle-portal')
//   async togglePortal(@Param('id') id: string, @Request() req) {
//     const job = await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     const updated = await this.prisma.jobOffer.update({
//       where: { id },
//       data: { showOnPortal: !job.showOnPortal }
//     });
//     return {
//       success: true,
//       message: updated.showOnPortal ? '✅ Offre publiée sur le portail !' : '❌ Offre retirée du portail',
//       showOnPortal: updated.showOnPortal
//     };
//   }

//   @Put('jobs/:id/toggle-premium')
//   async togglePremium(
//     @Param('id') id: string,
//     @Body('duration') duration: number = 30,
//     @Request() req
//   ) {
//     const job = await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     if (!job.isPremium) {
//       const expiresAt = new Date();
//       expiresAt.setDate(expiresAt.getDate() + duration);
//       const updated = await this.prisma.jobOffer.update({
//         where: { id },
//         data: { isPremium: true, premiumExpiresAt: expiresAt, premiumPaidAmount: 0 }
//       });
//       return { success: true, message: `💎 Offre promue PREMIUM pour ${duration} jours`, isPremium: true, expiresAt: updated.premiumExpiresAt };
//     } else {
//       await this.prisma.jobOffer.update({ where: { id }, data: { isPremium: false, premiumExpiresAt: null } });
//       return { success: true, message: 'Offre retirée du mode PREMIUM', isPremium: false };
//     }
//   }

//   @Get('jobs/:id/analytics')
//   async getJobAnalytics(@Param('id') id: string, @Request() req) {
//     await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     const views = await this.prisma.jobOfferView.findMany({
//       where: { jobOfferId: id },
//       orderBy: { createdAt: 'desc' },
//       take: 500
//     });
//     const sourceStats = views.reduce((acc, v) => {
//       const s = v.source || 'direct';
//       acc[s] = (acc[s] || 0) + 1;
//       return acc;
//     }, {} as Record<string, number>);
//     const candidatesCount = await this.prisma.candidate.count({ where: { jobOfferId: id } });
//     return {
//       success: true,
//       totalViews: views.length,
//       totalCandidates: candidatesCount,
//       conversionRate: views.length > 0 ? Math.round((candidatesCount / views.length) * 100) : 0,
//       sourceBreakdown: sourceStats,
//       topSources: Object.entries(sourceStats).sort(([, a], [, b]) => b - a).slice(0, 5).map(([source, count]) => ({ source, count })),
//       recentViews: views.slice(0, 20).map(v => ({ source: v.source, date: v.createdAt }))
//     };
//   }

//   @Put('jobs/:id/extend-expiration')
//   async extendJobExpiration(
//     @Param('id') id: string,
//     @Body() data: { expirationDate: string },
//     @Request() req
//   ) {
//     await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     const newDate = new Date(data.expirationDate);
//     if (newDate <= new Date()) throw new BadRequestException('La nouvelle date doit être dans le futur');
//     const updated = await this.jobExpirationService.extendJobExpiration(id, newDate);
//     return {
//       success: true,
//       message: `✅ Offre prolongée jusqu'au ${newDate.toLocaleDateString('fr-FR')}`,
//       job: { id: updated.id, title: updated.title, expirationDate: updated.expirationDate, isExpired: updated.isExpired, status: updated.status }
//     };
//   }

//   @Get('jobs/stats/expirations')
//   async getExpirationStats(@Request() req) {
//     const user = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new BadRequestException('Accès refusé');
//     const now = new Date();
//     const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
//     const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
//     const [expired, expiringSoon, expiringThisMonth, active] = await Promise.all([
//       this.prisma.jobOffer.count({ where: { companyId: user.companyId, status: 'PUBLISHED', expirationDate: { lte: now } } }),
//       this.prisma.jobOffer.count({ where: { companyId: user.companyId, status: 'PUBLISHED', expirationDate: { gt: now, lte: in7Days } } }),
//       this.prisma.jobOffer.count({ where: { companyId: user.companyId, status: 'PUBLISHED', expirationDate: { gt: in7Days, lte: in30Days } } }),
//       this.prisma.jobOffer.count({ where: { companyId: user.companyId, status: 'PUBLISHED', OR: [{ expirationDate: null }, { expirationDate: { gt: in30Days } }] } }),
//     ]);
//     return { success: true, stats: { expired, expiringSoon, expiringThisMonth, active } };
//   }

//   // ══════════════════════════════════════════════════════════
//   // 👥 CANDIDATES
//   // ══════════════════════════════════════════════════════════

//   @Get('candidates')
//   getAllCandidates(@Request() req) {
//     return this.recruitmentService.findAllCandidates(req.user.userId);
//   }

//   @Get('candidates/:id')
//   getOneCandidate(@Param('id') id: string, @Request() req) {
//     return this.recruitmentService.findOneCandidate(id, req.user.userId);
//   }

//   // ✅ FIX — transmet maintenant aussi les notes au service
//   @Patch('candidates/:id/status')
//   updateStatus(
//     @Param('id') id: string,
//     @Body('status') status: string,
//     @Body('notes') notes?: string,
//   ) {
//     return this.recruitmentService.updateCandidateStatus(id, status, notes);
//   }

//   @Post('candidates/:id/hire')
//   hireCandidate(@Param('id') id: string, @Request() req) {
//     return this.recruitmentService.convertToEmployee(id, req.user.userId);
//   }

//   @Put('candidates/:id/allow-retake')
//   async allowRetake(@Param('id') id: string, @Body('reason') reason: string, @Request() req) {
//     const candidate = await this.recruitmentService.findOneCandidate(id, req.user.userId);
//     const updated = await this.prisma.candidate.update({
//       where: { id },
//       data: { canRetake: true, retakeReason: reason || 'Autorisé par le recruteur', retakeGrantedBy: req.user.userId, retakeGrantedAt: new Date() }
//     });
//     return { success: true, message: `✅ ${candidate.firstName} ${candidate.lastName} peut re-postuler.`, candidate: updated };
//   }

//   @Put('candidates/:id/revoke-retake')
//   async revokeRetake(@Param('id') id: string, @Request() req) {
//     await this.recruitmentService.findOneCandidate(id, req.user.userId);
//     const updated = await this.prisma.candidate.update({
//       where: { id },
//       data: { canRetake: false, retakeReason: null, retakeGrantedBy: null, retakeGrantedAt: null }
//     });
//     return { success: true, message: 'Autorisation de retake annulée', candidate: updated };
//   }

//   @Patch('candidates/:id/hr-decision')
//   async makeHRDecision(@Param('id') id: string, @Body() data: { hrDecision: string; hrNotes?: string }, @Request() req) {
//     const validDecisions: AISuggestion[] = ['RETENU', 'MOYENNE', 'SECONDE_CHANCE', 'REFUS'];
//     if (!validDecisions.includes(data.hrDecision as AISuggestion))
//       throw new BadRequestException('hrDecision invalide');
//     return this.prisma.candidate.update({
//       where: { id },
//       data: { hrDecision: data.hrDecision as AISuggestion, hrNotes: data.hrNotes || null, hrDecidedBy: req.user.userId, hrDecidedAt: new Date() }
//     });
//   }

//   // ══════════════════════════════════════════════════════════
//   // 🗓️ ENTRETIENS
//   // ══════════════════════════════════════════════════════════

//   @Get('interviews')
//   async getInterviews(@Request() req) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: req.user.userId },
//       select: { companyId: true }
//     });
//     if (!user?.companyId) throw new BadRequestException('Accès refusé');

//     const candidates = await this.prisma.candidate.findMany({
//       where: {
//         status: 'INTERVIEW',
//         jobOffer: { companyId: user.companyId }
//       },
//       include: {
//         jobOffer: {
//           select: {
//             id: true,
//             title: true,
//             processingMode: true,
//             department: { select: { name: true } }
//           }
//         }
//       },
//       orderBy: [
//         { interviewDate: 'asc' },
//         { createdAt: 'desc' }
//       ]
//     });

//     return { success: true, count: candidates.length, candidates };
//   }

//   @Patch('candidates/:id/schedule-interview')
//   async scheduleInterview(
//     @Param('id') id: string,
//     @Body() data: { interviewDate?: string; interviewNotes?: string },
//     @Request() req
//   ) {
//     const candidate = await this.recruitmentService.findOneCandidate(id, req.user.userId);

//     const updated = await this.prisma.candidate.update({
//       where: { id },
//       data: {
//         status: 'INTERVIEW',
//         interviewDate: data.interviewDate ? new Date(data.interviewDate) : null,
//         interviewNotes: data.interviewNotes || null,
//         interviewScheduledBy: req.user.userId,
//         interviewScheduledAt: new Date()
//       },
//       include: {
//         jobOffer: { select: { title: true } }
//       }
//     });

//     this.mailService.sendInterviewInvitation(
//       { firstName: candidate.firstName, lastName: candidate.lastName, email: candidate.email },
//       {
//         jobTitle: (updated.jobOffer as any).title,
//         interviewDate: data.interviewDate ? new Date(data.interviewDate) : null,
//         interviewNotes: data.interviewNotes
//       }
//     ).catch(e => console.warn('⚠️ Email entretien non envoyé:', e));

//     return {
//       success: true,
//       message: `✅ ${candidate.firstName} convoqué(e) en entretien`,
//       candidate: updated
//     };
//   }

//   @Patch('candidates/:id/hire-after-interview')
//   async hireAfterInterview(@Param('id') id: string, @Request() req) {
//     const candidate = await this.recruitmentService.findOneCandidate(id, req.user.userId);

//     await this.prisma.candidate.update({
//       where: { id },
//       data: { status: 'HIRED' }
//     });

//     this.mailService.sendHireNotification(
//       { firstName: candidate.firstName, email: candidate.email },
//       { title: (candidate.jobOffer as any).title, companyName: '' }
//     ).catch(e => console.warn('⚠️ Email embauche non envoyé:', e));

//     return {
//       success: true,
//       message: `🎉 ${candidate.firstName} ${candidate.lastName} embauché(e) !`,
//       candidateForEmployee: {
//         id: candidate.id,
//         firstName: candidate.firstName,
//         lastName: candidate.lastName,
//         email: candidate.email,
//         phone: candidate.phone,
//         jobOfferId: (candidate.jobOffer as any).id,
//         jobTitle: (candidate.jobOffer as any).title,
//         departmentId: (candidate.jobOffer as any).departmentId,
//       }
//     };
//   }

//   @Patch('candidates/:id/reject-after-interview')
//   async rejectAfterInterview(
//     @Param('id') id: string,
//     @Body() data: { reason?: string },
//     @Request() req
//   ) {
//     const candidate = await this.recruitmentService.findOneCandidate(id, req.user.userId);

//     await this.prisma.candidate.update({
//       where: { id },
//       data: {
//         status: 'REJECTED',
//         interviewNotes: data.reason
//           ? `[Refus post-entretien] ${data.reason}`
//           : (candidate as any).interviewNotes
//       }
//     });

//     this.mailService.sendRejectionAfterInterview(
//       { firstName: candidate.firstName, email: candidate.email },
//       { title: (candidate.jobOffer as any).title, companyName: '' },
//       data.reason
//     ).catch(e => console.warn('⚠️ Email refus entretien non envoyé:', e));

//     return {
//       success: true,
//       message: `Candidat ${candidate.firstName} refusé après entretien`
//     };
//   }

//   @Post('candidates/:id/convert-to-employee')
//   async convertToEmployee(@Param('id') id: string, @Request() req) {
//     return this.recruitmentService.convertToEmployee(id, req.user.userId);
//   }

//   // ══════════════════════════════════════════════════════════
//   // 🤖 IA
//   // ══════════════════════════════════════════════════════════

//   @Post('jobs/:id/generate-test-questions')
//   async generateTestQuestions(@Param('id') id: string, @Request() req) {
//     await this.recruitmentService.findOneJobOffer(id, req.user.userId);
//     const existingCount = await this.prisma.jobOfferTestQuestion.count({ where: { jobOfferId: id } });
//     if (existingCount > 0) {
//       return {
//         success: false,
//         message: `Cette offre possède déjà ${existingCount} question(s). Supprimez-les d'abord pour régénérer.`,
//         existingCount
//       };
//     }
//     const result = await this.recruitmentAIService.generateTestQuestions(id);
//     return { success: true, message: `🤖 ${result.count} questions générées par l'IA !`, questions: result.questions };
//   }

//   @Post('jobs/:jobId/questions')
//   createQuestion(@Param('jobId') jobId: string, @Body() data: CreateQuestionDto) {
//     return this.prisma.jobOfferTestQuestion.create({
//       data: {
//         jobOfferId: jobId,
//         question: data.question,
//         questionType: data.questionType,
//         points: data.points,
//         order: data.order,
//         options: data.options,
//         correctAnswers: data.correctAnswers
//       }
//     });
//   }

//   @Post('candidates/:id/grade-test')
//   gradeTest(@Param('id') id: string) {
//     return this.recruitmentAIService.gradeTest(id);
//   }

//   @Post('candidates/:id/calculate-score')
//   calculateScore(@Param('id') id: string) {
//     return this.recruitmentAIService.calculateFinalScore(id);
//   }

//   @Get('ai-stats')
//   async getAIStats(@Request() req) {
//     const user = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { companyId: true } });
//     if (!user?.companyId) return { success: false, message: 'Accès refusé' };
//     const stats = await this.recruitmentAIService.getAIStats(user.companyId);
//     return { success: true, stats };
//   }

//   // ══════════════════════════════════════════════════════════
//   // 🎨 PAGE CARRIÈRE
//   // ══════════════════════════════════════════════════════════

//   @Get('company-career-page')
//   async getCareerPageSettings(@Request() req) {
//     const user = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new BadRequestException('Accès refusé');
//     const company = await this.prisma.company.findUnique({
//       where: { id: user.companyId },
//       select: { careerPageBanner: true, careerPageLogo: true, careerPageColors: true, careerPageAbout: true, careerPageValues: true, careerPagePhotos: true }
//     });
//     return { success: true, settings: company };
//   }

//   @Post('company-career-page')
//   @UseInterceptors(FileInterceptor('banner'))
//   async updateCareerPageSettings(
//     @Request() req,
//     @Body() data: { colors?: string; about?: string; values?: string },
//     @UploadedFile() banner?: Express.Multer.File
//   ) {
//     const user = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new BadRequestException('Accès refusé');
//     let bannerUrl: string | undefined;
//     if (banner) {
//       if (!['image/jpeg', 'image/png', 'image/webp'].includes(banner.mimetype)) throw new BadRequestException('Format d\'image non supporté');
//       if (banner.size > 5 * 1024 * 1024) throw new BadRequestException('Banner trop volumineux (max 5MB)');
//       bannerUrl = await this.cloudinaryService.uploadPublicFile(banner, 'career-pages');
//     }
//     const updateData: any = {};
//     if (bannerUrl) updateData.careerPageBanner = bannerUrl;
//     if (data.colors) updateData.careerPageColors = JSON.parse(data.colors);
//     if (data.about) updateData.careerPageAbout = data.about;
//     if (data.values) updateData.careerPageValues = JSON.parse(data.values);
//     const updated = await this.prisma.company.update({ where: { id: user.companyId }, data: updateData });
//     return { success: true, message: '✅ Page carrière mise à jour !', settings: { careerPageBanner: updated.careerPageBanner, careerPageColors: updated.careerPageColors, careerPageAbout: updated.careerPageAbout, careerPageValues: updated.careerPageValues } };
//   }

//   @Post('company-career-page/photos')
//   @UseInterceptors(FileInterceptor('photo'))
//   async addCareerPagePhoto(@Request() req, @UploadedFile() photo: Express.Multer.File) {
//     const user = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new BadRequestException('Accès refusé');
//     if (!photo) throw new BadRequestException('Photo requise');
//     if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimetype)) throw new BadRequestException('Format non supporté');
//     if (photo.size > 3 * 1024 * 1024) throw new BadRequestException('Photo trop volumineuse (max 3MB)');
//     const photoUrl = await this.cloudinaryService.uploadPublicFile(photo, 'career-pages/photos');
//     const company = await this.prisma.company.findUnique({ where: { id: user.companyId }, select: { careerPagePhotos: true } });
//     const photos = [...(company?.careerPagePhotos || []), photoUrl];
//     await this.prisma.company.update({ where: { id: user.companyId }, data: { careerPagePhotos: photos } });
//     return { success: true, message: '✅ Photo ajoutée !', photoUrl, totalPhotos: photos.length };
//   }

//   @Delete('company-career-page/photos/:index')
//   async removeCareerPagePhoto(@Request() req, @Param('index') index: string) {
//     const user = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new BadRequestException('Accès refusé');
//     const company = await this.prisma.company.findUnique({ where: { id: user.companyId }, select: { careerPagePhotos: true } });
//     const photos = company?.careerPagePhotos || [];
//     const photoIndex = parseInt(index);
//     if (photoIndex < 0 || photoIndex >= photos.length) throw new BadRequestException('Index invalide');
//     photos.splice(photoIndex, 1);
//     await this.prisma.company.update({ where: { id: user.companyId }, data: { careerPagePhotos: photos } });
//     return { success: true, message: '✅ Photo supprimée !', totalPhotos: photos.length };
//   }
// }

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Patch,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentAIService } from './recruitment-ai.service';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { AISuggestion } from '@prisma/client';
import { JobExpirationService } from './job-expiration.service';
import { MailService } from '../mail/mail.service';

@Controller('recruitment')
@UseGuards(AuthGuard('jwt'))
export class RecruitmentController {
  constructor(
    private readonly recruitmentService: RecruitmentService,
    private readonly recruitmentAIService: RecruitmentAIService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly prisma: PrismaService,
    private readonly jobExpirationService: JobExpirationService,
    private readonly mailService: MailService,
  ) {}

  @Post('jobs')
  @UseInterceptors(FileInterceptor('image'))
  async createJob(
    @Body() data: CreateJobDto,
    @Request() req: any,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    let imageUrl: string | null = null;
    if (image) {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimes.includes(image.mimetype))
        throw new BadRequestException(
          "Format d'image non supporté (JPG, PNG, WEBP)",
        );
      if (image.size > 2 * 1024 * 1024)
        throw new BadRequestException('Image trop volumineuse (max 2MB)');
      imageUrl = await this.cloudinaryService.uploadPublicFile(
        image,
        'job-offers',
      );
    }
    return this.recruitmentService.createJobOffer(
      { ...data, imageUrl: imageUrl || undefined },
      req.user.userId,
    );
  }

  @Get('jobs')
  findAllJobs(@Request() req: any) {
    return this.recruitmentService.findAllJobOffers(req.user.userId);
  }

  @Get('jobs/:id')
  findOneJob(@Param('id') id: string, @Request() req: any) {
    return this.recruitmentService.findOneJobOffer(id, req.user.userId);
  }

  @Put('jobs/:id')
  @UseInterceptors(FileInterceptor('image'))
  async updateJob(
    @Param('id') id: string,
    @Body() data: CreateJobDto & { removeImage?: string },
    @Request() req: any,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    const existingJob = await this.recruitmentService.findOneJobOffer(
      id,
      req.user.userId,
    );
    let imageUrl: string | undefined;
    let shouldRemoveImage = false;

    if (image) {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimes.includes(image.mimetype))
        throw new BadRequestException('Format image non supporté');
      if (image.size > 2 * 1024 * 1024)
        throw new BadRequestException('Image trop volumineuse (max 2MB)');
      imageUrl = await this.cloudinaryService.uploadPublicFile(
        image,
        'job-offers',
      );
      if (existingJob.imageUrl) {
        try {
          await this.cloudinaryService.deleteFile(existingJob.imageUrl);
        } catch (_) {}
      }
    } else if (data.removeImage === 'true') {
      shouldRemoveImage = true;
      imageUrl = null as any;
      if (existingJob.imageUrl) {
        try {
          await this.cloudinaryService.deleteFile(existingJob.imageUrl);
        } catch (_) {}
      }
    }

    if (data.expirationDate) {
      const d = new Date(data.expirationDate);
      if (isNaN(d.getTime()))
        throw new BadRequestException('Format de date invalide');
      if (d <= new Date())
        throw new BadRequestException(
          "La date d'expiration doit être dans le futur",
        );
    }

    const updateData: any = { ...data };
    delete updateData.removeImage;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    else if (shouldRemoveImage) updateData.imageUrl = null;

    return this.recruitmentService.updateJobOffer(
      id,
      updateData,
      req.user.userId,
    );
  }

  @Delete('jobs/:id')
  async deleteJob(@Param('id') id: string, @Request() req: any) {
    const job = await this.recruitmentService.findOneJobOffer(
      id,
      req.user.userId,
    );
    if (job.imageUrl) {
      try {
        await this.cloudinaryService.deleteFile(job.imageUrl);
      } catch (_) {}
    }
    return this.recruitmentService.deleteJobOffer(id, req.user.userId);
  }

  @Get('jobs/:id/share-links')
  async getShareLinks(@Param('id') id: string, @Request() req: any) {
    const job = await this.recruitmentService.findOneJobOffer(
      id,
      req.user.userId,
    );
    const company = await this.prisma.company.findUnique({
      where: { id: job.companyId },
      select: { legalName: true, slug: true, logo: true, careerPageLogo: true },
    });
    const baseUrl = process.env.FRONTEND_URL || 'https://rh.konza.com';
    const companySlug = company?.slug || job.companyId;
    return {
      success: true,
      links: {
        jobUrl: `${baseUrl}/jobs/${job.id}`,
        companyJobsUrl: `${baseUrl}/entreprises/${companySlug}`,
        portalUrl: job.showOnPortal ? `${baseUrl}/jobs/portal` : null,
        facebookShare: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${baseUrl}/jobs/${job.id}`)}`,
        linkedinShare: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${baseUrl}/jobs/${job.id}`)}`,
        twitterShare: `https://twitter.com/intent/tweet?url=${encodeURIComponent(`${baseUrl}/jobs/${job.id}`)}&text=${encodeURIComponent(job.title)}`,
        whatsappShare: `https://wa.me/?text=${encodeURIComponent(`${job.title} - ${baseUrl}/jobs/${job.id}`)}`,
        shareData: {
          title: `${job.title} - ${company?.legalName || "Offre d'emploi"}`,
          description: job.description.substring(0, 160) + '...',
          image:
            job.imageUrl ||
            company?.careerPageLogo ||
            company?.logo ||
            `${baseUrl}/og-default.png`,
        },
      },
    };
  }

  @Put('jobs/:id/toggle-portal')
  async togglePortal(@Param('id') id: string, @Request() req: any) {
    const job = await this.recruitmentService.findOneJobOffer(
      id,
      req.user.userId,
    );
    const updated = await this.prisma.jobOffer.update({
      where: { id },
      data: { showOnPortal: !job.showOnPortal },
    });
    return {
      success: true,
      message: updated.showOnPortal
        ? '✅ Offre publiée sur le portail !'
        : '❌ Offre retirée du portail',
      showOnPortal: updated.showOnPortal,
    };
  }

  @Put('jobs/:id/toggle-premium')
  async togglePremium(
    @Param('id') id: string,
    @Body('duration') duration = 30,
    @Request() req: any,
  ) {
    const job = await this.recruitmentService.findOneJobOffer(
      id,
      req.user.userId,
    );
    if (!job.isPremium) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + duration);
      const updated = await this.prisma.jobOffer.update({
        where: { id },
        data: {
          isPremium: true,
          premiumExpiresAt: expiresAt,
          premiumPaidAmount: 0,
        },
      });
      return {
        success: true,
        message: `💎 Offre promue PREMIUM pour ${duration} jours`,
        isPremium: true,
        expiresAt: updated.premiumExpiresAt,
      };
    } else {
      await this.prisma.jobOffer.update({
        where: { id },
        data: { isPremium: false, premiumExpiresAt: null },
      });
      return {
        success: true,
        message: 'Offre retirée du mode PREMIUM',
        isPremium: false,
      };
    }
  }

  @Get('jobs/:id/analytics')
  async getJobAnalytics(@Param('id') id: string, @Request() req: any) {
    await this.recruitmentService.findOneJobOffer(id, req.user.userId);
    const views = await this.prisma.jobOfferView.findMany({
      where: { jobOfferId: id },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const sourceStats = views.reduce(
      (acc, v) => {
        const s = v.source || 'direct';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const candidatesCount = await this.prisma.candidate.count({
      where: { jobOfferId: id },
    });
    return {
      success: true,
      totalViews: views.length,
      totalCandidates: candidatesCount,
      conversionRate:
        views.length > 0
          ? Math.round((candidatesCount / views.length) * 100)
          : 0,
      sourceBreakdown: sourceStats,
      topSources: Object.entries(sourceStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([source, count]) => ({ source, count })),
      recentViews: views
        .slice(0, 20)
        .map((v) => ({ source: v.source, date: v.createdAt })),
    };
  }

  @Put('jobs/:id/extend-expiration')
  async extendJobExpiration(
    @Param('id') id: string,
    @Body() data: { expirationDate: string },
    @Request() req: any,
  ) {
    await this.recruitmentService.findOneJobOffer(id, req.user.userId);
    const newDate = new Date(data.expirationDate);
    if (newDate <= new Date())
      throw new BadRequestException('La nouvelle date doit être dans le futur');
    const updated = await this.jobExpirationService.extendJobExpiration(
      id,
      newDate,
    );
    return {
      success: true,
      message: `✅ Offre prolongée jusqu'au ${newDate.toLocaleDateString('fr-FR')}`,
      job: {
        id: updated.id,
        title: updated.title,
        expirationDate: updated.expirationDate,
        isExpired: updated.isExpired,
        status: updated.status,
      },
    };
  }

  @Get('jobs/stats/expirations')
  async getExpirationStats(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [expired, expiringSoon, expiringThisMonth, active] =
      await Promise.all([
        this.prisma.jobOffer.count({
          where: {
            companyId: user.companyId,
            status: 'PUBLISHED',
            expirationDate: { lte: now },
          },
        }),
        this.prisma.jobOffer.count({
          where: {
            companyId: user.companyId,
            status: 'PUBLISHED',
            expirationDate: { gt: now, lte: in7Days },
          },
        }),
        this.prisma.jobOffer.count({
          where: {
            companyId: user.companyId,
            status: 'PUBLISHED',
            expirationDate: { gt: in7Days, lte: in30Days },
          },
        }),
        this.prisma.jobOffer.count({
          where: {
            companyId: user.companyId,
            status: 'PUBLISHED',
            OR: [
              { expirationDate: null },
              { expirationDate: { gt: in30Days } },
            ],
          },
        }),
      ]);
    return {
      success: true,
      stats: { expired, expiringSoon, expiringThisMonth, active },
    };
  }

  @Get('candidates')
  getAllCandidates(@Request() req: any) {
    return this.recruitmentService.findAllCandidates(req.user.userId);
  }

  @Get('candidates/:id')
  getOneCandidate(@Param('id') id: string, @Request() req: any) {
    return this.recruitmentService.findOneCandidate(id, req.user.userId);
  }

  @Patch('candidates/:id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('notes') notes?: string,
  ) {
    return this.recruitmentService.updateCandidateStatus(id, status, notes);
  }

  @Post('candidates/:id/hire')
  hireCandidate(@Param('id') id: string, @Request() req: any) {
    return this.recruitmentService.convertToEmployee(id, req.user.userId);
  }

  @Put('candidates/:id/allow-retake')
  async allowRetake(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    const candidate = await this.recruitmentService.findOneCandidate(
      id,
      req.user.userId,
    );
    const updated = await this.prisma.candidate.update({
      where: { id },
      data: {
        canRetake: true,
        retakeReason: reason || 'Autorisé par le recruteur',
        retakeGrantedBy: req.user.userId,
        retakeGrantedAt: new Date(),
      },
    });
    return {
      success: true,
      message: `✅ ${candidate.firstName} ${candidate.lastName} peut re-postuler.`,
      candidate: updated,
    };
  }

  @Put('candidates/:id/revoke-retake')
  async revokeRetake(@Param('id') id: string, @Request() req: any) {
    await this.recruitmentService.findOneCandidate(id, req.user.userId);
    const updated = await this.prisma.candidate.update({
      where: { id },
      data: {
        canRetake: false,
        retakeReason: null,
        retakeGrantedBy: null,
        retakeGrantedAt: null,
      },
    });
    return {
      success: true,
      message: 'Autorisation de retake annulée',
      candidate: updated,
    };
  }

  @Patch('candidates/:id/hr-decision')
  async makeHRDecision(
    @Param('id') id: string,
    @Body() data: { hrDecision: string; hrNotes?: string },
    @Request() req: any,
  ) {
    const validDecisions: AISuggestion[] = [
      'RETENU',
      'MOYENNE',
      'SECONDE_CHANCE',
      'REFUS',
    ];
    if (!validDecisions.includes(data.hrDecision as AISuggestion))
      throw new BadRequestException('hrDecision invalide');
    return this.prisma.candidate.update({
      where: { id },
      data: {
        hrDecision: data.hrDecision as AISuggestion,
        hrNotes: data.hrNotes || null,
        hrDecidedBy: req.user.userId,
        hrDecidedAt: new Date(),
      },
    });
  }

  @Get('interviews')
  async getInterviews(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');
    const candidates = await this.prisma.candidate.findMany({
      where: { status: 'INTERVIEW', jobOffer: { companyId: user.companyId } },
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
      orderBy: [{ interviewDate: 'asc' }, { createdAt: 'desc' }],
    });
    return { success: true, count: candidates.length, candidates };
  }

  @Patch('candidates/:id/schedule-interview')
  async scheduleInterview(
    @Param('id') id: string,
    @Body() data: { interviewDate?: string; interviewNotes?: string },
    @Request() req: any,
  ) {
    const candidate = await this.recruitmentService.findOneCandidate(
      id,
      req.user.userId,
    );
    const updated = await this.prisma.candidate.update({
      where: { id },
      data: {
        status: 'INTERVIEW',
        interviewDate: data.interviewDate ? new Date(data.interviewDate) : null,
        interviewNotes: data.interviewNotes || null,
        interviewScheduledBy: req.user.userId,
        interviewScheduledAt: new Date(),
      },
      include: { jobOffer: { select: { title: true } } },
    });
    this.mailService
      .sendInterviewInvitation(
        {
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email: candidate.email,
        },
        {
          jobTitle: (updated.jobOffer as any).title,
          interviewDate: data.interviewDate
            ? new Date(data.interviewDate)
            : null,
          interviewNotes: data.interviewNotes,
        },
      )
      .catch((e) => console.warn('⚠️ Email entretien non envoyé:', e));
    return {
      success: true,
      message: `✅ ${candidate.firstName} convoqué(e) en entretien`,
      candidate: updated,
    };
  }

  @Patch('candidates/:id/hire-after-interview')
  async hireAfterInterview(@Param('id') id: string, @Request() req: any) {
    const candidate = await this.recruitmentService.findOneCandidate(
      id,
      req.user.userId,
    );
    await this.prisma.candidate.update({
      where: { id },
      data: { status: 'HIRED' },
    });
    this.mailService
      .sendHireNotification(
        { firstName: candidate.firstName, email: candidate.email },
        { title: (candidate.jobOffer as any).title, companyName: '' },
      )
      .catch((e) => console.warn('⚠️ Email embauche non envoyé:', e));
    return {
      success: true,
      message: `🎉 ${candidate.firstName} ${candidate.lastName} embauché(e) !`,
      candidateForEmployee: {
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone: candidate.phone,
        jobOfferId: (candidate.jobOffer as any).id,
        jobTitle: (candidate.jobOffer as any).title,
        departmentId: (candidate.jobOffer as any).departmentId,
      },
    };
  }

  @Patch('candidates/:id/reject-after-interview')
  async rejectAfterInterview(
    @Param('id') id: string,
    @Body() data: { reason?: string },
    @Request() req: any,
  ) {
    const candidate = await this.recruitmentService.findOneCandidate(
      id,
      req.user.userId,
    );
    await this.prisma.candidate.update({
      where: { id },
      data: {
        status: 'REJECTED',
        interviewNotes: data.reason
          ? `[Refus post-entretien] ${data.reason}`
          : (candidate as any).interviewNotes,
      },
    });
    this.mailService
      .sendRejectionAfterInterview(
        { firstName: candidate.firstName, email: candidate.email },
        { title: (candidate.jobOffer as any).title, companyName: '' },
        data.reason,
      )
      .catch((e) => console.warn('⚠️ Email refus entretien non envoyé:', e));
    return {
      success: true,
      message: `Candidat ${candidate.firstName} refusé après entretien`,
    };
  }

  @Post('candidates/:id/convert-to-employee')
  async convertToEmployee(@Param('id') id: string, @Request() req: any) {
    return this.recruitmentService.convertToEmployee(id, req.user.userId);
  }

  @Post('jobs/:id/generate-test-questions')
  async generateTestQuestions(@Param('id') id: string, @Request() req: any) {
    await this.recruitmentService.findOneJobOffer(id, req.user.userId);
    const existingCount = await this.prisma.jobOfferTestQuestion.count({
      where: { jobOfferId: id },
    });
    if (existingCount > 0) {
      return {
        success: false,
        message: `Cette offre possède déjà ${existingCount} question(s). Supprimez-les d'abord.`,
        existingCount,
      };
    }
    const result = await this.recruitmentAIService.generateTestQuestions(id);
    return {
      success: true,
      message: `🤖 ${result.count} questions générées !`,
      questions: result.questions,
    };
  }

  @Post('jobs/:jobId/questions')
  createQuestion(
    @Param('jobId') jobId: string,
    @Body() data: CreateQuestionDto,
  ) {
    return this.prisma.jobOfferTestQuestion.create({
      data: {
        jobOfferId: jobId,
        question: data.question,
        questionType: data.questionType,
        points: data.points,
        order: data.order,
        options: data.options,
        correctAnswers: data.correctAnswers,
      },
    });
  }

  @Post('candidates/:id/grade-test')
  gradeTest(@Param('id') id: string) {
    return this.recruitmentAIService.gradeTest(id);
  }

  @Post('candidates/:id/calculate-score')
  calculateScore(@Param('id') id: string) {
    return this.recruitmentAIService.calculateFinalScore(id);
  }

  @Get('ai-stats')
  async getAIStats(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) return { success: false, message: 'Accès refusé' };
    const stats = await this.recruitmentAIService.getAIStats(user.companyId);
    return { success: true, stats };
  }

  @Get('company-career-page')
  async getCareerPageSettings(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        legalName: true,
        careerPageBanner: true,
        careerPageLogo: true,
        careerPageColors: true,
        careerPageAbout: true,
        careerPageValues: true,
        careerPagePhotos: true,
      },
    });
    return {
      success: true,
      settings: company,
      companyName: company?.legalName,
    };
  }

  @Post('company-career-page')
  @UseInterceptors(FileInterceptor('banner'))
  async updateCareerPageSettings(
    @Request() req: any,
    @Body()
    data: { colors?: string; about?: string; values?: string; logo?: string },
    @UploadedFile() banner?: Express.Multer.File,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');

    let bannerUrl: string | undefined;
    if (banner) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(banner.mimetype))
        throw new BadRequestException("Format d'image non supporté");
      if (banner.size > 5 * 1024 * 1024)
        throw new BadRequestException('Banner trop volumineux (max 5MB)');
      bannerUrl = await this.cloudinaryService.uploadPublicFile(
        banner,
        'career-pages',
      );
    }

    const updateData: any = {};
    if (bannerUrl) updateData.careerPageBanner = bannerUrl;
    if (data.colors) updateData.careerPageColors = JSON.parse(data.colors);
    if (data.about !== undefined) updateData.careerPageAbout = data.about;
    if (data.values) updateData.careerPageValues = JSON.parse(data.values);

    const updated = await this.prisma.company.update({
      where: { id: user.companyId },
      data: updateData,
    });
    return {
      success: true,
      message: '✅ Page carrière mise à jour !',
      settings: {
        careerPageBanner: updated.careerPageBanner,
        careerPageColors: updated.careerPageColors,
        careerPageAbout: updated.careerPageAbout,
        careerPageValues: updated.careerPageValues,
      },
    };
  }

  @Post('company-career-page/photos')
  @UseInterceptors(FileInterceptor('photo'))
  async addCareerPagePhoto(
    @Request() req: any,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');
    if (!photo) throw new BadRequestException('Photo requise');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimetype))
      throw new BadRequestException('Format non supporté');
    if (photo.size > 3 * 1024 * 1024)
      throw new BadRequestException('Photo trop volumineuse (max 3MB)');
    const photoUrl = await this.cloudinaryService.uploadPublicFile(
      photo,
      'career-pages/photos',
    );
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { careerPagePhotos: true },
    });
    const photos = [...(company?.careerPagePhotos || []), photoUrl];
    await this.prisma.company.update({
      where: { id: user.companyId },
      data: { careerPagePhotos: photos },
    });
    return {
      success: true,
      message: '✅ Photo ajoutée !',
      photoUrl,
      totalPhotos: photos.length,
    };
  }

  @Delete('company-career-page/photos/:index')
  async removeCareerPagePhoto(
    @Request() req: any,
    @Param('index') index: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { careerPagePhotos: true },
    });
    const photos = company?.careerPagePhotos || [];
    const photoIndex = parseInt(index);
    if (photoIndex < 0 || photoIndex >= photos.length)
      throw new BadRequestException('Index invalide');
    photos.splice(photoIndex, 1);
    await this.prisma.company.update({
      where: { id: user.companyId },
      data: { careerPagePhotos: photos },
    });
    return {
      success: true,
      message: '✅ Photo supprimée !',
      totalPhotos: photos.length,
    };
  }
}
