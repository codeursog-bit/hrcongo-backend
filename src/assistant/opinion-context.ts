/**
 * Avis du circuit de validation (comptable, RH, DG, supérieur hiérarchique, chef d'équipe) intégrés
 * au conseil de l'assistant, quand le circuit d'avis est activé pour ce type de demande.
 *
 * Lecture seule. Le modèle d'IA ne reçoit que des codes et des nombres : les fonctions concernées
 * sont indiquées par la PRÉSENCE d'une clé (dg, hr, accountant, hierarchy, teamLead), jamais par un
 * nom de personne, un commentaire ou un libellé saisi par l'entreprise.
 */
import { Prisma } from '@prisma/client';
import { approvalFunctionLabel } from '../approvals/approvals.constants';
import type { Severity, Verdict } from './request-advisor';

type Tx = Prisma.TransactionClient;
export type OpinionRequestType = 'LOAN' | 'ADVANCE' | 'ABSENCE' | 'LEAVE';

export interface OpinionFinding {
  code: 'OPINIONS_FAVORABLE' | 'OPINIONS_UNFAVORABLE' | 'OPINIONS_PENDING';
  severity: Severity;
  values: Record<string, number>;
}

/** Code de fonction (base) → clé de valeur lisible par le modèle. */
const FLAG: Record<string, string> = {
  ACCOUNTANT: 'accountant',
  HR: 'hr',
  DG: 'dg',
  HIERARCHY_HEAD: 'hierarchy',
  TEAM_LEAD: 'teamLead',
};
const FLAG_TO_CODE = Object.fromEntries(Object.entries(FLAG).map(([c, k]) => [k, c]));

const group = (
  code: OpinionFinding['code'],
  severity: Severity,
  codes: string[],
): OpinionFinding | null => {
  const flags = codes.filter((c) => FLAG[c]);
  if (!flags.length) return null;
  const values: Record<string, number> = { count: flags.length };
  for (const c of flags) values[FLAG[c]] = 1;
  return { code, severity, values };
};

/** Pure : transforme circuit + avis reçus en constats (testable sans base). */
export function buildOpinionFindings(
  circuitSteps: string[] | null,
  opinions: { functionCode: string; opinion: string }[],
): OpinionFinding[] {
  const favorable = opinions.filter((o) => o.opinion === 'FAVORABLE').map((o) => o.functionCode);
  const unfavorable = opinions.filter((o) => o.opinion === 'UNFAVORABLE').map((o) => o.functionCode);
  const given = new Set(opinions.map((o) => o.functionCode));
  const missing = (circuitSteps ?? []).filter((c) => !given.has(c));
  return [
    group('OPINIONS_UNFAVORABLE', 'warn', unfavorable),
    group('OPINIONS_PENDING', 'warn', missing),
    group('OPINIONS_FAVORABLE', 'info', favorable),
  ].filter((x): x is OpinionFinding => !!x);
}

export async function loadOpinionFindings(
  tx: Tx,
  companyId: string,
  requestType: OpinionRequestType,
  requestId: string | undefined,
): Promise<OpinionFinding[]> {
  if (!requestId) return [];
  const [circuit, opinions] = await Promise.all([
    tx.approvalCircuit.findFirst({
      where: { companyId, requestType, isActive: true },
      select: { steps: { select: { functionCode: true }, orderBy: { position: 'asc' } } },
    }),
    tx.approvalOpinion.findMany({
      where: { companyId, requestType, requestId },
      select: { functionCode: true, opinion: true },
      take: 20,
    }),
  ]);
  return buildOpinionFindings(circuit ? circuit.steps.map((s) => s.functionCode) : null, opinions);
}

/** Phrase locale (français) : liste les fonctions concernées, sans nom de personne. */
export function opinionFindingText(f: { code: string; values: Record<string, number> }): string | null {
  const names = Object.keys(f.values)
    .filter((k) => FLAG_TO_CODE[k])
    .map((k) => approvalFunctionLabel(FLAG_TO_CODE[k]));
  const list = names.join(', ');
  switch (f.code) {
    case 'OPINIONS_UNFAVORABLE':
      return `Avis défavorable déjà donné par : ${list}.`;
    case 'OPINIONS_PENDING':
      return `Avis encore attendu de : ${list}. Il peut être préférable d’attendre ${f.values.count > 1 ? 'ces avis' : 'cet avis'} avant de décider.`;
    case 'OPINIONS_FAVORABLE':
      return `Avis favorable déjà donné par : ${list}.`;
    default:
      return null;
  }
}

/**
 * Ajoute les avis du circuit au conseil : un avis défavorable ou manquant empêche un « favorable »
 * franc (il devient « réservé »). Un motif urgent ou un droit reste prioritaire.
 */
export function withOpinions<
  F extends { code: string; severity: Severity; values: Record<string, number> },
>(
  verdict: Verdict,
  findings: F[],
  extra: OpinionFinding[],
  clearCode: string,
): { verdict: Verdict; findings: (F | OpinionFinding)[] } {
  if (!extra.length) return { verdict, findings };
  const warn = extra.some((e) => e.severity === 'warn');
  const next: Verdict = verdict === 'FAVORABLE' && warn ? 'RESERVE' : verdict;
  return {
    verdict: next,
    findings: [...findings.filter((f) => !(warn && f.code === clearCode)), ...extra],
  };
}