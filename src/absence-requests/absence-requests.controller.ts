// ============================================================================
// 📁 src/absence-requests/absence-requests.controller.ts
// ============================================================================

import {
  Controller, Get, Post, Patch,
  Body, Param, Query, Request, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AbsenceRequestsService } from './absence-requests.service';
import { CreateAbsenceRequestDto } from './dto/create-absence-request.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('absence-requests')
@UseGuards(AuthGuard('jwt'))
export class AbsenceRequestsController {
  constructor(private readonly absenceRequestsService: AbsenceRequestsService) {}

  /** Créer une demande d'absence (employé connecté) */
  @Post()
  create(@Body() dto: CreateAbsenceRequestDto, @Request() req) {
    return this.absenceRequestsService.create(dto, req.user.userId);
  }

  /** Liste des demandes (RH / Manager / Admin — scope automatique) */
  @Get()
  findAll(
    @Request() req,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.absenceRequestsService.findAll(req.user.userId, employeeId, status);
  }

  /** Mes demandes (employé connecté) */
  @Get('me')
  findMine(@Request() req) {
    return this.absenceRequestsService.findMine(req.user.userId);
  }

  /**
   * Calcule automatiquement la date de retour à partir d'une date de départ
   * et d'un nombre de jours ouvrables.
   * ⚠️ Doit rester AVANT ':id' — sinon interprété comme un id.
   */
  @Get('calculate-return-date')
  calculateReturnDate(
    @Query('employeeId') employeeId: string,
    @Query('startDate') startDate: string,
    @Query('days') days: string,
  ) {
    return this.absenceRequestsService.calculateReturnDate(employeeId, new Date(startDate), parseFloat(days));
  }

  /** Détail d'une demande (utilisé pour l'impression) */
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.absenceRequestsService.findOne(id, req.user.userId);
  }

  /** Approuver ou refuser — isPaid optionnel : permet à la RH de trancher/écraser la proposition de l'employé au moment de la validation */
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @Body('rejectionReason') rejectionReason: string,
    @Body('isPaid') isPaid: boolean | undefined,
    @Request() req,
  ) {
    return this.absenceRequestsService.updateStatus(id, status, req.user.userId, rejectionReason, isPaid);
  }

  /**
   * Données résolues pour le rendu du document imprimable (générique ou Orca).
   */
  @Get(':id/document-data')
  getDocumentData(@Param('id') id: string) {
    return this.absenceRequestsService.getDocumentData(id);
  }

  /**
   * Télécharge le document Word Orca rempli (écriture directe dans leur
   * fichier .docx original).
   */
  @Get(':id/document.docx')
  async downloadOrcaDocument(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.absenceRequestsService.generateOrcaDocument(id);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="demande-absence-${id.slice(0, 8)}.docx"`,
    });
    res.send(buffer);
  }

  /** Annuler ma demande (tant qu'elle est en attente) */
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason: string, @Request() req) {
    return this.absenceRequestsService.cancel(id, req.user.userId, reason);
  }

  /**
   * Change le statut payé / non payé — réservé RH/Admin, modifiable à tout
   * moment (avant ou après validation), jamais accessible à l'employé.
   * L'employé ne fait que PROPOSER isPaid à la création (voir DTO) ; seule
   * la RH tranche, et peut changer d'avis plus tard via cet endpoint.
   */
  @Patch(':id/paid-status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  setPaidStatus(
    @Param('id') id: string,
    @Body('isPaid') isPaid: boolean,
    @Request() req,
  ) {
    return this.absenceRequestsService.setPaidStatus(id, isPaid, req.user.userId);
  }

  /**
   * Autoriser (ou retirer l'autorisation) l'impression du document pour l'employé.
   * Réservé RH/Admin — la demande doit déjà être APPROVED.
   */
  @Patch(':id/print-authorization')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  setPrintAuthorization(
    @Param('id') id: string,
    @Body('authorized') authorized: boolean,
    @Request() req,
  ) {
    return this.absenceRequestsService.setPrintAuthorization(id, authorized, req.user.userId);
  }
}