// ============================================================================
// 📁 src/admin/server-monitor/request-metrics.middleware.ts
// Mesure la durée et le statut de chaque requête (clé = motif de route, ex.
// "GET /employees/:id", donc pas d'explosion de clés avec les identifiants).
// ============================================================================
import { Injectable, NestMiddleware } from '@nestjs/common';
import { RouteStatsCollector } from './route-stats.collector';

@Injectable()
export class RequestMetricsMiddleware implements NestMiddleware {
  constructor(private readonly collector: RouteStatsCollector) {}

  use(req: any, res: any, next: () => void) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const pattern = req.route?.path ? `${req.baseUrl ?? ''}${String(req.route.path)}` : null;
        if (!pattern) {
          this.collector.record(`${req.method} (route inconnue)`, res.statusCode, ms);
          return;
        }
        // On ne mesure ni le monitoring lui-même ni le health check public
        if (pattern.startsWith('/admin/server') || pattern === '/health') return;
        this.collector.record(`${req.method} ${pattern}`, res.statusCode, ms);
      } catch {
        /* la mesure ne doit jamais gêner une requête */
      }
    });
    next();
  }
}