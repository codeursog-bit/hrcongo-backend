// ============================================================================
// 📁 src/audit-engine/audit-engine.service.ts
// Moteur de contrôles : charge les données d'UNE entreprise, applique les règles
// pures, et met à jour les constats (dédoublonnés par empreinte, clos
// automatiquement quand l'écart disparaît, rouverts s'il revient).
// ============================================================================
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditTrailService } from '../audit-trail/audit-trail.service';
import {
  ContractLite, EmployeeLite, PAYROLL_RULES, PayrollCtx, PayrollLite, RuleHit, ruleCheckpoints,
} from './rules/payroll-rules';
import { RULES } from './rules/rule-catalog';

export type RunTrigger = 'MANUAL' | 'GATE' | 'CRON';

export interface RunOptions {
  month?: number;
  year?: number;
  /** Gate : on ne contrôle que ces bulletins. */
  payrollIds?: string[];
  trigger: RunTrigger;
  actor?: AuditActor | null;
}

export interface RunSummary {
  runId: string;
  month: number;
  year: number;
  trigger: RunTrigger;
  startedAt: Date;
  finishedAt: Date;
  payrollsChecked: number;
  payrollsWithFindings: number;
  rulesRun: number;
  findingsNew: number;
  findingsResolved: number;
  findingsOpen: number;
  openCritical: number;
  openBlocking: number;
}

type Detected = RuleHit & { month: number; year: number };

const dec = (v: unknown) => Number(String(v ?? 0));
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

@Injectable()
export class AuditEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditTrailService,
  ) {}

  async run(companyId: string, opts: RunOptions): Promise<RunSummary> {
    const startedAt = new Date();
    const fullPeriod = !opts.payrollIds;

    // ── 1) Chargement (tout est filtré par companyId) ───────────────────────
    const rows = await this.prisma.payroll.findMany({
      where: {
        companyId,
        status: { not: 'CANCELLED' },
        ...(opts.payrollIds ? { id: { in: opts.payrollIds } } : { month: opts.month, year: opts.year }),
      },
      select: {
        id: true, employeeId: true, month: true, year: true, status: true, periodStart: true, periodEnd: true,
        baseSalary: true, grossSalary: true, netSalary: true, totalDeductions: true, cnssSalarial: true,
        cnssEmployerPension: true, cnssEmployerFamily: true, cnssEmployerAccident: true, cnssEmployer: true,
        tusDgiAmount: true, tusCnssAmount: true, irppFiscalParts: true, its: true,
        items: { select: { code: true, type: true, amount: true, isCnss: true, isTaxable: true } },
      },
    });
    const month = opts.month ?? rows[0]?.month ?? startedAt.getUTCMonth() + 1;
    const year = opts.year ?? rows[0]?.year ?? startedAt.getUTCFullYear();
    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];

    const [employees, company, contracts, headcount, attestations] = (await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: employeeIds }, companyId },
        select: { id: true, firstName: true, lastName: true, contractType: true, tolZone: true, isSubjectToCnss: true, isSubjectToTus: true, isSubjectToIrpp: true, cnssNumber: true },
      }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { isSubjectToTus: true, appliesCnssEmployer: true } }),
      this.prisma.employeeContract.findMany({
        where: { employeeId: { in: employeeIds }, companyId },
        select: { id: true, employeeId: true, chainId: true, rank: true, kind: true, contractType: true, status: true, startDate: true, endDate: true, cddMotif: true },
      }),
      this.prisma.employee.count({ where: { companyId, status: 'ACTIVE' } }),
      fullPeriod
        ? this.prisma.auditCheckpoint.findMany({ where: { companyId, periodMonth: month, periodYear: year }, select: { code: true } })
        : Promise.resolve([] as Array<{ code: string }>),
    ])) as [any[], any, any[], number, Array<{ code: string }>];

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const previous: Array<{ employeeId: string; grossSalary: unknown }> = employeeIds.length
      ? await this.prisma.payroll.findMany({
          where: { companyId, employeeId: { in: employeeIds }, month: prevMonth, year: prevYear, status: { not: 'CANCELLED' } },
          select: { employeeId: true, grossSalary: true },
        })
      : [];

    const empById = new Map<string, EmployeeLite>(employees.map((e: any) => [e.id, e as EmployeeLite] as [string, EmployeeLite]));
    const prevGross = new Map<string, number>(previous.map((p) => [p.employeeId, dec(p.grossSalary)] as [string, number]));
    const contractsByEmp = new Map<string, ContractLite[]>();
    for (const c of contracts as any[]) {
      const list = contractsByEmp.get(c.employeeId) ?? [];
      list.push({ ...c, startDate: new Date(c.startDate), endDate: c.endDate ? new Date(c.endDate) : null } as ContractLite);
      contractsByEmp.set(c.employeeId, list);
    }

    // ── 2) Application des règles ────────────────────────────────────────────
    const detected = new Map<string, Detected>();
    const put = (h: RuleHit, m: number, y: number) => detected.set(`${h.ruleCode}:${h.key}`, { ...h, month: m, year: y });
    let checked = 0;
    for (const r of rows) {
      const employee = empById.get(r.employeeId);
      if (!employee) continue; // employé hors entreprise ou supprimé : jamais contrôlé ici
      checked++;
      const payroll: PayrollLite = {
        id: r.id, employeeId: r.employeeId, month: r.month, year: r.year,
        periodStart: new Date(r.periodStart), periodEnd: new Date(r.periodEnd),
        baseSalary: dec(r.baseSalary), grossSalary: dec(r.grossSalary), netSalary: dec(r.netSalary),
        totalDeductions: dec(r.totalDeductions), cnssSalarial: dec(r.cnssSalarial),
        cnssEmployerPension: dec(r.cnssEmployerPension), cnssEmployerFamily: dec(r.cnssEmployerFamily),
        cnssEmployerAccident: dec(r.cnssEmployerAccident), cnssEmployer: dec(r.cnssEmployer),
        tusDgiAmount: dec(r.tusDgiAmount), tusCnssAmount: dec(r.tusCnssAmount),
        irppFiscalParts: dec(r.irppFiscalParts), its: dec(r.its),
        items: r.items.map((i) => ({ code: i.code, type: i.type as any, amount: dec(i.amount), isCnss: i.isCnss, isTaxable: i.isTaxable })),
      };
      const ctx: PayrollCtx = {
        payroll, employee,
        company: { isSubjectToTus: company?.isSubjectToTus ?? true, appliesCnssEmployer: company?.appliesCnssEmployer ?? true },
        contracts: contractsByEmp.get(r.employeeId) ?? [],
        previousGross: prevGross.get(r.employeeId) ?? null,
      };
      for (const rule of PAYROLL_RULES) for (const h of rule(ctx)) put(h, r.month, r.year);
    }

    const anyValidated = rows.some((r) => r.status === 'VALIDATED' || r.status === 'PAID');
    let rulesRun = PAYROLL_RULES.length;
    if (fullPeriod && anyValidated) {
      rulesRun += 1;
      const attested = new Set<string>(attestations.map((a) => a.code));
      for (const h of ruleCheckpoints({ companyId, month, year, headcount, today: utcDay(startedAt), attested })) put(h, month, year);
    }

    // ── 3) Mise à jour des constats (transaction, verrou par entreprise) ────
    const scopeOr: Prisma.AuditFindingWhereInput[] = [];
    if (fullPeriod) {
      scopeOr.push({ entity: 'PAYROLL', periodYear: year, periodMonth: month });
      scopeOr.push({ entity: 'COMPANY', periodYear: year, periodMonth: month });
    } else {
      scopeOr.push({ entity: 'PAYROLL', entityId: { in: rows.map((r) => r.id) } });
    }
    if (employeeIds.length) scopeOr.push({ periodYear: null, employeeId: { in: employeeIds } });
    const scopeWhere: Prisma.AuditFindingWhereInput = { companyId, OR: scopeOr };

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit-engine:' + companyId}))`;
      const now = new Date();

      const fingerprints = [...detected.keys()];
      const existing: any[] = fingerprints.length
        ? await tx.auditFinding.findMany({ where: { companyId, fingerprint: { in: fingerprints } } })
        : [];
      const byFp = new Map(existing.map((f) => [f.fingerprint, f]));
      let findingsNew = 0;

      // runId : créé d'abord pour que les constats puissent le référencer
      const run = await tx.auditRun.create({
        data: {
          companyId, month, year, trigger: opts.trigger, startedBy: opts.actor?.id ?? null, startedAt, finishedAt: now,
          payrollsChecked: checked, payrollsWithFindings: 0, rulesRun, findingsNew: 0, findingsResolved: 0, findingsOpen: 0, openCritical: 0, openBlocking: 0,
        },
      });

      for (const [fp, h] of detected) {
        const data = {
          runId: run.id, ruleCode: h.ruleCode, severity: h.severity, blocking: h.blocking, entity: h.entity,
          entityId: h.entityId, employeeId: h.employeeId,
          periodMonth: h.periodScoped ? h.month : null, periodYear: h.periodScoped ? h.year : null,
          message: h.message, expected: h.expected ?? null, actual: h.actual ?? null, lastDetectedAt: now,
        };
        const prev = byFp.get(fp);
        if (!prev) {
          await tx.auditFinding.create({ data: { companyId, fingerprint: fp, status: 'OPEN', firstDetectedAt: now, ...data } });
          findingsNew++;
        } else {
          const factsChanged = (prev.actual ?? '') !== (h.actual ?? '');
          const reopen = prev.status === 'RESOLVED' || ((prev.status === 'JUSTIFIED' || prev.status === 'WAIVED') && factsChanged);
          await tx.auditFinding.update({
            where: { id: prev.id },
            data: reopen
              ? { ...data, status: 'OPEN', resolvedAt: null, resolvedBy: null, resolutionNote: null }
              : data,
          });
          if (reopen) findingsNew++;
        }
      }

      // Écarts du périmètre qui ne sont plus détectés → clos automatiquement.
      const inScope: Array<{ id: string; fingerprint: string }> = await tx.auditFinding.findMany({ where: { ...scopeWhere, status: { not: 'RESOLVED' } }, select: { id: true, fingerprint: true } });
      const gone = inScope.filter((f) => !detected.has(f.fingerprint)).map((f) => f.id);
      if (gone.length) {
        await tx.auditFinding.updateMany({
          where: { id: { in: gone }, companyId },
          data: { status: 'RESOLVED', resolvedAt: now, resolvedBy: null, resolutionNote: 'Résolu automatiquement : l’écart n’est plus détecté.' },
        });
      }

      const openWhere: Prisma.AuditFindingWhereInput = { ...scopeWhere, status: 'OPEN' };
      const [findingsOpen, openCritical, openBlocking] = await Promise.all([
        tx.auditFinding.count({ where: openWhere }),
        tx.auditFinding.count({ where: { ...openWhere, severity: 'CRITICAL' } }),
        tx.auditFinding.count({ where: { ...openWhere, blocking: true } }),
      ]);
      // bulletins portant au moins un écart ouvert (sert à la courbe de conformité)
      const openPayrollRows: Array<{ entityId: string | null }> = await tx.auditFinding.findMany({
        where: { ...openWhere, entity: 'PAYROLL' }, select: { entityId: true },
      });
      const payrollsWithFindings = new Set(openPayrollRows.map((f) => f.entityId)).size;
      const finished = new Date();
      await tx.auditRun.update({
        where: { id: run.id },
        data: { finishedAt: finished, payrollsWithFindings, findingsNew, findingsResolved: gone.length, findingsOpen, openCritical, openBlocking },
      });

      await this.audit.record(tx, {
        companyId, actor: opts.actor ?? null,
        action: 'AUDIT_RUN_COMPLETED', entity: 'AUDIT_RUN', entityId: run.id,
        severity: openBlocking > 0 ? 'CRITICAL' : openCritical > 0 ? 'WARN' : 'INFO',
        summary: `Contrôle ${opts.trigger === 'GATE' ? 'à la validation' : opts.trigger === 'CRON' ? 'automatique' : 'manuel'} ${String(month).padStart(2, '0')}/${year} : ${checked} bulletin(s), ${findingsOpen} écart(s) ouvert(s) dont ${openBlocking} bloquant(s), ${findingsNew} nouveau(x), ${gone.length} résolu(s)`,
      });

      return { runId: run.id, startedAt, finishedAt: finished, payrollsWithFindings, findingsNew, findingsResolved: gone.length, findingsOpen, openCritical, openBlocking };
    }, { timeout: 60_000 });

    return { month, year, trigger: opts.trigger, payrollsChecked: checked, rulesRun, ...result };
  }

  /** Catalogue des règles, tel que le front l'affiche. */
  catalog() {
    return RULES;
  }
}