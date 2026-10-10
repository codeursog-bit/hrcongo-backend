// ============================================================================
// 📁 src/admin/server-monitor/server-monitor.controller.ts
// Routes réservées au SUPER_ADMIN (JwtAuthGuard + UltraAdminGuard).
// ============================================================================
import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { ServerMetricsService } from './server-metrics.service';
import { AdminPurgeService } from './purge.service';
import { PurgeExecuteDto, PurgePreviewDto } from './dto/purge.dto';

@Controller('admin/server')
@UseGuards(JwtAuthGuard, UltraAdminGuard) // ✅ SUPER_ADMIN uniquement
export class ServerMonitorController {
  constructor(
    private readonly metrics: ServerMetricsService,
    private readonly purge: AdminPurgeService,
  ) {}

  /** Valeurs en direct + diagnostic « pourquoi » */
  @Get('overview')
  overview() {
    return this.metrics.getOverview();
  }

  /** Courbes : /admin/server/history?hours=24 (max 720 = 30 jours) */
  @Get('history')
  history(@Query('hours') hours?: string) {
    return this.metrics.getHistory(Number(hours) || 24);
  }

  /** Taille de toutes les tables + croissance 7 jours */
  @Get('tables')
  tables() {
    return this.metrics.getTables();
  }

  @Get('slow-queries')
  slowQueries() {
    return this.metrics.getSlowQueries();
  }

  @Get('diagnostics')
  diagnostics() {
    return this.metrics.getDiagnostics();
  }

  // ── Purge sécurisée ──────────────────────────────────────────────────────
  @Get('purge/targets')
  purgeTargets() {
    return this.purge.listTargets();
  }

  @Post('purge/preview')
  purgePreview(@Body() dto: PurgePreviewDto) {
    return this.purge.preview(dto.items);
  }

  @Post('purge/execute')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  purgeExecute(@Body() dto: PurgeExecuteDto, @Request() req: any) {
    return this.purge.execute(dto.items, dto.confirm, dto.confirmText, {
      userId: req.user?.userId ?? req.user?.id,
      email: req.user?.email,
    });
  }
}