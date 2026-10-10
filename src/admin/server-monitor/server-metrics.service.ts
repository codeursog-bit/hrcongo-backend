// ============================================================================
// 📁 src/admin/server-monitor/server-metrics.service.ts
// Suivi du serveur depuis le super admin : machine, back, base, front, API.
//  • un relevé toutes les 5 min, gardé 30 jours (table server_metric_snapshots)
//  • la taille de TOUTES les tables est relevée automatiquement (nouvelles
//    tables incluses) toutes les 6 h
//  • alertes dédoublonnées vers les SUPER_ADMIN (notification + journal ALERT)
// Désactivable : SERVER_MONITOR_ENABLED=false
// ============================================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import * as fsp from 'fs/promises';
import { readFileSync } from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../../system-logs/system-logs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RouteStatsCollector } from './route-stats.collector';
import { analyzeServer, Finding } from './diagnostics';
import { PURGE_TABLES } from './purge-registry';

const TABLES_EVERY_MS = 6 * 3600_000;
const RETENTION_DAYS = 30;

const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
const gb = (b: number) => Math.round((b / 1073741824) * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const toNum = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

export interface TableInfo {
  name: string;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  liveRows: number;
  deadRows: number;
}

@Injectable()
export class ServerMetricsService implements OnModuleInit {
  private readonly logger = new Logger('📈 ServerMetrics');
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private lastCpu = process.cpuUsage();
  private lastCpuAt = Date.now();
  private lastTablesAt = 0;
  private collecting = false;
  private frontFailStreak = 0;
  private lastUptimeSec: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: RouteStatsCollector,
    private readonly systemLogs: SystemLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.loop.enable();
  }

  // ==========================================================================
  // 📸 Relevé planifié
  // ==========================================================================
  @Cron(CronExpression.EVERY_5_MINUTES)
  async snapshotTick(): Promise<void> {
    if (process.env.SERVER_MONITOR_ENABLED === 'false' || this.collecting) return;
    this.collecting = true;
    try {
      const needTables = Date.now() - this.lastTablesAt > TABLES_EVERY_MS;
      const { metrics, tables } = await this.readMetrics({ withTables: needTables, commit: true });
      const routes = this.collector.flush(15);
      await this.prisma.serverMetricSnapshot.create({
        data: {
          metrics: metrics as any,
          tables: tables ? (tables as any) : undefined,
          routes: routes.length ? (routes as any) : undefined,
        },
      });
      if (tables) this.lastTablesAt = Date.now();
      await this.evaluateAlerts(metrics);
    } catch (e: any) {
      this.logger.warn(`Relevé impossible : ${e?.message ?? e}`);
    } finally {
      this.collecting = false;
    }
  }

  @Cron('15 5 * * *', { timeZone: 'Africa/Brazzaville' })
  async purgeOldSnapshots(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000);
      const r = await this.prisma.serverMetricSnapshot.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (r.count) this.logger.log(`🧹 ${r.count} relevé(s) de suivi supprimé(s) (> ${RETENTION_DAYS} j)`);
    } catch (e: any) {
      this.logger.warn(`Purge relevés : ${e?.message ?? e}`);
    }
  }

  // ==========================================================================
  // 🔎 Lecture pour l'écran super admin
  // ==========================================================================

  /** Valeurs en direct (sans rien enregistrer) + diagnostic */
  async getOverview() {
    const { metrics } = await this.readMetrics({ withTables: false, commit: false });
    const findings = await this.getDiagnostics();
    return {
      live: metrics,
      liveRoutes: this.collector.peek(15), // depuis le dernier relevé (≤ 5 min)
      findings,
      retentionDays: RETENTION_DAYS,
    };
  }

  async getHistory(hours: number) {
    const h = Math.min(Math.max(Math.floor(hours) || 24, 1), RETENTION_DAYS * 24);
    const since = new Date(Date.now() - h * 3600_000);
    const rows = await this.prisma.serverMetricSnapshot.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, metrics: true },
    });
    const stride = Math.max(1, Math.ceil(rows.length / 300));
    const points = rows
      .filter((_, i) => i % stride === 0 || i === rows.length - 1)
      .map((r) => {
        const m: any = r.metrics;
        return {
          at: r.createdAt,
          loadPct: m.machine?.loadPct ?? null,
          memPct: m.machine?.memPct ?? null,
          diskPct: m.machine?.diskPct ?? null,
          diskUsedGb: m.machine?.diskUsedGb ?? null,
          rssMb: m.app?.rssMb ?? null,
          heapUsedMb: m.app?.heapUsedMb ?? null,
          appCpuPct: m.app?.cpuPct ?? null,
          eventLoopMeanMs: m.app?.eventLoopMeanMs ?? null,
          dbSizeMb: m.db?.sizeMb ?? null,
          dbConnections: m.db?.connections ?? null,
          dbLatencyMs: m.db?.latencyMs ?? null,
          frontLatencyMs: m.front?.latencyMs ?? null,
          frontOk: m.front?.ok ?? null,
        };
      });
    return { hours: h, snapshots: rows.length, stride, points };
  }

  /** Taille actuelle de toutes les tables + croissance sur ~7 jours */
  async getTables() {
    const live = await this.readTables();
    const since = new Date(Date.now() - 7 * 86400_000);
    const old = await this.prisma.serverMetricSnapshot.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, tables: true },
    });
    const withTables = old.filter((o) => Array.isArray(o.tables) && (o.tables as any[]).length);
    const base = withTables[0];
    const baseMap = new Map<string, number>(
      ((base?.tables as any[]) ?? []).map((t) => [t.name, t.totalBytes]),
    );
    return {
      since: base?.createdAt ?? null,
      tables: live.map((t) => ({
        name: t.name,
        totalMb: mb(t.totalBytes),
        tableMb: mb(t.tableBytes),
        indexMb: mb(t.indexBytes),
        liveRows: t.liveRows,
        deadRows: t.deadRows,
        growthMb: base ? mb(t.totalBytes - (baseMap.get(t.name) ?? 0)) : null,
        isNewSinceBase: base ? !baseMap.has(t.name) : false,
        purgeable: PURGE_TABLES.has(t.name),
      })),
    };
  }

  /** Requêtes les plus coûteuses (nécessite l'extension pg_stat_statements) */
  async getSlowQueries() {
    try {
      const ext = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_extension WHERE extname = 'pg_stat_statements'`;
      if (Number(ext[0]?.n ?? 0) === 0) return this.slowQueriesHowTo();
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT left(query, 300) AS query,
               calls::bigint AS calls,
               round(total_exec_time::numeric, 0)::float8 AS total_ms,
               round(mean_exec_time::numeric, 1)::float8 AS mean_ms,
               rows::bigint AS rows
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY total_exec_time DESC
        LIMIT 15`;
      return {
        available: true,
        queries: rows.map((r) => ({
          query: r.query, calls: Number(r.calls), totalMs: Number(r.total_ms), meanMs: Number(r.mean_ms), rows: Number(r.rows),
        })),
      };
    } catch {
      return this.slowQueriesHowTo();
    }
  }

  async getDiagnostics(): Promise<Finding[]> {
    const snaps = await this.prisma.serverMetricSnapshot.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, metrics: true, routes: true },
    });
    const tableSnaps = await this.prisma.serverMetricSnapshot.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, tables: true },
    });
    return analyzeServer(snaps as any, tableSnaps as any, PURGE_TABLES);
  }

  // ==========================================================================
  // 🧮 Mesures
  // ==========================================================================
  private async readMetrics(opts: { withTables: boolean; commit: boolean }) {
    const totalMem = os.totalmem();
    const usedMem = totalMem - os.freemem();
    const cores = os.cpus().length || 1;
    const load1 = os.loadavg()[0];

    // CPU du processus (en % d'un cœur) depuis le dernier relevé
    const now = Date.now();
    const usage = process.cpuUsage(this.lastCpu);
    const elapsedMs = Math.max(1, now - this.lastCpuAt);
    const cpuPct = round1(((usage.user + usage.system) / 1000 / elapsedMs) * 100);

    // Boucle d'événements
    const loopMean = Number.isFinite(this.loop.mean) ? this.loop.mean / 1e6 : 0;
    const loopMax = Number.isFinite(this.loop.max) ? this.loop.max / 1e6 : 0;

    if (opts.commit) {
      this.lastCpu = process.cpuUsage();
      this.lastCpuAt = now;
      this.loop.reset();
    }

    const mem = process.memoryUsage();
    const [disk, db, front] = await Promise.all([this.readDisk(), this.readDb(), this.pingFront()]);
    const cg = this.readCgroupMem();

    const metrics = {
      at: new Date().toISOString(),
      machine: {
        cpuLoad1: round1(load1),
        cpuCores: cores,
        loadPct: round1((load1 / cores) * 100),
        memTotalMb: Math.round(totalMem / 1048576),
        memUsedMb: Math.round(usedMem / 1048576),
        memPct: round1((usedMem / totalMem) * 100),
        diskTotalGb: disk?.totalGb ?? null,
        diskUsedGb: disk?.usedGb ?? null,
        diskPct: disk?.pct ?? null,
      },
      container: { memMb: cg.memMb, memLimitMb: cg.limitMb },
      app: {
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        heapTotalMb: Math.round(mem.heapTotal / 1048576),
        cpuPct,
        eventLoopMeanMs: round1(loopMean),
        eventLoopMaxMs: round1(loopMax),
        uptimeSec: Math.round(process.uptime()),
        nodeVersion: process.version,
      },
      db,
      front,
    };

    const tables = opts.withTables ? await this.readTables().catch(() => null) : null;
    return { metrics, tables };
  }

  private async readDisk() {
    try {
      const st = await (fsp as any).statfs(process.env.SERVER_MONITOR_DISK_PATH || '/');
      const bsize = Number(st.bsize);
      const used = (Number(st.blocks) - Number(st.bfree)) * bsize;
      const avail = Number(st.bavail) * bsize;
      const total = used + avail; // même logique que `df` (hors espace réservé root)
      return { totalGb: gb(total), usedGb: gb(used), pct: round1((used / total) * 100) };
    } catch {
      return null;
    }
  }

  private readCgroupMem(): { memMb: number | null; limitMb: number | null } {
    const read = (p: string) => {
      try { return readFileSync(p, 'utf8').trim(); } catch { return null; }
    };
    const cur = read('/sys/fs/cgroup/memory.current') ?? read('/sys/fs/cgroup/memory/memory.usage_in_bytes');
    const lim = read('/sys/fs/cgroup/memory.max') ?? read('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    const curN = cur ? Number(cur) : NaN;
    let limN = lim && lim !== 'max' ? Number(lim) : NaN;
    if (!Number.isFinite(limN) || limN > os.totalmem() * 1.01) limN = NaN; // aucune vraie limite
    return {
      memMb: Number.isFinite(curN) ? Math.round(curN / 1048576) : null,
      limitMb: Number.isFinite(limN) ? Math.round(limN / 1048576) : null,
    };
  }

  private async readDb() {
    const t0 = Date.now();
    try {
      const size = await this.prisma.$queryRaw<{ v: bigint }[]>`SELECT pg_database_size(current_database()) AS v`;
      const latencyMs = Date.now() - t0;
      const conns = await this.prisma.$queryRaw<{ v: bigint }[]>`SELECT count(*) AS v FROM pg_stat_activity WHERE datname = current_database()`;
      const max = await this.prisma.$queryRaw<{ v: number }[]>`SELECT setting::int AS v FROM pg_settings WHERE name = 'max_connections'`;
      const cache = await this.prisma.$queryRaw<{ v: number | null }[]>`
        SELECT (100.0 * sum(blks_hit) / NULLIF(sum(blks_hit) + sum(blks_read), 0))::float8 AS v
        FROM pg_stat_database WHERE datname = current_database()`;
      return {
        ok: true,
        sizeMb: mb(Number(size[0]?.v ?? 0)),
        connections: toNum(conns[0]?.v),
        maxConnections: toNum(max[0]?.v),
        cacheHitPct: cache[0]?.v != null ? round1(Number(cache[0].v)) : null,
        latencyMs,
      };
    } catch {
      return { ok: false, sizeMb: null, connections: null, maxConnections: null, cacheHitPct: null, latencyMs: null };
    }
  }

  /** Toutes les tables du schéma courant — les nouvelles tables apparaissent seules */
  private async readTables(): Promise<TableInfo[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT c.relname AS name,
             pg_total_relation_size(c.oid)::bigint AS total_bytes,
             pg_relation_size(c.oid)::bigint AS table_bytes,
             pg_indexes_size(c.oid)::bigint AS index_bytes,
             COALESCE(s.n_live_tup, 0)::bigint AS live_rows,
             COALESCE(s.n_dead_tup, 0)::bigint AS dead_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind = 'r' AND n.nspname = current_schema()
      ORDER BY total_bytes DESC
      LIMIT 60`;
    return rows.map((r) => ({
      name: r.name,
      totalBytes: Number(r.total_bytes),
      tableBytes: Number(r.table_bytes),
      indexBytes: Number(r.index_bytes),
      liveRows: Number(r.live_rows),
      deadRows: Number(r.dead_rows),
    }));
  }

  private async pingFront() {
    const raw = (process.env.FRONTEND_URL || '').split(',')[0]?.trim();
    if (!raw || !/^https?:\/\//i.test(raw)) return { checked: false, ok: null as boolean | null, latencyMs: null as number | null };
    const t0 = Date.now();
    try {
      const res = await fetch(raw, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
      void res.body?.cancel();
      return { checked: true, ok: res.status < 500, latencyMs: Date.now() - t0 };
    } catch {
      return { checked: true, ok: false, latencyMs: null };
    }
  }

  private slowQueriesHowTo() {
    return {
      available: false,
      howTo:
        "L'extension pg_stat_statements n'est pas activée. Dans Postgres : ajoute `shared_preload_libraries = 'pg_stat_statements'` " +
        "(Coolify : onglet de la base → configuration/commande), redémarre la base, puis exécute `CREATE EXTENSION pg_stat_statements;`.",
      queries: [] as any[],
    };
  }

  // ==========================================================================
  // 🚨 Alertes (dédoublonnées par jour) vers les SUPER_ADMIN
  // ==========================================================================
  private async evaluateAlerts(m: any): Promise<void> {
    const alerts: { key: string; level: 'WARNING' | 'ALERT'; title: string; message: string; hourly?: boolean }[] = [];

    const disk = m.machine?.diskPct;
    if (typeof disk === 'number' && disk >= 90) alerts.push({ key: 'disk-critical', level: 'ALERT', title: `Disque à ${disk} %`, message: `${m.machine.diskUsedGb}/${m.machine.diskTotalGb} Go utilisés. Purge les journaux ou libère de la place sans attendre.` });
    else if (typeof disk === 'number' && disk >= 80) alerts.push({ key: 'disk-warning', level: 'WARNING', title: `Disque à ${disk} %`, message: `${m.machine.diskUsedGb}/${m.machine.diskTotalGb} Go utilisés.` });

    if (typeof m.machine?.memPct === 'number' && m.machine.memPct >= 92)
      alerts.push({ key: 'ram-high', level: 'WARNING', title: `Mémoire à ${m.machine.memPct} %`, message: 'Risque qu’un process soit tué par Linux.' });

    if (m.container?.memMb && m.container?.memLimitMb && m.container.memMb / m.container.memLimitMb >= 0.92)
      alerts.push({ key: 'container-mem', level: 'WARNING', title: 'Conteneur du back proche de sa limite mémoire', message: `${m.container.memMb}/${m.container.memLimitMb} Mo.` });

    if (m.db?.ok === false) alerts.push({ key: 'db-down', level: 'ALERT', title: 'Base de données injoignable', message: 'Le back ne peut plus interroger PostgreSQL.', hourly: true });
    else if (m.db?.maxConnections && m.db?.connections / m.db.maxConnections >= 0.85)
      alerts.push({ key: 'db-connections', level: 'WARNING', title: 'Connexions à la base presque saturées', message: `${m.db.connections}/${m.db.maxConnections}.` });

    if (m.front?.checked && m.front.ok === false) this.frontFailStreak++;
    else this.frontFailStreak = 0;
    if (this.frontFailStreak >= 2) alerts.push({ key: 'front-down', level: 'ALERT', title: 'Le front ne répond plus', message: 'Les 2 derniers tests ont échoué.', hourly: true });

    const up = m.app?.uptimeSec ?? 0;
    if (this.lastUptimeSec !== null && up < this.lastUptimeSec)
      alerts.push({ key: 'app-restart', level: 'WARNING', title: 'Le back a redémarré', message: 'Normal après un déploiement ; sinon vérifie la mémoire et les logs du conteneur.', hourly: true });
    this.lastUptimeSec = up;

    for (const a of alerts) {
      try {
        const stamp = new Date().toISOString().slice(0, a.hourly ? 13 : 10);
        if (!(await this.notifications.tryClaim(`server-alert:${a.key}:${stamp}`))) continue;
        await this.systemLogs.log({ source: 'server-monitor', level: a.level, message: `${a.title} — ${a.message}`, details: { key: a.key } });
        const admins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } });
        for (const u of admins) {
          await this.notifications.create({
            userId: u.id, type: 'SYSTEM_ALERT' as any,
            title: `🖥️ ${a.title}`, message: a.message, link: '/admin/server',
          });
        }
      } catch (e: any) {
        this.logger.warn(`Alerte ${a.key} : ${e?.message ?? e}`);
      }
    }
  }
}