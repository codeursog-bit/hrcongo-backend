import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { congoDateString } from '../common/utils/congo-time';
import { normalizeHelp } from './help';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import {
  runAnalysisTool,
  type ToolIntent,
  type ToolCard,
} from './analysis-tools';
import { readOnlyClient } from './read-only-client';
import { buildRequestAdvice } from './request-advice';
import { buildFinanceAdvice } from './finance-advice';
import type { RequestKind } from './request-advisor';
export interface AnalysisCard {
  departments?: ToolCard['departments'];
  title: string;
  period: string;
  source: string;
  metrics: { label: string; value: number; unit?: string }[];
}
export interface AnalysisIntent {
  tool: 'headcount_summary';
  month: number;
  year: number;
}
export function analysisIntent(message: string): AnalysisIntent | null {
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{20,}/i.test(message)) return null;
  const q = normalizeHelp(message);
  if (
    /ignore|sql|autre entreprise|entreprise b/.test(q) ||
    !/(effectif|combien d employes|nombre d employes)/.test(q) ||
    /salaire|banque|cnss|net|brut/.test(q)
  )
    return null;
  const current = congoDateString(),
    nowYear = Number(current.slice(0, 4)),
    nowMonth = Number(current.slice(5, 7));
  let month = nowMonth,
    year = nowYear;
  const numeric = q.match(/\b(20\d{2}) (0?[1-9]|1[0-2])\b/);
  const months = [
    'janvier',
    'fevrier',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'aout',
    'septembre',
    'octobre',
    'novembre',
    'decembre',
  ];
  const named = months.findIndex((m) => new RegExp('\\b' + m + '\\b').test(q));
  const digits = q.match(/\b\d+\b/g) || [];
  if (
    (numeric && digits.length !== 2) ||
    (!numeric && named >= 0 && digits.length !== 1) ||
    (!numeric && named < 0 && digits.length > 0) ||
    months.filter((m) => new RegExp('\\b' + m + '\\b').test(q)).length > 1
  )
    return null;
  const words = new Set([
    'quel',
    'quelle',
    'quels',
    'quelles',
    'est',
    'l',
    'effectif',
    'effectifs',
    'ce',
    'mois',
    'ci',
    'le',
    'dernier',
    'precedent',
    'nombre',
    'd',
    'employes',
    'avons',
    'nous',
    'combien',
    'au',
    'total',
    'notre',
    'entreprise',
    'actuel',
    'actuelle',
    'en',
    'du',
    'pour',
    'de',
    'la',
    'les',
    'des',
    'donne',
    'moi',
    'montre',
    'affiche',
    'afficher',
    'peux',
    'tu',
    ...months,
  ]);
  if (
    q
      .split(' ')
      .some(
        (token) =>
          !words.has(token) &&
          !/^20\d{2}$/.test(token) &&
          !/^\d{1,2}$/.test(token),
      )
  )
    return null;
  if (!numeric && named < 0 && /\b20\d{2}\b/.test(q)) return null;
  if (numeric) {
    year = Number(numeric[1]);
    month = Number(numeric[2]);
  } else if (named >= 0) {
    const specified = q.match(/\b20\d{2}\b/);
    if (!specified) return null;
    year = Number(specified[0]);
    month = named + 1;
  } else if (/mois dernier|mois precedent/.test(q)) {
    month--;
    if (!month) {
      month = 12;
      year--;
    }
  }
  if (year < 2020 || year > nowYear || (year === nowYear && month > nowMonth))
    return null;
  return { tool: 'headcount_summary', month, year };
}
@Injectable()
export class AssistantAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}
  async execute(
    userId: string,
    companyId: string,
    intent: ToolIntent,
  ): Promise<ToolCard | null> {
    const current = congoDateString();
    const future =
      intent.year > Number(current.slice(0, 4)) ||
      (intent.year === Number(current.slice(0, 4)) &&
        intent.month > Number(current.slice(5, 7)));
    if (
      intent.year > Number(current.slice(0, 4)) + 1 ||
      (!['leave_departures', 'leave_returns', 'leave_allowance', 'leave_planning'].includes(
        intent.tool,
      ) &&
        future)
    )
      return null;
    const needsEmployee = [
      'explain_employee_pay',
      'leave_allowance',
      'leave_balance',
      'leave_request_advice',
      'absence_request_advice',
      'permission_request_advice',
      'loan_request_advice',
      'advance_request_advice',
    ].includes(intent.tool);
    if (
      (needsEmployee && !intent.employeeId) ||
      (!needsEmployee && intent.employeeId) ||
      (intent.tool !== 'leave_allowance' && intent.days !== undefined)
    )
      return null;
    if (intent.tool === 'headcount_summary')
      return this.headcount(userId, companyId, intent as AnalysisIntent);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            isActive: true,
            role: true,
            companyId: true,
            manageMultipleCompanies: true,
          },
        });
        if (
          !user?.isActive ||
          !['ADMIN', 'HR_MANAGER'].includes(user.role) ||
          (await resolveVerifiedCompanyId(tx as any, user, companyId)) !==
            companyId
        )
          return null;
        const guarded = readOnlyClient(tx);
        const result = await runAnalysisTool(guarded.client, companyId, intent);
        if (guarded.attempted()) return null;
        if (
          !result ||
          result.metrics.some((m) => !Number.isFinite(m.value)) ||
          result.rows?.some(
            (r) => r.value !== undefined && !Number.isFinite(r.value),
          )
        )
          return null;
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
        maxWait: 3000,
      },
    );
  }
  /**
   * Accès commun aux conseils (écrans de validation / de création) : aucun modèle d'IA, aucun
   * crédit, transaction en lecture seule. Réservé ADMIN / RH de l'entreprise vérifiée.
   */
  private async withAdviceAccess<T>(
    userId: string,
    companyId: string,
    run: (client: any) => Promise<T | null>,
  ): Promise<T | null> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            isActive: true,
            role: true,
            companyId: true,
            manageMultipleCompanies: true,
          },
        });
        if (
          !user?.isActive ||
          !['ADMIN', 'HR_MANAGER'].includes(user.role) ||
          (await resolveVerifiedCompanyId(tx as any, user, companyId)) !==
            companyId
        )
          return null;
        const guarded = readOnlyClient(tx);
        const card = await run(guarded.client);
        return guarded.attempted() ? null : card;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
        maxWait: 3000,
      },
    );
  }

  /** Conseil pour une demande précise en attente (congé, absence, permission, prêt ou avance). */
  async adviceForRequest(
    userId: string,
    companyId: string,
    kind: RequestKind | 'LOAN' | 'ADVANCE',
    requestId: string,
  ) {
    return this.withAdviceAccess(userId, companyId, async (client) => {
      const select = { employeeId: true } as const;
      if (kind === 'LOAN' || kind === 'ADVANCE') {
        // Prêts et avances n'ont pas de companyId : l'appartenance passe par l'employé.
        const where = { id: requestId, employee: { companyId } };
        const found =
          kind === 'LOAN'
            ? await client.loan.findFirst({ where, select })
            : await client.advance.findFirst({ where, select });
        if (!found) return null;
        return buildFinanceAdvice(client, companyId, {
          kind,
          employeeId: found.employeeId,
          requestId,
        });
      }
      const where = { id: requestId, companyId };
      const found =
        kind === 'LEAVE'
          ? await client.leave.findFirst({ where, select })
          : kind === 'ABSENCE'
            ? await client.absenceRequest.findFirst({ where, select })
            : await client.permissionTicket.findFirst({ where, select });
      if (!found) return null;
      return buildRequestAdvice(client, companyId, {
        kind,
        employeeId: found.employeeId,
        requestId,
      });
    });
  }

  /** Simulation avant enregistrement (formulaire de création d'un prêt ou d'une avance). */
  async adviceSimulation(
    userId: string,
    companyId: string,
    kind: 'LOAN' | 'ADVANCE',
    sim: {
      employeeId: string;
      amount: number;
      monthlyRepayment?: number;
      durationMonths?: number;
      deductMonthsAhead?: number;
    },
  ) {
    return this.withAdviceAccess(userId, companyId, (client) =>
      buildFinanceAdvice(client, companyId, {
        kind,
        employeeId: sim.employeeId,
        simulation: {
          amount: sim.amount,
          monthlyRepayment: sim.monthlyRepayment,
          durationMonths: sim.durationMonths,
          deductMonthsAhead: sim.deductMonthsAhead,
        },
      }),
    );
  }
  /** A dedicated read-only connection is enforced even if an existing report gains side effects later. */
  async headcount(
    userId: string,
    companyId: string,
    intent: AnalysisIntent,
  ): Promise<AnalysisCard | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          isActive: true,
          role: true,
          companyId: true,
          manageMultipleCompanies: true,
        },
      });
      if (
        !user?.isActive ||
        !['ADMIN', 'HR_MANAGER'].includes(user.role) ||
        (await resolveVerifiedCompanyId(tx as any, user, companyId)) !==
          companyId
      )
        return null;
      // Reuse the exact reporting engine with its Prisma dependency bound to this read-only transaction.
      const reports = Object.create(this.reports) as ReportsService;
      Object.defineProperty(reports, 'prisma', { value: tx });
      Object.defineProperty(reports, 'resolveCompanyId', {
        value: async (id: string, target: string) =>
          id === userId && target === companyId ? companyId : null,
      });
      const result = await reports.getWorkforceMovement(
        userId,
        companyId,
        'MOIS',
        intent.month,
        intent.year,
      );
      if (!result || !Object.values(result.totals).every(Number.isFinite))
        return null;
      return {
        title: 'Mouvements des effectifs',
        period: result.periodLabel,
        source: 'reports.getWorkforceMovement',
        departments: result.departments,
        metrics: [
          { label: 'Effectif initial', value: result.totals.initial },
          { label: 'Entrées', value: result.totals.hires },
          { label: 'Sorties', value: result.totals.departures },
          { label: 'Effectif en fin de période', value: result.totals.final },
        ],
      };
    });
  }
}