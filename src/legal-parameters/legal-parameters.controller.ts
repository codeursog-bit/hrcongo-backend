// ============================================================================
// 📁 src/legal-parameters/legal-parameters.controller.ts
// Réservé au SUPER_ADMIN (même garde que le reste de /admin).
// ============================================================================
import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { UltraAdminGuard } from '../admin/guards/ultra-admin.guard';
import { LegalParametersService } from './legal-parameters.service';

@Controller('admin/legal-parameters')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class LegalParametersController {
  constructor(private readonly service: LegalParametersService) {}

  /** Valeurs par défaut + valeurs en vigueur aujourd'hui + historique. */
  @Get()
  overview() {
    return this.service.getOverview();
  }

  /** Valeurs applicables à une date donnée (?date=AAAA-MM-JJ). */
  @Get('at')
  at(@Query('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new BadRequestException('date=AAAA-MM-JJ requis');
    return this.service.getAtKey(date);
  }

  /** Publie une nouvelle version (ne modifie jamais les précédentes). */
  @Post()
  create(
    @Body() dto: { effectiveFrom: string; params: unknown; note?: string },
    @GetUser() user: any,
  ) {
    return this.service.createVersion(dto, {
      id: user?.userId ?? user?.id ?? null,
      name: user?.email ?? null,
    });
  }
}


/**
 * Lecture SEULE des règles légales en vigueur — pour afficher les bons taux
 * dans les écrans (paramètres paie, taxes, création d'entreprise…).
 * Tout utilisateur connecté ; aucune écriture possible ici.
 */
@Controller('legal-parameters')
@UseGuards(JwtAuthGuard)
export class LegalParametersReadController {
  constructor(private readonly service: LegalParametersService) {}

  /** Règles en vigueur aujourd'hui (ou à ?date=AAAA-MM-JJ). */
  @Get('effective')
  effective(@Query('date') date?: string) {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date=AAAA-MM-JJ attendu');
    }
    return date ? this.service.getAtKey(date) : this.service.getAt(new Date());
  }
}