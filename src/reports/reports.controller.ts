// ============================================================================
// 📁 src/reports/reports.controller.ts
// ============================================================================
import {
  Controller,
  Get,
  UseGuards,
  Request,
  Response,
  Query,
  Param,
  ParseIntPipe,
  Optional,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { PayrollRecapService } from './payroll-recap.service';
import { PayrollRecapExportService } from './payroll-recap-export.service';
import { Das1DeclarationService } from './das1-declaration.service';
import { fillBulletinAnnuelTemplate } from './export-bulletin-annuel-template';
import { AuthGuard } from '@nestjs/passport';

@Controller('reports')
@UseGuards(AuthGuard('jwt'))
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly payrollRecapService: PayrollRecapService,
    private readonly payrollRecapExportService: PayrollRecapExportService,
    private readonly das1Service: Das1DeclarationService,
  ) {}

  /**
   * ✅ Récapitulatif mensuel "modèle Excel" — brut, CNSS, IRPP, indemnités
   * (transport/salissure/panier/...), avance, pharmacie, TOL, taxe dépt.
   * GET /reports/personnel-recap?month=&year=&companyId=xxx
   */
  @Get('personnel-recap')
  getPersonnelRecap(
    @Request() req,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    return this.payrollRecapService.getMonthlyRecap(req.user.userId, month, year, companyId);
  }

  /**
   * ✅ Récapitulatif annuel — même structure, cumulée sur les 12 mois.
   * GET /reports/personnel-recap/annual?year=&companyId=xxx
   */
  @Get('personnel-recap/annual')
  getPersonnelRecapAnnual(
    @Request() req,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    return this.payrollRecapService.getAnnualRecap(req.user.userId, year, companyId);
  }

  /**
   * ✅ Export Excel du récap mensuel — design pro, cellules déverrouillées
   * (modifiables à la main), formules SUM sur la ligne TOTAUX.
   * GET /reports/personnel-recap/export?month=&year=&companyId=xxx
   */
  @Get('personnel-recap/export')
  async exportPersonnelRecap(
    @Request() req,
    @Response() res: any,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    const [recap, companyName] = await Promise.all([
      this.payrollRecapService.getMonthlyRecap(req.user.userId, month, year, companyId),
      this.payrollRecapService.getCompanyName(req.user.userId, companyId),
    ]);
    const buffer = await this.payrollRecapExportService.exportMonthly(recap, companyName);
    const mm = String(month).padStart(2, '0');

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="recap_personnel_${mm}_${year}.xlsx"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }

  /**
   * ✅ Export Excel du récap annuel — synthèse + une feuille par mois.
   * GET /reports/personnel-recap/annual/export?year=&companyId=xxx
   */
  @Get('personnel-recap/annual/export')
  async exportPersonnelRecapAnnual(
    @Request() req,
    @Response() res: any,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    const [recap, companyName] = await Promise.all([
      this.payrollRecapService.getAnnualRecap(req.user.userId, year, companyId),
      this.payrollRecapService.getCompanyName(req.user.userId, companyId),
    ]);

    // Feuilles mensuelles détaillées, une par mois disponible dans l'année.
    const monthsWithData = recap.monthlyTotals.map((m) => m.month);
    const monthlyBreakdown = await Promise.all(
      monthsWithData.map((m) =>
        this.payrollRecapService.getMonthlyRecap(req.user.userId, m, year, companyId),
      ),
    );

    const buffer = await this.payrollRecapExportService.exportAnnual(
      recap,
      companyName,
      monthlyBreakdown,
    );

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="recap_personnel_annuel_${year}.xlsx"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }

  /**
   * ✅ Vue d'ensemble générale
   * GET /reports/overview?companyId=xxx (optionnel, pour cabinet)
   */
  @Get('overview')
  getOverview(@Request() req, @Query('companyId') companyId?: string) {
    return this.reportsService.getOverview(req.user.userId, companyId);
  }

  /**
   * ✅ Analyse de paie (masse salariale, tendances, etc.)
   * GET /reports/payroll?companyId=xxx
   */
  @Get('payroll')
  getPayrollAnalysis(@Request() req, @Query('companyId') companyId?: string) {
    return this.reportsService.getPayrollAnalysis(req.user.userId, companyId);
  }

  /**
   * ✅ Analyse des effectifs (démographie, pyramide des âges)
   * GET /reports/workforce?companyId=xxx
   */
  @Get('workforce')
  getWorkforceAnalysis(
    @Request() req,
    @Query('companyId') companyId?: string,
    @Query('department') department?: string,
    @Query('contractType') contractType?: string,
    @Query('nationality') nationality?: string,
    @Query('year') year?: string,
  ) {
    return this.reportsService.getWorkforceAnalysis(req.user.userId, companyId, {
      department,
      contractType,
      nationality,
      year: year ? parseInt(year, 10) : undefined,
    });
  }

  /**
   * 🆕 Détail des employés d'une nationalité — alimente le panneau latéral
   * ouvert au clic sur une barre du graphique "Effectif par nationalité".
   * GET /reports/workforce/nationality/:nationality?companyId=xxx
   */
  @Get('workforce/nationality/:nationality')
  getEmployeesByNationality(
    @Request() req,
    @Param('nationality') nationality: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getEmployeesByNationality(
      req.user.userId,
      decodeURIComponent(nationality),
      companyId,
    );
  }

  /**
   * 🆕 Liste des employés présents à une date donnée (mois/année), paginée,
   * avec recherche par nom/matricule/poste — composant "Effectif par mois".
   * GET /reports/workforce/employees?year=&month=&search=&page=&limit=
   */
  @Get('workforce/employees')
  getEmployeesAtDate(
    @Request() req,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('contractType') contractType?: string,
    @Query('nationality') nationality?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getEmployeesAtDate(
      req.user.userId,
      {
        year: year ? parseInt(year, 10) : new Date().getFullYear(),
        month: month ? parseInt(month, 10) : undefined,
        search,
        department,
        contractType,
        nationality,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 25,
      },
      companyId,
    );
  }

  /**
   * ✅ Analyse des congés (répartition, saisonnalité)
   * GET /reports/leaves?companyId=xxx
   */
  @Get('leaves')
  getLeaveAnalysis(@Request() req, @Query('companyId') companyId?: string) {
    return this.reportsService.getLeaveAnalysis(req.user.userId, companyId);
  }

  /**
   * 🆕 Indicateurs performance — objectifs (Goal) & entretiens (PerformanceReview)
   * GET /reports/performance-indicators?companyId=xxx
   */
  @Get('performance-indicators')
  getPerformanceIndicators(
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getPerformanceIndicators(
      req.user.userId,
      companyId,
    );
  }

  /**
   * 🆕 Indicateurs recrutement — offres (JobOffer) & candidatures (Candidate)
   * GET /reports/recruitment-indicators?companyId=xxx
   */
  @Get('recruitment-indicators')
  getRecruitmentIndicators(
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getRecruitmentIndicators(
      req.user.userId,
      companyId,
    );
  }

  /**
   * 🆕 Indicateurs formation — TrainingCourse & EmployeeTraining
   * GET /reports/training-indicators?companyId=xxx
   */
  @Get('training-indicators')
  getTrainingIndicators(
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getTrainingIndicators(
      req.user.userId,
      companyId,
    );
  }

  /**
   * ✅ Rapport heures supplémentaires détaillé
   * GET /reports/overtime?month=12&year=2025&companyId=xxx
   */
  @Get('overtime')
  getOvertimeReport(
    @Request() req,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getOvertimeAnalysis(
      req.user.userId,
      month,
      year,
      companyId,
    );
  }

  /**
   * ✅ Rapport par département (masse salariale + effectif)
   * GET /reports/departments?companyId=xxx
   */
  @Get('departments')
  getDepartmentReport(@Request() req, @Query('companyId') companyId?: string) {
    return this.reportsService.getDepartmentAnalysis(
      req.user.userId,
      companyId,
    );
  }

  /**
   * ✅ Comparaison mois précédent
   * GET /reports/comparison?month=12&year=2025&companyId=xxx
   */
  @Get('comparison')
  getMonthComparison(
    @Request() req,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getMonthComparison(
      req.user.userId,
      month,
      year,
      companyId,
    );
  }

  /**
   * 🆕 Vue Département unifiée — coût + effectif + absences + retards + turnover + alertes
   * GET /reports/department-traceability?companyId=xxx
   */
  @Get('department-traceability')
  getDepartmentTraceability(
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getDepartmentTraceability(
      req.user.userId,
      companyId,
    );
  }

  /**
   * 🆕 Vue Employé — traçabilité individuelle (retards, absences, coût, ancienneté) + alertes
   * GET /reports/employee-traceability?companyId=xxx
   */
  @Get('employee-traceability')
  getEmployeeTraceability(
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.reportsService.getEmployeeTraceability(
      req.user.userId,
      companyId,
    );
  }

  /**
   * ✅ Top employés (heures sup, absences, etc.)
   * GET /reports/top-employees?companyId=xxx
   */
  @Get('top-employees')
  getTopEmployees(@Request() req, @Query('companyId') companyId?: string) {
    return this.reportsService.getTopEmployeesReport(
      req.user.userId,
      companyId,
    );
  }

  /**
   * ✅ Déclaration Annuelle des Salaires — DAS 1 (Bulletin Individuel),
   * données JSON pour prévisualisation dans l'appli.
   * GET /reports/das1?year=&companyId=xxx
   */
  @Get('das1')
  getDas1(
    @Request() req,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    return this.das1Service.getAnnualDeclaration(req.user.userId, year, companyId);
  }

  /**
   * ✅ Export Excel du Bulletin Annuel — écrit directement sur le template
   * réel (bulletin-annuel-template.xlsx), même principe que la déclaration
   * DAS : un bloc par employé, une page imprimable chacune.
   * GET /reports/das1/export?year=&companyId=xxx
   */
  @Get('das1/export')
  async exportDas1(
    @Request() req,
    @Response() res: any,
    @Query('year', ParseIntPipe) year: number,
    @Query('companyId') companyId?: string,
  ) {
    const declaration = await this.das1Service.getAnnualDeclaration(req.user.userId, year, companyId);
    const buffer = await fillBulletinAnnuelTemplate(declaration);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Bulletin_Annuel_${year}.xlsx"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }

  /**
   * ✅ Évolution pluriannuelle — "comment était l'entreprise il y a 2 ans,
   * 5 ans, de 2020 à 2022..." — un point par année sur la plage demandée
   * (brut, net, charges salariales, charges patronales, coût total).
   * GET /reports/yearly-trend?yearFrom=2020&yearTo=2028&month=8&companyId=xxx
   * (month optionnel : compare ce mois précis d'une année à l'autre ;
   * omis = compare le cumul de l'année entière)
   */
  @Get('yearly-trend')
  getYearlyTrend(
    @Request() req,
    @Query('yearFrom', ParseIntPipe) yearFrom: number,
    @Query('yearTo', ParseIntPipe) yearTo: number,
    @Query('month') month: string | undefined,
    @Query('companyId') companyId?: string,
  ) {
    const monthNum = month ? parseInt(month, 10) : undefined;
    return this.reportsService.getYearlyTrend(
      req.user.userId,
      yearFrom,
      yearTo,
      monthNum,
      companyId,
    );
  }
}