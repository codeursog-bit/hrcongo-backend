import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DasDeclarationService } from './das-declaration.service';

@Controller('das-declaration')
@UseGuards(JwtAuthGuard)
export class DasDeclarationController {
  constructor(private readonly dasService: DasDeclarationService) {}

  // GET /das-declaration/years
  // Années pour lesquelles il existe au moins une paie validée — alimente
  // le sélecteur "2020 → 2026" côté frontend.
  @Get('years')
  async getYears(@Req() req: any) {
    return this.dasService.getAvailableYears(req.user.id);
  }

  // GET /das-declaration/recap?year=2026
  // Récapitulatif annuel par salarié — pour l'affichage écran/impression.
  @Get('recap')
  async getRecap(
    @Req() req: any,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
  ) {
    return this.dasService.getAnnualRecap(req.user.id, year);
  }

  // GET /das-declaration/export?year=2026
  // Retourne le template officiel DAS I rempli (.xlsx — mise en page identique au fichier fourni)
  @Get('export')
  async exportDas(
    @Req() req: any,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.dasService.exportDas(
      req.user.id,
      year,
    );
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  // GET /das-declaration/export-range?startYear=2020&endYear=2026
  // Zip contenant un .xlsx DAS I par année de la plage.
  @Get('export-range')
  async exportDasRange(
    @Req() req: any,
    @Query('startYear', ParseIntPipe) startYear: number,
    @Query('endYear', ParseIntPipe) endYear: number,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.dasService.exportDasRange(
      req.user.id,
      startYear,
      endYear,
    );
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
