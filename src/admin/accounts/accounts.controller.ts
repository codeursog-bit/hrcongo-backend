// ============================================================================
// src/admin/accounts/accounts.controller.ts — routes SUPER_ADMIN (lecture)
// ============================================================================
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { AccountsService } from './accounts.service';
import { ListAccountsQueryDto } from './accounts.dto';

@Controller('admin/accounts')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  // ⚠️ déclaré avant ':id'
  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Get()
  list(@Query() q: ListAccountsQueryDto) {
    return this.service.list(q);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }
}