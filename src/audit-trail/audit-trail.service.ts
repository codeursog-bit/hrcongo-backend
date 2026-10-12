// ============================================================================
// 📁 src/audit-trail/audit-trail.service.ts
// Journal d'audit en ajout seul, chaîné par hash (chaque événement contient le
// hash du précédent → toute modification ou suppression rompt la chaîne).
//
// UTILISATION (dans une transaction métier — recommandé) :
//   await this.prisma.$transaction(async (tx) => {
//     const updated = await tx.employeeContract.update(...);
//     await this.audit.record(tx, { companyId, actor, action: 'CONTRACT_RENEWED', ... });
//   });
// → l'action métier ET sa trace sont validées ensemble, ou annulées ensemble.
// Un log "fire-and-forget" peut se perdre en silence ; celui-ci non.
// ============================================================================
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditSeverityLevel,
  buildChanges,
  canonicalJson,
} from './audit-trail.policy';

type Db = PrismaService | Prisma.TransactionClient;

export interface AuditActor {
  id: string;
  role?: string | null;
  label?: string | null; // "Prénom NOM"
}

export interface AuditRecordInput {
  companyId: string;
  /** null / absent = action système (cron, moteur d'audit) */
  actor?: AuditActor | null;
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  severity?: AuditSeverityLevel;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  context?: { ip?: string; requestId?: string; route?: string };
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  truncated?: boolean;
  headHash?: string | null;
  brokenAtSeq?: string;
  reason?: 'SEQ_GAP' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH';
}

@Injectable()
export class AuditTrailService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Écriture ──────────────────────────────────────────────────────────────
  async record(db: Db, input: AuditRecordInput) {
    if (this.isRootClient(db)) {
      return db.$transaction((tx) => this.write(tx, input));
    }
    return this.write(db, input);
  }

  private isRootClient(db: Db): db is PrismaService {
    return typeof (db as any).$transaction === 'function';
  }

  private async write(tx: Prisma.TransactionClient, input: AuditRecordInput) {
    const { companyId } = input;

    // Sérialise les écritures d'UNE entreprise (même schéma que contract-expiry :
    // verrou consultatif lié à la transaction, libéré au commit).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit-trail:' + companyId}))`;

    const last = await tx.auditEvent.findFirst({
      where: { companyId },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    const seq = (last ? last.seq : BigInt(0)) + BigInt(1);
    const prevHash = last ? last.hash : null;

    const built = buildChanges(input.entity, input.before, input.after);
    const hasChanges =
      Object.keys(built.values).length > 0 || built.maskedFields.length > 0;
    const changes = hasChanges ? built : null;

    const occurredAt = new Date();
    const row = {
      companyId,
      seq,
      occurredAt,
      actorType: input.actor ? ('USER' as const) : ('SYSTEM' as const),
      actorId: input.actor?.id ?? null,
      actorRole: input.actor?.role ?? null,
      actorLabel: input.actor?.label?.slice(0, 200) ?? null,
      action: input.action.slice(0, 80),
      entity: input.entity.slice(0, 50),
      entityId: input.entityId ?? null,
      severity: (input.severity ?? 'INFO') as AuditSeverityLevel,
      summary: input.summary.slice(0, 500),
      changes,
      context: input.context ?? null,
      prevHash,
    };

    return tx.auditEvent.create({
      data: {
        ...row,
        changes: (changes as unknown as Prisma.InputJsonValue) ?? undefined,
        context: (row.context as unknown as Prisma.InputJsonValue) ?? undefined,
        hash: this.computeHash(row),
      },
    });
  }

  /** Hash reproductible : sert à l'écriture ET à la vérification. */
  computeHash(row: {
    companyId: string;
    seq: bigint;
    occurredAt: Date;
    actorType: string;
    actorId: string | null;
    actorRole: string | null;
    actorLabel: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    severity: string;
    summary: string;
    changes: unknown;
    context: unknown;
    prevHash: string | null;
  }): string {
    return createHash('sha256')
      .update(
        canonicalJson({
          companyId: row.companyId,
          seq: row.seq.toString(),
          occurredAt: row.occurredAt.toISOString(),
          actorType: row.actorType,
          actorId: row.actorId,
          actorRole: row.actorRole,
          actorLabel: row.actorLabel,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          severity: row.severity,
          summary: row.summary,
          changes: row.changes ?? null,
          context: row.context ?? null,
          prevHash: row.prevHash,
        }),
      )
      .digest('hex');
  }

  // ── Vérification d'intégrité ──────────────────────────────────────────────
  // Détecte : événement modifié, événement supprimé au milieu, chaînage rompu.
  // Limite : une suppression des TOUS DERNIERS événements ne se voit pas par la
  // chaîne seule (le trigger SQL l'empêche déjà ; ancrage externe = phase suivante).
  async verifyChain(
    companyId: string,
    maxEvents = 50_000,
  ): Promise<ChainVerification> {
    let expectedSeq = BigInt(1);
    let prev: string | null = null;
    let lastSeq = BigInt(0);
    let checked = 0;

    for (;;) {
      const rows = await this.prisma.auditEvent.findMany({
        where: { companyId, seq: { gt: lastSeq } },
        orderBy: { seq: 'asc' },
        take: 1000,
      });
      if (rows.length === 0) break;

      for (const r of rows) {
        const fail = (reason: ChainVerification['reason']): ChainVerification => ({
          ok: false,
          checked,
          brokenAtSeq: r.seq.toString(),
          reason,
        });
        if (r.seq !== expectedSeq) return fail('SEQ_GAP');
        if ((r.prevHash ?? null) !== prev) return fail('PREV_HASH_MISMATCH');
        if (this.computeHash(r) !== r.hash) return fail('HASH_MISMATCH');

        prev = r.hash;
        expectedSeq += BigInt(1);
        checked++;
        if (checked >= maxEvents) {
          return { ok: true, checked, truncated: true, headHash: prev };
        }
      }
      lastSeq = rows[rows.length - 1].seq;
    }
    return { ok: true, checked, headHash: prev };
  }
}