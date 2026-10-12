// ============================================================================
// 📁 src/admin/services/company-insights.service.ts
// Détail enrichi d'une entreprise pour le super admin :
//  • personnel réel (effectif actif = ce que compte la limite du plan)
//  • comptes utilisateurs et connexions
//  • fonctionnalités les plus utilisées (30 j), dormantes ou jamais utilisées
//  • consommation : requêtes, minutes actives, part de la plateforme, stockage,
//    volume estimé en base
//  • limites du plan (utilisé / maximum), signaux de santé, configuration, paiements
// Tout est calculé à la volée depuis la base : aucune valeur écrite en dur.
// ============================================================================
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getPlanLimits } from '../../subscriptions/config/plans.config';
import { FEATURE_PROBES, FeatureProbe, STORAGE_EXTRAS } from './company-feature-probes';

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? round1((a / b) * 100) : 0);

export type SignalLevel = 'CRITICAL' | 'WARNING' | 'INFO';
export interface CompanySignal { level: SignalLevel; title: string; detail: string }

@Injectable()
export class CompanyInsightsService {
  private readonly logger = new Logger('🏢 CompanyInsights');

  constructor(private readonly prisma: PrismaService) {}

  /** Un bloc qui échoue ne doit pas empêcher l'affichage des autres */
  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      this.logger.warn(`${label} : ${e?.message ?? e}`);
      return fallback;
    }
  }

  private delegate(model: string): any {
    const d = (this.prisma as any)[model];
    if (!d || typeof d.count !== 'function') throw new Error(`modèle ${model} introuvable`);
    return d;
  }

  async getInsights(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, createdAt: true, cnssNumber: true, taxNumber: true, logo: true,
        bankName: true, bankAccount: true, latitude: true, longitude: true,
        subscription: { select: { plan: true, status: true, currentPeriodEnd: true, trialEndsAt: true, pricePerMonth: true } },
      },
    });
    if (!company) throw new NotFoundException(`Entreprise ${companyId} introuvable`);

    const plan = company.subscription?.plan ?? 'FREE';
    const limits: Record<string, any> = getPlanLimits(plan) as any;
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY);

    const [personnel, accounts, features, consumption, documents, payments, setup, counts] = await Promise.all([
      this.safe('personnel', () => this.getPersonnel(companyId, now, since30), null),
      this.safe('comptes', () => this.getAccounts(companyId, since30), null),
      this.safe('fonctionnalités', () => this.getFeatures(companyId, since30, limits), []),
      this.safe('consommation', () => this.getConsumption(companyId, since30), null),
      this.safe('documents', () => this.getDocuments(companyId), { count: 0, bytes: 0 }),
      this.safe('paiements', () => this.getPayments(companyId, since30), null),
      this.safe('configuration', () => this.getSetup(companyId, company), null),
      this.safe('compteurs', () => this.getLimitCounters(companyId), { departments: 0, jobOffers: 0 }),
    ]);

    const storage = await this.safe('volume en base', () => this.getStorage(companyId, features as any[], documents), null);

    // ── Limites du plan (utilisé / maximum) ──────────────────────────────────
    const lim = (key: string, label: string, used: number, max: number, unit = '') => ({
      key, label, used, unit,
      max: max === -1 ? null : max,
      pct: max === -1 || max === 0 ? null : Math.min(100, round1((used / max) * 100)),
    });
    const limitRows = [
      lim('employees', 'Employés actifs', personnel?.activeHeadcount ?? 0, limits.maxEmployees),
      lim('users', 'Comptes utilisateurs actifs', accounts?.active ?? 0, limits.maxUsers),
      lim('departments', 'Départements', counts.departments, limits.maxDepartments),
      lim('jobOffers', 'Offres d’emploi publiées', counts.jobOffers, limits.maxJobOffers),
      lim('storage', 'Stockage documents', Math.round(((documents.bytes ?? 0) / 1048576) * 10) / 10, limits.maxStorageMB, 'Mo'),
    ];

    // ── Dernière activité ────────────────────────────────────────────────────
    const lastDates: number[] = [];
    if (accounts?.lastLoginAt) lastDates.push(new Date(accounts.lastLoginAt).getTime());
    for (const f of features as any[]) if (f.lastUsedAt) lastDates.push(new Date(f.lastUsedAt).getTime());
    const lastActivityAt = lastDates.length ? new Date(Math.max(...lastDates)).toISOString() : null;
    const daysSinceActivity = lastActivityAt ? Math.floor((now - new Date(lastActivityAt).getTime()) / DAY) : null;

    const signals = this.buildSignals({
      company, plan, personnel, accounts, features: features as any[], limitRows, daysSinceActivity, payments, now,
    });

    return {
      generatedAt: new Date().toISOString(),
      plan,
      personnel,
      accounts,
      limits: limitRows,
      features,
      consumption,
      storage,
      payments,
      setup,
      health: { lastActivityAt, daysSinceActivity, signals },
    };
  }

  // ==========================================================================
  // 👥 Personnel réel
  // ==========================================================================
  private async getPersonnel(companyId: string, now: number, since30: Date) {
    const in30 = new Date(now + 30 * DAY);
    const [byStatus, byContract, byDept, depts, hired30, left30, cddSoon, trial, withAccount] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ['contractType'], where: { companyId, status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ['departmentId'], where: { companyId, status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.department.findMany({ where: { companyId }, select: { id: true, name: true } }),
      this.prisma.employee.count({ where: { companyId, hireDate: { gte: since30 } } }),
      this.prisma.employee.count({ where: { companyId, terminationDate: { gte: since30 } } }),
      this.prisma.employee.count({ where: { companyId, status: 'ACTIVE', contractType: 'CDD', contractEndDate: { gte: new Date(now), lte: in30 } } }),
      this.prisma.employee.count({ where: { companyId, status: 'ACTIVE', trialStatus: 'IN_PROGRESS' } }),
      this.prisma.user.count({ where: { companyId, employeeId: { not: null } } }),
    ]);

    const status: Record<string, number> = { ACTIVE: 0, ON_LEAVE: 0, SUSPENDED: 0, TERMINATED: 0, RETIRED: 0 };
    for (const s of byStatus) status[s.status] = s._count._all;
    const totalRecords = Object.values(status).reduce((a, b) => a + b, 0);
    const deptName = new Map<string, string>(depts.map((d: any) => [d.id, d.name] as [string, string]));

    return {
      /** ⭐ Effectif actif : c'est ce que compte la limite du plan */
      activeHeadcount: status.ACTIVE,
      totalRecords,
      byStatus: status,
      byContractType: byContract
        .map((c) => ({ type: c.contractType as string, count: c._count._all }))
        .sort((a, b) => b.count - a.count),
      byDepartment: byDept
        .map((d) => ({ name: deptName.get(d.departmentId) ?? 'Sans département', count: d._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      hiredLast30d: hired30,
      leftLast30d: left30,
      cddEndingIn30d: cddSoon,
      onTrial: trial,
      withAccount,
    };
  }

  // ==========================================================================
  // 🔐 Comptes utilisateurs
  // ==========================================================================
  private async getAccounts(companyId: string, since30: Date) {
    const [total, active, byRole, loggedIn30, never, twoFa, last] = await Promise.all([
      this.prisma.user.count({ where: { companyId } }),
      this.prisma.user.count({ where: { companyId, isActive: true } }),
      this.prisma.user.groupBy({ by: ['role'], where: { companyId }, _count: { _all: true } }),
      this.prisma.user.count({ where: { companyId, lastLoginAt: { gte: since30 } } }),
      this.prisma.user.count({ where: { companyId, lastLoginAt: null } }),
      this.prisma.user.count({ where: { companyId, twoFactorEnabled: true } }),
      this.prisma.user.aggregate({ where: { companyId }, _max: { lastLoginAt: true } }),
    ]);
    return {
      total, active,
      byRole: byRole.map((r) => ({ role: r.role as string, count: r._count._all })).sort((a, b) => b.count - a.count),
      loggedIn30d: loggedIn30,
      neverLoggedIn: never,
      twoFactorEnabled: twoFa,
      lastLoginAt: last._max.lastLoginAt ? last._max.lastLoginAt.toISOString() : null,
    };
  }

  // ==========================================================================
  // ⚙️ Fonctionnalités : classement par usage sur 30 jours
  // ==========================================================================
  private async probeOne(p: FeatureProbe, companyId: string, since30: Date, limits: Record<string, any>) {
    const d = this.delegate(p.model);
    const where = p.where(companyId);
    const [recent, agg] = await Promise.all([
      d.count({ where: { AND: [where, { [p.dateField]: { gte: since30 } }] } }),
      d.aggregate({ where, _count: { _all: true }, _max: { [p.dateField]: true } }),
    ]);
    const total: number = agg._count._all;
    const last: Date | null = agg._max[p.dateField] ?? null;
    const included = p.planFlag ? !!limits[p.planFlag] : true;
    const adoption: 'active' | 'dormant' | 'unused' | 'locked' =
      recent > 0 ? 'active' : total > 0 ? 'dormant' : included ? 'unused' : 'locked';
    return {
      key: p.key, label: p.label, unit: p.unit, table: p.table,
      included, events30d: recent, eventsTotal: total,
      lastUsedAt: last ? last.toISOString() : null, adoption,
    };
  }

  private async getFeatures(companyId: string, since30: Date, limits: Record<string, any>) {
    const rows = await Promise.all(
      FEATURE_PROBES.map((p) => this.safe(`sonde ${p.key}`, () => this.probeOne(p, companyId, since30, limits), null)),
    );
    const ok = rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[];
    const total30 = ok.reduce((s, r) => s + r.events30d, 0);
    return ok
      .map((r) => ({ ...r, sharePct: pct(r.events30d, total30) }))
      .sort((a, b) => b.events30d - a.events30d || b.eventsTotal - a.eventsTotal);
  }

  // ==========================================================================
  // 📊 Consommation (requêtes, minutes actives, part de la plateforme)
  // ==========================================================================
  private async getConsumption(companyId: string, since30: Date) {
    const sinceStr = since30.toISOString().slice(0, 10);
    const [daily, platform, users, methods] = await Promise.all([
      this.prisma.dailyUserActivity.groupBy({
        by: ['date'], where: { companyId, date: { gte: sinceStr } },
        _sum: { requestCount: true, activeMinutes: true }, _count: { _all: true }, orderBy: { date: 'asc' },
      }),
      this.prisma.dailyUserActivity.aggregate({ where: { date: { gte: sinceStr } }, _sum: { requestCount: true } }),
      this.prisma.dailyUserActivity.findMany({ where: { companyId, date: { gte: sinceStr } }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.attendance.groupBy({ by: ['checkInMethod'], where: { companyId, createdAt: { gte: since30 } }, _count: { _all: true } }),
    ]);

    const byDate = new Map<string, any>(daily.map((d: any) => [d.date, d] as [string, any]));
    const series: { date: string; requests: number; activeUsers: number; activeMinutes: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
      const d = byDate.get(date);
      series.push({
        date,
        requests: d?._sum.requestCount ?? 0,
        activeUsers: d?._count._all ?? 0,
        activeMinutes: d?._sum.activeMinutes ?? 0,
      });
    }
    const requests30d = series.reduce((s, x) => s + x.requests, 0);
    const platformRequests = platform._sum.requestCount ?? 0;
    const peak = series.reduce((m, x) => (x.requests > m.requests ? x : m), series[0]);
    const activeDays = series.filter((x) => x.requests > 0).length;

    return {
      requests30d,
      platformSharePct: pct(requests30d, platformRequests),
      activeMinutes30d: series.reduce((s, x) => s + x.activeMinutes, 0),
      distinctActiveUsers30d: users.length,
      activeDays30d: activeDays,
      avgRequestsPerActiveDay: activeDays ? Math.round(requests30d / activeDays) : 0,
      peakDay: peak && peak.requests > 0 ? { date: peak.date, requests: peak.requests } : null,
      daily: series,
      attendanceMethods: methods
        .map((m) => ({ method: (m.checkInMethod as string | null) ?? 'NON_RENSEIGNÉ', count: m._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ==========================================================================
  // 🗄️ Stockage : documents (réel) + volume estimé en base
  // ==========================================================================
  private async getDocuments(companyId: string) {
    const a = await this.prisma.document.aggregate({ where: { companyId }, _count: { _all: true }, _sum: { fileSize: true } });
    return { count: a._count._all, bytes: a._sum.fileSize ?? 0 };
  }

  /**
   * Estimation : lignes de l'entreprise × poids moyen d'une ligne de la table
   * (taille totale de la table + index / lignes de la table). Ce n'est pas une mesure exacte.
   */
  private async getStorage(companyId: string, features: any[], documents: { count: number; bytes: number }) {
    const rowsByTable = new Map<string, { label: string; rows: number }>();
    for (const f of features) rowsByTable.set(f.table, { label: f.label, rows: f.eventsTotal });
    await Promise.all(
      STORAGE_EXTRAS.map(async (e) => {
        const rows = await this.safe(`volume ${e.table}`, () => this.delegate(e.model).count({ where: e.where(companyId) }), 0);
        rowsByTable.set(e.table, { label: e.label, rows });
      }),
    );

    const tables = [...rowsByTable.keys()];
    const stats = await this.prisma.$queryRaw<{ name: string; total_bytes: bigint; live_rows: bigint }[]>`
      SELECT c.relname AS name,
             pg_total_relation_size(c.oid)::bigint AS total_bytes,
             COALESCE(s.n_live_tup, 0)::bigint AS live_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind = 'r' AND n.nspname = current_schema() AND c.relname = ANY(${tables}::text[])`;

    const avg = new Map<string, number>(stats.map((s) => [s.name, Number(s.live_rows) > 0 ? Number(s.total_bytes) / Number(s.live_rows) : 0] as [string, number]));
    const rows = [...rowsByTable.entries()]
      .map(([table, v]) => ({ table, label: v.label, rows: v.rows, estimatedBytes: Math.round(v.rows * (avg.get(table) ?? 0)) }))
      .filter((r) => r.rows > 0)
      .sort((a, b) => b.estimatedBytes - a.estimatedBytes);

    return {
      documentsCount: documents.count,
      documentsBytes: documents.bytes,
      estimatedDbBytes: rows.reduce((s, r) => s + r.estimatedBytes, 0),
      topTables: rows.slice(0, 6),
    };
  }

  // ==========================================================================
  // 💳 Paiements
  // ==========================================================================
  private async getPayments(companyId: string, since30: Date) {
    const [last, paid, failed30] = await Promise.all([
      this.prisma.payment.findMany({
        where: { companyId }, orderBy: { createdAt: 'desc' }, take: 6,
        select: { id: true, status: true, amount: true, currency: true, provider: true, paymentMethod: true, createdAt: true, paidAt: true },
      }),
      this.prisma.payment.aggregate({ where: { companyId, status: 'SUCCEEDED' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.count({ where: { companyId, status: 'FAILED', createdAt: { gte: since30 } } }),
    ]);
    return {
      totalPaid: paid._sum.amount ?? 0,
      successfulCount: paid._count._all,
      failedLast30d: failed30,
      last: last.map((p) => ({
        id: p.id, status: p.status as string, amount: p.amount, currency: p.currency,
        provider: p.provider as string, method: p.paymentMethod,
        at: (p.paidAt ?? p.createdAt).toISOString(),
      })),
    };
  }

  // ==========================================================================
  // 🧰 Compteurs pour les limites
  // ==========================================================================
  private async getLimitCounters(companyId: string) {
    const [departments, jobOffers] = await Promise.all([
      this.prisma.department.count({ where: { companyId } }),
      this.prisma.jobOffer.count({ where: { companyId, status: 'PUBLISHED' } }),
    ]);
    return { departments, jobOffers };
  }

  // ==========================================================================
  // ✅ Configuration de l'entreprise (complétude)
  // ==========================================================================
  private async getSetup(companyId: string, c: any) {
    const year = String(new Date().getFullYear());
    const [departments, employees, payrollSettings, sites, holidays] = await Promise.all([
      this.prisma.department.count({ where: { companyId } }),
      this.prisma.employee.count({ where: { companyId } }),
      this.prisma.payrollSettings.count({ where: { companyId } }),
      this.prisma.companySite.count({ where: { companyId } }),
      this.prisma.publicHoliday.count({ where: { companyId, year: Number(year) } }),
    ]);
    const items = [
      { key: 'cnss', label: 'N° CNSS renseigné', done: !!c.cnssNumber },
      { key: 'tax', label: 'N° fiscal (NIU) renseigné', done: !!c.taxNumber },
      { key: 'logo', label: 'Logo ajouté', done: !!c.logo },
      { key: 'bank', label: 'Coordonnées bancaires', done: !!(c.bankName && c.bankAccount) },
      { key: 'departments', label: 'Au moins un département', done: departments > 0 },
      { key: 'employees', label: 'Au moins un employé', done: employees > 0 },
      { key: 'payroll', label: 'Paramètres de paie enregistrés', done: payrollSettings > 0 },
      { key: 'gps', label: 'Pointage géolocalisé (zone ou site)', done: !!(c.latitude && c.longitude) || sites > 0 },
      { key: 'holidays', label: `Jours fériés ${year}`, done: holidays > 0 },
    ];
    const done = items.filter((i) => i.done).length;
    return { items, done, total: items.length, scorePct: Math.round((done / items.length) * 100) };
  }

  // ==========================================================================
  // 🚦 Signaux de santé (règles lisibles, basées sur les chiffres ci-dessus)
  // ==========================================================================
  private buildSignals(x: {
    company: any; plan: string; personnel: any; accounts: any; features: any[]; limitRows: any[];
    daysSinceActivity: number | null; payments: any; now: number;
  }): CompanySignal[] {
    const s: CompanySignal[] = [];
    const sub = x.company.subscription;

    if (sub?.currentPeriodEnd) {
      const days = Math.ceil((new Date(sub.currentPeriodEnd).getTime() - x.now) / DAY);
      if (days < 0) s.push({ level: 'CRITICAL', title: 'Abonnement expiré', detail: `Période terminée depuis ${Math.abs(days)} jour(s).` });
      else if (days <= 7) s.push({ level: 'WARNING', title: `Abonnement : ${days} jour(s) restant(s)`, detail: 'Renouvellement à prévoir.' });
    }
    if (sub?.status === 'PAST_DUE') s.push({ level: 'WARNING', title: 'Abonnement en impayé', detail: 'Le dernier paiement n’a pas abouti.' });
    if (x.payments?.failedLast30d > 0) {
      s.push({ level: 'WARNING', title: `${x.payments.failedLast30d} paiement(s) échoué(s) en 30 j`, detail: 'Vérifie les détails dans la section Paiements.' });
    }

    if (x.daysSinceActivity === null) {
      s.push({ level: 'WARNING', title: 'Aucune activité enregistrée', detail: 'Aucune connexion ni donnée : compte probablement jamais utilisé.' });
    } else if (x.daysSinceActivity >= 30) {
      s.push({ level: 'CRITICAL', title: `Inactive depuis ${x.daysSinceActivity} jours`, detail: 'Risque de résiliation : contacte l’entreprise.' });
    } else if (x.daysSinceActivity >= 14) {
      s.push({ level: 'WARNING', title: `Peu active (${x.daysSinceActivity} jours sans activité)`, detail: 'À surveiller.' });
    }

    for (const l of x.limitRows) {
      if (l.pct !== null && l.pct >= 90) {
        s.push({ level: l.pct >= 100 ? 'WARNING' : 'INFO', title: `${l.label} : ${l.pct} % de la limite`, detail: `${l.used}/${l.max} ${l.unit ?? ''} — opportunité de passage au plan supérieur.`.replace('  ', ' ') });
      }
    }

    const att = x.features.find((f) => f.key === 'attendance');
    if (x.personnel?.activeHeadcount > 0 && att?.included && att.adoption !== 'active') {
      s.push({ level: 'INFO', title: 'Pointage non utilisé ce mois-ci', detail: 'Aucun pointage sur 30 jours alors que le plan l’inclut.' });
    }
    const pay = x.features.find((f) => f.key === 'payroll');
    if (x.personnel?.activeHeadcount > 0 && pay?.included && pay.adoption !== 'active') {
      s.push({ level: 'INFO', title: 'Aucun bulletin généré en 30 jours', detail: 'La paie est la fonctionnalité clé : à encourager.' });
    }
    if (x.accounts && x.accounts.total > 0 && x.accounts.neverLoggedIn === x.accounts.total) {
      s.push({ level: 'WARNING', title: 'Aucun utilisateur ne s’est jamais connecté', detail: 'Les invitations n’ont pas été acceptées.' });
    }
    const unused = x.features.filter((f) => f.adoption === 'unused').length;
    if (unused >= 5) {
      s.push({ level: 'INFO', title: `${unused} fonctionnalités incluses jamais utilisées`, detail: 'Piste de formation ou d’accompagnement.' });
    }
    if (x.personnel?.cddEndingIn30d > 0) {
      s.push({ level: 'INFO', title: `${x.personnel.cddEndingIn30d} CDD arrivent à échéance sous 30 jours`, detail: 'L’entreprise aura besoin de renouveler ou clôturer ces contrats.' });
    }

    const order: Record<SignalLevel, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return s.sort((a, b) => order[a.level] - order[b.level]);
  }
}