// 📁 EMPLACEMENT (projet backend) : src/device-sync/device-sync-processor.service.ts
// ============================================================================
// ✅ Transforme les passages bruts (device_punches) en présences (attendances).
//    - Idempotent : peut être relancé à volonté, ne duplique rien.
//    - Ne devine jamais : 1 seul passage sur un jour passé → INCOMPLETE.
//    - N'écrase jamais une présence saisie autrement (manuel, congé, absence).
//    - Les calculs (heures sup, férié, shift, nuit) sont ceux de
//      AttendanceService.createManual : aucune règle métier dupliquée ici.
// ============================================================================

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import {
  AttendanceUtilsService,
  SHIFT_LATE_TOLERANCE_MINUTES,
} from '../attendance/services/attendance-utils.service';
import { congoDateString, congoDayOfWeek } from '../common/utils/congo-time';
import { groupBy, resolveDay } from './punch-resolver';

export interface ConnectorCtx {
  id: string;
  companyId: string;
  actingUserId: string;
  name: string;
}

export interface ProcessStats {
  daysWritten: number;
  incomplete: number;
  conflicts: number;
  unmappedPeople: number;
  ignored: number;
  pending: number;
}

type PunchStatus = 'PENDING' | 'USED' | 'UNMAPPED' | 'INCOMPLETE' | 'CONFLICT' | 'IGNORED';

@Injectable()
export class DeviceSyncProcessor {
  private readonly logger = new Logger(DeviceSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly utils: AttendanceUtilsService,
  ) {}

  // ── Traitement principal ─────────────────────────────────────────────────
  async process(connector: ConnectorCtx): Promise<ProcessStats> {
    const stats: ProcessStats = {
      daysWritten: 0, incomplete: 0, conflicts: 0, unmappedPeople: 0, ignored: 0, pending: 0,
    };

    const maps = await this.prisma.deviceEmployeeMap.findMany({
      where: { connectorId: connector.id, employeeId: { not: null } },
      select: { deviceUserId: true, employeeId: true },
    });
    const empByDeviceId = new Map<string, string>(
      maps.map((m: { deviceUserId: string; employeeId: string | null }) => [m.deviceUserId, m.employeeId as string] as [string, string]),
    );

    // 1) Passages à (ré)évaluer : nouveaux, ou en attente d'association
    const fresh: Array<{ id: string; deviceUserId: string; punchedAt: Date }> = await this.prisma.devicePunch.findMany({
      where: { connectorId: connector.id, status: { in: ['PENDING', 'UNMAPPED'] } },
      select: { id: true, deviceUserId: true, punchedAt: true },
    });
    if (fresh.length === 0) return stats;

    const unmappedIds: string[] = [];
    const unmappedPeople = new Set<string>();
    const affected = new Map<string, { employeeId: string; date: string; ids: string[] }>();

    for (const p of fresh) {
      const employeeId = empByDeviceId.get(p.deviceUserId);
      if (!employeeId) {
        unmappedIds.push(p.id);
        unmappedPeople.add(p.deviceUserId);
        continue;
      }
      const date = congoDateString(p.punchedAt);
      const key = `${employeeId}|${date}`;
      const slot = affected.get(key);
      if (slot) slot.ids.push(p.id);
      else affected.set(key, { employeeId, date, ids: [p.id] });
    }

    if (unmappedIds.length) {
      await this.setStatus(unmappedIds, 'UNMAPPED', 'Numéro non associé à un employé');
    }
    stats.unmappedPeople = unmappedPeople.size;

    // Renseigne employeeId + date sur les nouveaux passages (une requête par jour/employé)
    for (const slot of affected.values()) {
      await this.prisma.devicePunch.updateMany({
        where: { id: { in: slot.ids } },
        data: { employeeId: slot.employeeId, date: slot.date },
      });
    }
    if (affected.size === 0) return stats;

    // 2) Tous les passages des jours concernés (anciens + nouveaux) en une requête
    const employeeIds = [...new Set([...affected.values()].map((a) => a.employeeId))];
    const dates = [...new Set([...affected.values()].map((a) => a.date))];
    const all = await this.prisma.devicePunch.findMany({
      where: {
        companyId: connector.companyId,
        connectorId: connector.id,
        employeeId: { in: employeeIds },
        date: { in: dates },
        NOT: { statusNote: 'ADMIN_IGNORED' },
      },
      select: { id: true, employeeId: true, date: true, punchedAt: true },
    });
    type DayPunch = { id: string; employeeId: string | null; date: string | null; punchedAt: Date };
    const byKey = groupBy<DayPunch>(all as DayPunch[], (p) => `${p.employeeId}|${p.date}`);

    const settings = await this.loadSettings(connector.companyId);
    const today = congoDateString();
    const updates = new Map<string, { status: PunchStatus; note: string | null; ids: string[] }>();
    const queue = (status: PunchStatus, note: string | null, ids: string[]) => {
      if (!ids.length) return;
      const k = `${status}|${note ?? ''}`;
      const slot = updates.get(k);
      if (slot) slot.ids.push(...ids);
      else updates.set(k, { status, note, ids: [...ids] });
    };

    // 3) Une décision par employé et par jour
    for (const [key, slot] of affected) {
      const dayPunches = byKey.get(key) ?? [];
      const r = resolveDay(dayPunches.map((p) => ({ id: p.id, punchedAt: p.punchedAt })));
      if (!r) continue;

      queue('IGNORED', 'Double badgeage', r.ignoredIds);
      stats.ignored += r.ignoredIds.length;

      if (r.kind === 'SINGLE') {
        if (slot.date >= today) {
          queue('PENDING', 'Journée en cours : un seul passage pour le moment', r.keptIds);
          stats.pending++;
        } else {
          queue('INCOMPLETE', 'Un seul passage ce jour-là', r.keptIds);
          stats.incomplete++;
        }
        continue;
      }

      try {
        const res = await this.writeDay(connector, settings, slot.employeeId, slot.date, r.checkIn, r.checkOut!);
        if (res.ok) {
          queue('USED', null, r.keptIds);
          stats.daysWritten++;
        } else {
          queue('CONFLICT', res.reason, r.keptIds);
          stats.conflicts++;
        }
      } catch (e: any) {
        // Droits de l'utilisateur agissant perdus : inutile de continuer, on remonte.
        if (e instanceof ForbiddenException) throw e;
        this.logger.warn(`Écriture présence impossible (${key}) : ${e?.message}`);
        queue('CONFLICT', `Erreur : ${String(e?.message ?? e).slice(0, 150)}`, r.keptIds);
        stats.conflicts++;
      }
    }

    for (const u of updates.values()) await this.setStatus(u.ids, u.status, u.note);
    return stats;
  }

  // ── Résolution manuelle d'un jour incomplet ou en conflit ────────────────
  /** Écrit une journée avec des heures données (déjà validées par l'appelant). */
  async writeResolved(
    connector: ConnectorCtx,
    employeeId: string,
    date: string,
    checkIn: Date,
    checkOut: Date,
    force: boolean,
  ) {
    const settings = await this.loadSettings(connector.companyId);
    return this.writeDay(connector, settings, employeeId, date, checkIn, checkOut, force);
  }

  async setStatus(ids: string[], status: PunchStatus, note: string | null) {
    const CHUNK = 5000;
    for (let i = 0; i < ids.length; i += CHUNK) {
      await this.prisma.devicePunch.updateMany({
        where: { id: { in: ids.slice(i, i + CHUNK) } },
        data: { status, statusNote: note, processedAt: new Date() },
      });
    }
  }

  // ── Écriture d'une journée ───────────────────────────────────────────────
  private async writeDay(
    connector: ConnectorCtx,
    settings: { startH: number; startM: number; tolerance: number },
    employeeId: string,
    date: string,
    checkIn: Date,
    checkOut: Date,
    force = false,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
      select: {
        status: true, checkIn: true, checkOut: true,
        checkInMethod: true, checkOutMethod: true, leaveId: true, absenceRequestId: true,
      },
    });

    if (existing) {
      // Congé / absence déclarée : jamais écrasé, même en "forcer".
      if (existing.leaveId || existing.status === 'LEAVE') return { ok: false, reason: 'En congé ce jour-là' };
      if (existing.absenceRequestId || existing.status === 'ABSENT_PAID') {
        return { ok: false, reason: 'Absence déclarée ce jour-là' };
      }
      const hasTimes = !!existing.checkIn || !!existing.checkOut;
      const fromDevice =
        (existing.checkInMethod == null || existing.checkInMethod === 'DEVICE') &&
        (existing.checkOutMethod == null || existing.checkOutMethod === 'DEVICE');
      if (hasTimes && !fromDevice && !force) {
        return { ok: false, reason: `Présence déjà saisie (${existing.checkInMethod ?? existing.checkOutMethod})` };
      }
      // Re-synchronisation identique : rien à réécrire.
      if (
        fromDevice && existing.checkIn && existing.checkOut &&
        existing.checkIn.getTime() === checkIn.getTime() &&
        existing.checkOut.getTime() === checkOut.getTime()
      ) {
        return { ok: true };
      }
    }

    // Retard : mêmes seuils que le pointage normal (shift individuel sinon horaires entreprise)
    const dateObj = new Date(date);
    const sa = await this.prisma.employeeShiftAssignment.findFirst({
      where: {
        employeeId,
        OR: [
          { specificDate: date },
          {
            dayOfWeek: congoDayOfWeek(dateObj),
            specificDate: null,
            OR: [{ validFrom: null }, { validFrom: { lte: dateObj } }],
            AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: dateObj } }] }],
          },
        ],
      },
      include: { shift: true },
      orderBy: { specificDate: 'desc' },
    });
    const shift = sa?.shift ?? null;
    const isLate = this.utils.isLateCheckIn(
      checkIn,
      shift?.startHour ?? settings.startH,
      shift ? SHIFT_LATE_TOLERANCE_MINUTES : settings.tolerance,
      shift ? shift.startMinute ?? 0 : settings.startM,
    );

    await this.attendance.createManual(
      connector.actingUserId,
      {
        employeeId,
        date,
        status: isLate ? 'LATE' : 'PRESENT',
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        notes: `Pointeuse « ${connector.name} »`,
      },
      { method: 'DEVICE', source: connector.name },
    );
    return { ok: true };
  }

  private async loadSettings(companyId: string) {
    const ps: any = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
      orderBy: { effectiveDate: 'desc' },
      select: { officialStartHour: true, officialStartMinute: true, lateToleranceMinutes: true } as any,
    });
    return {
      startH: Number(ps?.officialStartHour ?? 8),
      startM: Number(ps?.officialStartMinute ?? 0),
      tolerance: Number(ps?.lateToleranceMinutes ?? 60),
    };
  }
}