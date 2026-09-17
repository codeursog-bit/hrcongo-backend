// ============================================================================
// 📦 ADMIN MODULE - Module principal avec tous les providers
// ============================================================================
// Fichier: src/admin/admin.module.ts

import { Module } from '@nestjs/common';
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
import { UltraAdminGuard } from './guards/ultra-admin.guard';

@Module({
  imports: [PrismaModule, CleanupModule, PlatformSettingsModule],
  controllers: [AdminController, PortfolioAdminController],
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
export class AdminModule {}