// ============================================================================
// src/admin/cabinets/admin-cabinets.controller.ts — routes SUPER_ADMIN
// ============================================================================
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { AdminCabinetsService } from './admin-cabinets.service';
import {
  AdjustBulletinsDto, CabinetActionDto, CompanyAccessDto, ExtendTrialDto, ListCabinetsQueryDto,
  SetCabinetActiveDto, SetForfaitDto,
} from './admin-cabinets.dto';

const actorId = (req: any): string => req.user.userId ?? req.user.sub;
const routeOf = (req: any): string => `${req.method} ${req.originalUrl?.split('?')[0] ?? ''}`.slice(0, 200);

@Controller('admin/cabinets')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class AdminCabinetsController {
  constructor(private readonly service: AdminCabinetsService) {}

  // ⚠️ routes fixes déclarées avant ':id'
  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Post('recalculate-counters')
  recalculateAll(@Body() dto: CabinetActionDto, @Request() req) {
    return this.service.recalculateAllCounters(actorId(req), dto.reason, routeOf(req));
  }

  @Get()
  list(@Query() q: ListCabinetsQueryDto) {
    return this.service.list(q);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post(':id/bulletins')
  adjustBulletins(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustBulletinsDto, @Request() req) {
    return this.service.adjustBulletins(actorId(req), id, dto.delta, dto.reason, routeOf(req));
  }

  @Post(':id/forfait')
  setForfait(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetForfaitDto, @Request() req) {
    return this.service.setForfait(actorId(req), id, dto.active, dto.months, dto.reason, routeOf(req));
  }

  @Post(':id/trial')
  extendTrial(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendTrialDto, @Request() req) {
    return this.service.extendTrial(actorId(req), id, dto.days, dto.reason, routeOf(req));
  }

  @Patch(':id/active')
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCabinetActiveDto, @Request() req) {
    return this.service.setActive(actorId(req), id, dto.isActive, dto.reason, routeOf(req));
  }

  @Post(':id/recalculate-counters')
  recalculate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CabinetActionDto, @Request() req) {
    return this.service.recalculateCounters(actorId(req), id, dto.reason, routeOf(req));
  }

  @Patch(':id/companies/:companyId/access')
  setCompanyAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CompanyAccessDto,
    @Request() req,
  ) {
    return this.service.setCompanyAccess(actorId(req), id, companyId, dto, routeOf(req));
  }
}