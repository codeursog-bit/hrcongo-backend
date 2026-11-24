// ============================================================================
// 📁 src/loans-dashboard/loans-dashboard.controller.ts
//
//  Entreprise
//    GET /loans-dashboard?mode=MOIS&month=10&year=2026&companyId=…
//    GET /loans-dashboard/export?mode=PLAGE&fromMonth=1&fromYear=2026&toMonth=10&toYear=2026
//
//  Portefeuille (multi-entreprises)
//    GET /portfolio/loans-dashboard?companies=ALL|id1,id2&mode=…
//    GET /portfolio/loans-dashboard/export?companies=ALL|id1,id2&mode=…
//
//  mode : MOIS (month, year) | PLAGE (fromMonth, fromYear, toMonth, toYear) | ANNEE (year)
// ============================================================================

import { Controller, Get, Query, Request, Response, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { LoansDashboardService, LoansQuery } from './loans-dashboard.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NUM = /^\d{1,4}$/;

// ⚠️ ValidationPipe global en whitelist + forbidNonWhitelisted : chaque champ DOIT être décoré.
export class LoansQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() companies?: string;
  @IsOptional() @IsIn(['MOIS', 'PLAGE', 'ANNEE']) mode?: string;
  @IsOptional() @Matches(NUM) month?: string;
  @IsOptional() @Matches(NUM) year?: string;
  @IsOptional() @Matches(NUM) fromMonth?: string;
  @IsOptional() @Matches(NUM) fromYear?: string;
  @IsOptional() @Matches(NUM) toMonth?: string;
  @IsOptional() @Matches(NUM) toYear?: string;
  // Le front peut envoyer `model` (commun avec les autres dashboards) : ignoré ici mais toléré.
  @IsOptional() @IsString() model?: string;
}

const toQuery = (q: LoansQueryDto): LoansQuery => {
  const n = (v?: string) => (v !== undefined && v !== '' ? parseInt(v, 10) : undefined);
  return {
    companyId: q.companyId || undefined,
    companies: q.companies || undefined,
    mode: q.mode,
    month: n(q.month), year: n(q.year),
    fromMonth: n(q.fromMonth), fromYear: n(q.fromYear),
    toMonth: n(q.toMonth), toYear: n(q.toYear),
  };
};

function sendXlsx(res: any, buffer: Buffer, filename: string) {
  res.set({
    'Content-Type': XLSX_MIME,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Expose-Headers': 'Content-Disposition',
    'Cache-Control': 'no-cache',
  });
  res.send(buffer);
}

@Controller('loans-dashboard')
@UseGuards(AuthGuard('jwt'))
export class LoansDashboardController {
  constructor(private readonly service: LoansDashboardService) {}

  @Get()
  view(@Request() req, @Query() q: LoansQueryDto) {
    return this.service.getView(req.user.userId, 'COMPANY', toQuery(q));
  }

  @Get('export')
  async export(@Request() req, @Response() res: any, @Query() q: LoansQueryDto) {
    const { buffer, filename } = await this.service.generateExport(req.user.userId, 'COMPANY', toQuery(q));
    sendXlsx(res, buffer, filename);
  }
}

@Controller('portfolio/loans-dashboard')
@UseGuards(AuthGuard('jwt'))
export class PortfolioLoansDashboardController {
  constructor(private readonly service: LoansDashboardService) {}

  @Get()
  view(@Request() req, @Query() q: LoansQueryDto) {
    return this.service.getView(req.user.userId, 'PORTFOLIO', toQuery(q));
  }

  @Get('export')
  async export(@Request() req, @Response() res: any, @Query() q: LoansQueryDto) {
    const { buffer, filename } = await this.service.generateExport(req.user.userId, 'PORTFOLIO', toQuery(q));
    sendXlsx(res, buffer, filename);
  }
}