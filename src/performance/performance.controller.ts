// ============================================================================
// 📄 src/performance/performance.controller.ts — SÉCURISÉ + cycles/fiche
// Les anciennes routes sont conservées (mêmes chemins) ; seuls les contrôles
// d'accès changent. Le détail des règles est dans PerformanceAccessService.
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JsonOnlyGuard } from './json-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PerformanceService } from './performance.service';
import { ReviewCyclesService } from './review-cycles.service';
import { ReviewSheetService } from './review-sheet.service';
import { PERF_HR_ROLES, PERF_MANAGE_ROLES } from './performance-access.service';

@Controller('performance')
@UseGuards(AuthGuard('jwt'), RolesGuard, JsonOnlyGuard)
export class PerformanceController {
  constructor(
    private readonly performanceService: PerformanceService,
    private readonly cycles: ReviewCyclesService,
    private readonly sheet: ReviewSheetService,
  ) {}

  // ── Mon espace (tout utilisateur lié à un employé) ────────────────────────
  @Get('me')
  getMe(@Request() req, @Query('companyId') companyId?: string) {
    return this.sheet.getMe(req.user.userId, companyId);
  }

  // ── Grilles de critères (intégrées) ───────────────────────────────────────
  @Get('criteria/templates')
  @Roles(...PERF_MANAGE_ROLES)
  getCriteriaTemplates() {
    return this.performanceService.getCriteriaTemplates();
  }

  @Get('criteria/templates/:key')
  @Roles(...PERF_MANAGE_ROLES)
  getCriteriaTemplate(@Param('key') key: string) {
    return this.performanceService.getCriteriaTemplate(key);
  }

  // ── Modèles de fiche par poste ────────────────────────────────────────────
  @Get('templates')
  @Roles(...PERF_MANAGE_ROLES)
  listTemplates(@Request() req, @Query('companyId') companyId?: string) {
    return this.cycles.listTemplates(req.user.userId, companyId);
  }

  @Post('templates')
  @Roles(...PERF_HR_ROLES)
  createTemplate(
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.cycles.createTemplate(body, req.user.userId, companyId);
  }

  @Patch('templates/:id')
  @Roles(...PERF_HR_ROLES)
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.cycles.updateTemplate(id, body, req.user.userId, companyId);
  }

  @Delete('templates/:id')
  @Roles(...PERF_HR_ROLES)
  deleteTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.cycles.deleteTemplate(id, req.user.userId, companyId);
  }

  // ── Cycles d'évaluation ───────────────────────────────────────────────────
  @Get('cycles')
  @Roles(...PERF_MANAGE_ROLES)
  listCycles(@Request() req, @Query('companyId') companyId?: string) {
    return this.cycles.listCycles(req.user.userId, companyId);
  }

  @Post('cycles')
  @Roles(...PERF_HR_ROLES)
  createCycle(
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.cycles.createCycle(body, req.user.userId, companyId);
  }

  @Get('cycles/:id')
  @Roles(...PERF_MANAGE_ROLES)
  getCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.cycles.getCycle(id, req.user.userId, companyId);
  }

  // RH : toute l'entreprise · MANAGER : son département (filtré dans le service)
  @Post('cycles/:id/launch')
  @Roles(...PERF_MANAGE_ROLES)
  launchCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.cycles.launchCycle(id, body ?? {}, req.user.userId, companyId);
  }

  @Patch('cycles/:id/close')
  @Roles(...PERF_HR_ROLES)
  closeCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.cycles.closeCycle(id, req.user.userId, companyId);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  @Get('stats')
  @Roles(...PERF_MANAGE_ROLES)
  getStats(@Request() req) {
    return this.performanceService.getStats(req.user.userId);
  }

  // ── Fiche d'évaluation (accès contrôlé dans le service : RH / manager / employé) ─
  @Get('reviews/:id/sheet')
  getSheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.sheet.getSheet(id, req.user.userId, companyId);
  }

  @Patch('reviews/:id/sheet')
  @Roles(...PERF_MANAGE_ROLES)
  saveSheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.sheet.saveSheet(id, body ?? {}, req.user.userId, companyId);
  }

  @Patch('reviews/:id/self-assessment')
  saveSelfAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.sheet.saveSelfAssessment(id, body ?? {}, req.user.userId, companyId);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────
  @Post('reviews')
  @Roles(...PERF_MANAGE_ROLES)
  createReview(@Body() data: any, @Request() req) {
    return this.performanceService.createReview(data, req.user.userId);
  }

  @Get('reviews')
  getReviews(@Request() req, @Query('companyId') companyId?: string) {
    return this.performanceService.findAllReviews(req.user.userId, companyId);
  }

  @Get('reviews/employee/:employeeId')
  getEmployeeHistory(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Request() req,
  ) {
    return this.performanceService.findEmployeeHistory(
      employeeId,
      req.user.userId,
    );
  }

  @Get('reviews/:id')
  getOneReview(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.performanceService.findOneReview(id, req.user.userId);
  }

  @Patch('reviews/:id')
  @Roles(...PERF_MANAGE_ROLES)
  updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
    @Request() req,
  ) {
    return this.performanceService.updateReview(id, data, req.user.userId);
  }

  @Patch('reviews/:id/submit')
  @Roles(...PERF_MANAGE_ROLES)
  submitReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.performanceService.submitReview(id, req.user.userId, companyId);
  }

  // Accusé de réception : l'identité "employé concerné" est vérifiée dans le service
  @Patch('reviews/:id/acknowledge')
  acknowledgeReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { comment?: string },
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.performanceService.acknowledgeReview(
      id,
      body ?? {},
      req.user.userId,
      companyId,
    );
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  @Post('goals')
  @Roles(...PERF_MANAGE_ROLES)
  createGoal(@Body() data: any, @Request() req) {
    return this.performanceService.createGoal(data, req.user.userId);
  }

  @Get('goals')
  getGoals(@Request() req, @Query('companyId') companyId?: string) {
    return this.performanceService.findAllCompanyGoals(
      req.user.userId,
      companyId,
    );
  }

  @Get('goals/:employeeId')
  findGoals(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Request() req,
  ) {
    return this.performanceService.findAllGoals(employeeId, req.user.userId);
  }

  @Patch('goals/:goalId/progress')
  updateGoalProgress(
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body('progress') progress: number,
    @Request() req,
  ) {
    return this.performanceService.updateGoalProgress(
      goalId,
      progress,
      req.user.userId,
    );
  }

  @Patch('goals/key-results/:keyResultId')
  updateKeyResult(
    @Param('keyResultId', ParseUUIDPipe) keyResultId: string,
    @Body('currentValue') currentValue: number,
    @Request() req,
  ) {
    return this.performanceService.updateKeyResultValue(
      keyResultId,
      currentValue,
      req.user.userId,
    );
  }
}