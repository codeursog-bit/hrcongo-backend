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
import {
  CreateCompanySiteDto,
  UpdateCompanySiteDto,
} from './dto/company-site.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('companies/:companyId/sites')
export class CompanySiteController {
  constructor(private readonly companySiteService: CompanySiteService) {}

  // GET /companies/:companyId/sites
  @Get()
  findAll(@Param('companyId') companyId: string) {
    return this.companySiteService.findAll(companyId);
  }

  // POST /companies/:companyId/sites
  @Post()
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateCompanySiteDto,
  ) {
    return this.companySiteService.create(companyId, dto);
  }

  // PATCH /companies/:companyId/sites/:siteId
  @Patch(':siteId')
  update(
    @Param('companyId') companyId: string,
    @Param('siteId') siteId: string,
    @Body() dto: UpdateCompanySiteDto,
  ) {
    return this.companySiteService.update(siteId, companyId, dto);
  }

  // DELETE /companies/:companyId/sites/:siteId
  @Delete(':siteId')
  remove(
    @Param('companyId') companyId: string,
    @Param('siteId') siteId: string,
  ) {
    return this.companySiteService.remove(siteId, companyId);
  }
}
