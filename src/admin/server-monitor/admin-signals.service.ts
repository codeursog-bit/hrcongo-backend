// ============================================================================
// 📁 src/admin/server-monitor/admin-signals.service.ts
// Signaux RÉELS pour le panneau « Alertes », le « Flux en direct » et l'en-tête
// du super admin (plus aucun texte écrit en dur côté front).
//  • alertes  = constats serveur critiques/à surveiller + paiements échoués +
//               abonnements impayés + erreurs 5xx non résolues
//  • flux     = nouvelles entreprises, paiements reçus/échoués, alertes système
// Résultats mis en cache quelques secondes : l'en-tête les demande à chaque page.
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ServerMetricsService } from './server-metrics.service';

export type SignalLevel = 'CRITICAL' | 'WARNING';

export interface AdminAlertItem {
  key: string;
  level: SignalLevel;
  title: string;
  detail: string;
  /** Page du super admin où traiter l'alerte */
  href: string;
}
export interface AdminAlerts {
  level: 'OK' | SignalLevel;
  count: number;
  items: AdminAlertItem[];
  generatedAt: string;
}
export interface AdminFeedItem {
  id: string;
  type: 'success' | 'critical' | 'info';
  message: string;
  at: string;
}

const ALERTS_CACHE_MS = 60_000;
const FEED_CACHE_MS = 30_000;
const DAY_MS = 86_400_000;

@Injectable()
export class AdminSignalsService {
  private readonly logger = new Logger('📡 AdminSignals');
  private alertsCache: { at: number; data: AdminAlerts } | null = null;
  private feedCache: { at: number; limit: number; data: AdminFeedItem[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: ServerMetricsService,
  ) {}

  /** Un signal qui échoue ne doit jamais empêcher les autres de s'afficher */
  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      this.logger.warn(`${label} : ${e?.message ?? e}`);
      return fallback;
    }
  }

  // ==========================================================================
  // 🚨 Alertes
  // ==========================================================================
  async getAlerts(force = false): Promise<AdminAlerts> {
    if (!force && this.alertsCache && Date.now() - this.alertsCache.at < ALERTS_CACHE_MS) {
      return this.alertsCache.data;
    }

    const since = new Date(Date.now() - DAY_MS);
    const [findings, failedPayments, pastDue, errors5xx] = await Promise.all([
      this.safe('constats serveur', () => this.metrics.getDiagnostics(), []),
      this.safe('paiements échoués', () => this.prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: since } } }), 0),
      this.safe('abonnements impayés', () => this.prisma.subscription.count({ where: { status: 'PAST_DUE' } }), 0),
      this.safe('erreurs 5xx', () => this.prisma.appError.count({ where: { statusCode: { gte: 500 }, resolved: false, createdAt: { gte: since } } }), 0),
    ]);

    const items: AdminAlertItem[] = [];

    for (const f of findings) {
      if (f.level === 'INFO') continue;
      items.push({ key: `server:${f.key}`, level: f.level as SignalLevel, title: f.title, detail: f.detail, href: '/admin/serveur' });
    }
    if (failedPayments > 0) {
      items.push({
        key: 'payments-failed', level: failedPayments >= 5 ? 'CRITICAL' : 'WARNING',
        title: `${failedPayments} paiement(s) échoué(s) en 24 h`,
        detail: 'Des abonnements n’ont pas pu être encaissés.',
        href: '/admin/subscriptions',
      });
    }
    if (pastDue > 0) {
      items.push({
        key: 'subscriptions-past-due', level: 'WARNING',
        title: `${pastDue} abonnement(s) en impayé`,
        detail: 'Ces entreprises ont un abonnement en retard de paiement.',
        href: '/admin/subscriptions',
      });
    }
    if (errors5xx >= 10) {
      items.push({
        key: 'errors-5xx', level: errors5xx >= 100 ? 'CRITICAL' : 'WARNING',
        title: `${errors5xx} erreur(s) serveur non résolue(s) en 24 h`,
        detail: 'Le back a renvoyé des erreurs 5xx : ouvre l’Error Tracker.',
        href: '/admin/errors',
      });
    }

    items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'CRITICAL' ? -1 : 1));
    const level: AdminAlerts['level'] = items.some((i) => i.level === 'CRITICAL') ? 'CRITICAL' : items.length ? 'WARNING' : 'OK';
    const data: AdminAlerts = { level, count: items.length, items: items.slice(0, 8), generatedAt: new Date().toISOString() };
    this.alertsCache = { at: Date.now(), data };
    return data;
  }

  // ==========================================================================
  // 📰 Flux en direct
  // ==========================================================================
  async getFeed(limit = 8): Promise<AdminFeedItem[]> {
    const lim = Math.min(Math.max(Math.floor(limit) || 8, 1), 20);
    if (this.feedCache && this.feedCache.limit === lim && Date.now() - this.feedCache.at < FEED_CACHE_MS) {
      return this.feedCache.data;
    }

    const [companies, payments, logs] = await Promise.all([
      this.safe('nouvelles entreprises', () => this.prisma.company.findMany({
        where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, legalName: true, createdAt: true },
      }), [] as any[]),
      this.safe('paiements récents', () => this.prisma.payment.findMany({
        where: { status: { in: ['SUCCEEDED', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, status: true, amount: true, currency: true, createdAt: true, paidAt: true, company: { select: { legalName: true } } },
      }), [] as any[]),
      this.safe('alertes système', () => this.prisma.systemLog.findMany({
        where: { level: { in: ['ERROR', 'ALERT'] } }, orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, message: true, createdAt: true },
      }), [] as any[]),
    ]);

    const cut = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n)}…` : s);
    const items: AdminFeedItem[] = [
      ...companies.map((c) => ({ id: `company:${c.id}`, type: 'info' as const, message: `Nouvelle entreprise : ${c.legalName}`, at: c.createdAt.toISOString() })),
      ...payments.map((p) => ({
        id: `payment:${p.id}`,
        type: (p.status === 'SUCCEEDED' ? 'success' : 'critical') as 'success' | 'critical',
        message: `${p.status === 'SUCCEEDED' ? 'Paiement reçu' : 'Paiement échoué'} : ${Number(p.amount).toLocaleString('fr-FR')} ${p.currency} — ${p.company?.legalName ?? 'entreprise'}`,
        at: (p.status === 'SUCCEEDED' && p.paidAt ? p.paidAt : p.createdAt).toISOString(),
      })),
      ...logs.map((l) => ({ id: `log:${l.id}`, type: 'critical' as const, message: cut(l.message), at: l.createdAt.toISOString() })),
    ];
    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    const data = items.slice(0, lim);
    this.feedCache = { at: Date.now(), limit: lim, data };
    return data;
  }
}