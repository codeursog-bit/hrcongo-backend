// ============================================================================
// 📁 src/audit-trail/audit-trail.query.service.ts
// Lecture du journal — TOUJOURS filtrée sur une entreprise déjà vérifiée.
// ============================================================================
import { Injectable } from '@nestjs/common';
import { AuditEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditEventsDto } from './dto/query-audit-events.dto';

// Le SUPER_ADMIN (support plateforme) voit QUI a fait QUOI et QUAND, mais pas
// les valeurs avant/après (salaires, etc.) des entreprises clientes.
const VALUES_HIDDEN_FOR = new Set(['SUPER_ADMIN']);

@Injectable()
export class AuditTrailQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, viewerRole: string, q: QueryAuditEventsDto) {
    const where: Prisma.AuditEventWhereInput = {
      companyId, // ← jamais optionnel
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.from || q.to
        ? {
            occurredAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toView(r, viewerRole)),
      meta: {
        total,
        page: q.page,
        limit: q.limit,
        totalPages: Math.ceil(total / q.limit),
      },
    };
  }

  /** Historique complet d'un objet (employé, contrat…), du plus récent au plus ancien. */
  async historyOf(
    companyId: string,
    viewerRole: string,
    entity: string,
    entityId: string,
  ) {
    const rows = await this.prisma.auditEvent.findMany({
      where: { companyId, entity, entityId },
      orderBy: { seq: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.toView(r, viewerRole));
  }

  /**
   * Activité du journal : un point par jour (information / important / critique), totaux,
   * actions et objets les plus fréquents. Données AGRÉGÉES : aucune valeur, aucun nom.
   * Jours calculés à l'heure de Brazzaville.
   */
  async stats(companyId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; severity: string; n: bigint }>>`
      SELECT date_trunc('day', "occurredAt" AT TIME ZONE 'Africa/Brazzaville') AS day,
             severity::text AS severity, count(*)::bigint AS n
      FROM audit_events
      WHERE "companyId" = ${companyId}::uuid AND "occurredAt" >= ${since}
      GROUP BY 1, 2 ORDER BY 1`;

    const byDay = new Map<string, { info: number; warn: number; critical: number }>();
    for (const r of rows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      const cur = byDay.get(key) ?? { info: 0, warn: 0, critical: 0 };
      if (r.severity === 'INFO') cur.info += Number(r.n);
      else if (r.severity === 'WARN') cur.warn += Number(r.n);
      else if (r.severity === 'CRITICAL') cur.critical += Number(r.n);
      byDay.set(key, cur);
    }
    // jours sans événement = vraies valeurs à zéro (l'axe reste continu)
    const series: Array<{ date: string; info: number; warn: number; critical: number }> = [];
    const localNow = new Date(Date.now() + 3_600_000); // UTC+1, pas de changement d'heure au Congo
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      series.push({ date: key, ...(byDay.get(key) ?? { info: 0, warn: 0, critical: 0 }) });
    }

    const where = { companyId, occurredAt: { gte: since } };
    const [topActions, topEntities] = await Promise.all([
      this.prisma.auditEvent.groupBy({ by: ['action'], where, _count: { _all: true }, orderBy: { _count: { action: 'desc' } }, take: 8 }),
      this.prisma.auditEvent.groupBy({ by: ['entity'], where, _count: { _all: true }, orderBy: { _count: { entity: 'desc' } }, take: 8 }),
    ]);
    const totals = series.reduce((t, d) => ({ info: t.info + d.info, warn: t.warn + d.warn, critical: t.critical + d.critical }), { info: 0, warn: 0, critical: 0 });
    return {
      windowDays: days,
      totals: { events: totals.info + totals.warn + totals.critical, ...totals },
      days: series,
      topActions: topActions.map((a: any) => ({ action: a.action as string, count: a._count._all as number })),
      topEntities: topEntities.map((e: any) => ({ entity: e.entity as string, count: e._count._all as number })),
    };
  }

  private toView(r: AuditEvent, viewerRole: string) {
    const changes = r.changes as any;
    return {
      id: r.id,
      seq: r.seq.toString(), // BigInt non sérialisable en JSON
      occurredAt: r.occurredAt,
      actor: {
        type: r.actorType,
        id: r.actorId,
        role: r.actorRole,
        label: r.actorLabel ?? (r.actorType === 'SYSTEM' ? 'Système' : null),
      },
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      severity: r.severity,
      summary: r.summary,
      changes: VALUES_HIDDEN_FOR.has(viewerRole)
        ? changes
          ? { values: {}, maskedFields: [...Object.keys(changes.values ?? {}), ...(changes.maskedFields ?? [])] }
          : null
        : changes,
      ip: (r.context as any)?.ip ?? null,
    };
  }
}