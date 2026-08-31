// ============================================================================
// 📁 src/company-deductions/company-deductions.controller.ts
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { CompanyDeductionsService } from './company-deductions.service';
import { CreateCompanyDeductionDto } from './dto/create-company-deduction.dto';

@Controller('company-deductions')
@UseGuards(JwtAuthGuard)
export class CompanyDeductionsController {
  constructor(private readonly service: CompanyDeductionsService) {}

  @Post()
  create(
    @Body() dto: CreateCompanyDeductionDto,
    @GetUser('id') userId: string,
  ) {
    return this.service.create(dto, userId);
  }

  @Get()
  findAll(
    @GetUser('id') userId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(
      userId,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
      status,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCompanyDeductionDto>,
    @GetUser('id') userId: string,
  ) {
    return this.service.update(id, dto, userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.service.delete(id, userId);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.service.cancel(id, userId);
  }

  @Patch(':id/pay-cash')
  markAsPaidCash(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.service.markAsPaidCash(id, userId);
  }

  // ✅ Règlement en espèces à MONTANT LIBRE (ex: 2 000 FCFA aujourd'hui, le
  // reste plus tard) — complémentaire à /pay-cash qui solde tout d'un coup.
  // C'est celle-ci que le frontend (loans/page.tsx) appelle réellement.
  @Patch(':id/cash-repayment')
  recordCashRepayment(
    @Param('id') id: string,
    @Body() body: { amount: number },
    @GetUser('id') userId: string,
  ) {
    return this.service.recordCashRepayment(id, Number(body.amount), userId);
  }
}