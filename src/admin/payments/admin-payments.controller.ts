// ============================================================================
// src/admin/payments/admin-payments.controller.ts — routes SUPER_ADMIN
// ============================================================================
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { AdminPaymentsService } from './admin-payments.service';
import { ListPaymentsQueryDto, PaymentActionDto } from './admin-payments.dto';

const actorId = (req: any): string => req.user.userId ?? req.user.sub;
const routeOf = (req: any): string => `${req.method} ${req.originalUrl?.split('?')[0] ?? ''}`.slice(0, 200);

@Controller('admin/payments')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class AdminPaymentsController {
  constructor(private readonly service: AdminPaymentsService) {}

  // ⚠️ déclaré avant ':id'
  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Get()
  list(@Query() q: ListPaymentsQueryDto) {
    return this.service.list(q);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post(':id/recheck')
  recheck(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentActionDto, @Request() req) {
    return this.service.recheck(actorId(req), id, dto.reason, routeOf(req));
  }

  @Post(':id/validate')
  validate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentActionDto, @Request() req) {
    return this.service.validate(actorId(req), id, dto.reason, routeOf(req));
  }

  @Post(':id/fail')
  fail(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentActionDto, @Request() req) {
    return this.service.markFailed(actorId(req), id, dto.reason, routeOf(req));
  }

  @Post(':id/refund')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentActionDto, @Request() req) {
    return this.service.markRefunded(actorId(req), id, dto.reason, routeOf(req));
  }
}