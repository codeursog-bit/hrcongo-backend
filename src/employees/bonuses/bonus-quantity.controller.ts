// ============================================================================
// 📁 src/employees/bonuses/bonus-quantity.controller.ts
//
// Endpoints pour saisir/modifier les quantités variables avant/après bulletin
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { BonusQuantityService } from './bonus-quantity.service';
import { GetUser } from '../../auth/get-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class BonusQuantityController {
  constructor(private readonly svc: BonusQuantityService) {}

  // ── GET /employee-bonuses/quantities/pending?employeeId=&month=&year= ───────
  // Retourne les primes FREE sans quantité saisie + celles déjà saisies
  // Appelé par le frontend avant de générer le bulletin

  @Get('employee-bonuses/quantities/pending')
  async getPending(
    @Query('employeeId') employeeId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
  ) {
    return this.svc.findAllForEmployee(employeeId, month, year);
  }

  // ── POST /employee-bonuses/:bonusId/quantities ───────────────────────────────
  // Saisir ou modifier la quantité d'une prime FREE pour un mois
  // Appelé AVANT la génération (ou après pour recalcul)

  @Post('employee-bonuses/:bonusId/quantities')
  async upsert(
    @Param('bonusId') bonusId: string,
    @Body()
    body: { month: number; year: number; quantity: number; note?: string },
  ) {
    return this.svc.upsert(bonusId, body.month, body.year, {
      quantity: body.quantity,
      note: body.note,
    });
  }

  // ── GET /employee-bonuses/:bonusId/quantities?month=&year= ──────────────────
  // Consulter la quantité saisie pour un mois

  @Get('employee-bonuses/:bonusId/quantities')
  async findOne(
    @Param('bonusId') bonusId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
  ) {
    return this.svc.findOne(bonusId, month, year);
  }

  // ── DELETE /employee-bonuses/:bonusId/quantities?month=&year= ───────────────
  // Réinitialiser la quantité (retour au défaut)

  @Delete('employee-bonuses/:bonusId/quantities')
  async remove(
    @Param('bonusId') bonusId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
  ) {
    await this.svc.remove(bonusId, month, year);
    return { deleted: true };
  }
}

// ============================================================================
// RÉSUMÉ — quantityMode ne connaît plus qu'une seule valeur : 'FREE'.
// AUTO_DAYS / AUTO_WEEKS / AUTO_HOURS ont été retirés (redondants avec
// isProratized qui fait déjà le prorata jours travaillés / jours ouvrables,
// et jamais fiabilisés). Le flux FREE :
//
// 1. Admin génère bulletin → status DRAFT
// 2. Admin voit une prime FREE avec quantité par défaut (ex: 7 repas)
// 3. Admin corrige via POST /employee-bonuses/:bonusId/quantities { month, year, quantity: 5 }
// 4. Admin appelle PATCH /payrolls/:id/recalculate
// 5. resolveForPayroll() relit BonusMonthlyQuantity → nouveau montant
// 6. Bulletin recalculé → admin valide → VALIDATED → PAID (plus de modif,
//    déjà bloqué dans recalculatePayroll)
// ============================================================================

export {};