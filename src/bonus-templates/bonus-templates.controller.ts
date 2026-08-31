// // 📁 src/bonus-templates/bonus-templates.controller.ts
// // ✅ Fix 1 : chemin guard aligné sur '../auth/jwt-auth.guard' (sans guards/)
// // ✅ Fix 2 : DTOs déclarés comme classes dans service (pas interfaces)
// //            pour éviter l'erreur TS1272 avec isolatedModules

// import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// import { BonusTemplatesService } from './bonus-templates.service';

// @Controller('bonus-templates')
// @UseGuards(JwtAuthGuard)
// export class BonusTemplatesController {
//   constructor(private readonly service: BonusTemplatesService) {}

//   @Get()
//   findAll(@Req() req: any) {
//     return this.service.findAll(req.user.companyId);
//   }

//   @Post()
//   create(@Req() req: any, @Body() dto: any) {
//     return this.service.create(req.user.companyId, dto);
//   }

//   @Get(':id')
//   findOne(@Param('id') id: string, @Req() req: any) {
//     return this.service.findOne(id, req.user.companyId);
//   }

//   @Patch(':id')
//   update(@Param('id') id: string, @Req() req: any, @Body() dto: any) {
//     return this.service.update(id, req.user.companyId, dto);
//   }

//   @Delete(':id')
//   remove(@Param('id') id: string, @Req() req: any) {
//     return this.service.remove(id, req.user.companyId);
//   }
// }

// ============================================================================
// 📁 src/bonus-templates/bonus-templates.controller.ts
// ✅ Ajout : GET /bonus-templates/presets
// ✅ Ajout : POST /bonus-templates/import-presets
// ✅ Ajout : GET /bonus-templates/category-defaults
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BonusTemplatesService } from './bonus-templates.service';

@Controller('bonus-templates')
@UseGuards(JwtAuthGuard)
export class BonusTemplatesController {
  constructor(private readonly service: BonusTemplatesService) {}

  // ── Catalogue de l'entreprise ─────────────────────────────────────────────

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.companyId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: any) {
    return this.service.create(req.user.companyId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user.companyId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Req() req: any, @Body() dto: any) {
    return this.service.update(id, req.user.companyId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user.companyId);
  }

  // ── Presets conventionnels ────────────────────────────────────────────────

  /** Retourne la liste des presets conventionnels disponibles */
  @Get('presets/list')
  getPresets() {
    return this.service.getPresets();
  }

  /**
   * Importe des presets dans le catalogue de l'entreprise.
   * Body: { names?: string[] }  — si vide, importe tous les presets
   */
  @Post('presets/import')
  importPresets(@Req() req: any, @Body() body: { names?: string[] }) {
    return this.service.importPresets(req.user.companyId, body.names ?? []);
  }

  /** Retourne les valeurs par défaut de chaque catégorie (pour le front) */
  @Get('category-defaults/all')
  getCategoryDefaults() {
    return this.service.getCategoryDefaults();
  }
}
