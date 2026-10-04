// ============================================================================
// 📄 src/performance/career.controller.ts — Phase 3 : carrière + développement
// Routes statiques (me, proposals) déclarées avant les routes paramétrées.
// ============================================================================

import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Query, ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JsonOnlyGuard } from './json-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CareerService } from './career.service';
import { DevelopmentService } from './development.service';
import { PERF_HR_ROLES, PERF_MANAGE_ROLES } from './performance-access.service';

@Controller('performance')
@UseGuards(AuthGuard('jwt'), RolesGuard, JsonOnlyGuard)
export class CareerController {
  constructor(
    private readonly career: CareerService,
    private readonly dev: DevelopmentService,
  ) {}

  // ═══ CARRIÈRE ═════════════════════════════════════════════════════════════
  @Get('career/me')
  myTimeline(@Request() req, @Query('companyId') companyId?: string) {
    return this.career.getMyTimeline(req.user.userId, companyId);
  }

  @Get('career/proposals')
  @Roles(...PERF_MANAGE_ROLES)
  listProposals(@Request() req, @Query('status') status?: string, @Query('companyId') companyId?: string) {
    return this.career.listProposals(req.user.userId, status, companyId);
  }

  @Post('career/proposals')
  @Roles(...PERF_MANAGE_ROLES)
  createProposal(@Body() body: any, @Request() req, @Query('companyId') companyId?: string) {
    return this.career.createProposal(body ?? {}, req.user.userId, companyId);
  }

  @Patch('career/proposals/:id/decision')
  @Roles(...PERF_HR_ROLES)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.career.decide(id, body ?? {}, req.user.userId, companyId);
  }

  @Patch('career/proposals/:id/cancel')
  @Roles(...PERF_MANAGE_ROLES)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.career.cancelProposal(id, req.user.userId, companyId);
  }

  @Get('career/employee/:employeeId')
  timeline(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.career.getEmployeeTimeline(employeeId, req.user.userId, companyId);
  }

  @Post('career/employee/:employeeId/events')
  @Roles(...PERF_HR_ROLES)
  createEvent(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.career.createEvent(employeeId, body ?? {}, req.user.userId, companyId);
  }

  @Delete('career/events/:id')
  @Roles(...PERF_HR_ROLES)
  deleteEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.career.deleteEvent(id, req.user.userId, companyId);
  }

  // ═══ PLAN DE DÉVELOPPEMENT ════════════════════════════════════════════════
  @Get('development/me')
  myPlans(@Request() req, @Query('companyId') companyId?: string) {
    return this.dev.getMyPlans(req.user.userId, companyId);
  }

  @Get('development/employee/:employeeId')
  employeePlans(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.dev.getEmployeePlans(employeeId, req.user.userId, companyId);
  }

  @Post('development/employee/:employeeId/plans')
  @Roles(...PERF_MANAGE_ROLES)
  createPlan(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.dev.createPlan(employeeId, body ?? {}, req.user.userId, companyId);
  }

  @Patch('development/plans/:id')
  @Roles(...PERF_MANAGE_ROLES)
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.dev.updatePlan(id, body ?? {}, req.user.userId, companyId);
  }

  @Delete('development/plans/:id')
  @Roles(...PERF_MANAGE_ROLES)
  deletePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.dev.deletePlan(id, req.user.userId, companyId);
  }

  @Post('development/plans/:id/actions')
  @Roles(...PERF_MANAGE_ROLES)
  addAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.dev.addAction(id, body ?? {}, req.user.userId, companyId);
  }

  // Employé (statut + note) ou supérieur (tout) : contrôlé dans le service
  @Patch('development/actions/:id')
  updateAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.dev.updateAction(id, body ?? {}, req.user.userId, companyId);
  }

  @Delete('development/actions/:id')
  @Roles(...PERF_MANAGE_ROLES)
  deleteAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.dev.deleteAction(id, req.user.userId, companyId);
  }
}