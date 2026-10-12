// ============================================================================
// 📁 src/audit-engine/rules/payroll-rules.ts
// Contrôles PURS (aucun accès base de données) : un contexte entre, des écarts
// sortent. Testables sans serveur et rejouables à l'identique par la validation,
// le cron et le bouton manuel.
//
// Principe : on ne refait pas le calculateur ; on vérifie des INVARIANTS que le
// bulletin doit respecter (plafonds, taux, zone, cohérence). Quand le calcul
// exact est possible sans ambiguïté, on le fait ; sinon on borne.
// ============================================================================
import { tolAmountForZone } from '../../company-taxes/custom-tax.calculator';
import { ChainLink, evaluateChainCompliance } from '../../contract-chain/contract-chain.rules';
import {
  CNSS, FISCAL_PARTS, ROUNDING_TOLERANCE, SALARIED_PERMANENT, smigAt, TUS, VARIATION_THRESHOLD,
} from '../audit-params';
import { RULE_BY_CODE, Severity } from './rule-catalog';
import { CHECKPOINTS } from './checkpoints';

export interface PayrollItemLite {
  code: string | null;
  type: 'GAIN' | 'DEDUCTION' | 'EMPLOYER_COST' | 'INFO';
  amount: number;
  isCnss: boolean;
  isTaxable: boolean;
}

export interface PayrollLite {
  id: string;
  employeeId: string;
  month: number;
  year: number;
  periodStart: Date;
  periodEnd: Date;
  baseSalary: number;
  grossSalary: number;
  netSalary: number;
  totalDeductions: number;
  cnssSalarial: number;
  cnssEmployerPension: number;
  cnssEmployerFamily: number;
  cnssEmployerAccident: number;
  cnssEmployer: number;
  tusDgiAmount: number;
  tusCnssAmount: number;
  irppFiscalParts: number;
  its: number;
  items: PayrollItemLite[];
}

export interface EmployeeLite {
  id: string;
  firstName: string;
  lastName: string;
  contractType: string;
  tolZone: string | null;
  isSubjectToCnss: boolean;
  isSubjectToTus: boolean;
  isSubjectToIrpp: boolean;
  cnssNumber: string | null;
}

export interface ContractLite {
  id: string;
  chainId: string;
  rank: number;
  kind: 'INITIAL' | 'RENEWAL' | 'CONVERSION_CDI';
  contractType: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  cddMotif: string | null;
}

export interface PayrollCtx {
  payroll: PayrollLite;
  employee: EmployeeLite;
  company: { isSubjectToTus: boolean; appliesCnssEmployer: boolean };
  /** TOUS les contrats de l'employé. */
  contracts: ContractLite[];
  previousGross: number | null;
}

export interface RuleHit {
  ruleCode: string;
  /** Identité de l'écart (avec ruleCode → empreinte de dédoublonnage). */
  key: string;
  severity: Severity;
  blocking: boolean;
  entity: 'PAYROLL' | 'EMPLOYEE' | 'CONTRACT_CHAIN' | 'COMPANY';
  entityId: string | null;
  employeeId: string | null;
  /** true = écart propre à la période de la paie ; false = écart propre à l'employé. */
  periodScoped: boolean;
  message: string;
  expected?: string;
  actual?: string;
}

// ── utilitaires ─────────────────────────────────────────────────────────────
export const fcfa = (n: number) =>
  `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
const near = (a: number, b: number) => Math.abs(a - b) <= ROUNDING_TOLERANCE;
const name = (e: EmployeeLite) => `${e.firstName} ${e.lastName}`.trim();
const CURRENT = ['ACTIVE', 'TRIAL', 'SUSPENDED'];

function mk(
  ctx: PayrollCtx,
  ruleCode: string,
  p: { key?: string; message: string; expected?: string; actual?: string; severity?: Severity; blocking?: boolean;
       entity?: RuleHit['entity']; entityId?: string | null; periodScoped?: boolean },
): RuleHit {
  const def = RULE_BY_CODE[ruleCode];
  const entity = p.entity ?? 'PAYROLL';
  return {
    ruleCode,
    key: p.key ?? ctx.payroll.id,
    severity: p.severity ?? def.severity,
    blocking: p.blocking ?? def.blocking,
    entity,
    entityId: p.entityId !== undefined ? p.entityId : entity === 'PAYROLL' ? ctx.payroll.id : ctx.employee.id,
    employeeId: ctx.employee.id,
    periodScoped: p.periodScoped ?? entity === 'PAYROLL',
    message: `${name(ctx.employee)} — ${p.message}`.slice(0, 500),
    expected: p.expected?.slice(0, 200),
    actual: p.actual?.slice(0, 200),
  };
}

/** Le calcul exact n'est possible que si tous les gains entrent dans la base CNSS. */
const allGainsCnss = (p: PayrollLite) => p.items.filter((i) => i.type === 'GAIN').every((i) => i.isCnss);

// ── 1. Contrats ─────────────────────────────────────────────────────────────
export function ruleContractCoverage(c: PayrollCtx): RuleHit[] {
  const { periodStart, periodEnd } = c.payroll;
  const covered = c.contracts.some(
    (k) => k.startDate.getTime() <= periodEnd.getTime() && (!k.endDate || k.endDate.getTime() >= periodStart.getTime()),
  );
  return covered ? [] : [mk(c, 'CONTRACT_COVERAGE', {
    message: `aucun contrat ne couvre la période du ${periodStart.toISOString().slice(0, 10)} au ${periodEnd.toISOString().slice(0, 10)}.`,
    expected: 'Un contrat couvrant la période', actual: c.contracts.length ? 'Contrats hors période' : 'Aucun contrat enregistré',
  })];
}

function currentChain(c: PayrollCtx): ChainLink[] {
  const cur = [...c.contracts].filter((k) => CURRENT.includes(k.status)).sort((a, b) => b.rank - a.rank)[0];
  if (!cur) return [];
  return c.contracts
    .filter((k) => k.chainId === cur.chainId)
    .sort((a, b) => a.rank - b.rank)
    .map((k) => ({ rank: k.rank, kind: k.kind, contractType: k.contractType, startDate: k.startDate, endDate: k.endDate, cddMotif: k.cddMotif }));
}

export function ruleCddTermPassed(c: PayrollCtx): RuleHit[] {
  const chain = currentChain(c);
  const v = evaluateChainCompliance(chain, c.payroll.periodEnd).find((x) => x.code === 'TERM_PASSED');
  const last = chain[chain.length - 1];
  return v ? [mk(c, 'CDD_TERM_PASSED', {
    key: c.employee.id, entity: 'EMPLOYEE', periodScoped: false, message: v.message,
    expected: 'Renouvellement ou conversion enregistré', actual: `CDD échu le ${last?.endDate?.toISOString().slice(0, 10)}`,
  })] : [];
}

export function ruleCddLegalLimits(c: PayrollCtx): RuleHit[] {
  const chain = currentChain(c);
  if (chain.length === 0) return [];
  return evaluateChainCompliance(chain, c.payroll.periodEnd)
    .filter((v) => v.level === 'BLOCK' && v.code !== 'TERM_PASSED')
    .map((v) => mk(c, 'CDD_LEGAL_LIMITS', {
      key: `${c.employee.id}:${v.code}`, entity: 'EMPLOYEE', periodScoped: false,
      message: `${v.message}${v.legalRef ? ` (${v.legalRef})` : ''}`, actual: v.code,
    }));
}

// ── 2. Salaire ──────────────────────────────────────────────────────────────
export function ruleSmig(c: PayrollCtx): RuleHit[] {
  if (!SALARIED_PERMANENT.includes(c.employee.contractType)) return [];
  const smig = smigAt(c.payroll.periodEnd);
  return c.payroll.baseSalary < smig ? [mk(c, 'SMIG_MINIMUM', {
    message: `salaire de base de ${fcfa(c.payroll.baseSalary)}, inférieur au SMIG (${fcfa(smig)}).`,
    expected: `≥ ${fcfa(smig)}`, actual: fcfa(c.payroll.baseSalary),
  })] : [];
}

export function ruleNetCoherence(c: PayrollCtx): RuleHit[] {
  const p = c.payroll;
  const nonTaxableGains = p.items.filter((i) => i.type === 'GAIN' && i.isTaxable === false).reduce((s, i) => s + i.amount, 0);
  const expected = Math.floor(p.grossSalary - p.totalDeductions + nonTaxableGains);
  return near(p.netSalary, expected) ? [] : [mk(c, 'NET_COHERENCE', {
    message: `net à payer de ${fcfa(p.netSalary)} alors que brut − retenues + primes non imposables = ${fcfa(expected)}.`,
    expected: fcfa(expected), actual: fcfa(p.netSalary),
  })];
}

export function ruleSalaryVariation(c: PayrollCtx): RuleHit[] {
  const prev = c.previousGross;
  if (!prev || prev <= 0) return [];
  const delta = (c.payroll.grossSalary - prev) / prev;
  if (Math.abs(delta) <= VARIATION_THRESHOLD) return [];
  const pct = `${delta > 0 ? '+' : '−'}${Math.round(Math.abs(delta) * 100)} %`;
  return [mk(c, 'SALARY_VARIATION', {
    message: `brut de ${fcfa(c.payroll.grossSalary)} contre ${fcfa(prev)} le mois précédent (${pct}).`,
    expected: `Variation ≤ ${Math.round(VARIATION_THRESHOLD * 100)} %`, actual: pct,
  })];
}

// ── 3. CNSS ─────────────────────────────────────────────────────────────────
export function ruleCnssSalarial(c: PayrollCtx): RuleHit[] {
  const p = c.payroll;
  const permanent = SALARIED_PERMANENT.includes(c.employee.contractType);
  const subject = permanent && c.employee.isSubjectToCnss !== false;
  const cap = Math.round(CNSS.PENSION_CEILING * CNSS.SALARIAL_RATE);
  const hits: RuleHit[] = [];
  const add = (message: string, expected: string, actual: string) =>
    hits.push(mk(c, 'CNSS_SALARIAL', { message, expected, actual }));

  if (!subject) {
    if (p.cnssSalarial > 0) add(`CNSS salariale de ${fcfa(p.cnssSalarial)} retenue alors que l'employé n'y est pas soumis.`, '0 FCFA', fcfa(p.cnssSalarial));
    return hits;
  }
  if (p.grossSalary > 0 && p.cnssSalarial === 0) {
    add('CNSS salariale absente alors que l’employé y est soumis.', `${fcfa(Math.round(Math.min(p.grossSalary, CNSS.PENSION_CEILING) * CNSS.SALARIAL_RATE))} (au plus)`, '0 FCFA');
    return hits;
  }
  const upper = Math.round(Math.min(p.grossSalary, CNSS.PENSION_CEILING) * CNSS.SALARIAL_RATE);
  if (p.cnssSalarial > cap + ROUNDING_TOLERANCE) {
    add(`CNSS salariale de ${fcfa(p.cnssSalarial)} supérieure au maximum légal (${fcfa(cap)} : 4 % × plafond 1 200 000).`, `≤ ${fcfa(cap)}`, fcfa(p.cnssSalarial));
  } else if (allGainsCnss(p)) {
    if (!near(p.cnssSalarial, upper)) add(`CNSS salariale de ${fcfa(p.cnssSalarial)} au lieu de ${fcfa(upper)} (4 % du brut plafonné).`, fcfa(upper), fcfa(p.cnssSalarial));
  } else if (p.cnssSalarial > upper + ROUNDING_TOLERANCE) {
    add(`CNSS salariale de ${fcfa(p.cnssSalarial)} supérieure à 4 % du brut plafonné (${fcfa(upper)}).`, `≤ ${fcfa(upper)}`, fcfa(p.cnssSalarial));
  }
  return hits;
}

export function ruleCnssEmployer(c: PayrollCtx): RuleHit[] {
  const p = c.payroll;
  const type = c.employee.contractType;
  const hits: RuleHit[] = [];
  const add = (message: string, expected: string, actual: string) =>
    hits.push(mk(c, 'CNSS_EMPLOYER', { message, expected, actual }));

  const applies = c.company.appliesCnssEmployer !== false && (SALARIED_PERMANENT.includes(type) || type === 'STAGE');
  if (!applies) {
    if (p.cnssEmployer > 0) add(`CNSS patronale de ${fcfa(p.cnssEmployer)} alors qu'elle ne s'applique pas à ce contrat ou à cette entreprise.`, '0 FCFA', fcfa(p.cnssEmployer));
    return hits;
  }
  const intern = type === 'STAGE'; // stagiaire : accidents du travail uniquement
  const exact = allGainsCnss(p);
  const pensionBase = Math.min(p.grossSalary, CNSS.PENSION_CEILING);
  const socialBase = Math.min(p.grossSalary, CNSS.SOCIAL_CEILING);
  const branches = [
    { label: 'pension (8 %)', actual: p.cnssEmployerPension, exact: intern ? 0 : CNSS.EMPLOYER_PENSION_RATE * pensionBase, cap: intern ? 0 : CNSS.EMPLOYER_PENSION_RATE * CNSS.PENSION_CEILING },
    { label: 'prestations familiales (10,03 %)', actual: p.cnssEmployerFamily, exact: intern ? 0 : CNSS.EMPLOYER_FAMILY_RATE * socialBase, cap: intern ? 0 : CNSS.EMPLOYER_FAMILY_RATE * CNSS.SOCIAL_CEILING },
    { label: 'accidents du travail (2,25 %)', actual: p.cnssEmployerAccident, exact: CNSS.EMPLOYER_ACCIDENT_RATE * socialBase, cap: CNSS.EMPLOYER_ACCIDENT_RATE * CNSS.SOCIAL_CEILING },
  ];
  for (const br of branches) {
    const expected = Math.round(br.exact);
    const cap = Math.round(br.cap);
    if (br.actual > cap + ROUNDING_TOLERANCE) add(`CNSS patronale ${br.label} de ${fcfa(br.actual)} supérieure au maximum légal (${fcfa(cap)}).`, `≤ ${fcfa(cap)}`, fcfa(br.actual));
    else if (exact && !near(br.actual, expected)) add(`CNSS patronale ${br.label} de ${fcfa(br.actual)} au lieu de ${fcfa(expected)}.`, fcfa(expected), fcfa(br.actual));
    else if (!exact && br.actual > expected + ROUNDING_TOLERANCE) add(`CNSS patronale ${br.label} de ${fcfa(br.actual)} supérieure au calcul sur le brut plafonné (${fcfa(expected)}).`, `≤ ${fcfa(expected)}`, fcfa(br.actual));
  }
  const sum = p.cnssEmployerPension + p.cnssEmployerFamily + p.cnssEmployerAccident;
  if (Math.abs(sum - p.cnssEmployer) > 3 * ROUNDING_TOLERANCE) add(`total CNSS patronale de ${fcfa(p.cnssEmployer)} différent de la somme des 3 branches (${fcfa(sum)}).`, fcfa(sum), fcfa(p.cnssEmployer));
  return hits;
}

// ── 4. Fiscal ───────────────────────────────────────────────────────────────
export function ruleTus(c: PayrollCtx): RuleHit[] {
  const p = c.payroll;
  const applies = SALARIED_PERMANENT.includes(c.employee.contractType) && c.company.isSubjectToTus !== false && c.employee.isSubjectToTus !== false;
  const dgi = Math.round(p.grossSalary * TUS.DGI_RATE);
  const cnss = Math.round(p.grossSalary * TUS.CNSS_RATE);
  const hits: RuleHit[] = [];
  if (!applies) {
    if (p.tusDgiAmount + p.tusCnssAmount > 0) hits.push(mk(c, 'TUS_RATES', { message: `TUS de ${fcfa(p.tusDgiAmount + p.tusCnssAmount)} appliquée alors qu'elle ne s'applique pas.`, expected: '0 FCFA', actual: fcfa(p.tusDgiAmount + p.tusCnssAmount) }));
    return hits;
  }
  if (!near(p.tusDgiAmount, dgi)) hits.push(mk(c, 'TUS_RATES', { key: `${p.id}:dgi`, message: `TUS DGI de ${fcfa(p.tusDgiAmount)} au lieu de ${fcfa(dgi)} (2,025 % du brut).`, expected: fcfa(dgi), actual: fcfa(p.tusDgiAmount) }));
  if (!near(p.tusCnssAmount, cnss)) hits.push(mk(c, 'TUS_RATES', { key: `${p.id}:cnss`, message: `TUS CNSS de ${fcfa(p.tusCnssAmount)} au lieu de ${fcfa(cnss)} (5,475 % du brut).`, expected: fcfa(cnss), actual: fcfa(p.tusCnssAmount) }));
  return hits;
}

export function ruleTol(c: PayrollCtx): RuleHit[] {
  const due = SALARIED_PERMANENT.includes(c.employee.contractType);
  const zone = c.employee.tolZone === 'PERIPHERIE' ? 'périphérie' : 'ville';
  const actual = c.payroll.items.filter((i) => i.code === 'CTAX_TOL' && i.type === 'DEDUCTION').reduce((s, i) => s + i.amount, 0);
  if (!due) {
    return actual > 0 ? [mk(c, 'TOL_AMOUNT', {
      severity: 'WARN', blocking: false,
      message: `TOL de ${fcfa(actual)} retenue sur un contrat ${c.employee.contractType} (réservée aux CDI et CDD).`, expected: '0 FCFA', actual: fcfa(actual),
    })] : [];
  }
  const expected = tolAmountForZone(c.employee.tolZone);
  if (actual === 0) return [mk(c, 'TOL_AMOUNT', { message: `TOL absente du bulletin (zone ${zone} : ${fcfa(expected)}).`, expected: fcfa(expected), actual: '0 FCFA' })];
  return actual === expected ? [] : [mk(c, 'TOL_AMOUNT', {
    message: `TOL de ${fcfa(actual)} alors que la zone de l'employé (${zone}) appelle ${fcfa(expected)}. La zone a peut-être changé depuis la génération du bulletin : recalculez-le.`,
    expected: fcfa(expected), actual: fcfa(actual),
  })];
}

export function ruleFiscalParts(c: PayrollCtx): RuleHit[] {
  const p = c.payroll;
  if (c.employee.isSubjectToIrpp === false || !SALARIED_PERMANENT.includes(c.employee.contractType)) return [];
  const parts = Number(p.irppFiscalParts);
  return parts < FISCAL_PARTS.MIN || parts > FISCAL_PARTS.MAX ? [mk(c, 'FISCAL_PARTS_RANGE', {
    message: `${parts} part(s) fiscale(s) : le quotient familial doit être compris entre ${FISCAL_PARTS.MIN} et ${FISCAL_PARTS.MAX}.`,
    expected: `${FISCAL_PARTS.MIN} à ${FISCAL_PARTS.MAX}`, actual: String(parts),
  })] : [];
}

// ── 5. Dossier ──────────────────────────────────────────────────────────────
export function ruleCnssNumber(c: PayrollCtx): RuleHit[] {
  const subject = SALARIED_PERMANENT.includes(c.employee.contractType) && c.employee.isSubjectToCnss !== false;
  return subject && !c.employee.cnssNumber?.trim() ? [mk(c, 'CNSS_NUMBER_MISSING', {
    key: c.employee.id, entity: 'EMPLOYEE', periodScoped: false,
    message: "numéro d'affiliation CNSS non renseigné.", expected: "N° d'affiliation", actual: 'Vide',
  })] : [];
}

export const PAYROLL_RULES: Array<(c: PayrollCtx) => RuleHit[]> = [
  ruleContractCoverage, ruleCddTermPassed, ruleCddLegalLimits, ruleSmig, ruleNetCoherence, ruleSalaryVariation,
  ruleCnssSalarial, ruleCnssEmployer, ruleTus, ruleTol, ruleFiscalParts, ruleCnssNumber,
];

// ── 6. Points de contrôle humains (niveau entreprise) ───────────────────────
export function ruleCheckpoints(args: {
  companyId: string; month: number; year: number; headcount: number; today: Date; attested: ReadonlySet<string>;
}): RuleHit[] {
  const out: RuleHit[] = [];
  for (const cp of CHECKPOINTS) {
    const due = cp.dueDate(args.month, args.year, args.headcount);
    if (!due || args.attested.has(cp.code)) continue;
    const endOfDue = due.getTime() + 86_399_000;
    if (args.today.getTime() <= endOfDue) continue;
    const def = RULE_BY_CODE.CHECKPOINT_OVERDUE;
    const dueTxt = due.toISOString().slice(0, 10);
    out.push({
      ruleCode: 'CHECKPOINT_OVERDUE', key: `${cp.code}:${args.year}-${args.month}`,
      severity: def.severity, blocking: def.blocking, entity: 'COMPANY', entityId: args.companyId, employeeId: null, periodScoped: true,
      message: `${cp.label} — échéance du ${dueTxt} dépassée, aucune attestation.`,
      expected: `Attestation avec preuve (${cp.evidenceHint})`, actual: 'Non attesté',
    });
  }
  return out;
}