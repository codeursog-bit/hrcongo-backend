// ============================================================================
// 📁 src/admin/server-monitor/diagnostics.ts
// Moteur de diagnostic « pourquoi ? » — fonction PURE (sans base de données),
// donc testable. Il croise relevés machine, base, API et taille des tables.
// ============================================================================

export type FindingLevel = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Finding {
  key: string;
  level: FindingLevel;
  title: string;
  /** Explication en français, avec les chiffres */
  detail: string;
  /** Que faire */
  action?: string;
  /** Données brutes pour l'affichage (tableaux, valeurs) */
  evidence?: any;
}

export interface SnapshotRow {
  createdAt: Date;
  metrics: any;
  routes?: any;
}
export interface TablesRow {
  createdAt: Date;
  tables: any;
}

const SEVERITY: Record<FindingLevel, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function analyzeServer(
  snaps: SnapshotRow[],
  tableSnaps: TablesRow[],
  purgeTables: Set<string>,
): Finding[] {
  const f: Finding[] = [];
  const last = snaps[snaps.length - 1]?.metrics;

  if (!last) {
    return [
      {
        key: 'no-data',
        level: 'INFO',
        title: 'Pas encore de données',
        detail: 'Le premier relevé est pris dans les 5 minutes qui suivent le démarrage du back.',
      },
    ];
  }

  const hourAgo = Date.now() - 3600_000;
  const lastHour = snaps.filter((s) => s.createdAt.getTime() >= hourAgo);
  const lastHourMetrics = lastHour.map((s) => s.metrics);

  // ── Disque ────────────────────────────────────────────────────────────────
  const disk = last.machine?.diskPct;
  if (typeof disk === 'number') {
    if (disk >= 90) {
      f.push({
        key: 'disk-critical', level: 'CRITICAL',
        title: `Disque presque plein (${disk} %)`,
        detail: `${last.machine.diskUsedGb} Go utilisés sur ${last.machine.diskTotalGb} Go. À 100 %, la base et l’app s’arrêtent.`,
        action: 'Purge les journaux (écran Purge), fais un `docker system prune` et vérifie la taille des logs Docker.',
      });
    } else if (disk >= 80) {
      f.push({
        key: 'disk-warning', level: 'WARNING',
        title: `Disque à ${disk} %`,
        detail: `${last.machine.diskUsedGb} Go utilisés sur ${last.machine.diskTotalGb} Go.`,
        action: 'Surveille la croissance ci-dessous et purge les journaux inutiles.',
      });
    }
    // Rythme de remplissage (24 h)
    const first = snaps[0]?.metrics;
    const spanDays = (snaps[snaps.length - 1].createdAt.getTime() - snaps[0].createdAt.getTime()) / 86400_000;
    if (first?.machine?.diskUsedGb != null && spanDays >= 0.25) {
      const slope = (last.machine.diskUsedGb - first.machine.diskUsedGb) / spanDays; // Go / jour
      const free = last.machine.diskTotalGb - last.machine.diskUsedGb;
      if (slope > 0.05 && free / slope < 30) {
        f.push({
          key: 'disk-eta', level: free / slope < 7 ? 'CRITICAL' : 'WARNING',
          title: `Disque plein dans ~${Math.max(1, Math.round(free / slope))} jour(s) à ce rythme`,
          detail: `+${slope.toFixed(2)} Go/jour sur les dernières ${Math.round(spanDays * 24)} h, il reste ${free.toFixed(1)} Go.`,
          action: 'Regarde les tables qui grossissent le plus (plus bas) et les images Docker anciennes.',
        });
      }
    }
  }

  // ── Mémoire machine / conteneur ──────────────────────────────────────────
  const mem = last.machine?.memPct;
  if (typeof mem === 'number' && mem >= 90) {
    f.push({
      key: 'ram-high', level: 'WARNING',
      title: `Mémoire de la machine à ${mem} %`,
      detail: `${last.machine.memUsedMb} Mo sur ${last.machine.memTotalMb} Mo : risque que Linux tue un process (souvent la base ou le back).`,
      action: 'Ajoute du swap, évite de builder sur cette machine pendant les heures de pointe, ou passe à un serveur plus gros.',
    });
  }
  if (last.container?.memMb && last.container?.memLimitMb && last.container.memMb / last.container.memLimitMb >= 0.9) {
    f.push({
      key: 'container-mem', level: 'WARNING',
      title: 'Le conteneur du back approche sa limite de mémoire',
      detail: `${last.container.memMb} Mo sur ${last.container.memLimitMb} Mo autorisés : le conteneur sera tué (OOM) en cas de dépassement.`,
      action: 'Augmente la limite dans Coolify ou cherche la cause (fuite, gros imports, génération de PDF).',
    });
  }

  // ── Fuite mémoire probable (RSS qui monte sans jamais redescendre) ───────
  if (snaps.length >= 12) {
    const q = Math.floor(snaps.length / 4);
    const early = avg(snaps.slice(0, q).map((s) => s.metrics.app?.rssMb ?? 0));
    const late = avg(snaps.slice(-q).map((s) => s.metrics.app?.rssMb ?? 0));
    let continuous = true;
    for (let i = 1; i < snaps.length; i++) {
      if ((snaps[i].metrics.app?.uptimeSec ?? 0) < (snaps[i - 1].metrics.app?.uptimeSec ?? 0)) continuous = false;
    }
    if (continuous && early > 0 && late > 300 && late / early > 1.4) {
      f.push({
        key: 'memory-leak', level: 'WARNING',
        title: 'La mémoire du back monte sans redescendre',
        detail: `Moyenne passée de ${Math.round(early)} Mo à ${Math.round(late)} Mo sur 24 h sans redémarrage : fuite mémoire possible.`,
        action: 'Si ça continue, planifie un redémarrage et signale-moi les routes les plus appelées pour chercher la cause.',
      });
    }
  }

  // ── Redémarrages et trous de relevés ─────────────────────────────────────
  let restarts = 0;
  const gaps: { at: string; minutes: number }[] = [];
  for (let i = 1; i < snaps.length; i++) {
    if ((snaps[i].metrics.app?.uptimeSec ?? 0) < (snaps[i - 1].metrics.app?.uptimeSec ?? 0)) restarts++;
    const gapMin = (snaps[i].createdAt.getTime() - snaps[i - 1].createdAt.getTime()) / 60000;
    if (gapMin > 15) gaps.push({ at: snaps[i - 1].createdAt.toISOString(), minutes: Math.round(gapMin) });
  }
  if (restarts >= 3) {
    f.push({
      key: 'restarts', level: 'CRITICAL',
      title: `${restarts} redémarrages du back en 24 h`,
      detail: 'Le back plante ou est tué à répétition (mémoire saturée ? erreur au démarrage ? déploiements ?).',
      action: 'Regarde les logs du conteneur dans Coolify au moment des redémarrages et la mémoire juste avant.',
    });
  } else if (restarts > 0) {
    f.push({
      key: 'restarts', level: 'INFO',
      title: `${restarts} redémarrage(s) du back en 24 h`,
      detail: 'Normal si tu as déployé. Sinon, vérifie les logs du conteneur.',
    });
  }
  if (gaps.length) {
    f.push({
      key: 'gaps', level: 'INFO',
      title: `${gaps.length} trou(s) dans les relevés`,
      detail: 'Le back (ou la machine) était arrêté pendant ces périodes.',
      evidence: gaps.slice(-5),
    });
  }

  // ── Base de données ──────────────────────────────────────────────────────
  if (last.db?.ok === false) {
    f.push({
      key: 'db-down', level: 'CRITICAL', title: 'Base de données injoignable',
      detail: 'Le back n’arrive plus à interroger PostgreSQL.',
      action: 'Vérifie le conteneur Postgres dans Coolify et l’espace disque.',
    });
  } else if (last.db?.maxConnections && last.db?.connections != null) {
    const ratio = last.db.connections / last.db.maxConnections;
    if (ratio >= 0.7) {
      f.push({
        key: 'db-connections', level: ratio >= 0.85 ? 'CRITICAL' : 'WARNING',
        title: `Connexions à la base : ${last.db.connections}/${last.db.maxConnections}`,
        detail: 'Trop de connexions ouvertes : les nouvelles requêtes vont attendre ou échouer (erreur P2024).',
        action: 'Ajoute `?connection_limit=10&pool_timeout=20` à DATABASE_URL et vérifie les traitements lancés en parallèle.',
      });
    }
  }
  if (typeof last.db?.cacheHitPct === 'number' && last.db.cacheHitPct < 95 && (last.db.sizeMb ?? 0) > 200) {
    f.push({
      key: 'db-cache', level: 'INFO',
      title: `Cache de la base à ${last.db.cacheHitPct} %`,
      detail: 'La base lit souvent le disque au lieu de la mémoire : manque de RAM pour sa taille.',
    });
  }
  const dbLat = avg(lastHourMetrics.map((m) => m.db?.latencyMs).filter((v) => typeof v === 'number'));
  if (dbLat > 200) {
    f.push({
      key: 'db-latency', level: 'WARNING', title: `Base lente (${Math.round(dbLat)} ms en moyenne)`,
      detail: 'Une requête simple met plus de 200 ms : la base est surchargée ou le disque est lent.',
      action: 'Regarde « Requêtes lentes » et les tables avec beaucoup de lignes mortes.',
    });
  }

  // ── Back : CPU et boucle d'événements ────────────────────────────────────
  const loopMean = avg(lastHourMetrics.map((m) => m.app?.eventLoopMeanMs ?? 0));
  const loopMax = Math.max(0, ...lastHourMetrics.map((m) => m.app?.eventLoopMaxMs ?? 0));
  if (loopMean > 50 || loopMax > 2000) {
    f.push({
      key: 'event-loop', level: 'WARNING',
      title: 'Le back est parfois « bloqué »',
      detail: `Retard moyen de ${Math.round(loopMean)} ms, pic à ${Math.round(loopMax)} ms : un traitement lourd monopolise le processeur (génération de PDF, import Excel, gros calculs de paie).`,
      action: 'Regarde les routes les plus coûteuses ci-dessous : l’une d’elles est probablement la cause.',
    });
  }
  const cpuApp = avg(lastHourMetrics.map((m) => m.app?.cpuPct ?? 0));
  if (cpuApp > 80) {
    f.push({
      key: 'app-cpu', level: 'WARNING', title: `Le back utilise ${Math.round(cpuApp)} % d’un cœur`,
      detail: 'Node.js n’exploite qu’un cœur : au-delà de 80 % en moyenne, tout ralentit.',
    });
  }

  // ── Front ────────────────────────────────────────────────────────────────
  const lastTwo = snaps.slice(-2).map((s) => s.metrics.front);
  if (lastTwo.length === 2 && lastTwo.every((x) => x?.checked && x.ok === false)) {
    f.push({
      key: 'front-down', level: 'CRITICAL', title: 'Le front ne répond pas',
      detail: 'Les 2 derniers tests (10 min) ont échoué sur FRONTEND_URL.',
      action: 'Vérifie le conteneur du front et le proxy dans Coolify.',
    });
  }

  // ── Routes API (dernière heure) ──────────────────────────────────────────
  const agg = new Map<string, { count: number; err5xx: number; err4xx: number; totalMs: number; p95: number; max: number }>();
  for (const s of lastHour) {
    for (const r of (s.routes as any[]) ?? []) {
      const a = agg.get(r.route) ?? { count: 0, err5xx: 0, err4xx: 0, totalMs: 0, p95: 0, max: 0 };
      a.count += r.count; a.err5xx += r.err5xx; a.err4xx += r.err4xx; a.totalMs += r.totalMs;
      a.p95 = Math.max(a.p95, r.p95Ms); a.max = Math.max(a.max, r.maxMs);
      agg.set(r.route, a);
    }
  }
  const routes = [...agg.entries()].map(([route, a]) => ({ route, ...a }));
  const slow = routes.filter((r) => r.count >= 20 && r.p95 >= 2000).sort((a, b) => b.p95 - a.p95).slice(0, 5);
  if (slow.length) {
    f.push({
      key: 'slow-routes', level: 'WARNING', title: `${slow.length} route(s) lente(s) (p95 ≥ 2 s)`,
      detail: 'Ces routes mettent plus de 2 secondes pour 95 % des appels sur la dernière heure.',
      action: 'Ajoute un index, pagine la liste ou allège la requête Prisma (select au lieu de include).',
      evidence: slow,
    });
  }
  const failing = routes.filter((r) => r.count >= 20 && r.err5xx / r.count >= 0.05).sort((a, b) => b.err5xx - a.err5xx).slice(0, 5);
  if (failing.length) {
    f.push({
      key: 'failing-routes', level: 'WARNING', title: `${failing.length} route(s) en erreur serveur`,
      detail: 'Plus de 5 % d’erreurs 5xx sur la dernière heure.',
      action: 'Ouvre l’Error Tracker et filtre sur ces routes.',
      evidence: failing,
    });
  }
  const totalTime = routes.reduce((s, r) => s + r.totalMs, 0);
  if (totalTime > 0) {
    const top = [...routes].sort((a, b) => b.totalMs - a.totalMs).slice(0, 3)
      .map((r) => ({ route: r.route, appels: r.count, partDuTemps: Math.round((r.totalMs / totalTime) * 100) }));
    f.push({
      key: 'top-routes', level: 'INFO', title: 'Routes qui consomment le plus de temps serveur (1 h)',
      detail: top.map((t) => `${t.route} : ${t.partDuTemps} % (${t.appels} appels)`).join(' · '),
      evidence: top,
    });
  }

  // ── Tables : croissance et lignes mortes ─────────────────────────────────
  const withTables = tableSnaps.filter((t) => Array.isArray(t.tables) && t.tables.length);
  if (withTables.length) {
    const latest = withTables[withTables.length - 1];
    const base = withTables.find((t) => latest.createdAt.getTime() - t.createdAt.getTime() >= 12 * 3600_000);
    if (base) {
      const baseMap = new Map<string, number>((base.tables as any[]).map((t) => [t.name, t.totalBytes]));
      const grew = (latest.tables as any[])
        .map((t) => {
          const before = baseMap.get(t.name);
          return { name: t.name, totalMb: mb(t.totalBytes), growthMb: mb(t.totalBytes - (before ?? 0)), isNew: before == null, liveRows: t.liveRows, purgeable: purgeTables.has(t.name) };
        })
        .filter((t) => t.growthMb >= 20)
        .sort((a, b) => b.growthMb - a.growthMb)
        .slice(0, 5);
      if (grew.length) {
        const days = Math.max(1, Math.round((latest.createdAt.getTime() - base.createdAt.getTime()) / 86400_000));
        const heavy = grew.some((t) => t.growthMb >= 200);
        f.push({
          key: 'table-growth', level: heavy ? 'WARNING' : 'INFO',
          title: 'Tables qui grossissent le plus',
          detail: grew.map((t) => `${t.name} +${t.growthMb} Mo (${t.purgeable ? 'purgeable' : 'données métier ou sans règle de purge'})`).join(' · ') + ` — sur ~${days} jour(s).`,
          action: grew.some((t) => !t.purgeable)
            ? 'Si une table sans règle de purge est un journal, ajoute-la dans purge-registry.ts. Sinon, c’est de la croissance normale (plus de clients).'
            : 'Lance une purge depuis l’écran Purge.',
          evidence: grew,
        });
      }
    }
    const bloated = (latest.tables as any[])
      .filter((t) => t.deadRows >= 10000 && t.deadRows / Math.max(1, t.liveRows + t.deadRows) >= 0.25)
      .slice(0, 5);
    if (bloated.length) {
      f.push({
        key: 'dead-rows', level: 'INFO', title: 'Tables encombrées de lignes mortes',
        detail: bloated.map((t) => `${t.name} (${t.deadRows} lignes mortes)`).join(' · '),
        action: 'Normal après une grosse purge : PostgreSQL les nettoie (autovacuum). Si ça dure, lance un VACUUM en heures creuses.',
        evidence: bloated,
      });
    }
  }

  return f.sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
}