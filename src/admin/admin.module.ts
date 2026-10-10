// ============================================================================
// 📦 ADMIN MODULE - Module principal avec tous les providers
// ============================================================================
// Fichier: src/admin/admin.module.ts

import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PortfolioAdminController } from './controllers/portfolio-admin.controller';
import { DashboardService } from './services/dashboard.service';
import { AdminCompaniesService } from './services/companies.service';
import { AdminSubscriptionsService } from './services/subscriptions.service';
import { BillingService } from './services/billing.service';
import { AnalyticsService } from './services/analytics.service';
import { MonitoringService } from './services/monitoring.service';
import { SettingsService } from './services/settings.service';
import { ErrorTrackingService } from './services/error-tracking.service';
import { AdminUserActivityService } from './services/user-activity.service';
import { PortfolioAdminService } from './services/portfolio-admin.service';
import { CleanupModule } from '../cleanup/cleanup.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UltraAdminGuard } from './guards/ultra-admin.guard';
// 🆕 Suivi du serveur + purge sécurisée (super admin)
import { SystemLogsModule } from '../system-logs/system-logs.module';
import { ServerMonitorController } from './server-monitor/server-monitor.controller';
import { ServerMetricsService } from './server-monitor/server-metrics.service';
import { AdminPurgeService } from './server-monitor/purge.service';
import { RouteStatsCollector } from './server-monitor/route-stats.collector';
import { RequestMetricsMiddleware } from './server-monitor/request-metrics.middleware';

@Module({
  imports: [PrismaModule, CleanupModule, PlatformSettingsModule, NotificationsModule, SystemLogsModule],
  controllers: [AdminController, PortfolioAdminController, ServerMonitorController],
  providers: [
    // Services
    DashboardService,
    AdminCompaniesService,
    AdminSubscriptionsService,
    BillingService,
    AnalyticsService,
    MonitoringService,
    SettingsService,
    ErrorTrackingService,
    AdminUserActivityService,
    PortfolioAdminService,
    // 🆕 Suivi du serveur + purge sécurisée
    ServerMetricsService,
    AdminPurgeService,
    RouteStatsCollector,
    // Guards
    UltraAdminGuard,
  ],
  exports: [
    // Exporter les services si d'autres modules en ont besoin
    DashboardService,
    AdminCompaniesService,
    AdminSubscriptionsService,
    BillingService,
    AnalyticsService,
    MonitoringService,
    SettingsService,
    ErrorTrackingService,
    AdminUserActivityService,
    PortfolioAdminService,
  ],
})
export class AdminModule implements NestModule {
  // 🆕 Mesure la durée de chaque requête (par route) pour le suivi du serveur
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestMetricsMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}