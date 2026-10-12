// ============================================================================
// 📁 src/audit-trail/audit-trail.controller.ts
// Accès : ADMIN / HR_MANAGER de l'entreprise, CABINET_ADMIN (entreprises liées),
// SUPER_ADMIN (métadonnées seulement). L'entreprise est TOUJOURS vérifiée
// côté serveur via assertCompanyAccess — le client ne choisit jamais seul.
// ============================================================================
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { assertCompanyAccess } from '../common/resolve-verified-company.util';
import { AuditTrailService } from './audit-trail.service';
import { AuditTrailQueryService } from './audit-trail.query.service';
import {
  AuditHistoryQueryDto,
  AuditStatsQueryDto,
  QueryAuditEventsDto,
} from './dto/query-audit-events.dto';

@Controller('audit-trail')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'CABINET_ADMIN', 'SUPER_ADMIN')
export class AuditTrailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: AuditTrailQueryService,
    private readonly trail: AuditTrailService,
  ) {}

  @Get('events')
  async events(@Req() req: any, @Query() q: QueryAuditEventsDto) {
    const companyId = await this.resolveCompany(req, q.companyId);
    return this.query.list(companyId, req.user.role, q);
  }

  /** Activité par jour + actions les plus fréquentes (agrégé : aucune valeur, aucun nom). */
  @Get('stats')
  async stats(@Req() req: any, @Query() q: AuditStatsQueryDto) {
    const companyId = await this.resolveCompany(req, q.companyId);
    return this.query.stats(companyId, q.days);
  }

  @Get('history/:entity/:entityId')
  async history(
    @Req() req: any,
    @Param('entity') entity: string,
    @Param('entityId') entityId: string,
    @Query() q: AuditHistoryQueryDto,
  ) {
    if (!/^[A-Z_]{2,50}$/.test(entity)) {
      throw new BadRequestException('Entité invalide');
    }
    if (!/^[0-9a-f-]{36}$/i.test(entityId)) {
      throw new BadRequestException('Identifiant invalide');
    }
    const companyId = await this.resolveCompany(req, q.companyId);
    return this.query.historyOf(companyId, req.user.role, entity, entityId);
  }

  /** Recalcule toute la chaîne de hash : prouve que le journal n'a pas été altéré. */
  @Get('verify')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async verify(@Req() req: any, @Query() q: AuditHistoryQueryDto) {
    const companyId = await this.resolveCompany(req, q.companyId);
    return this.trail.verifyChain(companyId);
  }

  private async resolveCompany(req: any, requested?: string): Promise<string> {
    const target = requested ?? req.user.companyId;
    if (!target) throw new BadRequestException('companyId requis');
    await assertCompanyAccess(this.prisma, req.user.userId, target);
    return target;
  }
}