// ============================================================================
// 📁 src/absence-tracking/absence-tracking.controller.ts
// ✅ Endpoints LECTURE SEULE, réutilisés par 2 pages front :
//    - "Suivi des absences"       (?scope=all, ou omis)
//    - "Analyse des congés"       (?scope=leave)
//    (distinct de "Demande d'absence" géré par absence-requests.controller.ts
//    — aucune logique de workflow ici)
// ============================================================================

import { Controller, Get, Query, Param, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AbsenceTrackingService } from './absence-tracking.service';
import { AbsenceScope } from './absence-tracking.constants';

@Controller('absence-tracking')
@UseGuards(AuthGuard('jwt'))
export class AbsenceTrackingController {
  constructor(private readonly service: AbsenceTrackingService) {}

  /** Grille calendrier employé x jour pour un mois donné */
  @Get('grid')
  getGrid(
    @Request() req,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('departmentId') departmentId?: string,
    @Query('scope') scope?: string,
  ) {
    return this.service.getMonthlyGrid(req.user.userId, this.toInt(year), this.toInt(month), departmentId, this.toScope(scope));
  }

  /** Tableau de bord du mois : répartition par type/service, top 20, absents aujourd'hui */
  @Get('dashboard')
  getDashboard(@Request() req, @Query('year') year: string, @Query('month') month: string, @Query('scope') scope?: string) {
    return this.service.getMonthlyDashboard(req.user.userId, this.toInt(year), this.toInt(month), this.toScope(scope));
  }

  /** Journal détaillé du mois — qui, quel motif, quelle période, payé ou non — pour la traçabilité RH/DG */
  @Get('month-journal')
  getMonthJournal(@Request() req, @Query('year') year: string, @Query('month') month: string, @Query('scope') scope?: string) {
    return this.service.getMonthJournal(req.user.userId, this.toInt(year), this.toInt(month), this.toScope(scope));
  }

  /** Vue annuelle (12 mois) : courbe d'évolution + répartition par service */
  @Get('yearly-overview')
  getYearlyOverview(@Request() req, @Query('year') year: string, @Query('scope') scope?: string) {
    return this.service.getYearlyOverview(req.user.userId, this.toInt(year), this.toScope(scope));
  }

  /** Zoom annuel sur UN service : répartition par code, mois par mois */
  @Get('yearly-department-focus')
  getYearlyDepartmentFocus(
    @Request() req,
    @Query('year') year: string,
    @Query('departmentId') departmentId: string,
    @Query('scope') scope?: string,
  ) {
    if (!departmentId) throw new BadRequestException('Le paramètre "departmentId" est requis');
    return this.service.getYearlyDepartmentFocus(req.user.userId, this.toInt(year), departmentId, this.toScope(scope));
  }

  /** Comparaison pluriannuelle : ?years=2026,2027,2028 (jusqu'à 5 années) */
  @Get('compare')
  compareYears(@Request() req, @Query('years') years: string, @Query('scope') scope?: string) {
    if (!years) throw new BadRequestException('Le paramètre "years" est requis (ex: 2026,2027,2028)');
    const parsed = years.split(',').map((y) => this.toInt(y.trim()));
    if (parsed.length < 2) throw new BadRequestException('Fournissez au moins 2 années à comparer');
    if (parsed.length > 5) throw new BadRequestException('5 années maximum par comparaison');
    return this.service.compareYears(req.user.userId, parsed, this.toScope(scope));
  }

  /** Détail d'un employé : camembert du mois + vue annuelle */
  @Get('employee/:employeeId')
  getEmployeeDetail(
    @Request() req,
    @Param('employeeId') employeeId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('scope') scope?: string,
  ) {
    return this.service.getEmployeeDetail(req.user.userId, employeeId, this.toInt(year), this.toInt(month), this.toScope(scope));
  }

  private toInt(value: string): number {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) throw new BadRequestException(`Paramètre numérique invalide: "${value}"`);
    return n;
  }

  private toScope(value?: string): AbsenceScope {
    if (value === 'leave' || value === 'absence_request') return value;
    return 'all';
  }
}