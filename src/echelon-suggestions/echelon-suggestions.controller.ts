// ============================================================================
// 📁 src/echelon-suggestions/echelon-suggestions.controller.ts
// ============================================================================

import { Controller, Get, Post, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { EchelonSuggestionsService } from './echelon-suggestions.service';

@Controller('echelon-suggestions')
@UseGuards(JwtAuthGuard)
export class EchelonSuggestionsController {
  constructor(
    private readonly service: EchelonSuggestionsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Liste des suggestions en attente pour l'entreprise de l'utilisateur connecté. */
  @Get()
  async listPending(@GetUser('id') userId: string) {
    const companyId = await this._companyIdOf(userId);
    return this.service.listPending(companyId);
  }

  /** Valide UNE suggestion (avec double confirmation gérée côté front). */
  @Post(':id/accept')
  async accept(@Param('id') id: string, @GetUser('id') userId: string) {
    const companyId = await this._companyIdOf(userId);
    return this.service.accept(id, companyId, userId);
  }

  /** Refuse UNE suggestion — l'échelon actuel est conservé. */
  @Post(':id/reject')
  async reject(@Param('id') id: string, @GetUser('id') userId: string) {
    const companyId = await this._companyIdOf(userId);
    return this.service.reject(id, companyId, userId);
  }

  /**
   * "Tout valider" — bascule en une fois toutes les suggestions en attente.
   * Le front affiche le tableau retourné dans un toast/modal récapitulatif.
   */
  @Post('accept-all')
  async acceptAll(@GetUser('id') userId: string) {
    const companyId = await this._companyIdOf(userId);
    return this.service.acceptAll(companyId, userId);
  }

  private async _companyIdOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new NotFoundException('Utilisateur sans entreprise');
    return user.companyId;
  }
}