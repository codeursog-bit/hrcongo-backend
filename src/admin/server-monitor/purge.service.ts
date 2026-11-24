// ============================================================================
// 📁 src/admin/server-monitor/purge.service.ts
// Purge SÉCURISÉE depuis le super admin.
// Garde-fous :
//  1. liste blanche (purge-registry.ts) : impossible de toucher une autre table
//  2. ancienneté minimale imposée par le SERVEUR pour chaque règle
//  3. aperçu obligatoire avant d'exécuter (le front envoie le nombre aperçu ; si
//     le volume a explosé entre-temps, on refuse)
//  4. règles CAUTION : il faut taper « SUPPRIMER »
//  5. suppression par lots de 5 000 lignes (pas de verrou long) avec plafond
//  6. chaque purge est tracée (journal système + journal d'audit)
// ============================================================================
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../../system-logs/system-logs.service';
import { CAUTION_CONFIRM_TEXT, PURGE_TARGETS, PurgeTarget } from './purge-registry';
import { PurgeItemDto } from './dto/purge.dto';

const BATCH = 5000;
const MAX_ROWS_PER_TARGET = 500_000; // au-delà : « relance la purge »
const MAX_MS_PER_TARGET = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PurgeActor {
  userId: string;
  email?: string;
}

@Injectable()
export class AdminPurgeService {
  private readonly logger = new Logger('🧹 AdminPurge');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemLogs: SystemLogsService,
  ) {}

  private delegate(t: PurgeTarget): any {
    const d = (this.prisma as any)[t.model];
    if (!d || typeof d.count !== 'function' || typeof d.findMany !== 'function') {
      throw new BadRequestException(`Règle « ${t.key} » mal configurée (modèle ${t.model} introuvable).`);
    }
    return d;
  }

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * 86_400_000);
  }

  private find(key: string): PurgeTarget {
    const t = PURGE_TARGETS.find((x) => x.key === key);
    if (!t) throw new BadRequestException(`Règle de purge inconnue : ${key}`);
    return t;
  }

  /** Valide une liste (clé unique, ancienneté ≥ minimum de la règle) */
  private validate(items: PurgeItemDto[]): { target: PurgeTarget; item: PurgeItemDto }[] {
    const seen = new Set<string>();
    return items.map((item) => {
      if (seen.has(item.key)) throw new BadRequestException(`Règle en double : ${item.key}`);
      seen.add(item.key);
      const target = this.find(item.key);
      if (item.days < target.minDays) {
        throw new BadRequestException(
          `« ${target.label} » : ancienneté minimale ${target.minDays} jour(s) (demandé : ${item.days}).`,
        );
      }
      return { target, item };
    });
  }

  // ==========================================================================
  // 📋 Liste des règles avec volumes actuels
  // ==========================================================================
  async listTargets() {
    const out: any[] = [];
    // Estimation rapide du total par table (évite un count(*) sur de grosses tables)
    const est = await this.prisma
      .$queryRaw<{ name: string; rows: bigint }[]>`SELECT relname AS name, n_live_tup::bigint AS rows FROM pg_stat_user_tables`
      .catch(() => [] as { name: string; rows: bigint }[]);
    const estMap = new Map(est.map((e) => [e.name, Number(e.rows)]));

    for (const t of PURGE_TARGETS) {
      let eligible: number | null = null;
      try {
        eligible = await this.delegate(t).count({ where: t.where(this.cutoff(t.defaultDays)) });
      } catch (e: any) {
        this.logger.warn(`Comptage ${t.key} : ${e?.message ?? e}`);
      }
      out.push({
        key: t.key, label: t.label, description: t.description, keeps: t.keeps ?? null,
        table: t.table, risk: t.risk, defaultDays: t.defaultDays, minDays: t.minDays,
        totalRowsEstimate: estMap.get(t.table) ?? null,
        eligibleAtDefault: eligible,
      });
    }
    return { confirmText: CAUTION_CONFIRM_TEXT, targets: out };
  }

  // ==========================================================================
  // 👀 Aperçu (ne supprime rien)
  // ==========================================================================
  async preview(items: PurgeItemDto[]) {
    const checked = this.validate(items);
    const results: any[] = [];
    for (const { target, item } of checked) {
      const count = await this.delegate(target).count({ where: target.where(this.cutoff(item.days)) });
      results.push({ key: target.key, label: target.label, risk: target.risk, days: item.days, count });
    }
    return {
      total: results.reduce((s, r) => s + r.count, 0),
      needsConfirmText: results.some((r) => r.risk === 'CAUTION' && r.count > 0),
      results,
    };
  }

  // ==========================================================================
  // 🗑️ Exécution
  // ==========================================================================
  async execute(items: PurgeItemDto[], confirm: boolean, confirmText: string | undefined, actor: PurgeActor) {
    if (confirm !== true) throw new BadRequestException('Confirmation explicite requise.');
    const checked = this.validate(items);

    const hasCaution = checked.some(({ target }) => target.risk === 'CAUTION');
    if (hasCaution && (confirmText ?? '').trim() !== CAUTION_CONFIRM_TEXT) {
      throw new BadRequestException(`Cette purge inclut des données sensibles : tape « ${CAUTION_CONFIRM_TEXT} » pour confirmer.`);
    }
    if (this.running) throw new BadRequestException('Une purge est déjà en cours, patiente quelques instants.');

    // Vérification de volume AVANT de supprimer quoi que ce soit
    for (const { target, item } of checked) {
      if (item.expectedCount === undefined) continue;
      const now = await this.delegate(target).count({ where: target.where(this.cutoff(item.days)) });
      if (now > item.expectedCount * 1.2 + 100) {
        throw new BadRequestException(
          `« ${target.label} » : ${now} lignes concernées alors que l'aperçu en annonçait ${item.expectedCount}. Refais l'aperçu.`,
        );
      }
    }

    this.running = true;
    const started = Date.now();
    const results: { key: string; label: string; days: number; deleted: number; partial: boolean }[] = [];
    try {
      for (const { target, item } of checked) {
        const { deleted, partial } = await this.deleteBatched(target, target.where(this.cutoff(item.days)));
        results.push({ key: target.key, label: target.label, days: item.days, deleted, partial });
      }
    } finally {
      this.running = false;
    }

    const total = results.reduce((s, r) => s + r.deleted, 0);

    // Traçabilité : journal système + journal d'audit (qui a purgé quoi)
    await this.systemLogs.log({
      source: 'maintenance:purge', level: 'WARNING',
      message: `Purge manuelle : ${total} ligne(s) supprimée(s) par ${actor.email ?? actor.userId}`,
      details: { by: actor.userId, results },
      durationMs: Date.now() - started,
    });
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: actor.userId, action: 'PURGE_LOGS', entity: 'MAINTENANCE',
          description: `Purge manuelle de ${total} ligne(s) : ${results.map((r) => `${r.key}(${r.deleted})`).join(', ')}`,
          metadata: { results } as any,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Audit purge : ${e?.message ?? e}`);
    }

    return {
      total,
      results,
      partial: results.some((r) => r.partial),
      note:
        'L’espace libéré est réutilisé par PostgreSQL, mais la taille du disque ne diminue pas tout de suite. ' +
        'Pour la réduire réellement, il faut un VACUUM FULL en heures creuses (il verrouille la table pendant l’opération).',
    };
  }

  private async deleteBatched(t: PurgeTarget, where: Record<string, any>) {
    const d = this.delegate(t);
    const deadline = Date.now() + MAX_MS_PER_TARGET;
    let deleted = 0;
    let partial = false;
    while (true) {
      if (deleted >= MAX_ROWS_PER_TARGET || Date.now() > deadline) { partial = true; break; }
      const rows: { id: string }[] = await d.findMany({ where, select: { id: true }, take: BATCH });
      if (rows.length === 0) break;
      const r = await d.deleteMany({ where: { id: { in: rows.map((x) => x.id) } } });
      deleted += r.count;
      if (rows.length < BATCH) break;
      await sleep(50);
    }
    return { deleted, partial };
  }
}