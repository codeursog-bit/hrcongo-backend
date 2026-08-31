// ============================================================================
// 📁 src/contracts/contract-generation.controller.ts
//
// GET  /contracts/generation/types                       → Types de contrats configurés
// GET  /contracts/generation/prefill/:employeeId          → Pré-remplissage depuis un employé
// POST /contracts/generation/preview-breakdown             → Aperçu CDI/CDD (vrai moteur de paie)
// POST /contracts/generation                              → Génère un contrat
// GET  /contracts/generation                               → Liste tous les contrats générés (entreprise)
// GET  /contracts/generation/employee/:employeeId          → Contrats générés d'un employé
// GET  /contracts/generation/:id                           → Détail d'un contrat généré
// GET  /contracts/generation/:id/download                  → Regénère et télécharge le .docx
// GET  /contracts/generation/:id/preview                   → Regénère et prévisualise le .pdf
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ContractGenerationService } from './contract-generation.service';
import { GenerateContractDto, PreviewBreakdownDto } from './dto/generate-contract.dto';

const DEFAULT_CONTRACT_TYPES = [
  { key: 'CONTRAT_TRAVAIL', label: 'Contrat CDI / CDD', kind: 'CONTRAT_TRAVAIL' },
  { key: 'PRESTATION_SERVICES', label: 'Contrat de prestation de services', kind: 'PRESTATION_SERVICES' },
  { key: 'CONSULTANT', label: 'Contrat de consultance', kind: 'CONSULTANT' },
  { key: 'STAGE', label: 'Contrat de stage', kind: 'STAGE' },
];

@Controller('contracts/generation')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
export class ContractGenerationController {
  constructor(
    private generationService: ContractGenerationService,
    private prisma: PrismaService,
  ) {}

  private async companyIdOf(req: any): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    return user!.companyId!;
  }

  // ── GET /contracts/generation/types ────────────────────────────────────────
  @Get('types')
  async getTypes(@Request() req: any) {
    const companyId = await this.companyIdOf(req);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { contractTypesConfig: true },
    });
    return (company?.contractTypesConfig as any) || DEFAULT_CONTRACT_TYPES;
  }

  // ── GET /contracts/generation/prefill/:employeeId ──────────────────────────
  @Get('prefill/:employeeId')
  async prefill(@Param('employeeId') employeeId: string, @Request() req: any) {
    const companyId = await this.companyIdOf(req);
    return this.generationService.prefillFromEmployee(employeeId, companyId);
  }

  // ── POST /contracts/generation/preview-breakdown ───────────────────────────
  // Calcule Brut/CNSS/ITS/TOL/Net avec le VRAI moteur de paie — utilisé par
  // le front pour un aperçu fiable pendant la saisie (uniquement pour le
  // Contrat de travail CDI/CDD, dont le barème ITS est réellement progressif).
  @Post('preview-breakdown')
  async previewBreakdown(@Body() dto: PreviewBreakdownDto, @Request() req: any) {
    const companyId = await this.companyIdOf(req);
    return this.generationService.previewTravailBreakdown({ ...dto, companyId });
  }

  // ── POST /contracts/generation ─────────────────────────────────────────────
  @Post()
  async generate(@Body() dto: GenerateContractDto, @Request() req: any) {
    const companyId = await this.companyIdOf(req);
    return this.generationService.generate(dto, companyId, req.user.userId);
  }

  // ── GET /contracts/generation ──────────────────────────────────────────────
  @Get()
  async listAll(@Request() req: any) {
    const companyId = await this.companyIdOf(req);
    return this.generationService.listForCompany(companyId);
  }

  // ── GET /contracts/generation/employee/:employeeId ─────────────────────────
  @Get('employee/:employeeId')
  async listForEmployee(@Param('employeeId') employeeId: string, @Request() req: any) {
    const companyId = await this.companyIdOf(req);
    return this.generationService.listForEmployee(employeeId, companyId);
  }

  // ── GET /contracts/generation/:id ──────────────────────────────────────────
  @Get(':id')
  async getOne(@Param('id') id: string, @Request() req: any) {
    const companyId = await this.companyIdOf(req);
    return this.generationService.getOne(id, companyId);
  }

  // ── GET /contracts/generation/:id/download ─────────────────────────────────
  // Regénère le .docx à la volée (rien n'est stocké sur le cloud) et le
  // renvoie en téléchargement direct. En GET, consommé par api.getBlob()
  // côté front (la seule méthode de votre client qui gère les fichiers
  // binaires — api.get()/api.post() font toujours du response.json()).
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const companyId = await this.companyIdOf(req);
    const { buffer, fileName } = await this.generationService.getDocxBuffer(id, companyId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }

  // ── GET /contracts/generation/:id/preview ──────────────────────────────────
  // Regénère le .pdf à la volée (rien n'est stocké sur le cloud) et le
  // renvoie pour affichage direct dans le navigateur.
  @Get(':id/preview')
  async preview(
    @Param('id') id: string,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const companyId = await this.companyIdOf(req);
    const { buffer, fileName } = await this.generationService.getPdfBuffer(id, companyId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }
}