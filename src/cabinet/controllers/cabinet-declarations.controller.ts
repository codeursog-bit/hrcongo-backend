import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CabinetMemberGuard,
  CabinetCompanyIsolationGuard,
} from '../guards/cabinet.guards';
import { CabinetDeclarationsService } from '../services/cabinet-declarations.service';

@Controller('cabinet/:cabinetId/declarations')
@UseGuards(JwtAuthGuard, CabinetMemberGuard, CabinetCompanyIsolationGuard)
export class CabinetDeclarationsController {
  constructor(
    private readonly declarationsService: CabinetDeclarationsService,
  ) {}

  @Get('summary')
  getSummary(
    @Param('cabinetId') cabinetId: string,
    @Query('companyId') companyId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
  ) {
    return this.declarationsService.getSummary(
      cabinetId,
      companyId,
      month,
      year,
    );
  }

  @Get('export/excel')
  async exportExcel(
    @Param('cabinetId') cabinetId: string,
    @Query('companyId') companyId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Res() res: Response,
  ) {
    const buffer = await this.declarationsService.exportDeclarationsExcel(
      cabinetId,
      companyId,
      month,
      year,
    );
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="declarations-${month}-${year}.xlsx"`,
    });
    res.send(buffer);
  }

  @Get('export/sage')
  async exportSage(
    @Param('cabinetId') cabinetId: string,
    @Query('companyId') companyId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Res() res: Response,
  ) {
    const content = await this.declarationsService.exportSageJournal(
      cabinetId,
      companyId,
      month,
      year,
    );
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="sage-journal-paie-${month}-${year}.txt"`,
    });
    res.send(content);
  }

  @Get('export/rapport-client')
  async exportClientReport(
    @Param('cabinetId') cabinetId: string,
    @Query('companyId') companyId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Res() res: Response,
  ) {
    const buffer = await this.declarationsService.generateClientReport(
      cabinetId,
      companyId,
      month,
      year,
    );
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rapport-paie-${month}-${year}.xlsx"`,
    });
    res.send(buffer);
  }
}
