import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  NotFoundException,
  ServiceUnavailableException,
  Request,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../admin/guards/ultra-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { safeIncidentText } from './incident-privacy';
import { decodeIncidentStack } from './incident-source-maps';

export class IncidentFiltersDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsIn(['FRONT', 'BACK', 'CRON', 'THIRD_PARTY']) source?: string;
  @IsOptional() @IsIn(['INFO', 'WARN', 'ERROR', 'CRITICAL']) severity?: string;
  @IsOptional()
  @IsIn(['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED', 'REGRESSED'])
  status?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class IncidentActionDto {
  @IsIn(['ACKNOWLEDGED', 'RESOLVED', 'IGNORED']) status: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class IncidentPreferencesDto {
  @IsBoolean() emailEnabled: unknown;
}
@Controller('admin/incidents')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class AdminIncidentsController {
  constructor(private readonly prisma: PrismaService) {}
  private check() {
    if (process.env.INCIDENTS_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Le suivi des incidents est désactivé.',
      );
  }
  @Get('preferences')
  async preferences(@Request() req:any) {
    this.check();
    const user=await this.prisma.user.findUnique({where:{id:req.user.userId},select:{incidentEmailAlerts:true}});
    if(!user)throw new NotFoundException('Compte introuvable.');
    return {emailEnabled:user.incidentEmailAlerts,emailAvailable:process.env.INCIDENTS_EMAIL_ENABLED!=='false'};
  }
  @Patch('preferences')
  async setPreferences(@Request() req:any,@Body() body:IncidentPreferencesDto) {
    this.check();
    const user=await this.prisma.user.update({where:{id:req.user.userId},data:{incidentEmailAlerts:body.emailEnabled as boolean},select:{incidentEmailAlerts:true}});
    return {emailEnabled:user.incidentEmailAlerts,emailAvailable:process.env.INCIDENTS_EMAIL_ENABLED!=='false'};
  }
  @Get()
  async list(@Query() query: IncidentFiltersDto) {
    this.check();
    const where = {
      ...(query.source ? { source: query.source } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.companyId
        ? { actors: { some: { kind: 'COMPANY', actorId: query.companyId } } }
        : {}),
      ...(query.from || query.to
        ? {
            lastSeen: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.errorGroup.count({ where }),
      this.prisma.errorGroup.findMany({
        where,
        orderBy: [
          { companyCount: 'desc' },
          { userCount: 'desc' },
          { count: 'desc' },
          { lastSeen: 'desc' },
        ],
        take: 25,
        skip: (query.page - 1) * 25,
        include: {
          errors: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { message: true, path: true },
          },
        },
      }),
    ]);
    return {
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / 25)),
      rows,
    };
  }
  @Get('company/:id/health')
  async health(@Param('id', ParseUUIDPipe) companyId: string) {
    this.check();
    const since = new Date(Date.now() - 86400000);
    const [counts, unresolved] = await Promise.all([
      this.prisma.appError.aggregate({
        where: { companyId, createdAt: { gte: since }, groupId: { not: null } },
        _sum: { occurrences: true },
      }),
      this.prisma.errorGroup.count({
        where: {
          lastSeen: { gte: since },
          status: { in: ['NEW', 'ACKNOWLEDGED', 'REGRESSED'] },
          actors: { some: { kind: 'COMPANY', actorId: companyId } },
        },
      }),
    ]);
    return {
      companyId,
      periodHours: 24,
      occurrences: counts._sum.occurrences ?? 0,
      unresolved,
    };
  }
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    this.check();
    const group = await this.prisma.errorGroup.findUnique({
      where: { id },
      include: {
        errors: { orderBy: { createdAt: 'desc' }, take: 50 },
        actors: { take: 200 },
      },
    });
    if (!group) throw new NotFoundException('Incident introuvable.');
    if(group.errors[0]) group.errors[0].stack = (await decodeIncidentStack(group.errors[0].stack??undefined,group.version))??null;
    const [companies, users] = await Promise.all([
      this.prisma.company.findMany({
        where: {
          id: {
            in: group.actors
              .filter((a) => a.kind === 'COMPANY')
              .map((a) => a.actorId),
          },
        },
        select: {
          id: true,
          legalName: true,
          subscription: { select: { plan: true } },
        },
      }),
      this.prisma.user.findMany({
        where: {
          id: {
            in: group.actors
              .filter((a) => a.kind === 'USER')
              .map((a) => a.actorId),
          },
        },
        select: { id: true, firstName: true, lastName: true, role: true },
      }),
    ]);
    const sample = group.errors[0];
    const report = [
      '# Incident Konza RH',
      `- Référence : ${group.id}`,
      `- Source / gravité / statut : ${group.source} / ${group.severity} / ${group.status}`,
      `- Version : ${group.version ?? 'non renseignée'}`,
      `- Occurrences : ${group.count} ; entreprises : ${group.companyCount} ; utilisateurs : ${group.userCount}`,
      `- Première / dernière occurrence : ${group.firstSeen.toISOString()} / ${group.lastSeen.toISOString()}`,
      `- Route : ${sample?.path ?? 'non renseignée'}`,
      '## Erreur',
      sample?.message ?? '',
      '## Pile assainie',
      '```',
      sample?.stack ?? 'Pile indisponible',
      '```',
      '## Traces techniques (ne prouvent pas un scénario de reproduction)',
      JSON.stringify(sample?.context ?? {}, null, 2),
      '## Entreprises',
      ...companies.map(
        (c) => `${c.legalName} · ${c.subscription?.plan ?? 'sans plan'}`,
      ),
      '## Consigne',
      'Rechercher la cause à partir de la pile et de la route. Ne pas inventer de reproduction ni modifier les calculs de paie sans preuve.',
    ].join('\n');
    return {
      ...group,
      companies,
      users,
      report,
      historyNote:
        'Une ligne représente un lot de signalements regroupés ; la colonne occurrences indique sa taille. Les détails affichent les 50 derniers lots et 200 identités au maximum.',
    };
  }
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IncidentActionDto,
  ) {
    this.check();
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.errorGroup.findUnique({ where: { id } });
      if (!group) throw new NotFoundException('Incident introuvable.');
      const updated = await tx.errorGroup.update({
        where: { id },
        data: {
          status: body.status,
          note: body.note ? safeIncidentText(body.note, 2000) : null,
        },
      });
      await tx.appError.updateMany({
        where: { groupId: id },
        data: {
          resolved: body.status === 'RESOLVED' || body.status === 'IGNORED',
          resolvedAt: body.status === 'RESOLVED' ? new Date() : null,
        },
      });
      return updated;
    });
  }
}
