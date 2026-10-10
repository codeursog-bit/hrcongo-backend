// ============================================================================
// 📁 src/admin/server-monitor/route-stats.collector.ts
// Agrège en mémoire les appels API par route (nombre, erreurs, durées).
// Vidé à chaque relevé (toutes les 5 min) → aucune écriture en base par requête.
// ============================================================================
import { Injectable } from '@nestjs/common';

interface RouteAgg {
  count: number;
  err4xx: number;
  err5xx: number;
  totalMs: number;
  maxMs: number;
  samples: number[];
}

export interface RouteStat {
  route: string;
  count: number;
  err4xx: number;
  err5xx: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
}

const MAX_ROUTES = 400; // garde-fou mémoire
const MAX_SAMPLES = 200; // échantillon par route pour le p95

@Injectable()
export class RouteStatsCollector {
  private map = new Map<string, RouteAgg>();

  record(route: string, status: number, ms: number): void {
    let agg = this.map.get(route);
    if (!agg) {
      if (this.map.size >= MAX_ROUTES) return;
      agg = { count: 0, err4xx: 0, err5xx: 0, totalMs: 0, maxMs: 0, samples: [] };
      this.map.set(route, agg);
    }
    agg.count++;
    if (status >= 500) agg.err5xx++;
    else if (status >= 400) agg.err4xx++;
    agg.totalMs += ms;
    if (ms > agg.maxMs) agg.maxMs = ms;
    if (agg.samples.length < MAX_SAMPLES) {
      agg.samples.push(ms);
    } else {
      const j = Math.floor(Math.random() * agg.count);
      if (j < MAX_SAMPLES) agg.samples[j] = ms;
    }
  }

  /** Lecture sans vider (pour l'écran en direct) */
  peek(top = 15): RouteStat[] {
    const out: RouteStat[] = [];
    for (const [route, a] of this.map) {
      const sorted = [...a.samples].sort((x, y) => x - y);
      const p95 = sorted.length ? sorted[Math.floor(0.95 * (sorted.length - 1))] : 0;
      out.push({
        route,
        count: a.count,
        err4xx: a.err4xx,
        err5xx: a.err5xx,
        avgMs: Math.round(a.totalMs / a.count),
        p95Ms: Math.round(p95),
        maxMs: Math.round(a.maxMs),
        totalMs: Math.round(a.totalMs),
      });
    }
    return out.sort((a, b) => b.totalMs - a.totalMs).slice(0, top);
  }

  /** Lecture + remise à zéro (appelé par le relevé de 5 min) */
  flush(top = 15): RouteStat[] {
    const r = this.peek(top);
    this.map = new Map();
    return r;
  }
}