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
import { AdminSubscriptionsService } from './services/subscriptions.service';
import { BillingService } from './services/billing.service';
import { AnalyticsService } from './services/analytics.service';
import { MonitoringService } from './services/monitoring.service';
import { ErrorTrackingService } from './services/error-tracking.service';
import { CleanupService } from '../cleanup/cleanup.service';
import { SettingsService } from './services/settings.service';
import { AdminUserActivityService } from './services/user-activity.service';
import {
  UpdateCompanyStatusDto,
  ArchiveCompanyDto,
  UpdateCompanyDto,
  ActivateSubscriptionDto,
  SetSubscriptionPeriodDto,
  UpdateSubscriptionPlanDto,
  SuspendSubscriptionDto,
  ExtendSubscriptionDto,
} from './dto/company-actions.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, UltraAdminGuard) // ✅ Protection SUPER_ADMIN globale
export class AdminController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly companiesService: AdminCompaniesService,
    private readonly subscriptionsService: AdminSubscriptionsService,
    private readonly billingService: BillingService,
    private readonly analyticsService: AnalyticsService,
    private readonly monitoringService: MonitoringService,
    private readonly errorTrackingService: ErrorTrackingService,
    private readonly cleanupService: CleanupService,
    private readonly settingsService: SettingsService,
    private readonly userActivityService: AdminUserActivityService,
  ) {}

  // ==========================================================================
  // 📊 SECTION DASHBOARD
  // ==========================================================================

  @Get('stats')
  async getDashboardStats() {
    return this.dashboardService.getStats();
  }

  // ==========================================================================
  // 👀 SECTION PRÉSENCE / ACTIVITÉ UTILISATEURS
  // ==========================================================================

  @Get('users/online')
  async getUsersOnlineNow() {
    return this.userActivityService.getOnlineNow();
  }

  @Get('users/recently-online')
  async getUsersRecentlyOnline(@Query('hours') hours?: string) {
    return this.userActivityService.getRecentlyOnline(hours ? +hours : 24);
  }

  @Get('users/most-active')
  async getMostActiveUsers(@Query('period') period?: 'today' | 'week' | 'month') {
    return this.userActivityService.getMostActive(period ?? 'week');
  }

  @Get('users/push-status')
  async getUsersPushStatus() {
    return this.userActivityService.getPushStatus();
  }

  @Get('users/push-diagnostics')
  async getUsersPushDiagnostics() {
    return this.userActivityService.getPushDiagnostics();
  }

  // ==========================================================================
  // 🏢 SECTION COMPANIES
  // ==========================================================================

  @Get('companies')
  async getAllCompanies(
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('search') search?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.companiesService.getAllCompanies({
      status,
      plan,
      search,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get('companies/:id')
  async getCompanyDetails(@Param('id') id: string) {
    return this.companiesService.getCompanyDetails(id);
  }

  @Patch('companies/:id')
  async updateCompany(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
    @Request() req: any,
  ) {
    return this.companiesService.updateCompany(id, dto, req.user.userId);
  }

  @Patch('companies/:id/status')
  async updateCompanyStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyStatusDto,
    @Request() req: any,
  ) {
    return this.companiesService.updateCompanyStatus(id, dto, req.user.userId);
  }

  @Post('companies/:id/archive')
  async archiveCompany(
    @Param('id') id: string,
    @Body() dto: ArchiveCompanyDto,
    @Request() req: any,
  ) {
    return this.companiesService.archiveCompany(id, dto, req.user.userId);
  }

  @Post('companies/:id/unarchive')
  async unarchiveCompany(@Param('id') id: string, @Request() req: any) {
    return this.companiesService.unarchiveCompany(id, req.user.userId);
  }

  // ==========================================================================
  // 💳 SECTION ABONNEMENTS
  // ==========================================================================

  @Get('subscriptions')
  async getAllSubscriptions(
    @Query('expiringInDays') expiringInDays?: string,
    @Query('expired') expired?: string,
    @Query('status') status?: string,
  ) {
    return this.subscriptionsService.getAll({
      expiringInDays: expiringInDays ? +expiringInDays : undefined,
      expired: expired === 'true',
      status,
    });
  }

  @Patch('companies/:id/subscription/activate')
  async activateSubscription(
    @Param('id') id: string,
    @Body() dto: ActivateSubscriptionDto,
    @Request() req: any,
  ) {
    return this.subscriptionsService.activate(id, dto, req.user.userId);
  }

  @Patch('companies/:id/subscription/period')
  async setSubscriptionPeriod(
    @Param('id') id: string,
    @Body() dto: SetSubscriptionPeriodDto,
    @Request() req: any,
  ) {
    return this.subscriptionsService.setPeriod(id, dto, req.user.userId);
  }

  @Patch('companies/:id/subscription/suspend')
  async suspendSubscription(
    @Param('id') id: string,
    @Body() dto: SuspendSubscriptionDto,
    @Request() req: any,
  ) {
    return this.subscriptionsService.suspend(id, dto, req.user.userId);
  }

  @Patch('companies/:id/subscription/plan')
  async changeSubscriptionPlan(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
    @Request() req: any,
  ) {
    return this.subscriptionsService.changePlan(id, dto, req.user.userId);
  }

  @Patch('companies/:id/subscription/extend')
  async extendSubscription(
    @Param('id') id: string,
    @Body() dto: ExtendSubscriptionDto,
    @Request() req: any,
  ) {
    return this.subscriptionsService.extend(id, dto, req.user.userId);
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

  @Get('monitoring/system-logs')
  async getSystemLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
    @Query('level') level?: string,
    @Query('companyId') companyId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.monitoringService.getSystemLogs({
      page: page ? +page : 1,
      limit: limit ? +limit : 100,
      source,
      level,
      companyId,
      from,
      to,
    });
  }

  @Get('monitoring/system-logs/sources')
  async getSystemLogSources() {
    return this.monitoringService.getSystemLogSources();
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

  @Patch('settings')
  async updateGlobalSettings(
    @Body() dto: { preShiftReminderMinutes?: number },
    @Request() req: any,
  ) {
    return this.settingsService.updateGlobalSettings(dto, req.user.userId);
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