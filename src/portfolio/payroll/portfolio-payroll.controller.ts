import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioPayrollService } from './portfolio-payroll.service';
import { CreatePayrollDto } from '../../payrolls/dto/create-payroll.dto';
import type { CreateManualPayrollDto } from '../../payrolls/services/manual-payroll.service';

// 🆕 Paie — vue transverse "toutes mes entreprises".
@Controller('portfolio/payroll')
@UseGuards(AuthGuard('jwt'))
export class PortfolioPayrollController {
  constructor(private readonly service: PortfolioPayrollService) {}

  @Get()
  search(
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.search(userId, {
      companyId,
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
    });
  }

  @Post()
  create(@GetUser('id') userId: string, @Body() dto: CreatePayrollDto) {
    return this.service.create(userId, dto);
  }

  // Génère le lot mensuel pour l'entreprise donnée dans le body.
  @Post('generate')
  generate(
    @GetUser('id') userId: string,
    @Body()
    body: {
      companyId: string;
      month: number;
      year: number;
      employeeIds?: string[];
      customWorkDays?: number;
    },
  ) {
    return this.service.generateMonthlyPayrolls(
      userId,
      body.companyId,
      body.month,
      body.year,
      body.employeeIds,
      body.customWorkDays,
    );
  }

  @Get(':id')
  findOne(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id);
  }

  @Patch(':id/status')
  updateStatus(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('status') status: 'PAID' | 'VALIDATED' | 'CANCELLED',
  ) {
    return this.service.updateStatus(userId, id, status);
  }

  @Delete(':id')
  remove(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }

  // ── Paie manuelle (sans pointeuse) ──────────────────────────────────────
  @Post('manual-simulate')
  manualSimulate(
    @GetUser('id') userId: string,
    @Body() dto: CreateManualPayrollDto,
  ) {
    return this.service.simulateManual(userId, dto);
  }

  @Post('manual')
  manualSave(
    @GetUser('id') userId: string,
    @Body() dto: CreateManualPayrollDto,
  ) {
    return this.service.saveManual(userId, dto);
  }
}