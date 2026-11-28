// ============================================================================
// 📁 src/accounting/accounting-plan.controller.ts
// Réservé au SUPER_ADMIN (même garde que /admin/legal-parameters).
// ============================================================================
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { UltraAdminGuard } from '../admin/guards/ultra-admin.guard';
import { AccountingPlanService } from './accounting-plan.service';

@Controller('admin/accounting-plan')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class AccountingPlanController {
  constructor(private readonly service: AccountingPlanService) {}

  /** Catalogue des rubriques, défauts, plan en vigueur et historique (?country=CG). */
  @Get()
  overview(@Query('country') country?: string) {
    return this.service.getOverview(country);
  }

  /** Publie une nouvelle version (ne modifie jamais les précédentes). */
  @Post()
  create(@Body() dto: { country?: string; effectiveFrom: string; accounts: unknown; note?: string }, @GetUser() user: any) {
    return this.service.createVersion(dto, { id: user?.userId ?? user?.id ?? null, name: user?.email ?? null });
  }
}