// ============================================================================
// 📁 src/workforce-dashboard/workforce-dashboard.controller.ts
//
//  Entreprise (page "Liste des employés") — modèle ORCA par défaut
//    GET /workforce-dashboard?mode=MOIS&month=9&year=2026&companyId=…
//    GET /workforce-dashboard/export?mode=PLAGE&fromMonth=1&fromYear=2026&toMonth=10&toYear=2026
//
//  Portefeuille (multi-entreprises) — modèle POWERMAN par défaut
//    GET /portfolio/workforce-dashboard?companies=ALL|id1,id2&mode=…
//    GET /portfolio/workforce-dashboard/export?companies=ALL|id1,id2&mode=…
//
//  mode : MOIS (month, year) | PLAGE (fromMonth, fromYear, toMonth, toYear) | ANNEE (year)
// ============================================================================

import { Controller, Get, Query, Request, Response, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WorkforceDashboardService, WorkforceQuery } from './workforce-dashboard.service';
import { WorkforceModel } from './workforce-dashboard.types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class QueryDto {
  companyId?: string;
  companies?: string;
  model?: string;
  mode?: string;
  month?: string;
  year?: string;
  fromMonth?: string;
  fromYear?: string;
  toMonth?: string;
  toYear?: string;
}

const toQuery = (q: QueryDto): WorkforceQuery => {
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
const pickModel = (m: string | undefined, def: WorkforceModel): WorkforceModel =>
  m === 'ORCA' || m === 'POWERMAN' ? m : def;

@Controller('workforce-dashboard')
@UseGuards(AuthGuard('jwt'))
export class WorkforceDashboardController {
  constructor(private readonly service: WorkforceDashboardService) {}

  @Get()
  view(@Request() req, @Query() q: QueryDto) {
    return this.service.getView(req.user.userId, 'COMPANY', pickModel(q.model, 'ORCA'), toQuery(q));
  }

  @Get('export')
  async export(@Request() req, @Response() res: any, @Query() q: QueryDto) {
    const { buffer, filename } = await this.service.generateExport(req.user.userId, 'COMPANY', pickModel(q.model, 'ORCA'), toQuery(q));
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }
}

@Controller('portfolio/workforce-dashboard')
@UseGuards(AuthGuard('jwt'))
export class PortfolioWorkforceDashboardController {
  constructor(private readonly service: WorkforceDashboardService) {}

  @Get()
  view(@Request() req, @Query() q: QueryDto) {
    return this.service.getView(req.user.userId, 'PORTFOLIO', pickModel(q.model, 'POWERMAN'), toQuery(q));
  }

  @Get('export')
  async export(@Request() req, @Response() res: any, @Query() q: QueryDto) {
    const { buffer, filename } = await this.service.generateExport(req.user.userId, 'PORTFOLIO', pickModel(q.model, 'POWERMAN'), toQuery(q));
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }
}