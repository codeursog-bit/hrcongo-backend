// 📁 EMPLACEMENT (projet backend) : src/device-sync/device-sync.service.ts
// ============================================================================
// ✅ Cœur de la synchronisation des pointeuses externes.
//    Flux : [bouton Synchroniser] → job PENDING → l'agent (chez le client)
//           le prend au prochain poll → lit la pointeuse → envoie des lots →
//           dernier lot (done) → Konza traite en tâche de fond → job SUCCESS.
//    Konza ne se connecte JAMAIS à la pointeuse : c'est l'agent qui appelle
//    Konza (HTTPS sortant uniquement → rien à ouvrir sur le réseau du client).
// ============================================================================

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { atCongoTime, congoDateString } from '../common/utils/congo-time';
import { DeviceSyncProcessor, ConnectorCtx } from './device-sync-processor.service';
import { hashAgentKey } from './guards/sync-agent-key.guard';
import { resolveDay } from './punch-resolver';
import {
  AgentBatchDto,
  CreateConnectorDto,
  ResolveConflictDto,
  ResolveIncompleteDto,
  SaveMappingsDto,
  StartSyncDto,
  UpdateConnectorDto,
} from './dto/device-sync.dto';

const ONLINE_WINDOW_MS = 150_000; // agent "en ligne" s'il a appelé dans les 2 min 30
const STALE_RUNNING_MS = 10 * 60_000; // job RUNNING sans progrès depuis 10 min → échec
const STALE_PENDING_MS = 30 * 60_000; // job jamais pris par l'agent depuis 30 min → échec
const FIRST_SYNC_DAYS = 35; // 1re synchro sans période : on remonte à 35 jours
const CURSOR_SAFETY_DAYS = 2; // on relit 2 jours avant le dernier pointage (rattrapage)
const ADMIN_ROLES = ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
const CONGO_OFFSET = '+01:00'; // Brazzaville : UTC+1 toute l'année

const toJob = (j: any) => ({
  id: j.id,
  connectorId: j.connectorId,
  status: j.status,
  trigger: j.trigger,
  rangeFrom: j.rangeFrom,
  rangeTo: j.rangeTo,
  requestedAt: j.requestedAt,
  startedAt: j.startedAt,
  finishedAt: j.finishedAt,
  stats: j.stats ?? null,
  error: j.error ?? null,
});

const normId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^0+(?=.)/, '');

@Injectable()
export class DeviceSyncService {
  private readonly logger = new Logger(DeviceSyncService.name);
  // File d'attente par connecteur : un seul traitement à la fois par pointeuse.
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: DeviceSyncProcessor,
  ) {}

  private enqueue<T>(connectorId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(connectorId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    this.chains.set(connectorId, next);
    next.finally(() => {
      if (this.chains.get(connectorId) === next) this.chains.delete(connectorId);
    }).catch(() => undefined);
    return next;
  }

  private async getOwned(companyId: string, connectorId: string) {
    const c = await this.prisma.syncConnector.findFirst({ where: { id: connectorId, companyId } });
    if (!c) throw new NotFoundException('Connecteur introuvable.');
    return c;
  }

  private ctx(c: { id: string; companyId: string; actingUserId: string; name: string }): ConnectorCtx {
    return { id: c.id, companyId: c.companyId, actingUserId: c.actingUserId, name: c.name };
  }

  // ==========================================================================
  // 🔐 ADMIN — connecteurs
  // ==========================================================================
  async createConnector(companyId: string, userId: string, dto: CreateConnectorDto) {
    const agentKey = `kzs_${randomBytes(24).toString('hex')}`;
    const c = await this.prisma.syncConnector.create({
      data: {
        companyId,
        name: dto.name.trim(),
        kind: dto.kind as any,
        config: (dto.config ?? undefined) as Prisma.InputJsonValue | undefined,
        agentKeyHash: hashAgentKey(agentKey),
        agentKeyHint: agentKey.slice(-4),
        actingUserId: userId,
      },
    });
    // ⚠️ Clé en clair renvoyée UNE SEULE fois.
    return { id: c.id, name: c.name, kind: c.kind, agentKey };
  }

  async rotateKey(companyId: string, connectorId: string) {
    await this.getOwned(companyId, connectorId);
    const agentKey = `kzs_${randomBytes(24).toString('hex')}`;
    await this.prisma.syncConnector.update({
      where: { id: connectorId },
      data: { agentKeyHash: hashAgentKey(agentKey), agentKeyHint: agentKey.slice(-4) },
    });
    return { id: connectorId, agentKey };
  }

  async listConnectors(companyId: string) {
    await this.expireStale(companyId);
    const rows = await this.prisma.syncConnector.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, kind: true, config: true, isActive: true, autoSyncEnabled: true,
        lastSeenAt: true, lastAgentVersion: true, lastSyncAt: true, lastPunchAt: true,
        agentKeyHint: true, createdAt: true,
      },
    });
    const ids = rows.map((r) => r.id);
    const [issues, jobs] = await Promise.all([
      ids.length
        ? this.prisma.devicePunch.groupBy({
            by: ['connectorId', 'status'],
            where: { connectorId: { in: ids }, status: { in: ['INCOMPLETE', 'CONFLICT', 'UNMAPPED'] } },
            _count: { _all: true },
          })
        : Promise.resolve([] as any[]),
      Promise.all(ids.map((id) => this.prisma.syncJob.findFirst({ where: { connectorId: id }, orderBy: { requestedAt: 'desc' } }))),
    ]);
    const now = Date.now();
    return rows.map((r, i) => ({
      ...r,
      online: !!r.lastSeenAt && now - r.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
      issues: {
        incomplete: issues.find((x: any) => x.connectorId === r.id && x.status === 'INCOMPLETE')?._count._all ?? 0,
        conflict: issues.find((x: any) => x.connectorId === r.id && x.status === 'CONFLICT')?._count._all ?? 0,
        unmapped: issues.find((x: any) => x.connectorId === r.id && x.status === 'UNMAPPED')?._count._all ?? 0,
      },
      lastJob: jobs[i] ? toJob(jobs[i]) : null,
    }));
  }

  async updateConnector(companyId: string, connectorId: string, dto: UpdateConnectorDto) {
    await this.getOwned(companyId, connectorId);
    await this.prisma.syncConnector.update({
      where: { id: connectorId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.autoSyncEnabled !== undefined && { autoSyncEnabled: dto.autoSyncEnabled }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.config !== undefined && { config: dto.config as Prisma.InputJsonValue }),
      },
    });
    return { success: true };
  }

  /** L'admin courant devient l'utilisateur au nom duquel les présences sont écrites. */
  async rebindActingUser(companyId: string, connectorId: string, userId: string) {
    await this.getOwned(companyId, connectorId);
    await this.prisma.syncConnector.update({ where: { id: connectorId }, data: { actingUserId: userId } });
    return { success: true };
  }

  async deleteConnector(companyId: string, connectorId: string) {
    await this.getOwned(companyId, connectorId);
    // Supprime aussi les pointages bruts (cascade). Les présences déjà créées restent.
    await this.prisma.syncConnector.delete({ where: { id: connectorId } });
    return { success: true };
  }

  // ==========================================================================
  // 🔐 ADMIN — synchronisation (le bouton)
  // ==========================================================================
  async startSync(companyId: string, userId: string | null, connectorId: string, dto: StartSyncDto, trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL') {
    const c = await this.getOwned(companyId, connectorId);
    if (!c.isActive) throw new BadRequestException('Ce connecteur est désactivé.');

    if ((dto.rangeFrom && !dto.rangeTo) || (!dto.rangeFrom && dto.rangeTo)) {
      throw new BadRequestException('Indiquez la date de début ET la date de fin.');
    }
    if (dto.rangeFrom && dto.rangeTo) {
      const from = new Date(dto.rangeFrom).getTime();
      const to = new Date(dto.rangeTo).getTime();
      if (isNaN(from) || isNaN(to) || from > to) throw new BadRequestException('Période invalide.');
      if ((to - from) / 86_400_000 > 366) throw new BadRequestException('Période limitée à 1 an.');
    }

    await this.expireStale(companyId);
    // Double-clic / double onglet : on renvoie le job déjà en cours au lieu d'en créer un second.
    const active = await this.prisma.syncJob.findFirst({
      where: { connectorId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { requestedAt: 'desc' },
    });
    if (active) return { ...toJob(active), alreadyRunning: true };

    const job = await this.prisma.syncJob.create({
      data: {
        connectorId,
        companyId,
        trigger,
        rangeFrom: dto.rangeFrom ?? null,
        rangeTo: dto.rangeTo ?? null,
        requestedById: userId,
      },
    });
    return { ...toJob(job), alreadyRunning: false };
  }

  async getJob(companyId: string, jobId: string) {
    await this.expireStale(companyId);
    const job = await this.prisma.syncJob.findFirst({ where: { id: jobId, companyId } });
    if (!job) throw new NotFoundException('Synchronisation introuvable.');
    return toJob(job);
  }

  async listJobs(companyId: string, connectorId: string) {
    await this.getOwned(companyId, connectorId);
    const jobs = await this.prisma.syncJob.findMany({
      where: { connectorId },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    });
    return jobs.map(toJob);
  }

  async cancelJob(companyId: string, jobId: string) {
    const job = await this.prisma.syncJob.findFirst({ where: { id: jobId, companyId } });
    if (!job) throw new NotFoundException('Synchronisation introuvable.');
    if (job.status !== 'PENDING' && job.status !== 'RUNNING') return toJob(job);
    const upd = await this.prisma.syncJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', finishedAt: new Date(), error: 'Annulée par un administrateur.' },
    });
    return toJob(upd);
  }

  // ==========================================================================
  // 🔐 ADMIN — associations numéro-pointeuse ↔ employé
  // ==========================================================================
  async getMappings(companyId: string, connectorId: string) {
    await this.getOwned(companyId, connectorId);
    const [maps, employees] = await Promise.all([
      this.prisma.deviceEmployeeMap.findMany({
        where: { connectorId },
        orderBy: [{ employeeId: 'asc' }, { deviceUserId: 'asc' }],
      }),
      this.prisma.employee.findMany({
        where: { companyId },
        select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        orderBy: { lastName: 'asc' },
      }),
    ]);
    const byNum = new Map<string, typeof employees>();
    for (const e of employees) {
      const k = normId(e.employeeNumber);
      byNum.set(k, [...(byNum.get(k) ?? []), e]);
    }
    const empById = new Map(employees.map((e) => [e.id, e]));
    const items = maps.map((m) => {
      const hits = byNum.get(normId(m.deviceUserId)) ?? [];
      return {
        deviceUserId: m.deviceUserId,
        deviceUserName: m.deviceUserName,
        employeeId: m.employeeId,
        employee: m.employeeId ? empById.get(m.employeeId) ?? null : null,
        // Suggestion uniquement si le numéro correspond à UN SEUL matricule
        suggestionEmployeeId: !m.employeeId && hits.length === 1 ? hits[0].id : null,
      };
    });
    return { items, employees };
  }

  async saveMappings(companyId: string, connectorId: string, dto: SaveMappingsDto) {
    const c = await this.getOwned(companyId, connectorId);
    const empIds = [...new Set(dto.mappings.map((m) => m.employeeId).filter(Boolean) as string[])];
    if (empIds.length) {
      const ok = await this.prisma.employee.count({ where: { id: { in: empIds }, companyId } });
      if (ok !== empIds.length) throw new BadRequestException("Un des employés n'appartient pas à cette entreprise.");
    }
    // Deux numéros de la même pointeuse vers le même employé = double comptage
    const seen = new Set<string>();
    for (const m of dto.mappings) {
      if (!m.employeeId) continue;
      if (seen.has(m.employeeId)) {
        throw new BadRequestException('Un même employé ne peut pas être associé à deux numéros de la même pointeuse.');
      }
      seen.add(m.employeeId);
    }
    for (const m of dto.mappings) {
      await this.prisma.deviceEmployeeMap.upsert({
        where: { connectorId_deviceUserId: { connectorId, deviceUserId: m.deviceUserId } },
        update: { employeeId: m.employeeId ?? null },
        create: { connectorId, companyId, deviceUserId: m.deviceUserId, employeeId: m.employeeId ?? null },
      });
    }
    this.reprocessInBackground(c);
    return { success: true, saved: dto.mappings.length };
  }

  /** Associe automatiquement quand le numéro de la pointeuse = matricule Konza (correspondance unique). */
  async autoMap(companyId: string, connectorId: string) {
    const { items } = await this.getMappings(companyId, connectorId);
    const todo = items.filter((i) => !i.employeeId && i.suggestionEmployeeId);
    const taken = new Set(items.map((i) => i.employeeId).filter(Boolean) as string[]);
    const mappings = todo
      .filter((i) => !taken.has(i.suggestionEmployeeId!) && taken.add(i.suggestionEmployeeId!))
      .map((i) => ({ deviceUserId: i.deviceUserId, employeeId: i.suggestionEmployeeId! }));
    if (mappings.length) await this.saveMappings(companyId, connectorId, { mappings });
    return { mapped: mappings.length };
  }

  private reprocessInBackground(c: { id: string; companyId: string; actingUserId: string; name: string }) {
    void this.enqueue(c.id, () => this.processor.process(this.ctx(c))).catch((e) =>
      this.logger.warn(`Retraitement ${c.id} : ${e?.message}`),
    );
  }

  // ==========================================================================
  // 🔐 ADMIN — pointages à corriger
  // ==========================================================================
  async getIssues(companyId: string, connectorId?: string) {
    if (connectorId) await this.getOwned(companyId, connectorId);
    const where: Prisma.DevicePunchWhereInput = {
      companyId,
      ...(connectorId ? { connectorId } : {}),
    };

    const [punches, unmapped] = await Promise.all([
      this.prisma.devicePunch.findMany({
        where: { ...where, status: { in: ['INCOMPLETE', 'CONFLICT'] } },
        select: { id: true, connectorId: true, employeeId: true, date: true, punchedAt: true, status: true, statusNote: true },
        orderBy: { punchedAt: 'asc' },
        take: 5000,
      }),
      this.prisma.devicePunch.groupBy({
        by: ['connectorId', 'deviceUserId'],
        where: { ...where, status: 'UNMAPPED' },
        _count: { _all: true },
      }),
    ]);

    const empIds = [...new Set(punches.map((p) => p.employeeId).filter(Boolean) as string[])];
    const employees = empIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: empIds } },
          select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        })
      : [];
    type Emp = { id: string; firstName: string; lastName: string; employeeNumber: string };
    const empById = new Map<string, Emp>((employees as Emp[]).map((e) => [e.id, e] as [string, Emp]));

    type Row = { employeeId: string; date: string; connectorId: string; status: string; note: string | null; times: Date[] };
    const rows = new Map<string, Row>();
    for (const p of punches) {
      if (!p.employeeId || !p.date) continue;
      const k = `${p.status}|${p.employeeId}|${p.date}`;
      const r: Row = rows.get(k) ?? { employeeId: p.employeeId, date: p.date, connectorId: p.connectorId, status: p.status, note: p.statusNote, times: [] as Date[] };
      r.times.push(p.punchedAt);
      rows.set(k, r);
    }

    const conflictRows = [...rows.values()].filter((r) => r.status === 'CONFLICT');
    const existing = conflictRows.length
      ? await this.prisma.attendance.findMany({
          where: { OR: conflictRows.map((r) => ({ employeeId: r.employeeId, date: r.date })) },
          select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true, checkInMethod: true },
        })
      : [];

    const shape = (r: Row) => {
      const e = empById.get(r.employeeId);
      return {
        connectorId: r.connectorId,
        employeeId: r.employeeId,
        employeeName: e ? `${e.firstName} ${e.lastName}` : 'Employé supprimé',
        employeeNumber: e?.employeeNumber ?? '',
        date: r.date,
        punchTimes: r.times.map((t) => t.toISOString()),
        note: r.note,
      };
    };

    const maps = unmapped.length
      ? await this.prisma.deviceEmployeeMap.findMany({
          where: { connectorId: { in: [...new Set(unmapped.map((u) => u.connectorId))] } },
          select: { connectorId: true, deviceUserId: true, deviceUserName: true },
        })
      : [];

    return {
      incomplete: [...rows.values()].filter((r) => r.status === 'INCOMPLETE').map(shape),
      conflicts: conflictRows.map((r) => ({
        ...shape(r),
        existing: existing.find((x) => x.employeeId === r.employeeId && x.date === r.date) ?? null,
      })),
      unmapped: unmapped.map((u) => ({
        connectorId: u.connectorId,
        deviceUserId: u.deviceUserId,
        name: maps.find((m) => m.connectorId === u.connectorId && m.deviceUserId === u.deviceUserId)?.deviceUserName ?? null,
        punches: u._count._all,
      })),
    };
  }

  async resolveIncomplete(companyId: string, dto: ResolveIncompleteDto) {
    const punches = await this.prisma.devicePunch.findMany({
      where: { companyId, employeeId: dto.employeeId, date: dto.date, status: 'INCOMPLETE' },
      orderBy: { punchedAt: 'asc' },
    });
    if (!punches.length) throw new NotFoundException('Aucun pointage incomplet pour ce jour.');
    const ids = punches.map((p) => p.id);

    if (dto.ignore) {
      await this.prisma.devicePunch.updateMany({
        where: { id: { in: ids } },
        data: { status: 'IGNORED', statusNote: 'ADMIN_IGNORED', processedAt: new Date() },
      });
      return { success: true };
    }

    const [hhIn, mmIn] = (dto.checkInTime ?? '').split(':').map(Number);
    const [hhOut, mmOut] = (dto.checkOutTime ?? '').split(':').map(Number);
    let checkIn: Date; let checkOut: Date;
    if (dto.checkOutTime) {
      checkIn = punches[0].punchedAt;
      checkOut = atCongoTime(dto.date, hhOut, mmOut);
    } else if (dto.checkInTime) {
      checkIn = atCongoTime(dto.date, hhIn, mmIn);
      checkOut = punches[punches.length - 1].punchedAt;
    } else {
      throw new BadRequestException("Indiquez l'heure manquante, ou écartez ce pointage.");
    }
    if (checkOut.getTime() <= checkIn.getTime()) {
      throw new BadRequestException("L'heure de sortie doit être après l'heure d'entrée.");
    }

    const connector = await this.getOwned(companyId, punches[0].connectorId);
    const res = await this.enqueue(connector.id, () =>
      this.processor.writeResolved(this.ctx(connector), dto.employeeId, dto.date, checkIn, checkOut, false),
    );
    if (!res.ok) throw new ConflictException(res.reason);
    await this.processor.setStatus(ids, 'USED', 'Heure complétée par un administrateur');
    return { success: true };
  }

  async resolveConflict(companyId: string, dto: ResolveConflictDto) {
    const punches = await this.prisma.devicePunch.findMany({
      where: { companyId, employeeId: dto.employeeId, date: dto.date, NOT: { statusNote: 'ADMIN_IGNORED' } },
      orderBy: { punchedAt: 'asc' },
    });
    const conflicted = punches.filter((p) => p.status === 'CONFLICT');
    if (!conflicted.length) throw new NotFoundException('Aucun conflit pour ce jour.');
    const ids = conflicted.map((p) => p.id);

    if (dto.action === 'KEEP') {
      await this.prisma.devicePunch.updateMany({
        where: { id: { in: ids } },
        data: { status: 'IGNORED', statusNote: 'ADMIN_IGNORED', processedAt: new Date() },
      });
      return { success: true };
    }

    const r = resolveDay(punches.map((p) => ({ id: p.id, punchedAt: p.punchedAt })));
    if (!r || r.kind !== 'COMPLETE') throw new BadRequestException("Ce jour n'a pas d'entrée et de sortie exploitables.");
    const connector = await this.getOwned(companyId, conflicted[0].connectorId);
    const res = await this.enqueue(connector.id, () =>
      this.processor.writeResolved(this.ctx(connector), dto.employeeId, dto.date, r.checkIn, r.checkOut!, true),
    );
    if (!res.ok) throw new ConflictException(res.reason);
    await this.processor.setStatus(ids, 'USED', 'Heures de la pointeuse appliquées par un administrateur');
    return { success: true };
  }

  // ==========================================================================
  // 🤖 AGENT
  // ==========================================================================
  /** L'agent demande s'il y a du travail. Appelé toutes les ~20 s. */
  async poll(connector: { id: string; companyId: string; lastPunchAt: Date | null }, agentVersion?: string) {
    await this.prisma.syncConnector.update({
      where: { id: connector.id },
      data: { lastSeenAt: new Date(), ...(agentVersion ? { lastAgentVersion: agentVersion.slice(0, 30) } : {}) },
    });
    await this.expireStale(connector.companyId);

    const pending = await this.prisma.syncJob.findFirst({
      where: { connectorId: connector.id, status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
    });
    if (!pending) return { job: null, pollIntervalSec: 20 };

    // Prise atomique : si deux polls se croisent, un seul gagne.
    const taken = await this.prisma.syncJob.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date(), lastProgressAt: new Date() },
    });
    if (taken.count === 0) return { job: null, pollIntervalSec: 5 };

    const full = await this.prisma.syncConnector.findUnique({ where: { id: connector.id }, select: { kind: true, config: true } });
    let since: string | null; let until: string | null = null;
    if (pending.rangeFrom && pending.rangeTo) {
      since = `${pending.rangeFrom}T00:00:00${CONGO_OFFSET}`;
      until = `${pending.rangeTo}T23:59:59${CONGO_OFFSET}`;
    } else if (connector.lastPunchAt) {
      since = new Date(connector.lastPunchAt.getTime() - CURSOR_SAFETY_DAYS * 86_400_000).toISOString();
    } else {
      since = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000).toISOString();
    }
    return { job: { id: pending.id, kind: full?.kind, config: full?.config ?? {}, since, until }, pollIntervalSec: 5 };
  }

  async receiveBatch(connector: { id: string; companyId: string; actingUserId: string; name: string }, jobId: string, dto: AgentBatchDto) {
    const job = await this.prisma.syncJob.findFirst({ where: { id: jobId, connectorId: connector.id } });
    if (!job) throw new NotFoundException('Synchronisation introuvable.');
    if (job.status !== 'RUNNING') throw new ConflictException(`Synchronisation non active (${job.status}).`);

    const now = Date.now();
    let rejected = 0;
    const rows: Prisma.DevicePunchCreateManyInput[] = [];
    for (const p of dto.punches) {
      const t = new Date(p.punchedAt);
      // Horloge de pointeuse déréglée : on refuse le futur lointain et l'an 2000.
      if (isNaN(t.getTime()) || t.getTime() > now + 86_400_000 || t.getUTCFullYear() < 2015) { rejected++; continue; }
      rows.push({
        connectorId: connector.id,
        companyId: connector.companyId,
        jobId,
        deviceUserId: p.deviceUserId.trim(),
        punchedAt: t,
        rawState: p.state ?? null,
        rawPayload: (p.raw ?? undefined) as Prisma.InputJsonValue | undefined,
      });
    }

    const res = rows.length ? await this.prisma.devicePunch.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };

    // Employés de la pointeuse (pour l'écran d'association)
    const named = (dto.users ?? []).filter((u) => u.deviceUserId.trim());
    const idsSeen = new Set<string>([...rows.map((r) => r.deviceUserId), ...named.map((u) => u.deviceUserId.trim())]);
    if (idsSeen.size) {
      await this.prisma.deviceEmployeeMap.createMany({
        data: [...idsSeen].map((deviceUserId) => ({
          connectorId: connector.id, companyId: connector.companyId, deviceUserId,
          deviceUserName: named.find((u) => u.deviceUserId.trim() === deviceUserId)?.name?.trim() || null,
        })),
        skipDuplicates: true,
      });
      for (const u of named) {
        if (!u.name?.trim()) continue;
        await this.prisma.deviceEmployeeMap.updateMany({
          where: { connectorId: connector.id, deviceUserId: u.deviceUserId.trim(), OR: [{ deviceUserName: null }, { deviceUserName: { not: u.name.trim() } }] },
          data: { deviceUserName: u.name.trim() },
        });
      }
    }

    if (rows.length) {
      const maxAt = new Date(Math.max(...rows.map((r) => (r.punchedAt as Date).getTime())));
      await this.prisma.syncConnector.updateMany({
        where: { id: connector.id, OR: [{ lastPunchAt: null }, { lastPunchAt: { lt: maxAt } }] },
        data: { lastPunchAt: maxAt },
      });
    }

    const prev: any = job.stats ?? {};
    const stats = {
      ...prev,
      phase: dto.done ? 'PROCESSING' : 'RECEIVING',
      received: (prev.received ?? 0) + dto.punches.length,
      inserted: (prev.inserted ?? 0) + res.count,
      duplicates: (prev.duplicates ?? 0) + (rows.length - res.count),
      rejected: (prev.rejected ?? 0) + rejected,
    };
    await this.prisma.syncJob.update({ where: { id: jobId }, data: { stats, lastProgressAt: new Date() } });

    if (dto.done) {
      // Réponse immédiate à l'agent ; le traitement tourne en tâche de fond.
      void this.enqueue(connector.id, () => this.finishJob(connector, jobId)).catch(() => undefined);
    }
    return { ok: true, inserted: res.count, duplicates: rows.length - res.count, rejected };
  }

  private async finishJob(c: { id: string; companyId: string; actingUserId: string; name: string }, jobId: string) {
    try {
      const actor = await this.prisma.user.findFirst({ where: { id: c.actingUserId, companyId: c.companyId }, select: { role: true } });
      if (!actor || !ADMIN_ROLES.includes(actor.role)) {
        throw new Error("L'utilisateur lié à ce connecteur n'a plus les droits Admin/RH. Cliquez sur « Utiliser mon compte » dans les réglages du connecteur.");
      }
      const result = await this.processor.process(this.ctx(c));
      const job = await this.prisma.syncJob.findUnique({ where: { id: jobId }, select: { stats: true, status: true } });
      if (job?.status === 'CANCELLED') return;
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: { status: 'SUCCESS', finishedAt: new Date(), stats: { ...((job?.stats as any) ?? {}), ...result, phase: 'DONE' } },
      });
      await this.prisma.syncConnector.update({ where: { id: c.id }, data: { lastSyncAt: new Date() } });
    } catch (e: any) {
      this.logger.error(`Traitement du job ${jobId} : ${e?.message}`);
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', finishedAt: new Date(), error: String(e?.message ?? e).slice(0, 500) },
      }).catch(() => undefined);
    }
  }

  async failJob(connector: { id: string }, jobId: string, error: string) {
    await this.prisma.syncJob.updateMany({
      where: { id: jobId, connectorId: connector.id, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'FAILED', finishedAt: new Date(), error: error.slice(0, 500) },
    });
    return { ok: true };
  }

  // ==========================================================================
  // 🧹 Jobs bloqués : l'écran ne doit jamais rester coincé sur « en cours »
  // ==========================================================================
  async expireStale(companyId?: string) {
    const now = Date.now();
    const scope = companyId ? { companyId } : {};
    await this.prisma.syncJob.updateMany({
      where: { ...scope, status: 'RUNNING', OR: [
        { lastProgressAt: { lt: new Date(now - STALE_RUNNING_MS) } },
        { lastProgressAt: null, startedAt: { lt: new Date(now - STALE_RUNNING_MS) } },
      ] },
      data: { status: 'FAILED', finishedAt: new Date(), error: "L'agent ne répond plus. Vérifiez qu'il est démarré sur le PC de l'entreprise, puis relancez." },
    });
    await this.prisma.syncJob.updateMany({
      where: { ...scope, status: 'PENDING', requestedAt: { lt: new Date(now - STALE_PENDING_MS) } },
      data: { status: 'FAILED', finishedAt: new Date(), error: "L'agent n'a pas répondu (PC éteint ou sans internet ?). Les pointages restent sur la pointeuse : relancez quand l'agent est en ligne." },
    });
  }

  /** Synchronisation nocturne : un job PENDING par connecteur actif, sauf s'il y en a déjà un. */
  async createScheduledJobs() {
    const connectors = await this.prisma.syncConnector.findMany({
      where: { isActive: true, autoSyncEnabled: true },
      select: { id: true, companyId: true },
    });
    let created = 0;
    for (const c of connectors) {
      const r = await this.startSync(c.companyId, null, c.id, {}, 'SCHEDULED').catch(() => null);
      if (r && !(r as any).alreadyRunning) created++;
    }
    return created;
  }

  todayCongo() { return congoDateString(); }
}