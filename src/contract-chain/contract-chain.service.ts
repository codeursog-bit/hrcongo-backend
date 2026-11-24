// ============================================================================
// 📁 src/contract-chain/contract-chain.service.ts
// Traçabilité des contrats : 1er contrat → renouvellement → (conversion CDI),
// chaque maillon conservé (dates, salaire, motif, qui, quand) et lié au précédent.
//
// Compatibilité : Employee.contractEndDate / baseSalary / position restent
// synchronisés dans la même transaction → le scheduler d'expiration, la paie et
// les exports existants continuent de fonctionner sans changement.
// ============================================================================
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertCompanyAccess } from '../common/resolve-verified-company.util';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { pickTracked } from '../audit-trail/audit-trail.policy';
import {
  addDaysUtc,
  CDD_RULES,
  ChainLink,
  evaluateRenewal,
  RuleViolation,
  toUtcDate,
} from './contract-chain.rules';
import { ConvertToCdiDto, RenewContractDto } from './dto/contract-chain.dto';

type Db = PrismaService | Prisma.TransactionClient;

export interface AuthUser {
  userId: string;
  role: string;
  companyId: string | null;
}
export interface RequestCtx {
  ip?: string;
  requestId?: string;
  route?: string;
}

export interface ContractLinkView {
  id: string;
  rank: number;
  kind: 'INITIAL' | 'RENEWAL' | 'CONVERSION_CDI';
  contractType: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  duration: number | null;
  position: string;
  baseSalary: string; // Decimal sérialisé en texte
  trialPeriodDays: number | null;
  trialEndDate: Date | null;
  signedAt: Date | null;
  signedByEmp: boolean;
  renewalCount: number;
  cddMotif: string | null;
  renewalReason: string | null;
  renewedAt: Date | null;
  renewedByName: string | null;
  previousContractId: string | null;
  createdAt: Date;
  createdByName: string | null;
}

const CONTRACT_SELECT = {
  id: true,
  employeeId: true,
  companyId: true,
  contractType: true,
  status: true,
  startDate: true,
  endDate: true,
  duration: true,
  position: true,
  baseSalary: true,
  departmentId: true,
  trialPeriodDays: true,
  trialEndDate: true,
  signedAt: true,
  signedByEmp: true,
  renewalCount: true,
  chainId: true,
  rank: true,
  kind: true,
  previousContractId: true,
  cddMotif: true,
  renewalReason: true,
  renewedAt: true,
  renewedBy: true,
  createdBy: true,
  createdAt: true,
} satisfies Prisma.EmployeeContractSelect;

@Injectable()
export class ContractChainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditTrailService,
  ) {}

  // ── Lecture : toutes les chaînes d'un employé ─────────────────────────────
  async getChains(user: AuthUser, employeeId: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, companyId: true },
    });
    if (!emp) throw new NotFoundException('Employé introuvable');
    await assertCompanyAccess(this.prisma, user.userId, emp.companyId);

    const rows = await this.prisma.employeeContract.findMany({
      where: { employeeId, companyId: emp.companyId },
      orderBy: [{ startDate: 'asc' }, { rank: 'asc' }],
      select: CONTRACT_SELECT,
    });

    const views = await this.toViews(rows);
    const viewById = new Map(views.map((v) => [v.id, v]));
    const byChain = new Map<string, typeof rows>();
    for (const r of rows) {
      byChain.set(r.chainId, [...(byChain.get(r.chainId) ?? []), r]);
    }
    return [...byChain.entries()].map(([chainId, links]) => {
      const sorted = links.sort((a, b) => a.rank - b.rank);
      const last = sorted[sorted.length - 1];
      const renewals = sorted.filter((l) => l.kind === 'RENEWAL').length;
      return {
        chainId,
        current: ['ACTIVE', 'TRIAL', 'SUSPENDED'].includes(last.status),
        renewalsUsed: renewals,
        renewalsAllowed: last.contractType === 'CDD' ? CDD_RULES.MAX_RENEWALS : 0,
        links: sorted.map((l) => viewById.get(l.id)!),
      };
    });
  }

  // ── Simulation (aucune écriture) : le front affiche les blocages en direct ─
  async preview(user: AuthUser, contractId: string, dto: RenewContractDto) {
    const c = await this.prisma.employeeContract.findUnique({
      where: { id: contractId },
      select: { companyId: true },
    });
    if (!c) throw new NotFoundException('Contrat introuvable');
    await assertCompanyAccess(this.prisma, user.userId, c.companyId, { write: true });

    const ctx = await this.loadContext(this.prisma, contractId);
    const proposed = this.proposedFrom(ctx.current, dto);
    const violations = evaluateRenewal({
      today: toUtcDate(new Date()),
      chain: ctx.chain,
      currentStatus: ctx.current.status,
      proposed,
    });
    return {
      allowed: !violations.some((v) => v.level === 'BLOCK'),
      overridableOnly:
        violations.some((v) => v.level === 'BLOCK') &&
        violations.filter((v) => v.level === 'BLOCK').every((v) => v.overridable),
      violations,
    };
  }

  // ── Renouvellement d'un CDD ───────────────────────────────────────────────
  async renew(user: AuthUser, contractId: string, dto: RenewContractDto, rc: RequestCtx) {
    const r = await this.renewTx(user, contractId, dto, rc);
    return { contract: await this.viewOne(r.contract), warnings: r.violations };
  }

  private async renewTx(user: AuthUser, contractId: string, dto: RenewContractDto, rc: RequestCtx) {
    const probe = await this.prisma.employeeContract.findUnique({
      where: { id: contractId },
      select: { companyId: true, employeeId: true },
    });
    if (!probe) throw new NotFoundException('Contrat introuvable');
    await assertCompanyAccess(this.prisma, user.userId, probe.companyId, { write: true });
    const actor = await this.actorOf(user);

    return this.prisma.$transaction(
      async (tx) => {
        // Un seul renouvellement à la fois par employé (anti double-clic / deux RH).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract-chain:' + probe.employeeId}))`;

        // Relecture SOUS verrou : l'état peut avoir changé depuis la vérification.
        const { current, chain } = await this.loadContext(tx, contractId);
        const proposed = this.proposedFrom(current, dto);

        const violations = evaluateRenewal({
          today: toUtcDate(new Date()),
          chain,
          currentStatus: current.status,
          proposed,
        });
        const overridden = this.enforce(user, violations, dto.overrideReason);

        const now = new Date();
        // 1) Clore l'ancien AVANT de créer le nouveau (index « un seul contrat courant »).
        const closed = await tx.employeeContract.update({
          where: { id: current.id },
          data: { status: 'EXPIRED', renewedAt: now, renewedBy: user.userId },
          select: CONTRACT_SELECT,
        });

        // 2) Créer le maillon suivant.
        const next = await tx.employeeContract.create({
          data: {
            employeeId: current.employeeId,
            companyId: current.companyId,
            contractType: 'CDD',
            startDate: proposed.startDate,
            endDate: proposed.endDate,
            duration: approxMonths(proposed.startDate, proposed.endDate),
            renewalCount: current.renewalCount + 1,
            position: dto.position ?? current.position,
            baseSalary: dto.baseSalary ?? current.baseSalary,
            departmentId: current.departmentId,
            status: 'ACTIVE',
            chainId: current.chainId,
            rank: current.rank + 1,
            kind: 'RENEWAL',
            previousContractId: current.id,
            cddMotif: proposed.cddMotif ?? null,
            renewalReason: dto.reason,
            signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
            notes: dto.notes ?? null,
            createdBy: user.userId,
          },
          select: CONTRACT_SELECT,
        });

        // 3) Garder la fiche employé synchronisée (le reste de l'app la lit).
        const empBefore = await tx.employee.findUniqueOrThrow({
          where: { id: current.employeeId },
          select: { contractEndDate: true, baseSalary: true, position: true },
        });
        const empAfter = await tx.employee.update({
          where: { id: current.employeeId },
          data: {
            contractEndDate: proposed.endDate,
            ...(dto.baseSalary !== undefined ? { baseSalary: dto.baseSalary } : {}),
            ...(dto.position ? { position: dto.position } : {}),
          },
          select: { contractEndDate: true, baseSalary: true, position: true },
        });

        // 4) Traces — dans la MÊME transaction.
        const base = { companyId: current.companyId, actor, context: rc };
        await this.audit.record(tx, {
          ...base,
          action: 'CONTRACT_RENEWED',
          entity: 'EMPLOYEE_CONTRACT',
          entityId: next.id,
          severity: overridden ? 'CRITICAL' : 'INFO',
          summary:
            `CDD renouvelé (rang ${current.rank} → ${next.rank}) du ${iso(proposed.startDate)} au ${iso(proposed.endDate)}` +
            (overridden ? ` — PASSÉ OUTRE : ${dto.overrideReason}` : ''),
          before: null,
          after: pickTracked('EMPLOYEE_CONTRACT', next),
        });
        await this.audit.record(tx, {
          ...base,
          action: 'CONTRACT_CLOSED_BY_RENEWAL',
          entity: 'EMPLOYEE_CONTRACT',
          entityId: current.id,
          summary: `Contrat clos : remplacé par le renouvellement ${next.id}`,
          before: pickTracked('EMPLOYEE_CONTRACT', current),
          after: pickTracked('EMPLOYEE_CONTRACT', closed),
        });
        await this.audit.record(tx, {
          ...base,
          action: 'EMPLOYEE_SYNCED_BY_RENEWAL',
          entity: 'EMPLOYEE',
          entityId: current.employeeId,
          summary: 'Fiche employé mise à jour suite au renouvellement du contrat',
          before: pickTracked('EMPLOYEE', empBefore),
          after: pickTracked('EMPLOYEE', empAfter),
        });

        return { contract: next, violations: violations.filter((v) => v.level === 'WARN') };
      },
      { timeout: 15_000 },
    );
  }

  // ── Conversion CDD → CDI ──────────────────────────────────────────────────
  async convertToCdi(user: AuthUser, contractId: string, dto: ConvertToCdiDto, rc: RequestCtx) {
    const r = await this.convertTx(user, contractId, dto, rc);
    return { contract: await this.viewOne(r.contract) };
  }

  private async convertTx(user: AuthUser, contractId: string, dto: ConvertToCdiDto, rc: RequestCtx) {
    const probe = await this.prisma.employeeContract.findUnique({
      where: { id: contractId },
      select: { companyId: true, employeeId: true },
    });
    if (!probe) throw new NotFoundException('Contrat introuvable');
    await assertCompanyAccess(this.prisma, user.userId, probe.companyId, { write: true });
    const actor = await this.actorOf(user);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract-chain:' + probe.employeeId}))`;
        const { current } = await this.loadContext(tx, contractId);

        if (current.contractType !== 'CDD') {
          throw new UnprocessableEntityException({ error: 'NOT_CDD', message: 'Seul un CDD peut être converti en CDI.' });
        }
        if (!['ACTIVE', 'TRIAL'].includes(current.status)) {
          throw new UnprocessableEntityException({ error: 'NOT_CURRENT', message: 'Ce contrat n’est plus en cours.' });
        }
        const startDate = dto.startDate
          ? toUtcDate(dto.startDate)
          : current.endDate
            ? addDaysUtc(toUtcDate(current.endDate), 1)
            : toUtcDate(new Date());

        const now = new Date();
        const closed = await tx.employeeContract.update({
          where: { id: current.id },
          data: { status: 'CONVERTED', renewedAt: now, renewedBy: user.userId },
          select: CONTRACT_SELECT,
        });
        const next = await tx.employeeContract.create({
          data: {
            employeeId: current.employeeId,
            companyId: current.companyId,
            contractType: 'CDI',
            startDate,
            endDate: null,
            duration: null,
            renewalCount: current.renewalCount,
            position: dto.position ?? current.position,
            baseSalary: dto.baseSalary ?? current.baseSalary,
            departmentId: current.departmentId,
            status: 'ACTIVE',
            chainId: current.chainId,
            rank: current.rank + 1,
            kind: 'CONVERSION_CDI',
            previousContractId: current.id,
            renewalReason: dto.reason,
            signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
            notes: dto.notes ?? null,
            createdBy: user.userId,
          },
          select: CONTRACT_SELECT,
        });

        const empBefore = await tx.employee.findUniqueOrThrow({
          where: { id: current.employeeId },
          select: { contractType: true, contractEndDate: true, baseSalary: true, position: true },
        });
        const empAfter = await tx.employee.update({
          where: { id: current.employeeId },
          data: {
            contractType: 'CDI',
            contractEndDate: null,
            ...(dto.baseSalary !== undefined ? { baseSalary: dto.baseSalary } : {}),
            ...(dto.position ? { position: dto.position } : {}),
          },
          select: { contractType: true, contractEndDate: true, baseSalary: true, position: true },
        });

        const base = { companyId: current.companyId, actor, context: rc };
        await this.audit.record(tx, {
          ...base,
          action: 'CONTRACT_CONVERTED_CDI',
          entity: 'EMPLOYEE_CONTRACT',
          entityId: next.id,
          severity: 'WARN', // changement structurant → visible dans le tableau de bord
          summary: `CDD converti en CDI à compter du ${iso(startDate)} (rang ${current.rank} → ${next.rank})`,
          before: null,
          after: pickTracked('EMPLOYEE_CONTRACT', next),
        });
        await this.audit.record(tx, {
          ...base,
          action: 'CONTRACT_CLOSED_BY_CONVERSION',
          entity: 'EMPLOYEE_CONTRACT',
          entityId: current.id,
          summary: `Contrat clos : converti en CDI ${next.id}`,
          before: pickTracked('EMPLOYEE_CONTRACT', current),
          after: pickTracked('EMPLOYEE_CONTRACT', closed),
        });
        await this.audit.record(tx, {
          ...base,
          action: 'EMPLOYEE_SYNCED_BY_CONVERSION',
          entity: 'EMPLOYEE',
          entityId: current.employeeId,
          summary: 'Fiche employé mise à jour suite à la conversion en CDI',
          before: pickTracked('EMPLOYEE', empBefore),
          after: pickTracked('EMPLOYEE', empAfter),
        });
        return { contract: next };
      },
      { timeout: 15_000 },
    );
  }

  // ── Vue renvoyée au front : exactement les champs affichés, rien d'autre ───
  private async toViews(rows: Array<Prisma.EmployeeContractGetPayload<{ select: typeof CONTRACT_SELECT }>>): Promise<ContractLinkView[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.renewedBy, r.createdBy]).filter((x): x is string => !!x))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const name = new Map<string, string>(users.map((u: { id: string; firstName: string; lastName: string }) => [u.id, `${u.firstName} ${u.lastName}`] as [string, string]));
    return rows.map((r) => ({
      id: r.id,
      rank: r.rank,
      kind: r.kind,
      contractType: r.contractType,
      status: r.status,
      startDate: r.startDate,
      endDate: r.endDate,
      duration: r.duration,
      position: r.position,
      baseSalary: r.baseSalary.toString(),
      trialPeriodDays: r.trialPeriodDays,
      trialEndDate: r.trialEndDate,
      signedAt: r.signedAt,
      signedByEmp: r.signedByEmp,
      renewalCount: r.renewalCount,
      cddMotif: r.cddMotif,
      renewalReason: r.renewalReason,
      renewedAt: r.renewedAt,
      renewedByName: r.renewedBy ? (name.get(r.renewedBy) ?? null) : null,
      previousContractId: r.previousContractId,
      createdAt: r.createdAt,
      createdByName: r.createdBy ? (name.get(r.createdBy) ?? null) : null,
    }));
  }

  private async viewOne(row: Prisma.EmployeeContractGetPayload<{ select: typeof CONTRACT_SELECT }>) {
    return (await this.toViews([row]))[0];
  }

  // ── Interne ───────────────────────────────────────────────────────────────

  /** Charge le contrat + sa chaîne ; refuse tout ce qui n'est pas le DERNIER maillon. */
  private async loadContext(db: Db, contractId: string) {
    const contract = await db.employeeContract.findUnique({
      where: { id: contractId },
      select: { ...CONTRACT_SELECT, employee: { select: { companyId: true } } },
    });
    if (!contract) throw new NotFoundException('Contrat introuvable');
    // Défense en profondeur : contrat et employé doivent appartenir à la même entreprise.
    if (contract.employee.companyId !== contract.companyId) {
      throw new ForbiddenException('Données incohérentes : opération refusée.');
    }

    const rows = await db.employeeContract.findMany({
      where: { chainId: contract.chainId, companyId: contract.companyId },
      orderBy: { rank: 'asc' },
      select: CONTRACT_SELECT,
    });
    const last = rows[rows.length - 1];
    if (last.id !== contract.id) {
      throw new BadRequestException('Ce contrat a déjà été renouvelé ou converti : agissez sur le dernier contrat de la chaîne.');
    }
    const chain: ChainLink[] = rows.map((r) => ({
      rank: r.rank,
      kind: r.kind,
      contractType: r.contractType,
      startDate: toUtcDate(r.startDate),
      endDate: r.endDate ? toUtcDate(r.endDate) : null,
      cddMotif: r.cddMotif,
    }));
    return { current: contract, chain };
  }

  private proposedFrom(
    current: { endDate: Date | null; cddMotif: string | null },
    dto: RenewContractDto,
  ) {
    if (!dto.startDate && !current.endDate) {
      throw new BadRequestException('Le contrat actuel n’a pas de date de fin : précisez la date de début du renouvellement.');
    }
    const startDate = dto.startDate
      ? toUtcDate(dto.startDate)
      : addDaysUtc(toUtcDate(current.endDate as Date), 1);
    return {
      startDate,
      endDate: toUtcDate(dto.endDate),
      cddMotif: dto.cddMotif ?? current.cddMotif ?? null,
      signedAt: dto.signedAt ? toUtcDate(dto.signedAt) : null,
    };
  }

  /** Applique les violations : lève, ou renvoie true si un ADMIN a passé outre (avec motif). */
  private enforce(user: AuthUser, violations: RuleViolation[], overrideReason?: string): boolean {
    const blocking = violations.filter((v) => v.level === 'BLOCK');
    if (blocking.length === 0) return false;

    if (blocking.some((v) => !v.overridable)) {
      throw new UnprocessableEntityException({
        error: 'RENEWAL_REFUSED',
        message: 'Renouvellement refusé : limite légale non respectée.',
        violations,
      });
    }
    if (!overrideReason) {
      throw new UnprocessableEntityException({
        error: 'OVERRIDE_REQUIRED',
        message: 'Blocage de procédure : un administrateur peut le régulariser avec un motif écrit.',
        violations,
      });
    }
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Seul un administrateur peut passer outre ce blocage.');
    }
    return true;
  }

  private async actorOf(user: AuthUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { firstName: true, lastName: true },
    });
    return {
      id: user.userId,
      role: user.role,
      label: u ? `${u.firstName} ${u.lastName}` : null,
    };
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const approxMonths = (a: Date, b: Date) =>
  Math.max(1, Math.round((b.getTime() - a.getTime() + 86_400_000) / 86_400_000 / 30.4375));