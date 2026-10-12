// ============================================================================
// 📁 src/audit-engine/audit-engine.controller.ts
// Accès :
//   ADMIN / HR_MANAGER   : tout (lancer, lire, justifier, attester)
//   ADMIN seul           : passer outre un écart BLOQUANT
//   CABINET_ADMIN        : lecture des entreprises liées
//   SUPER_ADMIN          : synthèse chiffrée uniquement (pas de détail nominatif)
// L'entreprise est TOUJOURS revérifiée côté serveur (assertCompanyAccess).
// ============================================================================
import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { assertCompanyAccess } from '../common/resolve-verified-company.util';
import { AuditActor } from '../audit-trail/audit-trail.service';
import { AuditEngineService } from './audit-engine.service';
import { AuditFindingsService } from './audit-findings.service';
import { CHECKPOINTS } from './rules/checkpoints';
import {
  AttestCheckpointDto, CompanyScopeDto, FindingNoteDto, PeriodQueryDto, QueryFindingsDto, RunAuditDto, TrendQueryDto,
} from './dto/audit-engine.dto';

@Controller('audit-engine')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'CABINET_ADMIN', 'SUPER_ADMIN')
export class AuditEngineController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AuditEngineService,
    private readonly findings: AuditFindingsService,
  ) {}

  /** Catalogue des règles et des points de contrôle humains (libellés, gravité, base légale). */
  @Get('rules')
  rules() {
    return {
      rules: this.engine.catalog(),
      checkpoints: CHECKPOINTS.map((c) => ({ code: c.code, label: c.label, evidenceHint: c.evidenceHint, legalRef: c.legalRef })),
      gateMode: process.env.AUDIT_GATE_MODE === 'enforce' ? 'enforce' : 'observe',
    };
  }

  @Post('run')
  @Roles('ADMIN', 'HR_MANAGER')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async run(@Req() req: any, @Body() dto: RunAuditDto) {
    const companyId = await this.company(req, dto.companyId, true);
    return this.engine.run(companyId, { month: dto.month, year: dto.year, trigger: 'MANUAL', actor: await this.actor(req) });
  }

  @Get('summary')
  async summary(@Req() req: any, @Query() q: PeriodQueryDto) {
    const companyId = await this.company(req, q.companyId);
    return this.findings.summary(companyId, q, req.user.role);
  }

  /** Évolution mois par mois (conformité, écarts, critiques, bloquants) + règles les plus en écart. Données agrégées. */
  @Get('trend')
  async trend(@Req() req: any, @Query() q: TrendQueryDto) {
    const companyId = await this.company(req, q.companyId);
    return this.findings.trend(companyId, q.months);
  }

  @Get('findings')
  @Roles('ADMIN', 'HR_MANAGER', 'CABINET_ADMIN')
  async list(@Req() req: any, @Query() q: QueryFindingsDto) {
    const companyId = await this.company(req, q.companyId);
    return this.findings.list(companyId, q);
  }

  @Post('findings/:id/justify')
  @Roles('ADMIN', 'HR_MANAGER')
  async justify(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FindingNoteDto) {
    return this.findings.justify(req.user, id, dto.note, await this.actor(req));
  }

  @Post('findings/:id/waive')
  @Roles('ADMIN')
  async waive(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FindingNoteDto) {
    return this.findings.waive(req.user, id, dto.note, await this.actor(req));
  }

  @Post('findings/:id/reopen')
  @Roles('ADMIN', 'HR_MANAGER')
  async reopen(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.findings.reopen(req.user, id, await this.actor(req));
  }

  @Get('checkpoints')
  @Roles('ADMIN', 'HR_MANAGER', 'CABINET_ADMIN')
  async checkpoints(@Req() req: any, @Query() q: PeriodQueryDto) {
    if (!q.month || !q.year) throw new BadRequestException('month et year requis');
    const companyId = await this.company(req, q.companyId);
    return this.findings.checkpointViews(companyId, q.month, q.year);
  }

  @Post('checkpoints')
  @Roles('ADMIN', 'HR_MANAGER')
  async attest(@Req() req: any, @Body() dto: AttestCheckpointDto) {
    const companyId = await this.company(req, dto.companyId, true);
    return this.findings.attest(req.user, companyId, dto, await this.actor(req));
  }

  private async company(req: any, requested?: string, write = false): Promise<string> {
    const target = requested ?? req.user.companyId;
    if (!target) throw new BadRequestException('companyId requis');
    await assertCompanyAccess(this.prisma, req.user.userId, target, write ? { write: true } : {});
    return target;
  }

  private async actor(req: any): Promise<AuditActor> {
    const u = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { firstName: true, lastName: true } });
    return { id: req.user.userId, role: req.user.role, label: u ? `${u.firstName} ${u.lastName}` : null };
  }
}