// ============================================================================
// 📁 src/audit/audit.controller.ts
// Consultation des logs d'audit — ADMIN / HR_MANAGER uniquement
// ============================================================================
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('logs')
  async getLogs(
    @Req() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('userId') userId?: string,
    @Query('severity') severity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const role = req.user.role;
    if (
      !['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'CABINET_ADMIN'].includes(role)
    ) {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }

    const companyId = req.user.companyId;
    const skip = (Math.max(1, +page) - 1) * Math.min(100, +limit);
    const take = Math.min(100, +limit);

    // Construire les filtres
    const where: any = {};

    // Filtrer par entreprise (sécurité isolation)
    if (companyId) {
      where.user = { companyId };
    }

    // Filtres optionnels
    if (action) where.action = { contains: action.toUpperCase() };
    if (entity) where.entity = entity.toUpperCase();
    if (userId) where.userId = userId;
    if (severity)
      where.metadata = { path: ['severity'], equals: severity.toUpperCase() };

    // Filtre par date
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        total,
        page: +page,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  @Get('stats')
  async getStats(@Req() req: any) {
    const role = req.user.role;
    if (
      !['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'CABINET_ADMIN'].includes(role)
    ) {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }

    const companyId = req.user.companyId;
    const userWhere = companyId ? { user: { companyId } } : {};
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total7d, byAction, byEntity, critical] = await Promise.all([
      this.prisma.activityLog.count({
        where: { ...userWhere, createdAt: { gte: since7d } },
      }),
      this.prisma.activityLog.groupBy({
        by: ['action'],
        where: { ...userWhere, createdAt: { gte: since7d } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.activityLog.groupBy({
        by: ['entity'],
        where: { ...userWhere, createdAt: { gte: since7d } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.activityLog.count({
        where: {
          ...userWhere,
          createdAt: { gte: since7d },
          action: {
            in: [
              'DELETE',
              'CONTRACT_RUPTURE',
              'EXPORT_ETAX',
              '2FA_DISABLED',
              'SUBSCRIPTION_CANCEL',
              'SETTINGS_PAYROLL_UPDATE',
              'CABINET_REMOVE_COMPANY',
            ],
          },
        },
      }),
    ]);

    return {
      period: '7 derniers jours',
      total7d,
      critical,
      byAction: byAction.map((r) => ({ action: r.action, count: r._count.id })),
      byEntity: byEntity.map((r) => ({ entity: r.entity, count: r._count.id })),
    };
  }
}
