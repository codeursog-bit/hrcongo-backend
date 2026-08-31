// ============================================================================
// 📁 loans.controller.ts
// ✅ v3 — décision PARALLÈLE (une seule route /decision, DRH et DG reçoivent
//    en même temps, le premier présent tranche). Édition/suppression,
//    remboursement en espèces, historique inchangés.
// ⚠️ ORDRE DES ROUTES IMPORTANT : toutes les routes fixes ('advances', 'me'...)
//    sont déclarées AVANT ':id' — sinon NestJS interprète '/loans/advances'
//    comme '/loans/:id' avec id="advances" (même piège que documenté pour
//    /leaves/planning vs /leaves/:id).
// ============================================================================

import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards, HttpCode } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { UpdateAdvanceDto } from './dto/update-advance.dto';

@Controller('loans')
@UseGuards(JwtAuthGuard)
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  // ==================== PRÊTS — routes fixes d'abord ====================

  @Post()
  @HttpCode(201)
  createLoan(@Body() data: CreateLoanDto, @GetUser('id') userId: string) {
    return this.loansService.createLoan(data, userId);
  }

  @Get()
  findAllLoans(@GetUser('id') userId: string, @Query('status') status?: string) {
    return this.loansService.findAllLoans(userId, status);
  }

  @Get('me')
  findMyLoans(@GetUser('id') userId: string) {
    return this.loansService.findMyLoans(userId);
  }

  // ==================== AVANCES — toutes déclarées AVANT /loans/:id ====================

  @Post('advances')
  @HttpCode(201)
  createAdvance(@Body() data: CreateAdvanceDto, @GetUser('id') userId: string) {
    return this.loansService.createAdvance(data, userId);
  }

  @Get('advances/me')
  findMyAdvances(@GetUser('id') userId: string) {
    return this.loansService.findMyAdvances(userId);
  }

  @Get('advances')
  findAllAdvances(@GetUser('id') userId: string, @Query('status') status?: string) {
    return this.loansService.findAllAdvances(userId, status);
  }

  @Get('advances/:id')
  findOneAdvance(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.findOneAdvance(id, userId);
  }

  @Patch('advances/:id')
  updateAdvance(@Param('id') id: string, @Body() dto: UpdateAdvanceDto, @GetUser('id') userId: string) {
    return this.loansService.updateAdvance(id, dto, userId);
  }

  @Delete('advances/:id')
  deleteAdvance(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.deleteAdvance(id, userId);
  }

  @Patch('advances/:id/cancel')
  cancelAdvance(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.cancelAdvance(id, userId);
  }

  @Patch('advances/:id/decision')
  decideAdvance(
    @Param('id') id: string,
    @Body('decision') decision: 'APPROVED' | 'REJECTED',
    @Body('rejectionReason') rejectionReason: string,
    @Body('recoverViaPayroll') recoverViaPayroll: boolean,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.decideAdvance(id, decision, userId, rejectionReason, recoverViaPayroll ?? true);
  }

  @Patch('advances/:id/mark-paid-cash')
  markAdvancePaidInCash(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.markAdvancePaidInCash(id, userId);
  }

  /** Remboursement en espèces à montant LIBRE (comme les prêts) — remplace le seul "tout rembourser d'un coup". */
  @Post('advances/:id/cash-repayment')
  @HttpCode(201)
  recordAdvanceCashRepayment(
    @Param('id') id: string,
    @Body('amount') amount: number,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.recordAdvanceCashRepayment(id, Number(amount), userId);
  }

  /** Supprime une saisie de remboursement d'avance erronée — recalcule automatiquement le solde. */
  @Delete('advances/:id/cash-repayment/:logId')
  deleteAdvanceCashRepayment(
    @Param('id') id: string,
    @Param('logId') logId: string,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.deleteAdvanceCashRepayment(id, logId, userId);
  }

  @Get('advances/:id/history')
  getAdvanceHistory(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.getAdvanceHistory(id, userId);
  }

  @Get('advances/:id/document-data')
  getAdvanceDocumentData(@Param('id') id: string) {
    return this.loansService.getAdvanceDocumentData(id);
  }

  /** Export Excel générique (indépendant du format Orca) pour la page Suivi des dettes. */
  @Get('debt-tracking/export-xlsx')
  async exportDebtTrackingXlsx(
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('department') department: string,
    @Query('type') type: string,
    @GetUser('id') userId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.loansService.exportDebtTrackingXlsx(userId, {
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : new Date().getFullYear(),
      department: department || undefined,
      type: type || undefined,
    });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="suivi-dettes-${year || new Date().getFullYear()}.xlsx"`,
    });
    res.send(buffer);
  }

  /** Écrit directement dans l'onglet AVANCE du fichier Excel fourni par Orca et le renvoie en téléchargement. Réservé au client dont `documentTemplate === 'ORCA'`. */
  @Get('advances/:id/document/orca-xlsx')
  async downloadAdvanceOrcaXlsx(@Param('id') id: string, @GetUser('id') userId: string, @Res() res: Response) {
    const { buffer, filename } = await this.loansService.exportAdvanceXlsx(id, userId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  /** PDF de la fiche Orca — ouvert dans un nouvel onglet côté frontend pour imprimer directement depuis l'app (pas de téléchargement + réouverture manuelle dans Excel). */
  @Get('advances/:id/document/orca-pdf')
  async previewAdvanceOrcaPdf(@Param('id') id: string, @GetUser('id') userId: string, @Res() res: Response) {
    const { buffer, filename } = await this.loansService.exportAdvancePdf(id, userId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` });
    res.send(buffer);
  }

  /** Rendu HTML fidèle au fichier Excel réel (bordures/fusions/polices) — pour l'aperçu ET l'impression navigateur, sans dépendance serveur. */
  @Get('advances/:id/document/orca-html')
  async getAdvanceOrcaHtml(@Param('id') id: string, @GetUser('id') userId: string) {
    const html = await this.loansService.exportAdvanceHtml(id, userId);
    return { html };
  }

  @Patch('advances/:id/mark-deducted')
  markDeducted(@Param('id') id: string) {
    return this.loansService.markAdvanceAsDeducted(id);
  }

  @Patch('advances/:id/print-authorization')
  setAdvancePrintAuthorization(
    @Param('id') id: string,
    @Body('authorized') authorized: boolean,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.setAdvancePrintAuthorization(id, authorized, userId);
  }

  // ==================== PRÊTS — routes avec :id (déclarées en dernier) ====================

  @Get(':id')
  findOneLoan(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.findOneLoan(id, userId);
  }

  @Patch(':id')
  updateLoan(@Param('id') id: string, @Body() dto: UpdateLoanDto, @GetUser('id') userId: string) {
    return this.loansService.updateLoan(id, dto, userId);
  }

  @Delete(':id')
  deleteLoan(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.deleteLoan(id, userId);
  }

  @Patch(':id/cancel')
  cancelLoan(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.cancelLoan(id, userId);
  }

  /**
   * Décision PARALLÈLE — DRH et DG reçoivent la demande en même temps, le
   * premier présent (peu importe sa casquette) valide ou refuse ici même.
   * Remplace les anciennes routes séquentielles /decision/drh et /decision/dg.
   */
  @Patch(':id/decision')
  decideLoan(
    @Param('id') id: string,
    @Body('decision') decision: 'OUI' | 'NON',
    @Body('rejectionReason') rejectionReason: string,
    @Body('recoverViaPayroll') recoverViaPayroll: boolean,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.decideLoan(id, decision, userId, rejectionReason, recoverViaPayroll ?? true);
  }

  /** Réservé ADMIN/SUPER_ADMIN — bascule directe de statut, hors circuit normal. */
  @Patch(':id/force-status')
  forceLoanStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('recoverViaPayroll') recoverViaPayroll: boolean,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.forceLoanStatus(id, userId, status, recoverViaPayroll);
  }

  @Get(':id/document-data')
  getLoanDocumentData(@Param('id') id: string) {
    return this.loansService.getLoanDocumentData(id);
  }

  /** Écrit directement dans l'onglet MARCHANDISE du fichier Excel fourni par Orca et le renvoie en téléchargement. Réservé au client dont `documentTemplate === 'ORCA'`. */
  @Get(':id/document/orca-xlsx')
  async downloadLoanOrcaXlsx(@Param('id') id: string, @GetUser('id') userId: string, @Res() res: Response) {
    const { buffer, filename } = await this.loansService.exportLoanXlsx(id, userId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  /** PDF de la fiche Orca — ouvert dans un nouvel onglet côté frontend pour imprimer directement depuis l'app. */
  @Get(':id/document/orca-pdf')
  async previewLoanOrcaPdf(@Param('id') id: string, @GetUser('id') userId: string, @Res() res: Response) {
    const { buffer, filename } = await this.loansService.exportLoanPdf(id, userId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` });
    res.send(buffer);
  }

  /** Rendu HTML fidèle au fichier Excel réel (bordures/fusions/polices) — pour l'aperçu ET l'impression navigateur, sans dépendance serveur. */
  @Get(':id/document/orca-html')
  async getLoanOrcaHtml(@Param('id') id: string, @GetUser('id') userId: string) {
    const html = await this.loansService.exportLoanHtml(id, userId);
    return { html };
  }

  @Patch(':id/print-authorization')
  setLoanPrintAuthorization(
    @Param('id') id: string,
    @Body('authorized') authorized: boolean,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.setLoanPrintAuthorization(id, authorized, userId);
  }

  @Patch(':id/deduct')
  processDeduction(@Param('id') id: string) {
    return this.loansService.processMonthlyDeduction(id);
  }

  @Post(':id/cash-repayment')
  @HttpCode(201)
  recordCashRepayment(
    @Param('id') id: string,
    @Body('amount') amount: number,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.recordCashRepayment(id, Number(amount), userId);
  }

  @Get(':id/history')
  getLoanHistory(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.loansService.getLoanHistory(id, userId);
  }

  /** Supprime une saisie de remboursement erronée (double saisie, erreur de montant...) — recalcule automatiquement le solde. */
  @Delete(':id/cash-repayment/:logId')
  deleteCashRepayment(
    @Param('id') id: string,
    @Param('logId') logId: string,
    @GetUser('id') userId: string,
  ) {
    return this.loansService.deleteCashRepayment(id, logId, userId);
  }
}