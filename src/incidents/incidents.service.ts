import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  incidentFingerprint,
  ignoreIncident,
  safeIncidentPath,
  safeIncidentText,
  safeIncidentStack,
  safeIncidentVersion,
} from './incident-privacy';
import { IncidentAlertsService } from './incident-alerts.service';
import { registerIncidentSink } from './incident-sink';

export type IncidentEvent = {
  source: 'FRONT' | 'BACK' | 'CRON' | 'THIRD_PARTY';
  code: string;
  message: string;
  stack?: string;
  path: string;
  method?: string;
  statusCode?: number;
  severity?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  userId?: string;
  companyId?: string;
  version?: string;
  context?: {
    browser?: string;
    screen?: string;
    online?: boolean;
    durationMs?: number;
    breadcrumbs?: {
      type: string;
      path: string;
      method?: string;
      status?: number;
    }[];
  };
};
type Pending = {
  event: IncidentEvent;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  companies: Set<string>;
  users: Set<string>;
};
@Injectable()
export class IncidentsService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(IncidentsService.name);
  private pending = new Map<string, Pending>();
  private flushing = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: IncidentAlertsService,
  ) {}
  get enabled() {
    return process.env.INCIDENTS_ENABLED === 'true';
  }
  onModuleInit() {
    registerIncidentSink((event) => this.capture(event));
  }

  capture(input: IncidentEvent) {
    if (!this.enabled || ignoreIncident(input.message, input.stack)) return;
    const event: IncidentEvent = {
      ...input,
      code: safeIncidentText(input.code, 100),
      message: safeIncidentText(input.message),
      stack: input.stack ? safeIncidentStack(input.stack) : undefined,
      path: safeIncidentPath(input.path),
      version: safeIncidentVersion(input.version ?? process.env.APP_VERSION),
      context: input.context
        ? {
            browser: safeIncidentText(input.context.browser, 300),
            screen: safeIncidentText(input.context.screen, 80),
            online: input.context.online,
            durationMs: input.context.durationMs,
            breadcrumbs: input.context.breadcrumbs
              ?.slice(-10)
              .map((b) => ({
                type: b.type,
                method: b.method,
                status: b.status,
                path: safeIncidentPath(b.path),
              })),
          }
        : undefined,
    };
    const key = incidentFingerprint(event),
      now = new Date();
    let entry = this.pending.get(key);
    if (!entry) {
      if (this.pending.size >= 500) return;
      entry = {
        event,
        count: 0,
        firstSeen: now,
        lastSeen: now,
        companies: new Set(),
        users: new Set(),
      };
      this.pending.set(key, entry);
    }
    entry.count++;
    entry.lastSeen = now;
    // Bounded per flush; persisted unique actors are accurate within this explicit cap.
    if (input.companyId && entry.companies.size < 1000)
      entry.companies.add(input.companyId);
    if (input.userId && entry.users.size < 1000) entry.users.add(input.userId);
    if (
      input.severity === 'CRITICAL' ||
      (entry.count === 1 && this.pending.size === 1)
    )
      void this.flush();
  }

  @Interval(10000)
  async flush() {
    if (this.flushing || !this.enabled || !this.pending.size) return;
    this.flushing = true;
    const batch = this.pending;
    this.pending = new Map();
    try {
      for (const [fingerprint, entry] of batch) {
        try {
          const result = await this.prisma.$transaction(async (tx) => {
            const initial = await tx.errorGroup.upsert({
              where: { fingerprint },
              create: {
                fingerprint,
                source: entry.event.source,
                severity: entry.event.severity ?? 'ERROR',
                firstSeen: entry.firstSeen,
                lastSeen: entry.lastSeen,
              },
              update: { lastSeen: entry.lastSeen },
            });
            // Upsert obtains the row lock; regression and count increments are serialized across workers.
            const regressed = initial.status === 'RESOLVED';
            const group = await tx.errorGroup.update({
              where: { id: initial.id },
              data: {
                count: { increment: entry.count },
                lastSeen: entry.lastSeen,
                version: entry.event.version,
                ...(regressed ? { status: 'REGRESSED' } : {}),
                ...(entry.event.severity === 'CRITICAL'
                  ? { severity: 'CRITICAL' }
                  : {}),
              },
            });
            const actors = [
              ...Array.from(entry.companies, (actorId) => ({
                groupId: group.id,
                kind: 'COMPANY',
                actorId,
              })),
              ...Array.from(entry.users, (actorId) => ({
                groupId: group.id,
                kind: 'USER',
                actorId,
              })),
            ];
            if (actors.length)
              await tx.errorGroupActor.createMany({
                data: actors,
                skipDuplicates: true,
              });
            const counts = await tx.errorGroupActor.groupBy({
              by: ['kind'],
              where: { groupId: group.id },
              _count: { _all: true },
            });
            await tx.errorGroup.update({
              where: { id: group.id },
              data: {
                companyCount:
                  counts.find((c) => c.kind === 'COMPANY')?._count._all ?? 0,
                userCount:
                  counts.find((c) => c.kind === 'USER')?._count._all ?? 0,
              },
            });
            await tx.appError.create({
              data: {
                groupId: group.id,
                errorCode: entry.event.code,
                statusCode: entry.event.statusCode ?? 500,
                message: entry.event.message,
                stack: entry.event.stack,
                path: entry.event.path,
                method: entry.event.method ?? 'EVENT',
                severity: group.severity,
                companyId: entry.event.companyId,
                userId: entry.event.userId,
                occurrences: entry.count,
                context: entry.event.context as any,
              },
            });
            if (entry.event.source === 'CRON')
              await tx.systemLog.create({
                data: {
                  source: entry.event.path.slice(0, 100),
                  level: group.severity === 'CRITICAL' ? 'ALERT' : 'ERROR',
                  message: entry.event.message,
                  companyId: entry.event.companyId,
                  durationMs: entry.event.context?.durationMs,
                  details: { incidentId: group.id, occurrences: entry.count },
                },
              });
            return { group, regressed, isNew: initial.count === 0 };
          });
          if (result.group.status !== 'IGNORED')
            void this.alerts
              .notify(result.group, entry.event, {
                isNew: result.isNew,
                regressed: result.regressed,
                batchCount: entry.count,
              })
              .catch(() => this.logger.warn('Canaux incident indisponibles.'));
        } catch {
          // Best effort, bounded recovery. Never report an incident from its own storage failure.
          const queued = this.pending.get(fingerprint);
          if (queued) {
            queued.count += entry.count;
            for (const id of entry.companies)
              if (queued.companies.size < 1000) queued.companies.add(id);
            for (const id of entry.users)
              if (queued.users.size < 1000) queued.users.add(id);
          } else if (this.pending.size < 500)
            this.pending.set(fingerprint, entry);
          this.logger.warn(
            'Persistance des incidents indisponible ; lot conservé en mémoire.',
          );
        }
      }
    } finally {
      this.flushing = false;
    }
  }
  async onModuleDestroy() {
    registerIncidentSink(undefined);
    await this.flush();
  }
}
