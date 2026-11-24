// ============================================================================
// src/bulletin-template/bulletin-template.controller.ts
// Endpoints : GET / PUT / DELETE /companies/bulletin-template
// ============================================================================
import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BulletinTemplateService } from './bulletin-template.service';
import { UpsertBulletinTemplateDto } from './bulletin-template.dto';

@Controller('companies/bulletin-template')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BulletinTemplateController {
  constructor(private readonly svc: BulletinTemplateService) {}

  /**
   * GET /companies/bulletin-template
   * Récupère la config du bulletin (template OU canvas).
   * Tous les rôles connectés peuvent lire.
   * On passe req.user.companyId (issu du JWT) pour éviter tout lookup DB inutile.
   */
  @Get()
  getTemplate(@Request() req: any) {
    return this.svc.getTemplate(req.user.userId, req.user.companyId);
  }

  /**
   * PUT /companies/bulletin-template
   * Sauvegarde la config (template OU canvas selon le champ "mode").
   * Seuls ADMIN et HR_MANAGER peuvent modifier.
   */
  @Put()
  @Roles('ADMIN', 'HR_MANAGER')
  upsertTemplate(@Request() req: any, @Body() dto: UpsertBulletinTemplateDto) {
    return this.svc.upsertTemplate(req.user.userId, dto, req.user.companyId);
  }

  /**
   * DELETE /companies/bulletin-template/reset
   * Remet le bulletin au template par défaut.
   */
  @Delete('reset')
  @Roles('ADMIN', 'HR_MANAGER')
  resetTemplate(@Request() req: any) {
    return this.svc.resetTemplate(req.user.userId, req.user.companyId);
  }
}
