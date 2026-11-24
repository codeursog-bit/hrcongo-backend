// ============================================================================
// 📁 export.controller.ts — Contrôleur dédié aux exports
// GET /payrolls/export/excel  → Excel 3 feuilles (paie + charges + CNSS)
// GET /payrolls/export/sage   → Sage Comptabilité .TXT (format journal PNM)
// GET /payrolls/export/etax   → DGI Congo eTax .XLSX (strict, sans style)
// GET /payrolls/export/csv    → CSV générique
// ============================================================================

import {
  Controller,
  Get,
  Query,
  Request,
  Response,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExportService } from './export.service';

@Controller('payrolls/export')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls/export/excel
  // Fichier Excel 3 feuilles :
  //   Feuille 1 : État de paie complet (brut, CNSS, ITS, HS 10/25/50/100, net)
  //   Feuille 2 : Charges patronales (CNSS 3 branches + TUS)
  //   Feuille 3 : Récap déclaration CNSS (pour la CNSS)
  // ─────────────────────────────────────────────────────────────────────────
  @Get('excel')
  async exportExcel(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Response() res: any,
  ) {
    const buffer = await this.exportService.exportPayrollsToExcel(
      req.user.userId,
      month,
      year,
    );
    const mm = String(month).padStart(2, '0');

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="paie_${mm}_${year}.xlsx"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls/export/sage
  // Fichier .TXT format journal Sage Comptabilité (PNM pipe-séparé)
  // Import via : Fichier → Import → Écritures comptables dans Sage
  // ─────────────────────────────────────────────────────────────────────────
  @Get('sage')
  async exportSage(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Response() res: any,
  ) {
    const text = await this.exportService.exportToSage(
      req.user.userId,
      month,
      year,
    );
    const mm = String(month).padStart(2, '0');

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="sage_paie_${mm}_${year}.txt"`,
    });
    res.send(text);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls/export/etax
  // ✅ Déclaration DGI Congo eTax — Format STRICT conforme portail e-Tax
  //
  // Colonnes (ordre obligatoire DGI) :
  //   A : NIU (13 chiffres) — Numéro d'Identification Unique salarié
  //   B : Nom & Prénom
  //   C : Salaire Brut
  //   D : Base ITS/IRPP = (Brut - CNSS) × 80% (abattement 20%)
  //   E : Montant ITS calculé
  //   F : TUS = Brut × 5% (charge patronale déclarée à la DGI)
  //
  // Règles DGI appliquées :
  //   - Zéro formatage (aucune couleur, aucune cellule fusionnée)
  //   - Validation NIU 13 chiffres (avertissement si manquant)
  //   - Nom fichier : DECLARATION_ITS_MM_YYYY_NOM_ENTREPRISE.xlsx
  //   - Les avertissements NIU sont dans le header X-Export-Warnings
  // ─────────────────────────────────────────────────────────────────────────
  @Get('etax')
  async exportETax(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Response() res: any,
  ) {
    const result = await this.exportService.generateEtaxExport(
      req.user.userId,
      month,
      year,
    );

    // Avertissements NIU dans les headers (lisibles en console réseau)
    if (result.warnings.length > 0) {
      res.set(
        'X-Export-Warnings',
        result.warnings.join(' | ').substring(0, 500),
      );
      res.set('X-Warning-Count', String(result.warnings.length));
    }

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Filename': result.filename,
      'Cache-Control': 'no-cache',
    });
    res.send(result.buffer);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls/export/csv
  // CSV générique — Compatible Excel, LibreOffice, Sage, n'importe quel logiciel
  // Séparateur : point-virgule (;) — encodage UTF-8 BOM pour Excel FR
  // ─────────────────────────────────────────────────────────────────────────
  @Get('csv')
  async exportCSV(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Response() res: any,
  ) {
    const text = await this.exportService.exportToCSV(
      req.user.userId,
      month,
      year,
    );
    const mm = String(month).padStart(2, '0');

    // BOM UTF-8 pour que Excel FR ouvre correctement les accents
    const bom = '\uFEFF';

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="paie_${mm}_${year}.csv"`,
    });
    res.send(bom + text);
  }
}
