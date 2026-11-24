// ============================================================================
// 📁 src/contract-chain/contract-sync.service.ts
// Synchronisation FICHE EMPLOYÉ → CHAÎNE DE CONTRATS.
//
// Toute modification faite via PATCH /employees/:id (type de contrat, fin de CDD,
// salaire, poste, département, fin de relation) est répercutée sur le contrat en
// cours de la chaîne, DANS LA MÊME TRANSACTION que la modification de l'employé,
// avec une trace d'audit. La base reflète la réalité ; ce qui est contraire aux
// plafonds légaux n'est pas refusé mais marqué CRITIQUE (et repris par le moteur
// d'audit au contrôle pré-paie).
//
//   CDD → CDI (ou tout type temporaire → CDI)  : maillon CONVERSION_CDI, même chaîne
//   autre changement de type                   : ancien contrat clos, nouvelle chaîne
//   date de fin d'un CDD                       : date du maillon mise à jour + contrôle
//   salaire / poste / département              : maillon courant mis à jour
//   statut → TERMINATED                        : maillon courant clos (TERMINATED)
// ============================================================================
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditTrailService, AuditActor } from '../audit-trail/audit-trail.service';
import { buildChanges, pickTracked } from '../audit-trail/audit-trail.policy';
import {
  ChainLink,
  evaluateEndDateEdit,
  RuleViolation,
  toUtcDate,
} from './contract-chain.rules';

type Tx = Prisma.TransactionClient;

export interface EmployeeRow {
  id: string;
  companyId: string;
  status: string;
  contractType: string;
  contractEndDate: Date | null;
  baseSalary: unknown;
  position: string;
  departmentId: string;
  hireDate: Date;
  [k: string]: unknown;
}

export interface SyncInput {
  before: EmployeeRow;
  after: EmployeeRow;
  actor: AuditActor;
  context?: { ip?: string; requestId?: string; route?: string };
}

export interface SyncResult {
  actions: string[];
  violations: RuleViolation[];
}

const CURRENT = ['ACTIVE', 'TRIAL', 'SUSPENDED'];
const TEMP = ['CDD', 'STAGE', 'INTERIM', 'CONSULTANT', 'PRESTATAIRE'];
// Champs techniques : jamais comparés ni journalisés.
const TECHNICAL = new Set(['id', 'createdAt', 'updatedAt', 'companyId', 'createdById']);

const SELECT = {
  id: true, companyId: true, employeeId: true, chainId: true, rank: true, kind: true,
  contractType: true, status: true, startDate: true, endDate: true, position: true,
  baseSalary: true, departmentId: true, renewalCount: true, cddMotif: true,
  trialPeriodDays: true, trialEndDate: true, signedAt: true, signedByEmp: true,
  previousContractId: true, renewalReason: true,
} satisfies Prisma.EmployeeContractSelect;

const iso = (d: unknown) => (d ? new Date(d as any).toISOString().slice(0, 10) : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(String(v)));
const months = (a: Date, b: Date) =>
  Math.max(1, Math.round((b.getTime() - a.getTime() + 86_400_000) / 86_400_000 / 30.4375));

@Injectable()
export class ContractSyncService {
  constructor(private readonly audit: AuditTrailService) {}

  /** Trace d'embauche : appelée dans la transaction de création de l'employé. */
  async recordHire(
    tx: Tx,
    input: { employee: EmployeeRow; contract: Record<string, unknown> & { id: string }; actor: AuditActor; context?: SyncInput['context'] },
  ) {
    const { employee, contract, actor, context } = input;
    await this.audit.record(tx, {
      companyId: employee.companyId, actor, context,
      action: 'EMPLOYEE_CREATED', entity: 'EMPLOYEE', entityId: employee.id,
      summary: `Employé créé (${employee.contractType}, embauche le ${iso(employee.hireDate)})`,
      before: null, after: this.cleanRow(employee),
    });
    await this.audit.record(tx, {
      companyId: employee.companyId, actor, context,
      action: 'CONTRACT_CREATED', entity: 'EMPLOYEE_CONTRACT', entityId: contract.id,
      summary: `Contrat initial enregistré à l'embauche (${String(contract.contractType)})`,
      before: null, after: pickTracked('EMPLOYEE_CONTRACT', contract),
    });
  }

  async syncFromEmployeeChange(tx: Tx, input: SyncInput): Promise<SyncResult> {
    const { before, after, actor, context } = input;
    const companyId = after.companyId;
    const result: SyncResult = { actions: [], violations: [] };
    const base = { companyId, actor, context };

    // Même verrou que le renouvellement : jamais deux écritures de chaîne en parallèle.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract-chain:' + after.id}))`;

    // 1) Trace de la fiche elle-même (valeurs suivies + noms des champs sensibles modifiés).
    const b = this.cleanRow(before);
    const a = this.cleanRow(after);
    const built = buildChanges('EMPLOYEE', b, a);
    const nValues = Object.keys(built.values).length;
    if (nValues > 0 || built.maskedFields.length > 0) {
      await this.audit.record(tx, {
        ...base, action: 'EMPLOYEE_UPDATED', entity: 'EMPLOYEE', entityId: after.id,
        summary:
          `Fiche employé modifiée (${nValues} valeur${nValues > 1 ? 's' : ''} suivie${nValues > 1 ? 's' : ''}` +
          (built.maskedFields.length ? `, ${built.maskedFields.length} champ${built.maskedFields.length > 1 ? 's' : ''} non conservé${built.maskedFields.length > 1 ? 's' : ''}` : '') + ')',
        before: b, after: a,
      });
      result.actions.push('EMPLOYEE_UPDATED');
    }

    // 2) Qu'est-ce qui concerne le contrat ?
    const typeChanged = before.contractType !== after.contractType;
    const endChanged = iso(before.contractEndDate) !== iso(after.contractEndDate);
    const salaryChanged = num(before.baseSalary) !== num(after.baseSalary);
    const positionChanged = before.position !== after.position;
    const deptChanged = before.departmentId !== after.departmentId;
    const terminated = before.status !== 'TERMINATED' && after.status === 'TERMINATED';
    const trialConfirmed = before.trialStatus !== 'CONFIRMED' && after.trialStatus === 'CONFIRMED';
    if (!(typeChanged || endChanged || salaryChanged || positionChanged || deptChanged || terminated || trialConfirmed)) return result;

    const current = await tx.employeeContract.findFirst({
      where: { employeeId: after.id, companyId, status: { in: CURRENT as any } },
      orderBy: { rank: 'desc' },
      select: SELECT,
    });

    // 3) Pas de contrat en cours : on le recrée depuis la fiche (auto-réparation), sauf fin de relation.
    if (!current) {
      if (terminated || after.status === 'TERMINATED') return result;
      const created = await tx.employeeContract.create({
        data: {
          employeeId: after.id, companyId, contractType: after.contractType as any,
          startDate: after.hireDate, endDate: TEMP.includes(after.contractType) ? after.contractEndDate : null,
          position: after.position, baseSalary: after.baseSalary as any, departmentId: after.departmentId,
          status: 'ACTIVE', kind: 'INITIAL', createdBy: actor.id,
          notes: 'Recréé par synchronisation : aucun contrat en cours trouvé pour cet employé',
        },
        select: SELECT,
      });
      await this.audit.record(tx, {
        ...base, action: 'CONTRACT_CREATED_BY_SYNC', entity: 'EMPLOYEE_CONTRACT', entityId: created.id,
        severity: 'WARN', summary: 'Aucun contrat en cours pour cet employé : contrat recréé depuis la fiche',
        before: null, after: pickTracked('EMPLOYEE_CONTRACT', created),
      });
      result.actions.push('CONTRACT_CREATED_BY_SYNC');
      return result;
    }

    const now = new Date();
    const today = toUtcDate(now);

    // 4) Fin de relation de travail.
    if (terminated) {
      const trialFailed = before.trialStatus !== 'FAILED' && after.trialStatus === 'FAILED';
      const closed = await tx.employeeContract.update({
        where: { id: current.id }, data: { status: trialFailed ? 'TRIAL_FAILED' : 'TERMINATED' }, select: SELECT,
      });
      const action = trialFailed ? 'CONTRACT_CLOSED_BY_TRIAL_FAILURE' : 'CONTRACT_CLOSED_BY_TERMINATION';
      await this.audit.record(tx, {
        ...base, action, entity: 'EMPLOYEE_CONTRACT', entityId: current.id,
        severity: 'WARN',
        summary: trialFailed
          ? "Contrat clos : période d'essai non concluante, fin de la relation de travail"
          : "Contrat clos : fin de la relation de travail de l'employé",
        before: pickTracked('EMPLOYEE_CONTRACT', current), after: pickTracked('EMPLOYEE_CONTRACT', closed),
      });
      result.actions.push(action);
      return result;
    }

    // 5) Changement de type de contrat.
    if (typeChanged) {
      const toCdi = after.contractType === 'CDI' && before.contractType !== 'CDI';
      const start = today.getTime() < toUtcDate(current.startDate).getTime() ? toUtcDate(current.startDate) : today;
      const common = {
        employeeId: after.id, companyId, position: after.position,
        baseSalary: after.baseSalary as any, departmentId: after.departmentId,
        status: 'ACTIVE' as const, createdBy: actor.id, startDate: start,
      };

      if (toCdi) {
        const closed = await tx.employeeContract.update({
          where: { id: current.id },
          data: { status: 'CONVERTED', renewedAt: now, renewedBy: actor.id }, select: SELECT,
        });
        const next = await tx.employeeContract.create({
          data: {
            ...common, contractType: 'CDI', endDate: null, duration: null,
            chainId: current.chainId, rank: current.rank + 1, kind: 'CONVERSION_CDI',
            previousContractId: current.id, renewalCount: current.renewalCount,
            renewalReason: 'Conversion enregistrée depuis la fiche employé',
          },
          select: SELECT,
        });
        await this.audit.record(tx, {
          ...base, action: 'CONTRACT_CONVERTED_CDI', entity: 'EMPLOYEE_CONTRACT', entityId: next.id,
          severity: 'WARN',
          summary: `${before.contractType} converti en CDI à compter du ${iso(start)} (rang ${current.rank} → ${next.rank}) — depuis la fiche employé`,
          before: null, after: pickTracked('EMPLOYEE_CONTRACT', next),
        });
        await this.audit.record(tx, {
          ...base, action: 'CONTRACT_CLOSED_BY_CONVERSION', entity: 'EMPLOYEE_CONTRACT', entityId: current.id,
          summary: `Contrat clos : converti en CDI ${next.id}`,
          before: pickTracked('EMPLOYEE_CONTRACT', current), after: pickTracked('EMPLOYEE_CONTRACT', closed),
        });
        result.actions.push('CONTRACT_CONVERTED_CDI');
        return result;
      }

      // Autre changement (CDI→CDD, CDD→STAGE…) : on repart d'une nouvelle chaîne.
      const closed = await tx.employeeContract.update({
        where: { id: current.id },
        data: { status: 'EXPIRED', renewedAt: now, renewedBy: actor.id }, select: SELECT,
      });
      const endDate = TEMP.includes(after.contractType) ? after.contractEndDate : null;
      const next = await tx.employeeContract.create({
        data: {
          ...common, contractType: after.contractType as any, endDate,
          duration: endDate ? months(start, toUtcDate(endDate)) : null, kind: 'INITIAL',
          notes: `Remplace le contrat ${current.id} (${before.contractType} → ${after.contractType}, depuis la fiche employé)`,
        },
        select: SELECT,
      });
      const downgrade = before.contractType === 'CDI';
      await this.audit.record(tx, {
        ...base, action: 'CONTRACT_TYPE_CHANGED', entity: 'EMPLOYEE_CONTRACT', entityId: next.id,
        severity: downgrade ? 'CRITICAL' : 'WARN',
        summary: `Type de contrat modifié : ${before.contractType} → ${after.contractType} (nouvelle chaîne de contrats)` + (downgrade ? ' — un CDI ne devient pas un contrat temporaire sans accord écrit' : ''),
        before: pickTracked('EMPLOYEE_CONTRACT', current), after: pickTracked('EMPLOYEE_CONTRACT', next),
      });
      await this.audit.record(tx, {
        ...base, action: 'CONTRACT_CLOSED_BY_TYPE_CHANGE', entity: 'EMPLOYEE_CONTRACT', entityId: current.id,
        summary: `Contrat clos : remplacé par ${next.id}`,
        before: pickTracked('EMPLOYEE_CONTRACT', current), after: pickTracked('EMPLOYEE_CONTRACT', closed),
      });
      result.actions.push('CONTRACT_TYPE_CHANGED');
      return result;
    }

    // 5bis) Essai confirmé : le contrat passe de TRIAL à ACTIVE.
    if (trialConfirmed && current.status === 'TRIAL') {
      const confirmed = await tx.employeeContract.update({
        where: { id: current.id }, data: { status: 'ACTIVE' }, select: SELECT,
      });
      await this.audit.record(tx, {
        ...base, action: 'CONTRACT_TRIAL_CONFIRMED', entity: 'EMPLOYEE_CONTRACT', entityId: current.id,
        summary: "Période d'essai confirmée : le contrat passe en cours normal",
        before: pickTracked('EMPLOYEE_CONTRACT', current), after: pickTracked('EMPLOYEE_CONTRACT', confirmed),
      });
      result.actions.push('CONTRACT_TRIAL_CONFIRMED');
      current.status = 'ACTIVE' as typeof current.status;
    }

    // 6) Même type : on met à jour le maillon courant.
    const data: Prisma.EmployeeContractUpdateInput | Record<string, unknown> = {};
    const changed: string[] = [];
    let violations: RuleViolation[] = [];

    if (endChanged && TEMP.includes(current.contractType)) {
      (data as any).endDate = after.contractEndDate;
      (data as any).duration = after.contractEndDate ? months(toUtcDate(current.startDate), toUtcDate(after.contractEndDate)) : null;
      changed.push('fin de contrat');
      if (current.contractType === 'CDD' && after.contractEndDate) {
        const rows = await tx.employeeContract.findMany({
          where: { chainId: current.chainId, companyId }, orderBy: { rank: 'asc' }, select: SELECT,
        });
        const chain: ChainLink[] = rows.map((r: any) => ({
          rank: r.rank, kind: r.kind, contractType: r.contractType,
          startDate: toUtcDate(r.startDate), endDate: r.endDate ? toUtcDate(r.endDate) : null, cddMotif: r.cddMotif,
        }));
        violations = evaluateEndDateEdit(chain, toUtcDate(after.contractEndDate), today);
      }
    }
    if (salaryChanged) { (data as any).baseSalary = after.baseSalary; changed.push('salaire de base'); }
    if (positionChanged) { (data as any).position = after.position; changed.push('poste'); }
    if (deptChanged) { (data as any).departmentId = after.departmentId; changed.push('département'); }
    if (Object.keys(data).length === 0) return result;

    const updated = await tx.employeeContract.update({ where: { id: current.id }, data: data as any, select: SELECT });
    const hasBlock = violations.some((v) => v.level === 'BLOCK');
    const dateEdit = changed.includes('fin de contrat');
    await this.audit.record(tx, {
      ...base,
      action: dateEdit ? 'CONTRACT_DATES_EDITED' : 'CONTRACT_TERMS_SYNCED',
      entity: 'EMPLOYEE_CONTRACT', entityId: current.id,
      severity: hasBlock ? 'CRITICAL' : violations.length || dateEdit ? 'WARN' : 'INFO',
      summary:
        `Contrat (rang ${current.rank}) mis à jour depuis la fiche employé : ${changed.join(', ')}` +
        (violations.length ? ` — ${violations.map((v) => v.message).join(' | ')}` : ''),
      before: pickTracked('EMPLOYEE_CONTRACT', current), after: pickTracked('EMPLOYEE_CONTRACT', updated),
    });
    result.actions.push(dateEdit ? 'CONTRACT_DATES_EDITED' : 'CONTRACT_TERMS_SYNCED');
    result.violations = violations;
    return result;
  }

  private cleanRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (!TECHNICAL.has(k)) out[k] = v;
    return out;
  }
}