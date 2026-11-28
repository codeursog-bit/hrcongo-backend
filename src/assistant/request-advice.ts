/**
 * Lecture des données (lecture seule) et construction de la carte de conseil.
 *
 * Reçoit un client Prisma déjà protégé (transaction READ ONLY + readOnlyClient) : aucune écriture
 * possible. Le verdict vient de `adviseRequest` (règles pures), jamais du modèle d'IA.
 * Le texte local des constats (notes de la carte) permet de comprendre le conseil sans modèle.
 */
import { Prisma } from '@prisma/client';
import { LeavesBalanceService } from '../leaves/leaves-balance.service';
import { LeavesIndemnityService } from '../leaves/leaves-indemnity.service';
import { getCompanyWorkDays } from '../common/working-days.util';
import {
  adviseRequest,
  type AdvisorContext,
  type AdvisorRequest,
  type AdvisorResult,
  type Finding,
  type RequestKind,
} from './request-advisor';
import { loadOpinionFindings, opinionFindingText, withOpinions } from './opinion-context';

export interface AdviceCard {
  kind: RequestKind | 'LOAN' | 'ADVANCE';
  verdict: AdvisorResult['verdict'];
  findings: { code: string; severity: Finding['severity']; values: Record<string, number> }[];
  alternative: { start: string; end: string } | null;
}

const DAY = 86400000;
const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fr = (d: Date) => iso(d).split('-').reverse().join('/');
const n = (v: unknown) => Number(v ?? 0);

const LEGAL_LEAVES = ['SICK', 'MATERNITY', 'PATERNITY'];
const LEGAL_ABSENCE_SUBTYPES = [
  'MALADIE',
  'MATERNITE',
  'PATERNITE',
  'MARIAGE',
  'DECES',
  'NAISSANCE',
  'RETRAIT_DEUIL',
];

/** Phrase locale (français) d'un constat : lisible sans modèle, utilisée dans les notes de la carte. */
export function findingText(f: Finding): string {
  const v = f.values;
  switch (f.code) {
    case 'URGENT_REASON':
      return 'Motif urgent : la demande ne devrait pas être repoussée.';
    case 'LEGAL_RIGHT':
      return 'Motif lié à un droit (maladie, maternité, paternité, événement familial) : à ne pas repousser.';
    case 'SOLE_MEMBER':
      return 'Le demandeur est seul dans son département : personne ne le remplace sur la période.';
    case 'TEAM_COVERAGE':
      return `${v.absent} collègue(s) du département (${v.size} personnes) sont déjà absents sur la période ; le seuil retenu est de ${v.cap} absent(s) en même temps.`;
    case 'PENDING_OVERLAP':
      return `${v.count} autre(s) demande(s) du département en attente se chevauchent avec cette période.`;
    case 'BALANCE_LOW':
      return `${v.requested} jour(s) demandés pour un solde de ${v.remaining} jour(s) : le congé annuel dépasse le solde (congé anticipé à envisager).`;
    case 'RECENT_RETURN':
      return `Retour de congé il y a ${v.daysSince} jour(s) seulement.`;
    case 'FREQUENT_ABSENCES':
      return `${v.requests} demande(s) d'absence approuvée(s) sur ${v.windowDays} jours, pour ${v.days} jour(s) au total.`;
    case 'UNJUSTIFIED_ABSENCES':
      return `${v.days} jour(s) d'absence non justifiée sur ${v.windowDays} jours.`;
    case 'FREQUENT_PERMISSIONS':
      return `${v.count} permission(s) de sortie approuvée(s) sur ${v.windowDays} jours.`;
    case 'LONG_PERMISSION':
      return `Sortie de ${v.hours} h, au-delà de ${v.limit} h.`;
    case 'CLEAR_PERIOD':
      return `Aucune tension sur la période : le département (${v.size} personnes) reste couvert.`;
  }
}

export const VERDICT_TEXT: Record<AdvisorResult['verdict'], string> = {
  FAVORABLE: 'Avis favorable',
  RESERVE: 'Avis réservé : points d’attention',
  DEFER: 'Avis : à repousser',
  URGENT: 'Motif urgent ou droit : à traiter en priorité',
};

type Tx = Prisma.TransactionClient;

async function balanceRemaining(tx: Tx, employeeId: string): Promise<number | null> {
  try {
    const indemnity = new LeavesIndemnityService(tx as any);
    Object.defineProperty(indemnity, 'logger', { value: quiet });
    const svc = new LeavesBalanceService(
      tx as any,
      new Proxy(
        {},
        {
          get: () => () => {
            throw Error('Side effect forbidden');
          },
        },
      ) as any,
      indemnity,
    );
    Object.defineProperty(svc, 'logger', { value: quiet });
    if (!(await svc.getLeaveEligibility(employeeId)).eligible) return null;
    const r = await svc.getTotalLeaveBalanceSummary(employeeId);
    const rem = Number(r.annualRemaining);
    return Number.isFinite(rem) ? rem : null;
  } catch {
    return null;
  }
}

export interface AdviceTarget {
  kind: RequestKind;
  employeeId: string;
  /** Sans identifiant : dernière demande EN ATTENTE de cet employé pour ce type. */
  requestId?: string;
}

/**
 * Retourne la carte de conseil, ou null si la demande est introuvable, n'est plus en attente
 * ou n'appartient pas à l'entreprise.
 */
export async function buildRequestAdvice(
  tx: Tx,
  companyId: string,
  t: AdviceTarget,
  now = new Date(),
) {
  const employee = await tx.employee.findFirst({
    where: { id: t.employeeId, companyId },
    select: { id: true, departmentId: true },
  });
  if (!employee) return null;

  // ---- La demande -----------------------------------------------------------------------------
  let req: AdvisorRequest;
  let requestId: string;
  let path: string;
  let title: string;
  const where = {
    companyId,
    employeeId: t.employeeId,
    status: 'PENDING' as const,
    ...(t.requestId ? { id: t.requestId } : {}),
  };
  if (t.kind === 'LEAVE') {
    const l = await tx.leave.findFirst({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, type: true, startDate: true, endDate: true, daysCount: true },
    });
    if (!l) return null;
    requestId = l.id;
    path = '/conges/' + l.id;
    title = 'Conseil sur la demande de congé';
    req = {
      kind: 'LEAVE',
      start: l.startDate,
      end: l.endDate,
      days: n(l.daysCount),
      leaveType: l.type,
      legalRight: LEGAL_LEAVES.includes(l.type),
    };
  } else if (t.kind === 'ABSENCE') {
    const a = await tx.absenceRequest.findFirst({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, type: true, subType: true, startDate: true, endDate: true, workingDays: true },
    });
    if (!a) return null;
    requestId = a.id;
    path = '/presences/absences';
    title = 'Conseil sur la demande d’absence';
    req = {
      kind: 'ABSENCE',
      start: a.startDate,
      end: a.endDate,
      days: n(a.workingDays),
      urgent: a.type === 'MALADIE',
      legalRight: !!a.subType && LEGAL_ABSENCE_SUBTYPES.includes(a.subType),
    };
  } else {
    const p = await tx.permissionTicket.findFirst({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, type: true, departureTime: true, expectedReturnTime: true },
    });
    if (!p) return null;
    requestId = p.id;
    path = '/presences/permissions/validations';
    title = 'Conseil sur la permission de sortie';
    req = {
      kind: 'PERMISSION',
      start: p.departureTime,
      end: p.expectedReturnTime,
      days: 0,
      urgent: p.type === 'URGENCE',
    };
  }

  // ---- Contexte du département ----------------------------------------------------------------
  const peers = {
    companyId,
    employee: {
      companyId,
      departmentId: employee.departmentId,
      id: { not: employee.id },
    },
  };
  const dayStart = new Date(req.start.getTime() - (req.start.getTime() % DAY));
  const dayEnd = new Date(req.end.getTime() - (req.end.getTime() % DAY));
  const since90 = new Date(now.getTime() - 90 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const months: { month: number; year: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    months.push({ month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
  }

  const [
    deptSize,
    peerLeaves,
    peerAbsences,
    pendingLeaves,
    pendingAbsences,
    peerPermissions,
    lastLeave,
    absenceHistory,
    unjustified,
    permissions30d,
    workDays,
    holidays,
    remaining,
  ] = await Promise.all([
    tx.employee.count({
      where: { companyId, departmentId: employee.departmentId, status: 'ACTIVE' },
    }),
    tx.leave.findMany({
      where: { ...peers, status: 'APPROVED', startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
      select: { startDate: true, endDate: true },
      take: 200,
    }),
    tx.absenceRequest.findMany({
      where: { ...peers, status: 'APPROVED', startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
      select: { startDate: true, endDate: true },
      take: 200,
    }),
    tx.leave.count({
      where: {
        ...peers,
        status: 'PENDING',
        id: { not: requestId },
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
    }),
    tx.absenceRequest.count({
      where: {
        ...peers,
        status: 'PENDING',
        id: { not: requestId },
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
    }),
    t.kind === 'PERMISSION'
      ? tx.permissionTicket.findMany({
          where: {
            ...peers,
            status: 'APPROVED',
            departureTime: { lt: req.end },
            expectedReturnTime: { gt: req.start },
          },
          select: { departureTime: true, expectedReturnTime: true },
          take: 100,
        })
      : Promise.resolve([] as { departureTime: Date; expectedReturnTime: Date }[]),
    t.kind === 'LEAVE'
      ? tx.leave.findFirst({
          where: {
            companyId,
            employeeId: employee.id,
            status: 'APPROVED',
            endDate: { lt: req.start },
          },
          orderBy: { endDate: 'desc' },
          select: { endDate: true },
        })
      : Promise.resolve(null),
    tx.absenceRequest.aggregate({
      where: {
        companyId,
        employeeId: employee.id,
        status: 'APPROVED',
        startDate: { gte: since90 },
        id: { not: requestId },
      },
      _count: { id: true },
      _sum: { workingDays: true },
    }),
    tx.attendanceSummary.aggregate({
      where: {
        employeeId: employee.id,
        OR: months,
      },
      _sum: { daysAbsentUnpaid: true },
    }),
    tx.permissionTicket.count({
      where: {
        companyId,
        employeeId: employee.id,
        status: 'APPROVED',
        departureTime: { gte: since30 },
        id: { not: requestId },
      },
    }),
    getCompanyWorkDays(tx as any, companyId),
    tx.publicHoliday.findMany({
      where: { companyId, year: { in: [req.start.getUTCFullYear(), req.start.getUTCFullYear() + 1] } },
      select: { date: true },
    }),
    t.kind === 'LEAVE' ? balanceRemaining(tx, employee.id) : Promise.resolve(null),
  ]);

  const worked = new Set<number>(workDays);
  const holidaySet = new Set(holidays.map((h) => String(h.date)));
  const ctx: AdvisorContext = {
    deptSize,
    colleagueAbsences: [...peerLeaves, ...peerAbsences].map((x) => ({
      start: x.startDate,
      end: x.endDate,
    })),
    pendingOverlaps: pendingLeaves + pendingAbsences,
    colleaguePermissions: peerPermissions.map((p) => ({
      start: p.departureTime,
      end: p.expectedReturnTime,
    })),
    balanceRemaining: remaining,
    daysSinceLastReturn: lastLeave
      ? Math.floor((req.start.getTime() - (lastLeave.endDate.getTime() + DAY)) / DAY)
      : null,
    history: {
      absenceRequests90d: absenceHistory._count.id,
      absenceDays90d: n(absenceHistory._sum.workingDays),
      unjustifiedDays90d: n(unjustified._sum.daysAbsentUnpaid),
      permissions30d,
    },
    isWorkingDay: (d: Date) => worked.has(d.getUTCDay()) && !holidaySet.has(iso(d)),
  };

  const result = adviseRequest(req, ctx);
  // Avis du circuit de validation (comptable, RH, DG…) : pas de circuit pour les permissions de sortie.
  const opinions =
    t.kind === 'PERMISSION' ? [] : await loadOpinionFindings(tx, companyId, t.kind, requestId);
  const merged = withOpinions(result.verdict, result.findings, opinions, 'CLEAR_PERIOD');
  const advice: AdviceCard = {
    kind: t.kind,
    verdict: merged.verdict,
    findings: merged.findings,
    alternative: result.alternative
      ? { start: iso(result.alternative.start), end: iso(result.alternative.end) }
      : null,
  };

  const notes = [
    VERDICT_TEXT[merged.verdict] + '.',
    ...merged.findings
      .map((f) => (f.code.startsWith('OPINIONS_') ? opinionFindingText(f) : findingText(f as Finding)))
      .filter((x): x is string => !!x),
  ];
  if (result.alternative)
    notes.push(
      `Période alternative sans surcharge : du ${fr(result.alternative.start)} au ${fr(result.alternative.end)}.`,
    );
  notes.push(
    'Avis indicatif calculé à partir des congés, absences et permissions déjà approuvés. La décision reste à l’administrateur.',
  );

  const period =
    t.kind === 'PERMISSION'
      ? fr(req.start)
      : `${fr(req.start)} au ${fr(req.end)}`;

  return {
    title,
    period,
    source: 'requestAdvice.' + t.kind.toLowerCase(),
    path,
    notes,
    advice,
    metrics: [
      { label: 'Effectif du département', value: deptSize, unit: 'personnes' },
      { label: 'Plafond d’absents simultanés', value: result.cap, unit: 'personnes' },
    ],
    rows: [
      {
        employeeId: employee.id,
        label: 'Employé 1',
        path: '/employes/' + employee.id,
      },
    ],
    requestId,
  };
}