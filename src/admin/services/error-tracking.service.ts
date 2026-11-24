// ============================================================================
// 📁 src/admin/services/error-tracking.service.ts
// Service de consultation des erreurs applicatives — Super Admin uniquement
// ============================================================================
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ErrorTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Récupérer les erreurs avec filtres ──────────────────────────────────
  async getErrors(filters: {
    page?: number;
    limit?: number;
    companyId?: string;
    errorCode?: string;
    statusCode?: number;
    path?: string;
    severity?: string;
    resolved?: boolean;
    from?: string;
    to?: string;
  }) {
    const take = Math.min(filters.limit ?? 50, 200);
    const skip = ((filters.page ?? 1) - 1) * take;

    const where: any = {};
    if (filters.companyId) where.companyId = filters.companyId;
    if (filters.errorCode)
      where.errorCode = { contains: filters.errorCode.toUpperCase() };
    if (filters.statusCode) where.statusCode = filters.statusCode;
    if (filters.path) where.path = { contains: filters.path };
    if (filters.severity) where.severity = filters.severity.toUpperCase();
    if (filters.resolved !== undefined) where.resolved = filters.resolved;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }

    const [errors, total] = await Promise.all([
      (this.prisma as any).appError.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          // On joint manuellement via userId / companyId car pas de relation définie
        },
      }),
      (this.prisma as any).appError.count({ where }),
    ]);

    // Enrichir avec infos entreprise et utilisateur
    const enriched = await Promise.all(
      errors.map(async (e: any) => {
        let companyName: string | null = null;
        let userEmail: string | null = null;
        if (e.companyId) {
          const co = await this.prisma.company
            .findUnique({
              where: { id: e.companyId },
              select: { legalName: true },
            })
            .catch(() => null);
          companyName = co?.legalName ?? null;
        }
        if (e.userId) {
          const u = await this.prisma.user
            .findUnique({
              where: { id: e.userId },
              select: { email: true, firstName: true, lastName: true },
            })
            .catch(() => null);
          userEmail = u ? `${u.firstName} ${u.lastName} <${u.email}>` : null;
        }
        return { ...e, companyName, userEmail };
      }),
    );

    return {
      data: enriched,
      meta: {
        total,
        page: filters.page ?? 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  // ─── Stats globales ───────────────────────────────────────────────────────
  async getStats() {
    const h24 = new Date(Date.now() - 86400000);
    const d7 = new Date(Date.now() - 7 * 86400000);

    const [
      total24h,
      total7d,
      unresolved,
      by4xx,
      by5xx,
      critical,
      byCode,
      byPath,
      byCompany,
      recent500,
    ] = await Promise.all([
      (this.prisma as any).appError.count({
        where: { createdAt: { gte: h24 } },
      }),
      (this.prisma as any).appError.count({
        where: { createdAt: { gte: d7 } },
      }),
      (this.prisma as any).appError.count({ where: { resolved: false } }),

      (this.prisma as any).appError.count({
        where: { createdAt: { gte: d7 }, statusCode: { gte: 400, lt: 500 } },
      }),
      (this.prisma as any).appError.count({
        where: { createdAt: { gte: d7 }, statusCode: { gte: 500 } },
      }),
      (this.prisma as any).appError.count({
        where: { createdAt: { gte: d7 }, severity: 'CRITICAL' },
      }),

      // Top codes d'erreur
      (this.prisma as any).appError.groupBy({
        by: ['errorCode'],
        where: { createdAt: { gte: d7 } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // Top routes avec erreurs
      (this.prisma as any).appError.groupBy({
        by: ['path'],
        where: { createdAt: { gte: d7 } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // Erreurs par entreprise
      (this.prisma as any).appError
        .groupBy({
          by: ['companyId'],
          where: { createdAt: { gte: d7 }, companyId: { not: null } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 10,
        })
        .then(async (rows: any[]) => {
          return Promise.all(
            rows.map(async (r: any) => {
              const co = await this.prisma.company
                .findUnique({
                  where: { id: r.companyId },
                  select: { legalName: true },
                })
                .catch(() => null);
              return {
                companyId: r.companyId,
                name: co?.legalName ?? r.companyId,
                count: r._count.id,
              };
            }),
          );
        }),

      // Dernières erreurs 500
      (this.prisma as any).appError.findMany({
        where: { statusCode: { gte: 500 }, createdAt: { gte: d7 } },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          message: true,
          path: true,
          createdAt: true,
          errorCode: true,
        },
      }),
    ]);

    // Distribution par status code (24h)
    const byStatus = await (this.prisma as any).appError.groupBy({
      by: ['statusCode'],
      where: { createdAt: { gte: h24 } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return {
      total24h,
      total7d,
      unresolved,
      by4xx,
      by5xx,
      critical,
      byCode: byCode.map((r: any) => ({
        code: r.errorCode,
        count: r._count.id,
      })),
      byPath: byPath.map((r: any) => ({ path: r.path, count: r._count.id })),
      byCompany,
      byStatus: byStatus.map((r: any) => ({
        status: r.statusCode,
        count: r._count.id,
      })),
      recent500,
    };
  }

  // ─── Résoudre une erreur ──────────────────────────────────────────────────
  async resolve(id: string, note?: string, adminId?: string) {
    return (this.prisma as any).appError.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: adminId ?? null,
        note: note ?? null,
      },
    });
  }

  // ─── Résoudre en masse (par errorCode) ───────────────────────────────────
  async resolveByCode(errorCode: string, adminId?: string) {
    return (this.prisma as any).appError.updateMany({
      where: { errorCode, resolved: false },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: adminId ?? null,
      },
    });
  }

  // ─── Supprimer les anciennes erreurs résolues ─────────────────────────────
  async cleanup(olderThanDays = 30) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000);
    return (this.prisma as any).appError.deleteMany({
      where: { resolved: true, createdAt: { lt: cutoff } },
    });
  }
}
