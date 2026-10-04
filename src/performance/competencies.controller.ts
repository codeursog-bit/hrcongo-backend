// ============================================================================
// 📄 src/performance/competencies.controller.ts — Phase 2 : compétences
// Les routes "statiques" (me, team) sont déclarées avant les routes à :id.
// ============================================================================

import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Query, ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JsonOnlyGuard } from './json-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompetenciesService } from './competencies.service';
import { PERF_HR_ROLES, PERF_MANAGE_ROLES } from './performance-access.service';

@Controller('performance')
@UseGuards(AuthGuard('jwt'), RolesGuard, JsonOnlyGuard)
export class CompetenciesController {
  constructor(private readonly svc: CompetenciesService) {}

  // ── Employé : mes compétences ─────────────────────────────────────────────
  @Get('competencies/me')
  getMine(@Request() req, @Query('companyId') companyId?: string) {
    return this.svc.getMyCompetencies(req.user.userId, companyId);
  }

  // ── Vue équipe (RH : tous · manager : son département) ────────────────────
  @Get('competencies/team')
  @Roles(...PERF_MANAGE_ROLES)
  team(@Request() req, @Query('companyId') companyId?: string) {
    return this.svc.teamOverview(req.user.userId, companyId);
  }

  // ── Un employé (lui-même, son supérieur, RH) ──────────────────────────────
  @Get('competencies/employee/:employeeId')
  employee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.svc.getEmployeeCompetencies(employeeId, req.user.userId, companyId);
  }

  @Post('competencies/employee/:employeeId/assess')
  @Roles(...PERF_MANAGE_ROLES)
  assess(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.svc.assess(employeeId, body ?? {}, req.user.userId, companyId);
  }

  // ── Référentiel ───────────────────────────────────────────────────────────
  @Get('competencies')
  @Roles(...PERF_MANAGE_ROLES)
  list(@Request() req, @Query('companyId') companyId?: string) {
    return this.svc.listCompetencies(req.user.userId, companyId);
  }

  @Post('competencies')
  @Roles(...PERF_HR_ROLES)
  create(@Body() body: any, @Request() req, @Query('companyId') companyId?: string) {
    return this.svc.createCompetency(body, req.user.userId, companyId);
  }

  @Patch('competencies/:id')
  @Roles(...PERF_HR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.svc.updateCompetency(id, body, req.user.userId, companyId);
  }

  @Delete('competencies/:id')
  @Roles(...PERF_HR_ROLES)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.svc.deleteCompetency(id, req.user.userId, companyId);
  }

  // ── Fiches de poste ───────────────────────────────────────────────────────
  @Get('job-profiles')
  @Roles(...PERF_MANAGE_ROLES)
  listProfiles(@Request() req, @Query('companyId') companyId?: string) {
    return this.svc.listJobProfiles(req.user.userId, companyId);
  }

  @Post('job-profiles')
  @Roles(...PERF_HR_ROLES)
  createProfile(@Body() body: any, @Request() req, @Query('companyId') companyId?: string) {
    return this.svc.createJobProfile(body, req.user.userId, companyId);
  }

  @Patch('job-profiles/:id')
  @Roles(...PERF_HR_ROLES)
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.svc.updateJobProfile(id, body, req.user.userId, companyId);
  }

  @Delete('job-profiles/:id')
  @Roles(...PERF_HR_ROLES)
  removeProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.svc.deleteJobProfile(id, req.user.userId, companyId);
  }

  @Post('job-profiles/:id/generate-template')
  @Roles(...PERF_HR_ROLES)
  generateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.svc.generateTemplate(id, req.user.userId, companyId);
  }
}