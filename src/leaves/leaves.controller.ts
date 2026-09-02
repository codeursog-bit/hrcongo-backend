// ============================================================================
// 📁 src/leaves/leaves.controller.ts
// ✅ Support cabinet : ?companyId= query param optionnel
//    Pour les users ENTREPRISE : companyId ignoré, comportement original
//    Pour les CABINET_ADMIN    : companyId requis (fourni par le front cabinet)
// ✅ FIX (04/08/2026) : 'balances' et 'provision' étaient déclarées APRÈS
//    @Get(':id') → NestJS matchait GET /leaves/balances et GET /leaves/provision
//    sur findOne(), qui tentait ensuite prisma.leave.findUnique({ id: "balances" })
//    → PrismaClientKnownRequestError (UUID invalide). Toute route à segment
//    unique doit être déclarée AVANT ':id'.
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { LeavesService } from './leaves.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('leaves')
@UseGuards(AuthGuard('jwt'))
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  /**
   * Calcule automatiquement la date de retour à partir d'une date de départ
   * et d'un nombre de jours ouvrables — utilisé en direct par le formulaire
   * de demande pour ne plus faire deviner la date de retour.
   */
  @Get('calculate-return-date')
  calculateReturnDate(
    @Query('employeeId') employeeId: string,
    @Query('startDate') startDate: string,
    @Query('days') days: string,
  ) {
    return this.leavesService.calculateReturnDate(
      employeeId,
      new Date(startDate),
      parseFloat(days),
    );
  }

  /**
   * Vue combinée congé + absence pour la page "Gestion des congés"
   * (KPI + liste filtrable par mois/type/sous-type/statut).
   */
  @Get('management-overview')
  getManagementOverview(
    @Request() req,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('type') type?: string,
    @Query('subType') subType?: string,
    @Query('status') status?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.getManagementOverview(
      req.user.userId,
      {
        month: month ? parseInt(month) : undefined,
        year: year ? parseInt(year) : undefined,
        type,
        subType,
        status,
      },
      companyId,
    );
  }

  /** Historique complet (congé + absence) d'un employé — fiche employé
   *  ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet */
  @Get('employee-history/:employeeId')
  getEmployeeLeaveHistory(
    @Param('employeeId') employeeId: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.getEmployeeLeaveHistory(
      employeeId,
      req.user.userId,
      companyId,
    );
  }

  /**
   * Télécharge le "Programme des départs en congé" Orca rempli (2 onglets)
   * pour un mois donné — écriture directe dans leur fichier .xlsx original.
   */
  @Get('planning/document.xlsx')
  async downloadOrcaPlanningDocument(
    @Request() req,
    @Query('month') month: string,
    @Query('year') year: string,
    @Res() res: Response,
    @Query('companyId') companyId?: string,
  ) {
    const buffer = await this.leavesService.generateOrcaPlanningDocument(
      req.user.userId,
      Number(month),
      Number(year),
      companyId,
    );
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="programme-conges-${year}-${String(month).padStart(2, '0')}.xlsx"`,
    });
    res.send(buffer);
  }

  /**
   * RH/Admin confirme que l'employé est bien revenu de congé — arrête les
   * rappels quotidiens pour cette demande.
   * `actualReturnDate` (optionnel) : à fournir seulement si le retour est
   * ANTICIPÉ (avant la date de retour prévue) — calcule alors les jours
   * ouvrables du congé posé qui n'ont pas été pris (perdus, non reversés
   * au solde). Omis → comportement inchangé (confirmation simple).
   */
  @Patch(':id/confirm-return')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  confirmLeaveReturn(
    @Param('id') id: string,
    @Request() req,
    @Body('actualReturnDate') actualReturnDate?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.confirmLeaveReturn(
      id,
      req.user.userId,
      actualReturnDate ? new Date(actualReturnDate) : undefined,
      companyId,
    );
  }

  // ============================================================================
  // 📝 DEMANDES DE CONGÉ
  // ============================================================================

  /**
   * Créer une demande de congé.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   * Pour les users entreprise, ce param est ignoré (getUserWithCompany utilise user.companyId)
   */
  @Post()
  create(
    @Body() dto: CreateLeaveDto,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.create(dto, req.user.userId, companyId);
  }

  /**
   * Planifier un congé directement pour un employé (RH/Admin) — créé
   * APPROVED immédiatement, sans passer par le flux demande → validation.
   * Prime automatiquement sur le calcul théorique du programme des départs
   * pour la période couverte.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Post('manual')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  createManual(
    @Body()
    dto: {
      employeeId: string;
      type: 'ANNUAL' | 'ANNUAL_ANTICIPATED';
      startDate: string;
      endDate: string;
      reason?: string;
      extraDaysGranted?: number;
      resumptionNote?: string;
    },
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.createManual(dto, req.user.userId, companyId);
  }

  /**
   * Liste des congés.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Get()
  findAll(
    @Request() req,
    @Query('employeeId') employeeId?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.findAll(req.user.userId, employeeId, companyId);
  }

  @Get('yearly-trend')
  getYearlyLeaveTrend(
    @Request() req,
    @Query('year') year: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.getYearlyLeaveTrend(
      req.user.userId,
      Number(year),
      companyId,
    );
  }

  /**
   * Programme des départs — page PUBLIQUE (visible par tous les employés).
   * Ne renvoie JAMAIS de montant/indemnité. Distinct de 'planning' (RH/Admin
   * uniquement, avec les montants à payer).
   */
  @Get('departure-program')
  getDepartureProgram(
    @Query('month') month: string,
    @Query('year') year: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.getDepartureProgram(
      req.user.userId,
      Number(month),
      Number(year),
      companyId,
    );
  }

  @Get('planning')
  getMonthlyPlanning(
    @Query('month') month: string,
    @Query('year') year: string,
    @Request() req,
    @Query('companyId') companyId?: string,
    @Query('mode') mode?: 'departures' | 'payable',
  ) {
    return this.leavesService.getMonthlyPlanning(
      req.user.userId,
      Number(month),
      Number(year),
      companyId,
      mode || 'departures',
    );
  }

  /** Mes congés (employé connecté — non utilisé par cabinet) */
  @Get('me')
  findMyLeaves(@Request() req) {
    return this.leavesService.findMyLeaves(req.user.userId);
  }

  /** Mon solde de congés (employé connecté) */
  @Get('me/balance')
  getMyBalance(@Request() req) {
    return this.leavesService.getMyBalance(req.user.userId);
  }

  // ============================================================================
  // 📊 SOLDES
  // ✅ Segments uniques ('balances') — DOIVENT rester avant ':id' ci-dessous,
  //    sinon NestJS route GET /leaves/balances vers findOne() avec id="balances".
  // ============================================================================

  /** Solde (cycle en cours) de TOUS les employés actifs (RH/Admin/Cabinet) */
  @Get('balances')
  getAllBalances(@Request() req, @Query('companyId') companyId?: string) {
    return this.leavesService.getAllEmployeeBalances(
      req.user.userId,
      companyId,
    );
  }

  /** Solde (cycle en cours) d'un employé.
   *  ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet */
  @Get('balance/:employeeId')
  getBalance(
    @Param('employeeId') employeeId: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.getEmployeeBalanceDetails(
      employeeId,
      req.user.userId,
      companyId,
    );
  }

  /**
   * Ajustement manuel du solde congé d'un employé (onboarding, reprise d'un
   * solde existant avant Konza RH, correction...). Réservé RH/Admin.
   * S'applique toujours au cycle en cours de l'employé.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Patch('balance/:employeeId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  setManualBalance(
    @Param('employeeId') employeeId: string,
    @Body('annualEntitled') annualEntitled: number,
    @Body('annualTaken') annualTaken: number,
    @Body('note') note: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.setManualBalance(
      employeeId,
      annualEntitled,
      annualTaken,
      note,
      req.user.userId,
      companyId,
    );
  }

  /**
   * Reprise du solde à la migration — via le dernier congé connu (départ +
   * retour) plutôt qu'un solde figé à la main. Voir la doc du service pour
   * le détail du comportement normal vs anticipé. Réservé RH/Admin.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Post('employee/:employeeId/seed-from-last-leave')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  seedBalanceFromLastLeave(
    @Param('employeeId') employeeId: string,
    @Body('lastLeaveType') lastLeaveType: 'ANNUAL' | 'ANNUAL_ANTICIPATED',
    @Body('startDate') startDate: string,
    @Body('endDate') endDate: string,
    @Body('remainingDays') remainingDays: number,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.seedBalanceFromLastLeave(
      employeeId,
      lastLeaveType,
      new Date(startDate),
      new Date(endDate),
      remainingDays,
      req.user.userId,
      companyId,
    );
  }

  // ============================================================================
  // 💰 PROVISION (dette sociale — uniquement entreprise ou cabinet avec companyId)
  // ✅ Segment unique ('provision') — DOIT rester avant ':id' ci-dessous, même
  //    raison que 'balances' plus haut.
  // ============================================================================

  /**
   * Provision totale pour congés non pris.
   * ?companyId= : requis pour le cabinet, ignoré pour entreprise (utilise user.companyId)
   */
  @Get('provision')
  async getProvision(@Request() req, @Query('companyId') companyId?: string) {
    // Résoudre companyId : cabinet passe le sien, entreprise utilise le sien
    const isCabinet =
      req.user.role === 'CABINET_ADMIN' ||
      req.user.role === 'CABINET_GESTIONNAIRE';

    if (isCabinet) {
      if (!companyId) {
        return { totalProvision: 0, currency: 'XAF', details: [] };
      }
      return this.leavesService.getLeaveProvision(companyId);
    }

    // User entreprise : on résout depuis la BDD
    const user = await this.leavesService['prisma'].user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId)
      return { totalProvision: 0, currency: 'XAF', details: [] };
    return this.leavesService.getLeaveProvision(user.companyId);
  }

  // ============================================================================
  // 🔗 IMPACT PAIE (utilisé par PayrollGeneratorService en interne + cabinet en HTTP)
  // ⚠️ Le service sous-jacent (getLeaveImpactForPayroll/calculateLeaveIndemnity)
  // n'a PAS de vérification d'entreprise — il est aussi appelé en interne par
  // PayrollGeneratorService sans contexte utilisateur HTTP, donc sa signature
  // ne doit pas changer. Le contrôle d'accès se fait ICI, avant l'appel, pour
  // les deux routes HTTP exposées.
  // ============================================================================

  @Get('payroll-impact/:employeeId')
  async getPayrollImpact(
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    await this.leavesService.assertEmployeeAccess(
      employeeId,
      req.user.userId,
      companyId,
    );
    return this.leavesService.getLeaveImpactForPayroll(
      employeeId,
      parseInt(month),
      parseInt(year),
    );
  }

  @Get('indemnity/:employeeId')
  async calculateIndemnity(
    @Param('employeeId') employeeId: string,
    @Query('days') days: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    await this.leavesService.assertEmployeeAccess(
      employeeId,
      req.user.userId,
      companyId,
    );
    return this.leavesService.calculateLeaveIndemnity(
      employeeId,
      parseInt(days || '1'),
    );
  }

  // ============================================================================
  // 🔎 ROUTE DYNAMIQUE ':id' — TOUJOURS EN DERNIER parmi les GET
  // ⚠️ Toute nouvelle route à segment unique (ex: 'stats', 'export') doit être
  // ajoutée AU-DESSUS de ce bloc, jamais en dessous.
  // ============================================================================

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.findOne(id, req.user.userId, companyId);
  }

  /**
   * Approuver ou rejeter une demande.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @Body('rejectionReason') rejectionReason: string,
    @Request() req,
    @Query('companyId') companyId?: string,
    @Body('extraDaysGranted') extraDaysGranted?: number,
    @Body('resumptionNote') resumptionNote?: string,
  ) {
    return this.leavesService.updateStatus(
      id,
      status,
      req.user.userId,
      rejectionReason,
      companyId,
      extraDaysGranted,
      resumptionNote,
    );
  }

  /**
   * Replanifier (déplacer) un congé déjà approuvé/planifié — le RH peut
   * bouger un départ quand il veut (ex: du 2 au 10) sans blocage de solde
   * et sans ajouter de jours en trop : seul l'écart entre ancien et nouveau
   * nombre de jours ouvrés est ajusté sur le solde, pas le total. Le mois de
   * paiement de l'indemnité (s'il y en a un) n'est pas déplacé.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Patch(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body('startDate') startDate: string,
    @Body('endDate') endDate: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.rescheduleLeave(
      id,
      req.user.userId,
      new Date(startDate),
      new Date(endDate),
      companyId,
    );
  }

  /**
   * Annuler un congé.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.cancel(id, req.user.userId, reason, companyId);
  }

  /**
   * Données résolues pour le rendu du document imprimable (générique ou Orca).
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Get(':id/document-data')
  getDocumentData(
    @Param('id') id: string,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.getDocumentData(id, req.user.userId, companyId);
  }

  /**
   * Télécharge le document Word Orca rempli (écriture directe dans leur
   * fichier .docx original — pas une reproduction HTML). 404 côté service
   * si l'entreprise n'est pas sur le modèle ORCA.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Get(':id/document.docx')
  async downloadOrcaDocument(
    @Param('id') id: string,
    @Request() req,
    @Res() res: Response,
    @Query('companyId') companyId?: string,
  ) {
    const buffer = await this.leavesService.generateOrcaDocument(
      id,
      req.user.userId,
      companyId,
    );
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="demande-conge-${id.slice(0, 8)}.docx"`,
    });
    res.send(buffer);
  }

  /**
   * Autoriser (ou retirer l'autorisation) l'impression du document pour l'employé.
   * Réservé RH/Admin — la demande doit déjà être APPROVED.
   * ?companyId= : optionnel, utilisé UNIQUEMENT par le cabinet
   */
  @Patch(':id/print-authorization')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  setPrintAuthorization(
    @Param('id') id: string,
    @Body('authorized') authorized: boolean,
    @Request() req,
    @Query('companyId') companyId?: string,
  ) {
    return this.leavesService.setPrintAuthorization(
      id,
      authorized,
      req.user.userId,
      companyId,
    );
  }
}