// ============================================================================
// 📁 src/notifications/push-broadcast.service.ts
// 📣 Envoi GROUPÉ d'un rappel de pointage, déclenché à la main par le super admin
// ----------------------------------------------------------------------------
// Pensé pour ne JAMAIS faire tomber le serveur :
//  • UN SEUL envoi à la fois sur toute la plateforme (verrou en base, valable aussi
//    avec plusieurs instances) → un double clic ou deux admins ne lancent pas deux envois.
//  • Le bouton répond tout de suite ; l'envoi continue en arrière-plan, par lots de 10
//    utilisateurs en parallèle (même rythme que les crons de pointage) avec une courte
//    pause entre les lots → pas de saturation du pool de connexions Prisma.
//  • Les destinataires sont lus par pages de 200 identifiants (jamais toute la table en mémoire).
//  • Progression enregistrée en base (push_broadcasts) : consultable depuis n'importe
//    quelle instance, et historique conservé.
//  • Aucune dépendance au cron ni à sa fenêtre horaire : les notifications partent à
//    l'instant du clic (urgency « high » = livraison immédiate même téléphone en veille).
// ============================================================================
import { ConflictException, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../cron-lock/cron-lock.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { PushNotificationsService } from './push-notifications.service';
import { congoDateString } from '../common/utils/congo-time';

const LOCK_NAME = 'push-broadcast';
const LOCK_TTL_SECONDS = 15 * 60; // si le process plante, le verrou expire seul
const PAGE_SIZE = 200;
const BATCH_SIZE = 10;
const PAUSE_BETWEEN_BATCHES_MS = 100;
const STALE_AFTER_MS = 20 * 60 * 1000;

const DEFAULT_TITLE = '⏰ Rappel de pointage';
const DEFAULT_BODY = "N'oubliez pas de pointer votre présence.";

export interface StartBroadcastInput {
  /** Une entreprise précise, ou absent = toutes les entreprises. */
  companyId?: string;
  /** true = seulement les employés actifs qui n'ont pas encore pointé aujourd'hui (et pas en congé approuvé). */
  onlyNotPunched?: boolean;
  title?: string;
  body?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class PushBroadcastService {
  private readonly logger = new Logger(PushBroadcastService.name);

  constructor(
    private prisma: PrismaService,
    private push: PushNotificationsService,
    private cronLock: CronLockService,
    private systemLogs: SystemLogsService,
  ) {}

  // ─── Qui reçoit ? ──────────────────────────────────────────────────────────
  private recipientsWhere(input: StartBroadcastInput): Prisma.UserWhereInput {
    const today = congoDateString();
    const where: Prisma.UserWhereInput = {
      isActive: true,
      pushNotifEnabled: true,
      pushSubscriptions: { some: { status: 'ACTIVE' } },
    };
    if (input.companyId) where.companyId = input.companyId;
    if (input.onlyNotPunched) {
      where.employee = {
        is: {
          status: 'ACTIVE',
          attendances: { none: { date: today } },
          leaves: {
            none: {
              status: 'APPROVED',
              startDate: { lte: new Date(today) },
              endDate: { gte: new Date(today) },
            },
          },
        },
      };
    }
    return where;
  }

  // ─── Lancer ────────────────────────────────────────────────────────────────
  async start(input: StartBroadcastInput, startedBy: string) {
    const title = (input.title?.trim() || DEFAULT_TITLE).slice(0, 120);
    const body = (input.body?.trim() || DEFAULT_BODY).slice(0, 300);
    if (input.companyId && !/^[0-9a-f-]{36}$/i.test(input.companyId)) {
      throw new BadRequestException('Entreprise invalide.');
    }

    // Les envois « RUNNING » restés bloqués (serveur redémarré en plein envoi) sont fermés.
    await this.prisma.pushBroadcast.updateMany({
      where: { status: 'RUNNING', createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
      data: { status: 'FAILED', error: 'Interrompu (serveur redémarré ?)', finishedAt: new Date() },
    });

    const locked = await this.cronLock.acquire(LOCK_NAME, LOCK_TTL_SECONDS);
    if (!locked) throw new ConflictException('Un envoi est déjà en cours. Attendez sa fin.');

    try {
      const where = this.recipientsWhere(input);
      const total = await this.prisma.user.count({ where });

      const job = await this.prisma.pushBroadcast.create({
        data: {
          createdBy: startedBy,
          companyId: input.companyId ?? null,
          onlyNotPunched: !!input.onlyNotPunched,
          title,
          body,
          total,
          status: total === 0 ? 'DONE' : 'RUNNING',
          finishedAt: total === 0 ? new Date() : null,
        },
      });

      if (total === 0) {
        await this.cronLock.release(LOCK_NAME);
        return job;
      }

      // L'envoi continue APRÈS la réponse HTTP. Le verrou est libéré à la fin de run().
      void this.run(job.id, where, { title, body }).catch((e) =>
        this.logger.error(`Envoi groupé ${job.id} : ${e?.message}`),
      );
      return job;
    } catch (e) {
      await this.cronLock.release(LOCK_NAME);
      throw e;
    }
  }

  // ─── Exécution en arrière-plan ─────────────────────────────────────────────
  private async run(jobId: string, where: Prisma.UserWhereInput, msg: { title: string; body: string }) {
    const startedAt = Date.now();
    let processed = 0, sent = 0, failed = 0, noDevice = 0;
    let cursor: string | undefined;

    const flush = (extra: Prisma.PushBroadcastUpdateInput = {}) =>
      this.prisma.pushBroadcast
        .update({ where: { id: jobId }, data: { processed, sent, failed, noDevice, ...extra } })
        .catch(() => {});

    try {
      for (;;) {
        const page = await this.prisma.user.findMany({
          where,
          select: { id: true },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1].id;

        for (let i = 0; i < page.length; i += BATCH_SIZE) {
          const batch = page.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map((u) =>
              this.push
                .sendPushToUserDetailed(u.id, {
                  title: msg.title,
                  body: msg.body,
                  url: '/presences/pointage',
                  tag: 'pointage-reminder-manual',
                  requireInteraction: false,
                  urgency: 'high',
                  ttlSeconds: 60 * 30, // un rappel de pointage n'a plus de sens après 30 min
                })
                .catch(() => null),
            ),
          );
          for (const r of results) {
            processed++;
            if (!r) failed++;
            else if (r.status === 'SENT' || r.status === 'PARTIAL') sent++;
            else if (r.status === 'NO_DEVICE' || r.status === 'DISABLED') noDevice++;
            else failed++;
          }
          await sleep(PAUSE_BETWEEN_BATCHES_MS);
        }
        await flush();
        if (page.length < PAGE_SIZE) break;
      }

      await flush({ status: 'DONE', finishedAt: new Date() });
      await this.systemLogs.log({
        source: 'push-broadcast:pointage',
        level: 'INFO',
        message: `Rappel de pointage manuel : ${sent} envoyé(s), ${failed} échec(s), ${noDevice} sans appareil sur ${processed} utilisateur(s)`,
        durationMs: Date.now() - startedAt,
      });
    } catch (e: any) {
      await flush({ status: 'FAILED', error: String(e?.message ?? e).slice(0, 300), finishedAt: new Date() });
      await this.systemLogs.log({
        source: 'push-broadcast:pointage',
        level: 'ERROR',
        message: `Rappel de pointage manuel interrompu : ${e?.message ?? e}`,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      await this.cronLock.release(LOCK_NAME);
    }
  }

  // ─── Consultation ──────────────────────────────────────────────────────────
  async get(id: string) {
    return this.prisma.pushBroadcast.findUnique({ where: { id } });
  }

  async list(limit = 15) {
    return this.prisma.pushBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
  }

  /** Nombre de personnes qui recevraient l'envoi avec ces réglages (aperçu avant de cliquer). */
  async preview(input: StartBroadcastInput) {
    const total = await this.prisma.user.count({ where: this.recipientsWhere(input) });
    return { total };
  }
}