// ============================================================================
// 📁 src/legal-parameters/legal-parameters.service.ts
// Référentiel légal versionné (barèmes ITS, CNSS, TUS, parts) piloté par le
// super administrateur.
//   • Les versions ne sont JAMAIS modifiées ni supprimées : on en ajoute une
//     avec une date d'application → l'historique est l'ensemble des lignes.
//   • getAt()/getAtPeriod() sont SYNCHRONES (cache mémoire) pour s'insérer
//     dans les calculateurs de paie existants sans les rendre asynchrones.
//   • Aucune version publiée (ou table absente) → valeurs actuelles par défaut.
// ============================================================================
import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  bindLegalResolver,
  DEFAULT_LEGAL_PARAMS,
  LegalParams,
  StoredVersion,
  cloneParams,
  dateKeyLocal,
  mergeWithDefaults,
  periodKey,
  pickVersion,
  validateLegalParams,
} from './legal-parameters.core';

const REFRESH_MS = 60_000;

@Injectable()
export class LegalParametersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LegalParametersService.name);
  private versions: StoredVersion[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
    // Rend les règles lisibles par le code non injecté (audit, exports, DAS…).
    bindLegalResolver((key) => this.getAtKey(key));
    // Relecture périodique : une modification faite depuis un autre processus
    // est prise en compte en moins d'une minute.
    this.timer = setInterval(() => void this.reload(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    bindLegalResolver(null);
    if (this.timer) clearInterval(this.timer);
  }

  private async reload() {
    try {
      const rows = await this.prisma.legalParameterVersion.findMany({
        orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      });
      this.versions = rows.map((r) => ({
        id: r.id,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        createdAt: r.createdAt.toISOString(),
        params: r.params,
      }));
    } catch (e) {
      // Table pas encore migrée ou base indisponible : on garde le cache
      // précédent (ou les valeurs par défaut) — la paie ne doit jamais tomber.
      this.logger.warn(`Référentiel légal non relu (valeurs en cache/défaut conservées) : ${(e as Error).message}`);
    }
  }

  // ── Lecture synchrone (utilisée par les calculateurs) ─────────────────────

  getAtKey(key: string): LegalParams {
    const v = pickVersion(this.versions, key);
    return v ? mergeWithDefaults(v.params) : cloneParams(DEFAULT_LEGAL_PARAMS);
  }

  /** Paramètres applicables à une date (composantes locales du jour). */
  getAt(date: Date = new Date()): LegalParams {
    return this.getAtKey(dateKeyLocal(date));
  }

  /** Paramètres applicables à une période de paie (1er jour du mois). */
  getAtPeriod(year: number, month: number): LegalParams {
    return this.getAtKey(periodKey(year, month));
  }

  // ── Administration (super admin) ──────────────────────────────────────────

  async getOverview() {
    const today = dateKeyLocal(new Date());
    const current = pickVersion(this.versions, today);
    return {
      defaults: DEFAULT_LEGAL_PARAMS,
      effectiveToday: this.getAtKey(today),
      currentVersionId: current?.id ?? null,
      versions: await this.listVersions(),
    };
  }

  async listVersions() {
    const rows = await this.prisma.legalParameterVersion.findMany({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      note: r.note,
      createdAt: r.createdAt,
      createdByName: r.createdByName,
      params: mergeWithDefaults(r.params),
    }));
  }

  /**
   * Publie une nouvelle version. `params` peut être partiel : il est fusionné
   * avec la version aujourd'hui applicable à cette date, puis validé en entier.
   */
  async createVersion(
    dto: { effectiveFrom: string; params: unknown; note?: string },
    actor: { id?: string | null; name?: string | null },
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto?.effectiveFrom ?? ''))
      throw new BadRequestException("Date d'application invalide (format AAAA-MM-JJ).");
    const asDate = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
    if (Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== dto.effectiveFrom)
      throw new BadRequestException("Date d'application invalide.");

    const base = this.getAtKey(dto.effectiveFrom);
    const merged = mergeWithDefaults(dto.params, base);
    const errors = validateLegalParams(merged);
    if (errors.length) throw new BadRequestException({ message: 'Paramètres invalides', errors });

    const row = await this.prisma.legalParameterVersion.create({
      data: {
        effectiveFrom: asDate,
        params: merged as any,
        note: dto.note?.trim() || null,
        createdById: actor.id ?? null,
        createdByName: actor.name ?? null,
      },
    });
    await this.reload();
    this.logger.log(`📜 Nouvelle version du référentiel légal (effet ${dto.effectiveFrom}) par ${actor.name ?? actor.id ?? '?'}`);
    return { id: row.id, effectiveFrom: dto.effectiveFrom };
  }
}