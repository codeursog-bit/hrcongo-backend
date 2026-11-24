// ============================================================================
// 📁 src/contracts/contracts.controller.ts
//
// PATCH /contracts/:employeeId/confirm-trial   → Confirmer l'essai
// PATCH /contracts/:employeeId/fail-trial      → Rompre l'essai
// GET   /contracts/trials                      → Liste essais en cours
// GET   /contracts/expiring                    → Liste contrats expirant
// ============================================================================

import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TrialPeriodService } from './trial-period.service';
import { ContractExpiryService } from './contract-expiry.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('contracts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
export class ContractsController {
  constructor(
    private trialService: TrialPeriodService,
    private expiryService: ContractExpiryService,
    private prisma: PrismaService,
  ) {}

  // ── GET /contracts/trials ─────────────────────────────────────────────────
  @Get('trials')
  async getActiveTrials(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    return this.trialService.getActiveTrials(user!.companyId!);
  }

  // ── GET /contracts/expiring ───────────────────────────────────────────────
  @Get('expiring')
  async getExpiring(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    return this.expiryService.getExpiringList(user!.companyId!);
  }

  // ── PATCH /contracts/:id/confirm-trial ───────────────────────────────────
  @Patch(':employeeId/confirm-trial')
  async confirmTrial(
    @Param('employeeId') employeeId: string,
    @Request() req: any,
  ) {
    await this.trialService.confirmTrial(employeeId, req.user.userId);
    return { success: true, message: "Période d'essai confirmée" };
  }

  // ── PATCH /contracts/:id/fail-trial ──────────────────────────────────────
  @Patch(':employeeId/fail-trial')
  async failTrial(
    @Param('employeeId') employeeId: string,
    @Body() body: { reason: string },
    @Request() req: any,
  ) {
    await this.trialService.failTrial(
      employeeId,
      body.reason || 'Non précisé',
      req.user.userId,
    );
    return { success: true, message: "Rupture d'essai enregistrée" };
  }
}