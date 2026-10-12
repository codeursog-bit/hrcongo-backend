// ============================================================================
// 📁 src/audit-engine/audit-findings.service.ts
// Lecture des constats / synthèse / points de contrôle, et décisions humaines
// (justifier, passer outre, rouvrir, attester). Toute décision est inscrite dans
// le journal d'audit infalsifiable avec son motif.
// ============================================================================
import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertCompanyAccess } from '../common/resolve-verified-company.util';
import { AuditActor, AuditTrailService } from '../audit-trail/audit-trail.service';
import { pickTracked } from '../audit-trail/audit-trail.policy';
import { AttestCheckpointDto, PeriodQueryDto, QueryFindingsDto } from './dto/audit-engine.dto';
import { CHECKPOINT_BY_CODE, CHECKPOINTS } from './rules/checkpoints';
import { RULE_BY_CODE } from './rules/rule-catalog';

export interface AuthUser { userId: string; role: string; companyId: string | null }
const ADMIN_ONLY_WAIVE = ['ADMIN', 'SUPER_ADMIN'];
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

@Injectable()
export class AuditFindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditTrailService,
  ) {}

  // ── Lecture ───────────────────────────────────────────────────────────────
  async list(companyId: string, q: QueryFindingsDto) {
    const where: Prisma.AuditFindingWhereInput = {
      companyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.blocking !== undefined ? { blocking: q.blocking } : {}),
      ...(q.ruleCode ? { ruleCode: q.ruleCode } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.month && q.year ? { OR: [{ periodYear: q.year, periodMonth: q.month }, { periodYear: null }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditFinding.findMany({
        where, orderBy: [{ status: 'asc' }, { severity: 'desc' }, { lastDetectedAt: 'desc' }],
        skip: (q.page - 1) * q.limit, take: q.limit,
      }),
      this.prisma.auditFinding.count({ where }),
    ]);
    return { data: await this.toViews(companyId, rows), meta: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) } };
  }

  async summary(companyId: string, q: PeriodQueryDto, viewerRole: string) {
    const hasPeriod = !!(q.month && q.year);
    const periodWhere: Prisma.AuditFindingWhereInput = hasPeriod
      ? { OR: [{ periodYear: q.year, periodMonth: q.month }, { periodYear: null }] }
      : {};
    const open: Prisma.AuditFindingWhereInput = { companyId, status: 'OPEN', ...periodWhere };

    const [byRule, byStatus, bySeverity, blocking, payrollFindings, lastRun, periodPayrolls] = await Promise.all([
      this.prisma.auditFinding.groupBy({ by: ['ruleCode'], where: open, _count: { _all: true } }),
      this.prisma.auditFinding.groupBy({ by: ['status'], where: { companyId, ...periodWhere }, _count: { _all: true } }),
      this.prisma.auditFinding.groupBy({ by: ['severity'], where: open, _count: { _all: true } }),
      this.prisma.auditFinding.count({ where: { ...open, blocking: true } }),
      this.prisma.auditFinding.findMany({ where: { ...open, entity: 'PAYROLL' }, select: { entityId: true } }),
      this.prisma.auditRun.findFirst({ where: { companyId, ...(hasPeriod ? { month: q.month, year: q.year } : {}) }, orderBy: { startedAt: 'desc' } }),
      hasPeriod ? this.prisma.payroll.count({ where: { companyId, month: q.month, year: q.year, status: { not: 'CANCELLED' } } }) : Promise.resolve(0),
    ]);

    const checked = lastRun?.payrollsChecked ?? periodPayrolls;
    const withOpen = new Set(payrollFindings.map((f) => f.entityId)).size;
    const cat = new Map<string, number>();
    for (const r of byRule) {
      const c = RULE_BY_CODE[r.ruleCode]?.category ?? 'AUTRE';
      cat.set(c, (cat.get(c) ?? 0) + r._count._all);
    }
    const sev = (s: string) => bySeverity.find((x) => x.severity === s)?._count._all ?? 0;
    const st = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;

    return {
      period: hasPeriod ? { month: q.month!, year: q.year! } : null,
      lastRun: lastRun ? await this.runView(companyId, lastRun) : null,
      payrollsChecked: checked,
      payrollsWithOpenFindings: withOpen,
      conformityRate: checked > 0 ? Math.max(0, Math.round(100 * (1 - withOpen / checked))) : null,
      open: { total: sev('INFO') + sev('WARN') + sev('CRITICAL'), critical: sev('CRITICAL'), warn: sev('WARN'), info: sev('INFO'), blocking },
      byStatus: { OPEN: st('OPEN'), JUSTIFIED: st('JUSTIFIED'), WAIVED: st('WAIVED'), RESOLVED: st('RESOLVED') },
      byCategory: [...cat.entries()].map(([category, open]) => ({ category, open })).sort((a, b) => b.open - a.open),
      checkpoints: hasPeriod ? await this.checkpointViews(companyId, q.month!, q.year!) : [],
      // Le support plateforme voit des compteurs, jamais le détail nominatif.
      detailVisible: viewerRole !== 'SUPER_ADMIN',
    };
  }


  // ── Tendance : un point par mois (dernier contrôle du mois) ─────────────────
  async trend(companyId: string, months: number) {
    const now = new Date();
    const periods: Array<{ year: number; month: number }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      periods.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
    }
    const windowStart = new Date(Date.UTC(periods[0].year, periods[0].month - 1, 1));

    const runs = await this.prisma.auditRun.findMany({
      where: { companyId, OR: periods.map((p) => ({ year: p.year, month: p.month })) },
      orderBy: { startedAt: 'asc' },
    });
    const last = new Map<string, (typeof runs)[number]>();
    const count = new Map<string, number>();
    for (const r of runs) {
      const k = `${r.year}-${r.month}`;
      last.set(k, r); // trié par date : le dernier écrase les précédents
      count.set(k, (count.get(k) ?? 0) + 1);
    }

    const points = periods.map((p) => {
      const k = `${p.year}-${p.month}`;
      const r = last.get(k);
      return {
        year: p.year, month: p.month, hasRun: !!r, runs: count.get(k) ?? 0,
        lastRunAt: r?.finishedAt ?? null,
        payrollsChecked: r?.payrollsChecked ?? null,
        payrollsWithFindings: r?.payrollsWithFindings ?? null,
        // null (et non 0) quand rien n'a été contrôlé : la courbe montre un trou, pas une fausse valeur
        conformityRate: r && r.payrollsChecked > 0
          ? Math.max(0, Math.round(100 * (1 - r.payrollsWithFindings / r.payrollsChecked)))
          : null,
        findingsOpen: r?.findingsOpen ?? null, openCritical: r?.openCritical ?? null, openBlocking: r?.openBlocking ?? null,
        findingsNew: r?.findingsNew ?? null, findingsResolved: r?.findingsResolved ?? null,
      };
    });

    const [all, open] = await Promise.all([
      this.prisma.auditFinding.groupBy({ by: ['ruleCode'], where: { companyId, firstDetectedAt: { gte: windowStart } }, _count: { _all: true } }),
      this.prisma.auditFinding.groupBy({ by: ['ruleCode'], where: { companyId, status: 'OPEN' }, _count: { _all: true } }),
    ]);
    const openBy = new Map<string, number>(open.map((o: any) => [o.ruleCode, o._count._all] as [string, number]));
    const topRules = all
      .map((a: any) => ({ ruleCode: a.ruleCode as string, count: a._count._all as number, open: openBy.get(a.ruleCode) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return { windowMonths: months, months: points, topRules };
  }

  // ── Décisions humaines ────────────────────────────────────────────────────
  async justify(user: AuthUser, id: string, note: string, actor: AuditActor) {
    const f = await this.load(user, id);
    if (f.blocking) throw new ForbiddenException('Cet écart est bloquant : seul un administrateur peut passer outre (« Passer outre »).');
    return this.transition(f, 'JUSTIFIED', note, user, actor, 'AUDIT_FINDING_JUSTIFIED', 'INFO');
  }

  async waive(user: AuthUser, id: string, note: string, actor: AuditActor) {
    if (!ADMIN_ONLY_WAIVE.includes(user.role)) throw new ForbiddenException('Seul un administrateur peut passer outre un écart bloquant.');
    const f = await this.load(user, id);
    return this.transition(f, 'WAIVED', note, user, actor, 'AUDIT_FINDING_WAIVED', 'CRITICAL');
  }

  async reopen(user: AuthUser, id: string, actor: AuditActor) {
    const f = await this.load(user, id);
    if (f.status === 'OPEN') throw new BadRequestException('Cet écart est déjà ouvert.');
    return this.transition(f, 'OPEN', null, user, actor, 'AUDIT_FINDING_REOPENED', 'INFO');
  }

  async attest(user: AuthUser, companyId: string, dto: AttestCheckpointDto, actor: AuditActor) {
    const def = CHECKPOINT_BY_CODE[dto.code];
    if (!def) throw new BadRequestException('Point de contrôle inconnu.');
    if (dto.status === 'DONE' && !dto.evidenceRef?.trim()) throw new BadRequestException('Une preuve est obligatoire (n° de reçu, accusé de dépôt…).');
    if (dto.status === 'NOT_APPLICABLE' && !dto.note?.trim()) throw new BadRequestException('Un motif est obligatoire pour déclarer ce point sans objet.');

    const now = new Date();
    const key = { companyId_code_periodYear_periodMonth: { companyId, code: dto.code, periodYear: dto.year, periodMonth: dto.month } };
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.auditCheckpoint.findUnique({ where: key });
      const row = await tx.auditCheckpoint.upsert({
        where: key,
        create: { companyId, code: dto.code, periodMonth: dto.month, periodYear: dto.year, status: dto.status, evidenceRef: dto.evidenceRef ?? null, note: dto.note ?? null, attestedBy: user.userId, attestedAt: now },
        update: { status: dto.status, evidenceRef: dto.evidenceRef ?? null, note: dto.note ?? null, attestedBy: user.userId, attestedAt: now },
      });
      // L'écart « échéance dépassée » correspondant se clôt tout de suite.
      await tx.auditFinding.updateMany({
        where: { companyId, fingerprint: `CHECKPOINT_OVERDUE:${dto.code}:${dto.year}-${dto.month}`, status: { not: 'RESOLVED' } },
        data: { status: 'RESOLVED', resolvedAt: now, resolvedBy: user.userId, resolutionNote: `Attesté : ${dto.status === 'DONE' ? dto.evidenceRef : dto.note}`.slice(0, 500) },
      });
      await this.audit.record(tx, {
        companyId, actor, action: 'AUDIT_CHECKPOINT_ATTESTED', entity: 'AUDIT_CHECKPOINT', entityId: row.id,
        severity: dto.status === 'NOT_APPLICABLE' ? 'WARN' : 'INFO',
        summary: `${def.label} — ${String(dto.month).padStart(2, '0')}/${dto.year} : ${dto.status === 'DONE' ? `fait (preuve : ${dto.evidenceRef})` : `sans objet (${dto.note})`}`,
        before: before ? pickTracked('AUDIT_CHECKPOINT', before) : null, after: pickTracked('AUDIT_CHECKPOINT', row),
      });
    });
    return this.checkpointViews(companyId, dto.month, dto.year);
  }

  // ── Interne ───────────────────────────────────────────────────────────────
  private async load(user: AuthUser, id: string) {
    const f = await this.prisma.auditFinding.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Écart introuvable');
    await assertCompanyAccess(this.prisma, user.userId, f.companyId, { write: true });
    return f;
  }

  private async transition(
    f: Prisma.AuditFindingGetPayload<Record<string, never>>,
    status: 'OPEN' | 'JUSTIFIED' | 'WAIVED',
    note: string | null,
    user: AuthUser,
    actor: AuditActor,
    action: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL',
  ) {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.auditFinding.update({
        where: { id: f.id },
        data: status === 'OPEN'
          ? { status, resolvedAt: null, resolvedBy: null, resolutionNote: null }
          : { status, resolvedAt: now, resolvedBy: user.userId, resolutionNote: note },
      });
      await this.audit.record(tx, {
        companyId: f.companyId, actor, action, entity: 'AUDIT_FINDING', entityId: f.id, severity,
        summary: `${RULE_BY_CODE[f.ruleCode]?.label ?? f.ruleCode} — ${f.message}` + (note ? ` — Motif : ${note}` : ''),
        before: pickTracked('AUDIT_FINDING', f), after: pickTracked('AUDIT_FINDING', row),
      });
      return row;
    });
    return (await this.toViews(f.companyId, [updated]))[0];
  }

  private async toViews(companyId: string, rows: Array<Prisma.AuditFindingGetPayload<Record<string, never>>>) {
    const empIds = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => !!x))];
    const userIds = [...new Set(rows.map((r) => r.resolvedBy).filter((x): x is string => !!x))];
    const [emps, users] = await Promise.all([
      empIds.length ? this.prisma.employee.findMany({ where: { id: { in: empIds }, companyId }, select: { id: true, firstName: true, lastName: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
    ]);
    const empName = new Map<string, string>(emps.map((e: any) => [e.id, `${e.firstName} ${e.lastName}`] as [string, string]));
    const userName = new Map<string, string>(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`] as [string, string]));
    return rows.map((r) => ({
      id: r.id, runId: r.runId, ruleCode: r.ruleCode, severity: r.severity, blocking: r.blocking, status: r.status,
      entity: r.entity, entityId: r.entityId, employeeId: r.employeeId,
      employeeName: r.employeeId ? (empName.get(r.employeeId) ?? null) : null,
      periodMonth: r.periodMonth, periodYear: r.periodYear,
      message: r.message, expected: r.expected, actual: r.actual,
      resolutionNote: r.resolutionNote, resolvedAt: r.resolvedAt,
      resolvedByName: r.resolvedBy ? (userName.get(r.resolvedBy) ?? null) : null,
      autoResolved: r.status === 'RESOLVED' && !r.resolvedBy,
      firstDetectedAt: r.firstDetectedAt, lastDetectedAt: r.lastDetectedAt,
    }));
  }

  private async runView(companyId: string, r: Prisma.AuditRunGetPayload<Record<string, never>>) {
    const by = r.startedBy
      ? await this.prisma.user.findUnique({ where: { id: r.startedBy }, select: { firstName: true, lastName: true } })
      : null;
    return {
      id: r.id, month: r.month, year: r.year, trigger: r.trigger,
      startedByName: by ? `${by.firstName} ${by.lastName}` : null,
      startedAt: r.startedAt, finishedAt: r.finishedAt,
      payrollsChecked: r.payrollsChecked, payrollsWithFindings: r.payrollsWithFindings, rulesRun: r.rulesRun,
      findingsNew: r.findingsNew, findingsResolved: r.findingsResolved,
      findingsOpen: r.findingsOpen, openCritical: r.openCritical, openBlocking: r.openBlocking,
    };
  }

  async checkpointViews(companyId: string, month: number, year: number) {
    const [rows, headcount] = await Promise.all([
      this.prisma.auditCheckpoint.findMany({ where: { companyId, periodMonth: month, periodYear: year } }),
      this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } }),
    ]);
    const userIds = [...new Set(rows.map((r) => r.attestedBy))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
    const userName = new Map<string, string>(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`] as [string, string]));
    const today = utcDay(new Date());
    return CHECKPOINTS.map((def) => {
      const due = def.dueDate(month, year, headcount);
      const att = rows.find((r) => r.code === def.code);
      const overdue = !!due && !att && today.getTime() > due.getTime() + 86_399_000;
      return {
        code: def.code, label: def.label, evidenceHint: def.evidenceHint, legalRef: def.legalRef,
        dueDate: due, status: att ? att.status : due ? 'PENDING' : 'NOT_DUE', overdue,
        evidenceRef: att?.evidenceRef ?? null, note: att?.note ?? null,
        attestedByName: att ? (userName.get(att.attestedBy) ?? null) : null, attestedAt: att?.attestedAt ?? null,
      };
    });
  }
}