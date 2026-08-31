// ============================================================================
// 🎛️ ADMIN CONTROLLER - Controller unifié avec routes groupées
// ============================================================================
// Fichier: src/admin/admin.controller.ts

import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UltraAdminGuard } from './guards/ultra-admin.guard';
import { DashboardService } from './services/dashboard.service';
import { AdminCompaniesService } from './services/companies.service';
import { BillingService } from './services/billing.service';
import { AnalyticsService } from './services/analytics.service';
import { MonitoringService } from './services/monitoring.service';
import { ErrorTrackingService } from './services/error-tracking.service';
import { CleanupService } from '../cleanup/cleanup.service';
import { SettingsService } from './services/settings.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, UltraAdminGuard) // ✅ Protection SUPER_ADMIN globale
export class AdminController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly companiesService: AdminCompaniesService,
    private readonly billingService: BillingService,
    private readonly analyticsService: AnalyticsService,
    private readonly monitoringService: MonitoringService,
    private readonly errorTrackingService: ErrorTrackingService,
    private readonly cleanupService: CleanupService,
    private readonly settingsService: SettingsService,
  ) {}

  // ==========================================================================
  // 📊 SECTION DASHBOARD
  // ==========================================================================

  @Get('stats')
  async getDashboardStats() {
    return this.dashboardService.getStats();
  }

  // ==========================================================================
  // 🏢 SECTION COMPANIES
  // ==========================================================================

  @Get('companies')
  async getAllCompanies(
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('search') search?: string,
  ) {
    return this.companiesService.getAllCompanies({ status, plan, search });
  }

  @Get('companies/:id')
  async getCompanyDetails(@Param('id') id: string) {
    return this.companiesService.getCompanyDetails(id);
  }

  // ==========================================================================
  // 💰 SECTION BILLING
  // ==========================================================================

  @Get('billing')
  async getBillingStats() {
    return this.billingService.getBillingStats();
  }

  // ==========================================================================
  // 📈 SECTION ANALYTICS
  // ==========================================================================

  @Get('analytics')
  async getAnalytics() {
    return this.analyticsService.getAnalytics();
  }

  // ==========================================================================
  // 🔧 SECTION MONITORING
  // ==========================================================================

  @Get('monitoring')
  async getMonitoringData() {
    return this.monitoringService.getMonitoringData();
  }

  @Get('monitoring/logs')
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('companyId') companyId?: string,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('severity') severity?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.monitoringService.getAuditLogs({
      page: page ? +page : 1,
      limit: limit ? +limit : 100,
      companyId,
      action,
      entity,
      severity,
      userId,
      from,
      to,
    });
  }

  @Get('monitoring/security')
  async getSecurityEvents(@Query('limit') limit?: string) {
    return this.monitoringService.getSecurityEvents(limit ? +limit : 200);
  }

  @Get('monitoring/stats')
  async getMonitoringStats() {
    return this.monitoringService.getGlobalStats();
  }

  @Get('monitoring/health')
  async getServerHealth() {
    return this.monitoringService.getServerHealth();
  }

  @Get('monitoring/company/:id')
  async getCompanyAudit(@Param('id') id: string) {
    return this.monitoringService.getCompanyAuditStats(id);
  }

  // ==========================================================================
  // ⚙️ SECTION SETTINGS
  // ==========================================================================

  @Get('settings')
  async getGlobalSettings() {
    return this.settingsService.getGlobalSettings();
  }

  // ── Error Tracking ──────────────────────────────────────────────────────
  @Get('errors')
  async getErrors(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('companyId') companyId?: string,
    @Query('errorCode') errorCode?: string,
    @Query('statusCode') statusCode?: string,
    @Query('path') path?: string,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.errorTrackingService.getErrors({
      page: page ? +page : 1,
      limit: limit ? +limit : 50,
      companyId,
      errorCode,
      path,
      severity,
      from,
      to,
      statusCode: statusCode ? +statusCode : undefined,
      resolved: resolved !== undefined ? resolved === 'true' : undefined,
    });
  }

  @Get('errors/stats')
  async getErrorStats() {
    return this.errorTrackingService.getStats();
  }

  @Patch('errors/:id/resolve')
  async resolveError(
    @Param('id') id: string,
    @Body('note') note?: string,
    @Request() req?: any,
  ) {
    return this.errorTrackingService.resolve(id, note, req?.user?.userId);
  }

  @Patch('errors/resolve-by-code/:code')
  async resolveByCode(@Param('code') code: string, @Request() req?: any) {
    return this.errorTrackingService.resolveByCode(code, req?.user?.userId);
  }

  @Delete('errors/cleanup')
  async cleanupErrors(@Query('days') days?: string) {
    return this.errorTrackingService.cleanup(days ? +days : 30);
  }

  // ── Nettoyage BDD manuel (déclenche tous les crons immédiatement) ────────
  @Post('maintenance/cleanup')
  async runCleanup() {
    return this.cleanupService.manualCleanup();
  }
}
