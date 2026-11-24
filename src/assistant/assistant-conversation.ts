/**
 * Lot 5a du chantier C2 : orchestrateur de conversation.
 *
 * Assemble les lots 1 à 4 SANS accès base ni réseau direct (tout est injecté) :
 *   planTurn      question libre -> pseudonymisation locale -> plan du modèle -> validation
 *   composeAnswer carte vérifiée -> vue masquée -> texte du modèle -> rendu vérifié
 * L'entreprise, le rôle, les quotas, la licence et l'exécution de l'outil restent dans
 * AssistantService : ce module ne reçoit ni identifiant d'entreprise ni client de base.
 * Chaque panne ou refus se termine par un résultat explicite : jamais de faux succès.
 */

import type { AnalysisTool, ToolCard, ToolIntent } from './analysis-tools';
import {
  sanitizeQuestion,
  type Bindings,
  type Candidate,
  type EmployeeRef,
  type RefusalReason,
} from './pseudonymizer';
import {
  nextContext,
  parseContext,
  validatePlan,
  type ClarifyKind,
  type ConversationContext,
} from './tool-plan';
import { maskCard, renderModelText } from './result-mask';
import {
  buildAnswerPrompt,
  buildPlanPrompt,
  ModelError,
  type CallOptions,
  type Prompt,
} from './model-transport';
import { parseChatTurns, type ChatTurn } from './free-chat';
import { MAX_REFS, REF_NUM } from './refs';
const EMPLOYEE_REF = new RegExp(`^E${REF_NUM}$`);

export const MAX_PENDING_ROUNDS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Texte pseudonymisé uniquement : vocabulaire, années, repères E1/[[N1]]. */
const OUTBOUND_SHAPE = /^[a-zA-Z0-9 \[\]]{1,600}$/;

/** Contexte conservé (chiffré) côté serveur entre deux tours. */
export interface StoredContext extends ConversationContext {
  /** Repères E1..E9 attribués dans la conversation (position = numéro - 1). */
  refs: string[];
  /** Questions déjà pseudonymisées, en attente d'une précision (période, employé, jours). */
  pendingOutbound?: string;
  pendingRounds?: number;
  /** Question brute gardée uniquement le temps de choisir entre homonymes (chiffrée avec le reste). */
  pendingRaw?: { text: string; candidateIds: string[] };
  /** Historique de la conversation libre avec Sofia (questions masquées + réponses). */
  chat?: ChatTurn[];
}
export const EMPTY_STORED: StoredContext = { employeeIds: [], refs: [] };

export function parseStoredContext(value: unknown): StoredContext {
  const base = parseContext(value);
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, any>;
  const ids = (x: unknown, max: number) =>
    Array.isArray(x)
      ? x.filter((i): i is string => typeof i === 'string' && UUID.test(i)).slice(0, max)
      : [];
  const out: StoredContext = { ...base, refs: ids(v.refs, MAX_REFS) };
  const chat = parseChatTurns(v.chat);
  if (chat.length) out.chat = chat;
  if (typeof v.pendingOutbound === 'string' && OUTBOUND_SHAPE.test(v.pendingOutbound)) {
    out.pendingOutbound = v.pendingOutbound;
    out.pendingRounds = Number.isInteger(v.pendingRounds)
      ? Math.max(1, Math.min(MAX_PENDING_ROUNDS, v.pendingRounds))
      : 1;
  }
  const raw = v.pendingRaw;
  if (raw && typeof raw.text === 'string' && raw.text.length <= 400) {
    const candidateIds = ids(raw.candidateIds, 8);
    if (candidateIds.length >= 2) out.pendingRaw = { text: raw.text, candidateIds };
  }
  return out;
}

export interface Deps {
  /** Employés de l'entreprise de l'identité vérifiée (jamais fournis par le client ou le modèle). */
  employees(): Promise<EmployeeRef[]>;
  model(prompt: Prompt, opts: CallOptions): Promise<Record<string, unknown>>;
  now(): { month: number; year: number };
}

export type TurnPlan =
  | { kind: 'intent'; intent: ToolIntent; outbound: string; bindings: Bindings; employees: EmployeeRef[]; context: StoredContext }
  | {
      kind: 'clarify';
      text: string;
      why: ClarifyKind | RefusalReason | 'choice_invalid' | 'rounds_exceeded';
      options?: Candidate[];
      context: StoredContext;
    }
  | { kind: 'help' }
  | { kind: 'refuse'; text: string; context: StoredContext }
  | { kind: 'unavailable'; text: string; context: StoredContext };

const seedOf = (ctx: StoredContext): Bindings =>
  new Map(ctx.refs.map((id, i) => [`E${i + 1}`, { kind: 'employee' as const, id }]));
const refsOf = (b: Bindings): string[] =>
  [...b.entries()]
    .filter(([k, v]) => EMPLOYEE_REF.test(k) && v.kind === 'employee')
    .sort((x, y) => Number(x[0].slice(1)) - Number(y[0].slice(1)))
    .map(([, v]) => (v as { id: string }).id);

export const TEXT = {
  unavailable:
    'Le modèle externe est indisponible. Le mode intégré reste disponible : utilisez « Explorer mes données » ou l’aide.',
  refused:
    'Je ne peux pas traiter cette demande. Utilisez « Explorer mes données » ou posez une question sur l’application.',
  choice: 'Ce choix n’est plus valable. Posez de nouveau votre question.',
  rounds:
    'Je n’ai toujours pas assez d’éléments. Utilisez « Explorer mes données » pour choisir la période et l’employé.',
  smallGroup:
    'Résultats affichés sans explication rédigée : l’effectif est trop petit pour être transmis à un modèle externe.',
};

export async function planTurn(
  message: string,
  ctx: StoredContext,
  deps: Deps,
  opts: { signal?: AbortSignal; choice?: { employeeId: string } } = {},
): Promise<TurnPlan> {
  let employees = await deps.employees();
  let text = message;
  let pendingOutbound = ctx.pendingOutbound;
  const base: StoredContext = { ...ctx, pendingRaw: undefined };

  if (opts.choice) {
    // Le choix ne vaut que pour la question brute mémorisée et ses candidats : jamais un id libre.
    const raw = ctx.pendingRaw;
    if (!raw || !raw.candidateIds.includes(opts.choice.employeeId))
      return { kind: 'clarify', text: TEXT.choice, why: 'choice_invalid', context: base };
    text = raw.text;
    pendingOutbound = undefined;
    employees = employees.filter(
      (e) => !raw.candidateIds.includes(e.id) || e.id === opts.choice!.employeeId,
    );
  }

  const s = sanitizeQuestion(text, employees, seedOf(ctx));
  if (!s.ok) {
    const keepRaw =
      s.reason === 'ambiguous_employee' && s.candidates && s.candidates.length >= 2;
    return {
      kind: 'clarify',
      text: s.clarification,
      why: s.reason,
      options: s.candidates,
      context: {
        ...base,
        ...(keepRaw
          ? { pendingRaw: { text, candidateIds: s.candidates!.map((c) => c.id) } }
          : {}),
      },
    };
  }

  let outbound = s.outbound;
  let rounds = 0;
  // Une précision est courte et ne ressemble pas à une nouvelle question.
  const isCompletion =
    s.outbound.split(' ').length <= 8 &&
    !/\b(quel|quelle|quels|quelles|combien|pourquoi|comment|qui|donne|montre|affiche|calcule|liste)\b/.test(s.outbound);
  if (pendingOutbound && !opts.choice && isCompletion) {
    const merged = `${pendingOutbound} ${s.outbound}`;
    if (OUTBOUND_SHAPE.test(merged)) {
      outbound = merged;
      rounds = ctx.pendingRounds ?? 1;
    }
  }
  const bindings = s.bindings;
  const refs = refsOf(bindings);
  const withRefs = { ...base, refs, pendingOutbound: undefined, pendingRounds: undefined };

  let raw: Record<string, unknown>;
  try {
    raw = await deps.model(
      buildPlanPrompt({ outbound, bindings, employees, context: ctx }),
      { signal: opts.signal, maxTokens: 200 },
    );
  } catch (e) {
    // Panne, délai, annulation ou garde de sortie : aucune analyse, aucun contexte avancé.
    return { kind: 'unavailable', text: TEXT.unavailable, context: base };
  }

  const r = validatePlan(raw, { outbound, bindings, context: ctx, now: deps.now() });
  if (r.kind === 'intent')
    return { kind: 'intent', intent: r.intent, outbound, bindings, employees, context: withRefs };
  if (r.kind === 'help') return { kind: 'help' };
  if (r.kind === 'refuse') return { kind: 'refuse', text: TEXT.refused, context: base };
  // Précision demandée : on garde la question pseudonymisée pour la compléter au tour suivant.
  if (rounds + 1 > MAX_PENDING_ROUNDS)
    return { kind: 'clarify', text: TEXT.rounds, why: 'rounds_exceeded', context: withRefs };
  return {
    kind: 'clarify',
    text: r.text,
    why: r.ask,
    context: { ...withRefs, pendingOutbound: outbound, pendingRounds: rounds + 1 },
  };
}

/** Contexte à enregistrer APRÈS une exécution d'outil réussie (jamais avant). */
export function commitContext(
  ctx: StoredContext,
  intent: ToolIntent,
  bindings: Bindings,
): StoredContext {
  const next = nextContext(ctx, intent);
  return { ...next, refs: refsOf(bindings), ...(ctx.chat?.length ? { chat: ctx.chat } : {}) };
}

export type ComposeResult =
  | { ok: true; text: string; bindings: Bindings }
  | { ok: false; reason: 'small_group' | 'too_many_refs' | 'unsupported' | 'model' | 'unsafe'; text?: string };

/** Rédige l'explication d'une carte déjà vérifiée ; en cas d'échec le service garde sa phrase locale. */
export async function composeAnswer(args: {
  tool: AnalysisTool;
  card: ToolCard;
  outbound: string;
  bindings: Bindings;
  employees: EmployeeRef[];
  deps: Pick<Deps, 'model'>;
  signal?: AbortSignal;
}): Promise<ComposeResult> {
  const m = maskCard(args.tool, args.card, args.employees.length, args.bindings);
  if (!m.ok)
    return {
      ok: false,
      reason: m.reason,
      text: m.reason === 'small_group' ? TEXT.smallGroup : undefined,
    };
  let raw: Record<string, unknown>;
  try {
    raw = await args.deps.model(
      buildAnswerPrompt({
        outbound: args.outbound,
        view: m.view,
        bindings: m.bindings,
        employees: args.employees,
      }),
      { signal: args.signal, maxTokens: 350 },
    );
  } catch (e) {
    return { ok: false, reason: e instanceof ModelError && e.code === 'unsafe_input' ? 'unsafe' : 'model' };
  }
  const names = new Map<string, string>();
  for (const [ref, t] of m.refs) {
    if (t.kind !== 'employee') continue;
    const e = args.employees.find((x) => x.id === t.id);
    if (e) names.set(ref, `${e.firstName} ${e.lastName}`.trim());
  }
  const out = renderModelText(raw.text, m.values, m.refs, names);
  return out.ok
    ? { ok: true, text: out.text, bindings: m.bindings }
    : { ok: false, reason: 'unsafe' };
}