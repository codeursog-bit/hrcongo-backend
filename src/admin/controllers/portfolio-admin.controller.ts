import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { PortfolioAdminService } from '../services/portfolio-admin.service';

@Controller('admin/portfolio-users')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class PortfolioAdminController {
  constructor(private readonly service: PortfolioAdminService) {}

  @Get('search')
  search(@Query('q') q?: string) {
    return this.service.searchUsers(q);
  }

  @Get(':userId')
  getDetail(@Param('userId') userId: string) {
    return this.service.getUserDetail(userId);
  }

  @Post(':userId/attach-company')
  attach(@Param('userId') userId: string, @Body('companyId') companyId: string) {
    return this.service.attachCompany(userId, companyId);
  }

  @Delete(':userId/companies/:companyId')
  detach(@Param('userId') userId: string, @Param('companyId') companyId: string) {
    return this.service.detachCompany(userId, companyId);
  }

  @Post(':userId/toggle-flag')
  toggleFlag(
    @Param('userId') userId: string,
    @Body('enabled') enabled: boolean,
    @Body('maxCompanies') maxCompanies?: number,
  ) {
    return this.service.toggleFlag(userId, enabled, maxCompanies);
  }

  @Post()
  create(
    @Body()
    dto: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      companyIds: string[];
      maxCompanies?: number;
    },
  ) {
    return this.service.createPortfolioUser(dto);
  }
}