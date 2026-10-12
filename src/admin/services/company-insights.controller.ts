// ============================================================================
// 📁 src/admin/services/company-insights.controller.ts
// GET /admin/companies/:id/insights — réservé au SUPER_ADMIN
// ============================================================================
import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { CompanyInsightsService } from './company-insights.service';

@Controller('admin/companies')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class CompanyInsightsController {
  constructor(private readonly insights: CompanyInsightsService) {}

  @Get(':id/insights')
  getInsights(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.insights.getInsights(id);
  }
}