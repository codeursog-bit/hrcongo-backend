/**
 * Contrat de conversation (lot 2 du chantier C2).
 *
 * Le modèle externe ne fait que PROPOSER un « plan » JSON. Ce module, local et
 * sans accès base ni réseau, décide si ce plan est acceptable :
 *   - seul un outil de la liste fermée est accepté ; toute clé inconnue est rejetée
 *     (en particulier toute tentative de fournir une entreprise, du SQL, etc.) ;
 *   - l'employé doit être un repère E<n> connu de la conversation, jamais un nom ni un id ;
 *   - un nombre (jours) doit être un marqueur [[N<n>]] issu de la question de la personne ;
 *   - la période doit être justifiée par le texte pseudonymisé réellement envoyé
 *     (ou reprise du contexte pour un suivi) : jamais devinée ;
 *   - si une information manque, on renvoie une demande de précision FIXE, locale.
 * L'entreprise ne figure nulle part ici : elle vient de l'identité vérifiée côté serveur.
 */
import type { AnalysisTool, ToolIntent } from './analysis-tools';
import { resolveMarker, type Bindings } from './pseudonymizer';

export const PLAN_TOOLS = [
  'headcount_summary',
  'explain_payroll_variation',
  'top_paid_employees',
  'explain_employee_pay',
  'permissions_ranking',
  'leave_departures',
  'leave_returns',
  'leave_allowance',
  'leave_balance',
  'attendance_summary',
  'absences_ranking',
  'lateness_ranking',
  'leave_planning',
  'leave_request_advice',
  'absence_request_advice',
  'permission_request_advice',
  'loan_request_advice',
  'advance_request_advice',
] as const;
// Échec de compilation si un outil est ajouté à ANALYSIS_TOOLS sans être décrit ici.
type MissingTools = Exclude<AnalysisTool, (typeof PLAN_TOOLS)[number]>;
const _allToolsCovered: [MissingTools] extends [never] ? true : never = true;
void _allToolsCovered;

/** Un tour = au plus un appel d'outil ; une conversation ne peut pas boucler sur le modèle. */
export const MAX_TOOL_CALLS_PER_TURN = 1;
export const MAX_MODEL_ROUNDS_PER_TURN = 2;

const NEEDS: Record<
  AnalysisTool,
  { employee: boolean; days: boolean; period: boolean }
> = {
  headcount_summary: { employee: false, days: false, period: true },
  explain_payroll_variation: { employee: false, days: false, period: true },
  top_paid_employees: { employee: false, days: false, period: true },
  explain_employee_pay: { employee: true, days: false, period: true },
  permissions_ranking: { employee: false, days: false, period: true },
  leave_departures: { employee: false, days: false, period: true },
  leave_returns: { employee: false, days: false, period: true },
  leave_allowance: { employee: true, days: true, period: true },
  leave_balance: { employee: true, days: false, period: false },
  attendance_summary: { employee: false, days: false, period: true },
  absences_ranking: { employee: false, days: false, period: true },
  lateness_ranking: { employee: false, days: false, period: true },
  leave_planning: { employee: false, days: false, period: true },
  leave_request_advice: { employee: true, days: false, period: false },
  absence_request_advice: { employee: true, days: false, period: false },
  permission_request_advice: { employee: true, days: false, period: false },
  loan_request_advice: { employee: true, days: false, period: false },
  advance_request_advice: { employee: true, days: false, period: false },
};

export interface RawPlan {
  action: 'call_tool' | 'clarify' | 'help' | 'refuse';
  tool?: string;
  period?: { kind: 'current' | 'previous' | 'month'; month?: number; year?: number };
  employee?: string;
  days?: string;
  ask?: 'period' | 'employee' | 'days';
}
const PLAN_KEYS = new Set(['action', 'tool', 'period', 'employee', 'days', 'ask']);
const PERIOD_KEYS = new Set(['kind', 'month', 'year']);

/** Mémoire de conversation conservée côté serveur (identifiants internes, jamais de noms). */
export interface ConversationContext {
  tool?: AnalysisTool;
  month?: number;
  year?: number;
  employeeIds: string[];
}
export const EMPTY_CONTEXT: ConversationContext = { employeeIds: [] };

export type ClarifyKind = 'period' | 'employee' | 'days';
export const CLARIFY_TEXT: Record<ClarifyKind, string> = {
  period:
    'Pour quelle période ? Précisez par exemple « ce mois-ci », « le mois dernier » ou « mars 2026 ».',
  employee:
    'De quel employé parlez-vous ? Indiquez son nom, ou choisissez-le dans la recherche.',
  days: 'Pour combien de jours ? Indiquez un nombre entre 0,5 et 366.',
};
export type PlanResult =
  | { kind: 'intent'; intent: ToolIntent }
  | { kind: 'clarify'; ask: ClarifyKind; text: string }
  | { kind: 'help' }
  | { kind: 'refuse'; reason: 'invalid_plan' | 'unknown_tool' | 'model_refusal' | 'invented_period' };

export interface PlanEnv {
  /** Texte pseudonymisé réellement envoyé au modèle pour ce tour. */
  outbound: string;
  bindings: Bindings;
  context: ConversationContext;
  now: { month: number; year: number };
}

const MONTH_NAMES = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
];
const FOLLOW_UP =
  /^et\b|\b(cet ecart|cette difference|cette variation|meme mois|meme periode|lui|elle)\b/;
const CURRENT_EVIDENCE = /\b(ce mois|mois courant|actuel|actuelle|actuellement|aujourd hui)\b/;
const PREVIOUS_EVIDENCE = /\b(mois dernier|mois precedent|precedent|precedente|dernier|derniere)\b/;
const PRONOUN = /\b(lui|elle|meme)\b/;

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const shift = (m: number, y: number, by: number) => {
  const t = y * 12 + (m - 1) + by;
  return { month: (t % 12) + 1, year: Math.floor(t / 12) };
};
const clarify = (ask: ClarifyKind): PlanResult => ({
  kind: 'clarify',
  ask,
  text: CLARIFY_TEXT[ask],
});
const bad = (reason: 'invalid_plan' | 'unknown_tool' | 'model_refusal' | 'invented_period'): PlanResult => ({
  kind: 'refuse',
  reason,
});

export function validatePlan(raw: unknown, env: PlanEnv): PlanResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('invalid_plan');
  const plan = raw as Record<string, unknown>;
  if (Object.keys(plan).some((k) => !PLAN_KEYS.has(k))) return bad('invalid_plan');
  const { action } = plan;
  if (action === 'help') return { kind: 'help' };
  if (action === 'refuse') return bad('model_refusal');
  if (action === 'clarify') {
    return plan.ask === 'period' || plan.ask === 'employee' || plan.ask === 'days'
      ? clarify(plan.ask)
      : bad('invalid_plan');
  }
  if (action !== 'call_tool') return bad('invalid_plan');
  if (typeof plan.tool !== 'string') return bad('invalid_plan');
  if (!(PLAN_TOOLS as readonly string[]).includes(plan.tool)) return bad('unknown_tool');
  const tool = plan.tool as AnalysisTool;
  const need = NEEDS[tool];
  const { outbound, bindings, context, now } = env;
  const followUp = FOLLOW_UP.test(outbound);

  // --- Employé -------------------------------------------------------------
  let employeeId: string | undefined;
  if (plan.employee !== undefined) {
    if (!need.employee) return bad('invalid_plan');
    const b = resolveMarker(plan.employee, bindings, 'employee');
    if (!b || b.kind !== 'employee') return bad('invalid_plan'); // repère inventé ou nom/identifiant brut
    employeeId = b.id;
  } else if (need.employee) {
    // Suivi « et lui ? » : repris du contexte seulement s'il n'y a aucune ambiguïté.
    if (PRONOUN.test(outbound) && context.employeeIds.length === 1)
      employeeId = context.employeeIds[0];
    else return clarify('employee');
  }

  // --- Nombre de jours -----------------------------------------------------
  let days: number | undefined;
  if (plan.days !== undefined) {
    if (!need.days) return bad('invalid_plan');
    const b = resolveMarker(plan.days, bindings, 'number');
    if (!b || b.kind !== 'number') return bad('invalid_plan');
    days = b.value;
    if (!(days >= 0.5 && days <= 366)) return clarify('days');
  } else if (need.days) return clarify('days');

  // --- Période -------------------------------------------------------------
  let month = now.month,
    year = now.year;
  if (need.period) {
    const tokens = outbound.split(/\s+/);
    const base =
      followUp && context.month && context.year
        ? { month: context.month, year: context.year }
        : now;
    const p = plan.period;
    if (p === undefined) {
      if (followUp && context.month && context.year) {
        month = context.month;
        year = context.year;
      } else return clarify('period');
    } else {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return bad('invalid_plan');
      const pr = p as Record<string, unknown>;
      if (Object.keys(pr).some((k) => !PERIOD_KEYS.has(k))) return bad('invalid_plan');
      if (pr.kind === 'current') {
        if (!CURRENT_EVIDENCE.test(outbound)) return bad('invented_period');
        ({ month, year } = now);
      } else if (pr.kind === 'previous') {
        if (!PREVIOUS_EVIDENCE.test(outbound)) return bad('invented_period');
        if (followUp && !(context.month && context.year) && /^et\b/.test(outbound))
          return clarify('period');
        ({ month, year } = shift(base.month, base.year, -1));
      } else if (pr.kind === 'month') {
        if (!isInt(pr.month, 1, 12) || !isInt(pr.year, 2020, 2100)) return bad('invalid_plan');
        const named = tokens.filter((t) => MONTH_NAMES.includes(t));
        const years = tokens.filter((t) => /^20\d{2}$/.test(t));
        // Mois et année doivent figurer dans la question ; sinon on demande, on ne devine pas.
        if (named.length === 1 && years.length === 0) return clarify('period');
        if (
          named.length !== 1 ||
          years.length !== 1 ||
          MONTH_NAMES.indexOf(named[0]) + 1 !== pr.month ||
          Number(years[0]) !== pr.year
        )
          return bad('invented_period');
        month = pr.month;
        year = pr.year;
      } else return bad('invalid_plan');
    }
    if (year < 2020 || year > now.year + 1) return clarify('period');
  }

  const intent: ToolIntent = { tool, month, year };
  if (employeeId) intent.employeeId = employeeId;
  if (days !== undefined) intent.days = days;
  return { kind: 'intent', intent };
}

/** Contexte à conserver après une analyse réussie (ids internes seulement). */
export function nextContext(prev: ConversationContext, intent: ToolIntent): ConversationContext {
  const keep = NEEDS[intent.tool].period;
  const employeeIds = intent.employeeId
    ? [intent.employeeId, ...prev.employeeIds.filter((i) => i !== intent.employeeId)].slice(0, 3)
    : prev.employeeIds;
  return {
    tool: intent.tool,
    month: keep ? intent.month : prev.month,
    year: keep ? intent.year : prev.year,
    employeeIds,
  };
}

/** Contexte lu depuis un stockage non fiable : tout champ douteux est ignoré. */
export function parseContext(value: unknown): ConversationContext {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    tool: (PLAN_TOOLS as readonly unknown[]).includes(v.tool) ? (v.tool as AnalysisTool) : undefined,
    month: isInt(v.month, 1, 12) ? v.month : undefined,
    year: isInt(v.year, 2020, 2100) ? v.year : undefined,
    employeeIds: Array.isArray(v.employeeIds)
      ? v.employeeIds.filter((i): i is string => typeof i === 'string' && uuid.test(i)).slice(0, 3)
      : [],
  };
}