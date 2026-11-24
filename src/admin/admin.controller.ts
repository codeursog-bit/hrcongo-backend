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
import { PushBroadcastService } from '../notifications/push-broadcast.service';
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
    private readonly pushBroadcastService: PushBroadcastService,
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

  // 🆕 Notification de test envoyée à l'admin qui clique (vérification de bout en bout)
  @Post('push/test')
  async sendTestPush(@Request() req: any) {
    return this.userActivityService.sendTestPush(req.user.userId);
  }

  // 🆕 Historique d'activation / désactivation des appareils d'un utilisateur
  @Get('push/devices/:userId/events')
  async getPushDeviceEvents(@Param('userId') userId: string) {
    return this.userActivityService.getDeviceEvents(userId);
  }

  // 🆕 Envoi groupé du rappel de pointage (immédiat, sans passer par le cron)
  @Get('push/broadcast/preview')
  async previewPushBroadcast(
    @Query('companyId') companyId?: string,
    @Query('onlyNotPunched') onlyNotPunched?: string,
  ) {
    return this.pushBroadcastService.preview({
      companyId: companyId || undefined,
      onlyNotPunched: onlyNotPunched === 'true',
    });
  }

  @Post('push/broadcast')
  async startPushBroadcast(
    @Request() req: any,
    @Body() body: { companyId?: string; onlyNotPunched?: boolean; title?: string; body?: string },
  ) {
    return this.pushBroadcastService.start(
      {
        companyId: body?.companyId || undefined,
        onlyNotPunched: !!body?.onlyNotPunched,
        title: body?.title,
        body: body?.body,
      },
      req.user.userId,
    );
  }

  @Get('push/broadcasts')
  async listPushBroadcasts() {
    return this.pushBroadcastService.list();
  }

  @Get('push/broadcast/:id')
  async getPushBroadcast(@Param('id') id: string) {
    return this.pushBroadcastService.get(id);
  }

  // 🆕 Réceptions : qui a reçu chaque notification dans l'app et hors app (push)
  @Get('push/receipts')
  async getPushReceipts(
    @Query('hours') hours?: string,
    @Query('type') type?: string,
    @Query('push') push?: string,
    @Query('read') read?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.userActivityService.getPushReceipts({
      hours: hours ? Number(hours) : undefined,
      type,
      push,
      read,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
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