// ============================================================================
// contract-rupture.controller.ts — Endpoints REST
// ============================================================================

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ContractRuptureService } from './contract-rupture.service';
import type { CreateRuptureDto } from './dto/create-rupture.dto';

@Controller('rupture')
export class ContractRuptureController {
  constructor(private readonly ruptureService: ContractRuptureService) {}

  // ── Liste toutes les conventions disponibles
  @Get('conventions')
  listConventions() {
    return this.ruptureService.listConventions();
  }

  // ── Calcul principal — mode auto ou assisté
  // POST /rupture/calculer
  @Post('calculer')
  @HttpCode(HttpStatus.OK)
  calculer(@Body() dto: CreateRuptureDto) {
    return this.ruptureService.calculerRupture(dto);
  }

  // ── Simulation rapide sans contexte employé complet
  // GET /rupture/simuler?convention=COMMERCE&annees=8&avg12=450000
  @Get('simuler')
  simuler(
    @Query('convention') convention: string,
    @Query('annees') annees: string,
    @Query('avg12') avg12: string,
    @Query('eco') eco: string,
  ) {
    return this.ruptureService.simulerIndemnite({
      conventionCode: convention,
      annees: parseFloat(annees),
      avg12: parseFloat(avg12),
      isEco: eco === 'true',
    });
  }

  // ── Calcul du préavis seul
  // GET /rupture/preavis?convention=INDUSTRIE&categorie=7&avg12=350000
  @Get('preavis')
  preavis(
    @Query('convention') convention: string,
    @Query('categorie') categorie: string,
    @Query('avg12') avg12: string,
    @Query('double') double: string,
  ) {
    return this.ruptureService.calcPreavisSeul(
      convention,
      parseInt(categorie),
      parseFloat(avg12),
      double === 'true',
    );
  }

  // ── Checklist procédurale seule (sans calcul financier)
  // GET /rupture/checklist/:motif
  @Get('checklist/:motif')
  checklist(@Param('motif') motif: string) {
    const { genererChecklist } = require('./procedures/procedure.helper');
    return genererChecklist(motif as any, 'CDI', 'DISPENSE_EMPLOYEUR');
  }
}
