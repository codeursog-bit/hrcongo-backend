// ============================================================================
// 📁 src/company-taxes/company-tax.controller.ts
// ✅ Sans roles.decorator / roles.guard
// ✅ Isolation par companyId gérée dans le service
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompanyTaxService } from './company-tax.service';
import {
  CreateCompanyTaxDto,
  UpdateCompanyTaxDto,
} from './dto/company-tax.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';

@Controller('company-taxes')
@UseGuards(JwtAuthGuard)
export class CompanyTaxController {
  constructor(private readonly companyTaxService: CompanyTaxService) {}

  /** GET /company-taxes */
  @Get()
  findAll(@GetUser('id') userId: string) {
    return this.companyTaxService.findAll(userId);
  }

  /** GET /company-taxes/:id */
  @Get(':id')
  findOne(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companyTaxService.findOne(userId, id);
  }

  /** POST /company-taxes */
  @Post()
  create(@GetUser('id') userId: string, @Body() dto: CreateCompanyTaxDto) {
    return this.companyTaxService.create(userId, dto);
  }

  /** PATCH /company-taxes/:id */
  @Patch(':id')
  update(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyTaxDto,
  ) {
    return this.companyTaxService.update(userId, id, dto);
  }

  /** PATCH /company-taxes/:id/toggle */
  @Patch(':id/toggle')
  toggle(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companyTaxService.toggle(userId, id);
  }

  /** DELETE /company-taxes/:id */
  @Delete(':id')
  remove(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companyTaxService.remove(userId, id);
  }
}
