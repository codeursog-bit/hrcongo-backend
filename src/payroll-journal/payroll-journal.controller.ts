// ============================================================================
// 📁 src/payroll-journal/payroll-journal.controller.ts
//   GET    /payroll-journal?month=&year=&companyId=            → journal du mois
//   GET    /payroll-journal/export/excel?month=&year=&companyId= → Excel dynamique
//   GET    /payroll-journal/foreign-pays?month=&year=          → paies étrangères
//   POST   /payroll-journal/foreign-pays?companyId=            → créer / écraser
//   DELETE /payroll-journal/foreign-pays/:id?companyId=        → supprimer
// Mêmes rôles que les routes paie existantes (cabinet inclus).
// ============================================================================
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Response,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PayrollJournalService } from './payroll-journal.service';
import { PayrollForeignPayService } from './payroll-foreign-pay.service';
import { PayrollJournalExportService } from './payroll-journal-export.service';
import { UpsertForeignPayDto } from './dto/foreign-pay.dto';

const PAYROLL_ROLES = [
  'ADMIN',
  'HR_MANAGER',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];

@Controller('payroll-journal')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(...PAYROLL_ROLES)
export class PayrollJournalController {
  constructor(
    private readonly journalService: PayrollJournalService,
    private readonly foreignPayService: PayrollForeignPayService,
    private readonly exportService: PayrollJournalExportService,
  ) {}

  @Get()
  getJournal(
    @Request() req: any,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    return this.journalService.getJournal(
      req.user.userId,
      month,
      year,
      companyId,
    );
  }

  /** Export Excel dynamique (formules, cellules modifiables) — même design que le récap personnel. */
  @Get('export/excel')
  async exportExcel(
    @Request() req: any,
    @Response() res: any,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    const journal = await this.journalService.getJournal(
      req.user.userId,
      month,
      year,
      companyId,
    );
    const buffer = await this.exportService.exportExcel(journal);
    const mm = String(month).padStart(2, '0');

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="journal_paie_${mm}_${year}.xlsx"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }

  @Get('foreign-pays')
  listForeignPays(
    @Request() req: any,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    return this.foreignPayService.list(req.user.userId, month, year, companyId);
  }

  @Post('foreign-pays')
  upsertForeignPay(
    @Request() req: any,
    @Body() dto: UpsertForeignPayDto,
    @Query('companyId') companyId?: string,
  ) {
    return this.foreignPayService.upsert(req.user.userId, dto, companyId);
  }

  @Delete('foreign-pays/:id')
  removeForeignPay(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.foreignPayService.remove(req.user.userId, id, companyId);
  }
}