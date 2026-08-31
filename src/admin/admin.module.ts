// ============================================================================
// 📦 ADMIN MODULE - Module principal avec tous les providers
// ============================================================================
// Fichier: src/admin/admin.module.ts

import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { DashboardService } from './services/dashboard.service';
import { AdminCompaniesService } from './services/companies.service';
import { BillingService } from './services/billing.service';
import { AnalyticsService } from './services/analytics.service';
import { MonitoringService } from './services/monitoring.service';
import { SettingsService } from './services/settings.service';
import { ErrorTrackingService } from './services/error-tracking.service';
import { CleanupModule } from '../cleanup/cleanup.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UltraAdminGuard } from './guards/ultra-admin.guard';

@Module({
  imports: [PrismaModule, CleanupModule],
  controllers: [AdminController],
  providers: [
    // Services
    DashboardService,
    AdminCompaniesService,
    BillingService,
    AnalyticsService,
    MonitoringService,
    SettingsService,
    ErrorTrackingService,
    // Guards
    UltraAdminGuard,
  ],
  exports: [
    // Exporter les services si d'autres modules en ont besoin
    DashboardService,
    AdminCompaniesService,
    BillingService,
    AnalyticsService,
    MonitoringService,
    SettingsService,
    ErrorTrackingService,
  ],
})
export class AdminModule {}
