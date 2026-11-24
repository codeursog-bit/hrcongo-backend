// src/recruitment/recruitment-pro.controller.ts
// Routes « Recrutement Pro » — même garde et mêmes rôles que RecruitmentController.
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RecruitmentProService } from './recruitment-pro.service';

@Controller('recruitment')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN', 'HR_MANAGER', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE')
export class RecruitmentProController {
  constructor(private readonly pro: RecruitmentProService) {}

  // ── Tableau de bord, pipeline, offres ──────────────────────────────────────
  @Get('dashboard')
  dashboard(@Request() req: any) {
    return this.pro.dashboard(req.user.userId);
  }

  @Get('pipeline')
  pipeline(
    @Query('jobId') jobId: string | undefined,
    @Query('q') q: string | undefined,
    @Query('source') source: string | undefined,
    @Query('talentPool') talentPool: string | undefined,
    @Request() req: any,
  ) {
    return this.pro.pipeline(req.user.userId, { jobId, q, source, talentPool });
  }

  @Get('jobs-overview')
  jobsOverview(@Request() req: any) {
    return this.pro.jobsOverview(req.user.userId);
  }

  @Post('jobs/:id/close')
  @HttpCode(HttpStatus.OK)
  closeJob(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.closeJob(id, body, req.user.userId);
  }

  @Post('jobs/:id/reopen')
  @HttpCode(HttpStatus.OK)
  reopenJob(@Param('id') id: string, @Request() req: any) {
    return this.pro.reopenJob(id, req.user.userId);
  }

  // ── Candidat : fiche 360°, déplacement, notes, profil ──────────────────────
  @Get('candidates/:id/fiche')
  fiche(@Param('id') id: string, @Request() req: any) {
    return this.pro.fiche(id, req.user.userId);
  }

  @Patch('candidates/:id/move')
  move(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.move(id, body, req.user.userId);
  }

  @Post('candidates/:id/notes')
  @HttpCode(HttpStatus.OK)
  addNote(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.addNote(id, body, req.user.userId);
  }

  @Patch('candidates/:id/profile')
  updateProfile(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.updateProfile(id, body, req.user.userId);
  }

  @Post('candidates/:id/reapply')
  @HttpCode(HttpStatus.OK)
  reapply(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.reapply(id, body, req.user.userId);
  }

  // ── Entretiens ─────────────────────────────────────────────────────────────
  @Get('interviews/agenda')
  agenda(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req: any,
  ) {
    return this.pro.agenda(req.user.userId, from, to);
  }

  @Post('candidates/:id/interviews')
  @HttpCode(HttpStatus.OK)
  scheduleInterview(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.scheduleInterview(id, body, req.user.userId);
  }

  @Patch('interviews/:id')
  updateInterview(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.updateInterview(id, body, req.user.userId);
  }

  @Post('interviews/:id/feedback')
  @HttpCode(HttpStatus.OK)
  feedback(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.submitFeedback(id, body, req.user.userId);
  }

  // ── E-mails ────────────────────────────────────────────────────────────────
  @Get('email-templates')
  templates(@Request() req: any) {
    return this.pro.listTemplates(req.user.userId);
  }

  @Put('email-templates/:id')
  saveTemplate(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.saveTemplate(id, body, req.user.userId);
  }

  @Delete('email-templates/:id')
  resetTemplate(@Param('id') id: string, @Request() req: any) {
    return this.pro.resetTemplate(id, req.user.userId);
  }

  // ── Actions groupées ───────────────────────────────────────────────────────
  @Post('bulk/move')
  @HttpCode(HttpStatus.OK)
  bulkMove(@Body() body: any, @Request() req: any) {
    return this.pro.bulkMove(body, req.user.userId);
  }

  @Get('candidates/:id/email-preview')
  emailPreview(@Param('id') id: string, @Query('template') template: string, @Request() req: any) {
    return this.pro.previewEmail(id, template, req.user.userId);
  }

  @Post('candidates/:id/email')
  @HttpCode(HttpStatus.OK)
  sendEmail(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.sendEmail(id, body, req.user.userId);
  }

  // ── Offre d'embauche ───────────────────────────────────────────────────────
  @Post('candidates/:id/offer')
  @HttpCode(HttpStatus.OK)
  makeOffer(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.makeOffer(id, body, req.user.userId);
  }

  @Post('candidates/:id/offer-response')
  @HttpCode(HttpStatus.OK)
  offerResponse(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.pro.offerResponse(id, body, req.user.userId);
  }
}