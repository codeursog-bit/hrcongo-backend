import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CnssDeclarationService } from './cnss-declaration.service';

@Controller('cnss-declaration')
@UseGuards(JwtAuthGuard)
export class CnssDeclarationController {
  constructor(private readonly cnssService: CnssDeclarationService) {}

  // GET /cnss-declaration/recap?month=7&year=2026
  @Get('recap')
  async getRecap(
    @Req() req: any,
    @Query(
      'month',
      new DefaultValuePipe(new Date().getMonth() + 1),
      ParseIntPipe,
    )
    month: number,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
  ) {
    return this.cnssService.getMonthlyRecap(req.user.id, month, year);
  }

  // GET /cnss-declaration/export/dnms?month=7&year=2026
  // Retourne le template officiel CNSS rempli — format exact e-déclaration
  @Get('export/dnms')
  async exportDnms(
    @Req() req: any,
    @Query(
      'month',
      new DefaultValuePipe(new Date().getMonth() + 1),
      ParseIntPipe,
    )
    month: number,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
    @Res() res: Response,
  ) {
    const { buffer, filename, warnings } =
      await this.cnssService.exportDnmsTemplate(req.user.id, month, year);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'X-Warnings': warnings.length > 0 ? warnings.join(' | ') : '',
    });
    res.end(buffer);
  }

  // GET /cnss-declaration/export/tus?month=7&year=2026
  // Retourne le template officiel TUS rempli — format exact e-déclaration
  @Get('export/tus')
  async exportTus(
    @Req() req: any,
    @Query(
      'month',
      new DefaultValuePipe(new Date().getMonth() + 1),
      ParseIntPipe,
    )
    month: number,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.cnssService.exportTusTemplate(
      req.user.id,
      month,
      year,
    );

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  // GET /cnss-declaration/export/dgc?month=7&year=2026
  // Retourne le template officiel DGC (.docx) rempli
  @Get('export/dgc')
  async exportDgc(
    @Req() req: any,
    @Query(
      'month',
      new DefaultValuePipe(new Date().getMonth() + 1),
      ParseIntPipe,
    )
    month: number,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
    @Res() res: Response,
  ) {
    const { buffer, filename, warnings } =
      await this.cnssService.exportDgcTemplate(req.user.id, month, year);

    // ⚠️ ERR_INVALID_CHAR : Node refuse les caractères accentués bruts dans
    // un header HTTP (ex: "à confirmer", "é"). On encode la valeur —
    // le frontend doit décoder avec decodeURIComponent() pour l'afficher.
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'X-Warnings':
        warnings.length > 0 ? encodeURIComponent(warnings.join(' | ')) : '',
    });
    res.end(buffer);
  }

  // GET /cnss-declaration/export/excel?month=7&year=2026
  // Export Excel custom 3 feuilles (DNMS + TUS + DGC) — pour usage interne
  @Get('export/excel')
  async exportExcel(
    @Req() req: any,
    @Query(
      'month',
      new DefaultValuePipe(new Date().getMonth() + 1),
      ParseIntPipe,
    )
    month: number,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
    @Res() res: Response,
  ) {
    const { buffer, filename, warnings } =
      await this.cnssService.exportDeclarationExcel(req.user.id, month, year);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'X-Warnings': warnings.length > 0 ? warnings.join(' | ') : '',
    });
    res.end(buffer);
  }

  // GET /cnss-declaration/export/csv?month=7&year=2026
  @Get('export/csv')
  async exportCsv(
    @Req() req: any,
    @Query(
      'month',
      new DefaultValuePipe(new Date().getMonth() + 1),
      ParseIntPipe,
    )
    month: number,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
    @Res() res: Response,
  ) {
    const { content, filename } = await this.cnssService.exportDeclarationCsv(
      req.user.id,
      month,
      year,
    );

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(content);
  }

  // GET /cnss-declaration/history?year=2026
  @Get('history')
  async getHistory(
    @Req() req: any,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
  ) {
    return this.cnssService.getDeclarationHistory(req.user.id, year);
  }

  // 🆕 POST /cnss-declaration/declare
  // Bouton "Je déclare la CNSS" — marque le mois comme réellement déclaré.
  // Ne dépend plus du statut de la paie : c'est une action manuelle et
  // explicite de l'entreprise, indépendante du fait que la paie soit payée.
  @Post('declare')
  async declare(
    @Req() req: any,
    @Body()
    body: {
      month: number;
      year: number;
      paymentReference?: string;
      paymentMode?: string;
      notes?: string;
    },
  ) {
    return this.cnssService.declareCnss(req.user.id, body.month, body.year, {
      paymentReference: body.paymentReference,
      paymentMode: body.paymentMode,
      notes: body.notes,
    });
  }

  // 🆕 POST /cnss-declaration/cancel-declare
  // Annule une déclaration marquée par erreur (repasse à A_DECLARER)
  @Post('cancel-declare')
  async cancelDeclare(
    @Req() req: any,
    @Body() body: { month: number; year: number },
  ) {
    return this.cnssService.cancelDeclareCnss(req.user.id, body.month, body.year);
  }
}