// ============================================================================
// 📄 src/performance/performance.controller.ts — VERSION AMÉLIORÉE
// Conserve tous les anciens endpoints + ajoute les nouveaux
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PerformanceService } from './performance.service';

@Controller('performance')
@UseGuards(AuthGuard('jwt'))
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  // ── Grilles de critères ───────────────────────────────────────────────────

  @Get('criteria/templates')
  getCriteriaTemplates() {
    return this.performanceService.getCriteriaTemplates();
  }

  @Get('criteria/templates/:key')
  getCriteriaTemplate(@Param('key') key: string) {
    return this.performanceService.getCriteriaTemplate(key);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  getStats(@Request() req) {
    return this.performanceService.getStats(req.user.userId);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  @Post('reviews')
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
  updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
    @Request() req,
  ) {
    return this.performanceService.updateReview(id, data, req.user.userId);
  }

  @Patch('reviews/:id/submit')
  submitReview(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.performanceService.submitReview(id, req.user.userId);
  }

  @Patch('reviews/:id/acknowledge')
  acknowledgeReview(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.performanceService.acknowledgeReview(id, req.user.userId);
  }

  // ── Goals — conservés intégralement ──────────────────────────────────────

  @Post('goals')
  createGoal(@Body() data: any) {
    return this.performanceService.createGoal(data);
  }

  @Get('goals')
  getGoals(@Request() req, @Query('companyId') companyId?: string) {
    return this.performanceService.findAllCompanyGoals(
      req.user.userId,
      companyId,
    );
  }

  @Get('goals/:employeeId')
  findGoals(@Param('employeeId') employeeId: string) {
    return this.performanceService.findAllGoals(employeeId);
  }

  @Patch('goals/:goalId/progress')
  updateGoalProgress(
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body('progress') progress: number,
  ) {
    return this.performanceService.updateGoalProgress(goalId, progress);
  }

  @Patch('goals/key-results/:keyResultId')
  updateKeyResult(
    @Param('keyResultId', ParseUUIDPipe) keyResultId: string,
    @Body('currentValue') currentValue: number,
  ) {
    return this.performanceService.updateKeyResultValue(
      keyResultId,
      currentValue,
    );
  }
}
