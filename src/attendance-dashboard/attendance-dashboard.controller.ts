// ============================================================================
// 📁 src/attendance-dashboard/attendance-dashboard.controller.ts
//
//  Entreprise
//    GET /attendance-dashboard?mode=MOIS&month=10&year=2026&companyId=…
//    GET /attendance-dashboard/export?mode=PLAGE&fromMonth=1&fromYear=2026&toMonth=10&toYear=2026
//
//  Portefeuille (multi-entreprises)
//    GET /portfolio/attendance-dashboard?companies=ALL|id1,id2&mode=…
//    GET /portfolio/attendance-dashboard/export?companies=ALL|id1,id2&mode=…
//
//  mode : MOIS (month, year) | PLAGE (fromMonth, fromYear, toMonth, toYear) | ANNEE (year)
// ============================================================================

import { Controller, Get, Query, Request, Response, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { AttendanceDashboardService, AttendanceQuery } from './attendance-dashboard.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NUM = /^\d{1,4}$/;

// ⚠️ ValidationPipe global en whitelist + forbidNonWhitelisted : chaque champ DOIT être décoré.
export class AttendanceQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() companies?: string;
  @IsOptional() @IsIn(['MOIS', 'PLAGE', 'ANNEE']) mode?: string;
  @IsOptional() @Matches(NUM) month?: string;
  @IsOptional() @Matches(NUM) year?: string;
  @IsOptional() @Matches(NUM) fromMonth?: string;
  @IsOptional() @Matches(NUM) fromYear?: string;
  @IsOptional() @Matches(NUM) toMonth?: string;
  @IsOptional() @Matches(NUM) toYear?: string;
  // Le front envoie aussi `model` (commun avec le dashboard effectifs) : ignoré ici mais toléré.
  @IsOptional() @IsString() model?: string;
}

const toQuery = (q: AttendanceQueryDto): AttendanceQuery => {
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

@Controller('attendance-dashboard')
@UseGuards(AuthGuard('jwt'))
export class AttendanceDashboardController {
  constructor(private readonly service: AttendanceDashboardService) {}

  @Get()
  view(@Request() req, @Query() q: AttendanceQueryDto) {
    return this.service.getView(req.user.userId, 'COMPANY', toQuery(q));
  }

  @Get('export')
  async export(@Request() req, @Response() res: any, @Query() q: AttendanceQueryDto) {
    const { buffer, filename } = await this.service.generateExport(req.user.userId, 'COMPANY', toQuery(q));
    sendXlsx(res, buffer, filename);
  }
}

@Controller('portfolio/attendance-dashboard')
@UseGuards(AuthGuard('jwt'))
export class PortfolioAttendanceDashboardController {
  constructor(private readonly service: AttendanceDashboardService) {}

  @Get()
  view(@Request() req, @Query() q: AttendanceQueryDto) {
    return this.service.getView(req.user.userId, 'PORTFOLIO', toQuery(q));
  }

  @Get('export')
  async export(@Request() req, @Response() res: any, @Query() q: AttendanceQueryDto) {
    const { buffer, filename } = await this.service.generateExport(req.user.userId, 'PORTFOLIO', toQuery(q));
    sendXlsx(res, buffer, filename);
  }
}
