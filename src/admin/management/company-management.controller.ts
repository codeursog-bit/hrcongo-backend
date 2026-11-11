// ============================================================================
// src/admin/management/company-management.controller.ts
// Routes SUPER_ADMIN : gestion d'entreprise (vue, tendances, bilans, contrôles)
// ============================================================================
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { CompanyManagementService } from './company-management.service';
import { ConsistencyQueryDto, ReportQueryDto, TrendsQueryDto } from './company-management.dto';

@Controller('admin/management/companies/:companyId')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class CompanyManagementController {
  constructor(private readonly service: CompanyManagementService) {}

  @Get('overview')
  overview(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.service.overview(companyId);
  }

  @Get('trends')
  trends(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() q: TrendsQueryDto) {
    return this.service.trends(companyId, q.months ?? 12);
  }

  @Get('report')
  report(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() q: ReportQueryDto) {
    return this.service.report(companyId, q.period, q.year, q.index);
  }

  @Get('consistency')
  consistency(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() q: ConsistencyQueryDto) {
    return this.service.consistency(companyId, q.month, q.year);
  }
}