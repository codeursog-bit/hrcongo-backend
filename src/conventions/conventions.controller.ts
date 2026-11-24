// ============================================================================
// 📁 src/conventions/conventions.controller.ts
// Version existante CONSERVÉE + endpoint /status pour le module rupture
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConventionsService } from './conventions.service';
import { GetUser } from '../auth/get-user.decorator';

@Controller('conventions')
@UseGuards(JwtAuthGuard)
export class ConventionsController {
  constructor(private readonly conventionsService: ConventionsService) {}

  // ── Endpoints existants (inchangés) ────────────────────────────────────────

  @Get('predefined')
  async getPredefinedConventions() {
    return this.conventionsService.getPredefinedConventions();
  }

  @Post('activate')
  async activateConvention(
    @Body('conventionCode') conventionCode: string,
    @GetUser('id') userId: string,
  ) {
    return this.conventionsService.activateConventionForCompany(
      userId,
      conventionCode,
    );
  }

  @Post('deactivate')
  async deactivateConvention(@GetUser('id') userId: string) {
    return this.conventionsService.deactivateConvention(userId);
  }

  @Get('my-rules')
  async getMyConventionRules(@GetUser('id') userId: string) {
    return this.conventionsService.getCompanyConventionRules(userId);
  }

  @Post('rules')
  async addCustomRule(@Body() ruleDto: any, @GetUser('id') userId: string) {
    return this.conventionsService.addCustomRule(userId, ruleDto);
  }

  @Post('rules/:id/deactivate')
  async deactivateRule(
    @Param('id') ruleId: string,
    @GetUser('id') userId: string,
  ) {
    return this.conventionsService.deactivateRule(userId, ruleId);
  }

  @Get('categories/:code')
  @ApiOperation({ summary: "Récupérer les catégories d'une convention" })
  @ApiParam({
    name: 'code',
    description: 'Code de la convention (ex: BTP, COMMERCE)',
  })
  @ApiResponse({ status: 200, description: 'Liste des catégories' })
  @ApiResponse({ status: 404, description: 'Convention introuvable' })
  getConventionCategories(@Param('code') code: string) {
    const categories = this.conventionsService.getCategoriesByConvention(code);
    if (!categories || categories.length === 0) {
      throw new NotFoundException(
        `Aucune catégorie trouvée pour la convention ${code}`,
      );
    }
    return categories;
  }

  // ── Nouvel endpoint pour le module rupture ─────────────────────────────────
  /**
   * GET /conventions/status
   * Retourne si l'entreprise a une convention active + ses catégories.
   * Utilisé par le front pour afficher/masquer le modal de sélection.
   */
  @Get('status')
  @ApiOperation({ summary: "Statut de la convention active de l'entreprise" })
  async getConventionStatus(@GetUser('companyId') companyId: string) {
    return this.conventionsService.hasActiveConvention(companyId);
  }
}