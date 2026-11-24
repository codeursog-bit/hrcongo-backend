import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CompanySiteService } from './company-site.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import {
  CreateCompanySiteDto,
  UpdateCompanySiteDto,
} from './dto/company-site.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('companies/:companyId/sites')
export class CompanySiteController {
  constructor(
    private readonly companySiteService: CompanySiteService,
    private readonly subscriptionGuard: SubscriptionGuard,
  ) {}

  // GET /companies/:companyId/sites
  @Get()
  async findAll(@Param('companyId') companyId: string, @Request() req) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, false);
    return this.companySiteService.findAll(companyId);
  }

  // POST /companies/:companyId/sites
  @Post()
  async create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateCompanySiteDto,
    @Request() req,
  ) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, true);
    // ✅ Le multi-sites GPS est une feature d'abonnement — avant ce
    // correctif, n'importe quel plan pouvait créer des sites ici.
    await this.subscriptionGuard.checkFeatureAccess(
      companyId,
      'hasAttendanceGPS',
    );
    return this.companySiteService.create(companyId, dto);
  }

  // PATCH /companies/:companyId/sites/:siteId
  @Patch(':siteId')
  async update(
    @Param('companyId') companyId: string,
    @Param('siteId') siteId: string,
    @Body() dto: UpdateCompanySiteDto,
    @Request() req,
  ) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, true);
    return this.companySiteService.update(siteId, companyId, dto);
  }

  // DELETE /companies/:companyId/sites/:siteId
  @Delete(':siteId')
  async remove(
    @Param('companyId') companyId: string,
    @Param('siteId') siteId: string,
    @Request() req,
  ) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, true);
    return this.companySiteService.remove(siteId, companyId);
  }
}