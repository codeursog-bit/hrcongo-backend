import { validateSimulationItems } from './payroll-simulation-validation';
// ============================================================================
// 📁 payrolls.controller.ts — VERSION FINALE
// ✅ PATCH /:id/recalculate — recalcul complet après modification bulletin
// ============================================================================

import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';

import { PayrollsService } from './payrolls.service';
import { ExportService } from './export.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

import { ManualPayrollService } from './services/manual-payroll.service';
import type { CreateManualPayrollDto } from './services/manual-payroll.service';

// Rôles autorisés sur toutes les routes paie (cabinet inclus)
const PAYROLL_ROLES = [
  'ADMIN',
  'HR_MANAGER',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];

@Controller('payrolls')
@UseGuards(AuthGuard('jwt'))
export class PayrollsController {
  constructor(
    private readonly payrollsService: PayrollsService,
    private readonly exportService: ExportService,
    private readonly manualPayrollService: ManualPayrollService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls — Créer un bulletin individuel
  // ─────────────────────────────────────────────────────────────────────────
  @Post()
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  create(@Body() createPayrollDto: CreatePayrollDto, @Request() req: any) {
    return this.payrollsService.create(createPayrollDto, req.user.userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/generate
  // ─────────────────────────────────────────────────────────────────────────
  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  generateMonthly(
    @Body()
    body: {
      month: number;
      year: number;
      employeeIds?: string[];
      customWorkDays?: number;
      daysOverrides?: Record<string, number>;
    },
    @Request() req: any,
  ) {
    return this.payrollsService.generateMonthlyPayrolls(
      req.user.userId,
      body.month,
      body.year,
      body.employeeIds,
      body.customWorkDays,
      undefined,
      undefined,
      body.daysOverrides,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/generate-stream
  // ✅ Même génération que /generate, mais en NDJSON streamé : chaque
  // employé traité est écrit dans la réponse dès qu'il est terminé (au lieu
  // d'attendre que TOUT le lot soit fini). Permet au front d'afficher une
  // vraie progression en direct (nom, jours travaillés, prêts/avances
  // déduits, net) au lieu d'une barre de progression muette pendant 20-30s
  // sur un gros lot, puis d'un rejoue factice après coup.
  // Format de sortie : une ligne JSON par événement, séparées par "\n" :
  //   {"type":"detail", ...détail employé...}
  //   {"type":"summary", ...récap final identique à /generate...}
  // ─────────────────────────────────────────────────────────────────────────
  @Post('generate-stream')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async generateMonthlyStream(
    @Body()
    body: {
      month: number;
      year: number;
      employeeIds?: string[];
      customWorkDays?: number;
      daysOverrides?: Record<string, number>;
    },
    @Request() req: any,
    @Res() res: Response,
  ) {
    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // évite qu'un proxy (nginx) mette en tampon toute la réponse
    });
    // @ts-ignore — dispo sur la réponse HTTP Node sous-jacente
    res.flushHeaders?.();

    const writeLine = (obj: any) => {
      // Client parti (onglet fermé, coupure réseau) : on n'écrit plus, mais la
      // génération continue côté serveur jusqu'au bout (rien n'est perdu).
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(obj) + '\n');
    };

    // 💓 Battement de cœur : pendant la phase de calcul d'un gros lot (500+
    // bulletins), aucune ligne n'est écrite pendant de longues secondes. Un
    // proxy (Traefik/Coolify, nginx) coupe une connexion silencieuse au bout
    // de 60-180 s. Une ligne toutes les 10 s la maintient ouverte. Le front
    // ignore ce type d'événement.
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      writeLine({ type: 'heartbeat', elapsedMs: Date.now() - startedAt });
    }, 10000);

    try {
      const summary = await this.payrollsService.generateMonthlyPayrolls(
        req.user.userId,
        body.month,
        body.year,
        body.employeeIds,
        body.customWorkDays,
        (detail) => writeLine({ type: 'detail', ...detail }),
        undefined,
        body.daysOverrides,
      );
      writeLine({ type: 'summary', ...summary });
    } catch (error: any) {
      writeLine({
        type: 'error',
        message: error?.message || 'Erreur inconnue',
      });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/batch-status-stream
  // Valider / passer à payer / annuler PLUSIEURS bulletins en une seule
  // requête (flux NDJSON, un événement par bulletin). Avant : le navigateur
  // envoyait un PATCH par bulletin, l'un après l'autre (500 allers-retours,
  // aucun suivi). Ici le serveur traite un bulletin à la fois avec la même
  // logique que PATCH /payrolls/:id, et le front voit la progression.
  // ─────────────────────────────────────────────────────────────────────────
  @Post('batch-status-stream')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async batchStatusStream(
    @Body() body: { payrollIds: string[]; status: 'VALIDATED' | 'TO_PAY' | 'CANCELLED' },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const status = body?.status;
    if (!['VALIDATED', 'TO_PAY', 'CANCELLED'].includes(status as string)) {
      throw new BadRequestException('Statut invalide.');
    }
    const ids = Array.isArray(body?.payrollIds)
      ? [...new Set(body.payrollIds.filter((x) => typeof x === 'string' && x.length > 0))]
      : [];
    if (ids.length === 0) throw new BadRequestException('Aucun bulletin sélectionné.');
    if (ids.length > 2000) throw new BadRequestException('Maximum 2000 bulletins par lot.');

    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // @ts-ignore — dispo sur la réponse HTTP Node sous-jacente
    res.flushHeaders?.();

    const writeLine = (obj: any) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(obj) + '\n');
    };

    let success = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        // Client parti : on s'arrête proprement (chaque bulletin déjà traité
        // reste valide, un nouveau lancement reprend les autres).
        if (res.destroyed || res.writableEnded) break;
        try {
          await this.payrollsService.applyBatchStatusChange(id, status, req.user.userId);
          success++;
          writeLine({ type: 'detail', id, ok: true });
        } catch (error: any) {
          failed++;
          const resp = typeof error?.getResponse === 'function' ? error.getResponse() : null;
          const data = resp && typeof resp === 'object' ? resp : null;
          const rawMessage = (data as any)?.message ?? error?.message ?? 'Erreur';
          writeLine({
            type: 'detail',
            id,
            ok: false,
            message: Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage),
            // Même forme que l'erreur d'un PATCH classique, pour la fenêtre « refus du contrôle de paie »
            code: (data as any)?.error,
            data,
          });
        }
      }
      writeLine({ type: 'summary', total: ids.length, success, failed });
    } catch (error: any) {
      writeLine({ type: 'error', message: error?.message || 'Erreur inconnue' });
    } finally {
      res.end();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/simulate
  // ─────────────────────────────────────────────────────────────────────────
  @Post('simulate')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  simulate(
    @Body()
    body: {
      employeeId: string;
      companyId?: string; // utilisé par le cabinet
      month: string | number;
      year: number;
      workedDays?: number;
      absentDays?: number;
      overtime10?: number;
      overtime25?: number;
      overtime50?: number;
      overtime100?: number;
      bonuses?: any[];
      advanceAmount?: number;
      loanDeduction?: number;
      // anciens noms (rétro-compat)
      baseSalary?: number;
      overtimeHours10?: number;
      overtimeHours25?: number;
      overtimeHours50?: number;
      overtimeHours100?: number;
      manualBonuses?: any[];
    },
    @Request() req: any,
  ) {
    const { employeeId, month, year, ...rest } = body;
    validateSimulationItems(rest.bonuses, 'bonuses');

    // Normaliser les noms de champs (front cabinet → back)
    const overrides: any = {
      ...rest,
      workedDays: rest.workedDays ?? rest.workedDays,
      overtimeHours10: rest.overtime10 ?? rest.overtimeHours10,
      overtimeHours25: rest.overtime25 ?? rest.overtimeHours25,
      overtimeHours50: rest.overtime50 ?? rest.overtimeHours50,
      overtimeHours100: rest.overtime100 ?? rest.overtimeHours100,
      manualBonuses:
        rest.bonuses?.map((b: any) => ({
          bonusType: b.label ?? b.bonusType,
          amount: b.amount,
          isTaxable: b.isTaxable ?? true,
          isCnss: b.isCnss ?? true,
          fiscalType: b.fiscalType,
        })) ?? rest.manualBonuses,
      advanceAmount: rest.advanceAmount,
      loanDeduction: rest.loanDeduction,
    };

    return this.payrollsService.simulatePayroll(
      employeeId,
      month,
      year,
      req.user.userId,
      overrides,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/simulate-batch
  // ─────────────────────────────────────────────────────────────────────────
  @Post('simulate-batch')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  simulateBatch(
    @Body()
    body: {
      employeeIds: string[];
      month: number;
      year: number;
      workDays?: number;
      daysOverrides?: Record<string, number>;
    },
    @Request() req: any,
  ) {
    return this.payrollsService.simulateBatchPayroll(
      body.employeeIds,
      body.month,
      body.year,
      req.user.userId,
      {
        workDays: body.workDays,
        daysOverrides: body.daysOverrides,
        // ⚡ Estimation seulement : réutilise les résumés de présence calculés
        // il y a moins de 2 min au lieu de recalculer TOUTE l'entreprise à
        // chaque changement de sélection. La génération réelle recalcule
        // toujours à neuf (aucun cache).
        summariesMaxAgeMs: 120000,
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/simulate-free — Simulation libre sans compte
  // ─────────────────────────────────────────────────────────────────────────
  @Post('simulate-free')
  simulateFree(@Body() body: any, @Request() req: any) {
    // userId → charge les taxes configurées de l'entreprise (CAMU, etc.)
    return this.payrollsService.simulateFree(body, req.user?.userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls/declarations-summary  ← NOUVEAU (attendu par declarations/page)
  // ─────────────────────────────────────────────────────────────────────────
  @Get('declarations-summary')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  getDeclarationsSummary(
    @Query('companyId') companyId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req,
  ) {
    return this.payrollsService.getDeclarationsSummary(
      companyId,
      month,
      year,
      req.user.userId,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls/journal
  // ─────────────────────────────────────────────────────────────────────────
  @Get('journal')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  getJournal(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
  ) {
    return this.payrollsService.getAccountingJournal(
      req.user.userId,
      month,
      year,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls
  // ─────────────────────────────────────────────────────────────────────────
  @Get()
  findAll(
    @Request() req: any,
    @Query('employeeId') employeeId?: string,
    @Query('companyId') companyId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.payrollsService.findAll(req.user.userId, employeeId, {
      companyId,
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
      limit: limit ? Number(limit) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/manual-simulate — Simulation manuelle (sans pointeuse)
  // ─────────────────────────────────────────────────────────────────────────
  @Post('manual-simulate')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  manualSimulate(@Body() dto: CreateManualPayrollDto, @Request() req: any) {
    return this.manualPayrollService.simulate(dto, req.user.userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /payrolls/manual — Enregistrement bulletin manuel (sans pointeuse)
  // ─────────────────────────────────────────────────────────────────────────
  @Post('manual')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  manualSave(@Body() dto: CreateManualPayrollDto, @Request() req: any) {
    return this.manualPayrollService.save(dto, req.user.userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /payrolls/:id
  // ─────────────────────────────────────────────────────────────────────────
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any, @Query('companyId') companyId?: string) {
    return this.payrollsService.findOne(id, req.user.userId, companyId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /payrolls/:id/recalculate
  // ─────────────────────────────────────────────────────────────────────────
  @Patch(':id/recalculate')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  recalculate(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.payrollsService.recalculatePayroll(id, req.user.userId, body);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /payrolls/:id
  // ─────────────────────────────────────────────────────────────────────────
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  update(
    @Param('id') id: string,
    @Body() updatePayrollDto: UpdatePayrollDto,
    @Request() req: any,
  ) {
    return this.payrollsService.update(id, updatePayrollDto, req.user.userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /payrolls/:id
  // ─────────────────────────────────────────────────────────────────────────
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  remove(@Param('id') id: string, @Request() req) {
    return this.payrollsService.remove(id, req.user.userId);
  }

  // =========================================================================
  // EXPORTS
  // =========================================================================

  // GET /payrolls/export/excel
  @Get('export/excel')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async exportExcel(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Res() res: Response,
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

  // GET /payrolls/export/sage  (ancien)
  @Get('export/sage')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async exportSageGet(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Res() res: Response,
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

  // POST /payrolls/export/sage  ← NOUVEAU (attendu par bulletins/page)
  @Post('export/sage')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async exportSagePost(
    @Body() body: { payrollIds: string[]; companyId?: string },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const text = await this.exportService.exportToSageByIds(
      body.payrollIds,
      body.companyId,
      req.user.userId,
    );
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="sage-paie.txt"`,
    });
    res.send(text);
  }

  // POST /payrolls/export/batch-pdf  ← NOUVEAU (attendu par bulletins/page)
  @Post('export/batch-pdf')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async exportBatchPdf(
    @Body() body: { payrollIds: string[] },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.exportBatchPdf(
      body.payrollIds,
      req.user.userId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="bulletins.pdf"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }

  // POST /payrolls/export/declarations-pdf  ← NOUVEAU (attendu par declarations/page)
  @Post('export/declarations-pdf')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async exportDeclarationsPdf(
    @Body() body: { companyId?: string; month: number; year: number },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.exportDeclarationsPdf(
      body.companyId,
      body.month,
      body.year,
      req.user.userId,
    );
    const mm = String(body.month).padStart(2, '0');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="declarations-${mm}-${body.year}.pdf"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }

  // GET /payrolls/export/etax
  @Get('export/etax')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async exportETax(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const result = await this.exportService.generateEtaxExport(
      req.user.userId,
      month,
      year,
    );
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

  // GET /payrolls/export/csv
  @Get('export/csv')
  @UseGuards(RolesGuard)
  @Roles(...PAYROLL_ROLES)
  async exportCSV(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const text = await this.exportService.exportToCSV(
      req.user.userId,
      month,
      year,
    );
    const mm = String(month).padStart(2, '0');
    const bom = '\uFEFF';
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="paie_${mm}_${year}.csv"`,
    });
    res.send(bom + text);
  }
}