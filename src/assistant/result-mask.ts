/**
 * Lot 3 du chantier C2 : masquage des résultats d'outils + rendu vérifié.
 *
 * `maskCard` transforme la carte réelle (valeurs vraies) en une VUE destinée au modèle :
 *   - aucune valeur : seulement des marqueurs [[brut]], [[E1.valeur]], [[D1.final]]…
 *   - employés -> repères E<n> (les mêmes que dans la conversation) ;
 *   - départements -> D<n> (jamais leur nom : un nom de service peut identifier une entreprise) ;
 *   - notes et détails libres jamais envoyés ;
 *   - petits groupes (< MIN_GROUP) : refus de l'externe, l'orchestrateur répond en mode intégré.
 * `renderModelText` vérifie le texte rédigé par le modèle PUIS remplace marqueurs et repères
 * par les vraies valeurs. Tout chiffre « nu », nombre écrit en lettres, marqueur inconnu,
 * balise ou lien bloque la réponse. Le texte du modèle n'est jamais du HTML ni une consigne.
 *
 * Fonctions pures : ni base, ni réseau.
 */
import { MAX_REFS, REF_NUM } from './refs';
import type { AnalysisTool, ToolCard } from './analysis-tools';
import type { Bindings } from './pseudonymizer';

export const MIN_GROUP = 5;
export const MAX_MODEL_TEXT = 1200;

export type MaskFailure = 'small_group' | 'too_many_refs' | 'unsupported';
export type RefTarget =
  | { kind: 'employee'; id: string }
  | { kind: 'department'; name: string };
export interface MaskedView {
  tool: AnalysisTool;
  period: '[[period]]';
  metrics: {
    key: string;
    label: string;
    marker: string;
    direction?: 'up' | 'down' | 'flat';
  }[];
  rows: { ref: string; rank: number; markers: string[] }[];
  departments: { ref: string; markers: string[] }[];
}
export type MaskResult =
  | {
      ok: true;
      view: MaskedView;
      /** marqueur -> texte réel (reste sur le serveur) */
      values: Map<string, string>;
      /** E1/D1 -> cible réelle (reste sur le serveur) */
      refs: Map<string, RefTarget>;
      /** repères de conversation mis à jour (nouveaux employés ajoutés) */
      bindings: Bindings;
    }
  | { ok: false; reason: MaskFailure };

const KEYS: Record<string, string> = {
  'Brut de la période': 'brut',
  'Brut du mois précédent': 'brut_prec',
  'Écart brut': 'delta_total',
  'Écart des primes': 'delta_primes',
  'Écart des heures supplémentaires': 'delta_hs',
  'Autres composantes de l’écart brut': 'delta_autres',
  'Net de la période': 'net',
  'Coût employeur enregistré': 'cout_employeur',
  'Salaire de base': 'base',
  Primes: 'primes',
  'Heures supplémentaires': 'hs',
  Brut: 'brut',
  'Total des retenues': 'retenues',
  Net: 'net',
  'Coût employeur': 'cout_employeur',
  'Écart net avec le mois précédent': 'delta_net',
  'Jours acquis': 'jours_acquis',
  'Jours pris': 'jours_pris',
  'Jours restants': 'jours_restants',
  'Jours demandés': 'jours_demandes',
  'Allocation calculée': 'allocation',
  'Base de référence du moteur': 'base_ref',
  'Mois utilisés': 'mois_utilises',
  'Employés actifs': 'actifs',
  'Éligibles à un congé': 'eligibles',
  'Déjà en congé sur la période': 'deja_en_conge',
  'Revenus récemment': 'revenus',
  'Solde insuffisant': 'solde_insuffisant',
  'Propositions de congé': 'propositions',
  'Employés avec résumé': 'employes_resume',
  'Jours de présence': 'presents',
  'Jours en télétravail': 'teletravail',
  'Jours en congé': 'jours_conge',
  'Absences justifiées': 'abs_justifiees',
  'Absences non justifiées': 'abs_non_justifiees',
  'Jours de retard': 'retards',
  'Heures normales': 'h_normales',
  'Effectif initial': 'effectif_initial',
  Entrées: 'entrees',
  Sorties: 'sorties',
  'Effectif en fin de période': 'effectif_final',
};
const fmt = (v: number, unit?: string) =>
  v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + (unit ? ' ' + unit : '');

/** Chaîne issue des données : sans balise ni caractère de contrôle, longueur bornée. */
export const safeData = (s: string, max = 80) =>
  s
    .replace(/[\u0000-\u001f\u007f<>`\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function maskCard(
  tool: AnalysisTool,
  card: ToolCard,
  groupSize: number,
  conversation: Bindings,
): MaskResult {
  if (!Number.isFinite(groupSize) || groupSize < MIN_GROUP)
    return { ok: false, reason: 'small_group' };
  const values = new Map<string, string>([['[[period]]', safeData(card.period)]]);
  const refs = new Map<string, RefTarget>();
  const bindings: Bindings = new Map(conversation);
  const view: MaskedView = {
    tool,
    period: '[[period]]',
    metrics: [],
    rows: [],
    departments: [],
  };
  const used = new Set<string>();
  card.metrics.forEach((m, i) => {
    let key = KEYS[m.label] || 'm' + (i + 1);
    while (used.has(key)) key += '_' + (i + 1);
    used.add(key);
    const marker = `[[${key}]]`;
    values.set(marker, fmt(m.value, m.unit));
    view.metrics.push({
      key,
      label: key,
      marker,
      ...(key.startsWith('delta_')
        ? { direction: m.value > 0 ? 'up' : m.value < 0 ? 'down' : 'flat' }
        : {}),
    });
  });
  const known = new Map<string, string>(); // employeeId -> repère déjà attribué
  for (const [k, b] of bindings) if (b.kind === 'employee') known.set(b.id, k);
  for (const [n, r] of (card.rows || []).entries()) {
    let ref = known.get(r.employeeId);
    if (!ref) {
      const count = [...bindings.values()].filter((b) => b.kind === 'employee').length;
      if (count >= MAX_REFS) return { ok: false, reason: 'too_many_refs' };
      ref = `E${count + 1}`;
      bindings.set(ref, { kind: 'employee', id: r.employeeId });
      known.set(r.employeeId, ref);
    }
    refs.set(ref, { kind: 'employee', id: r.employeeId });
    const markers: string[] = [];
    if (r.value !== undefined && Number.isFinite(r.value)) {
      values.set(`[[${ref}.valeur]]`, fmt(r.value, r.unit));
      markers.push(`[[${ref}.valeur]]`);
    }
    if (r.detail) {
      values.set(`[[${ref}.detail]]`, safeData(r.detail, 200));
      markers.push(`[[${ref}.detail]]`);
    }
    view.rows.push({ ref, rank: n + 1, markers });
  }
  if (card.departments) {
    if (card.departments.length > MAX_REFS) return { ok: false, reason: 'too_many_refs' };
    card.departments.forEach((d, n) => {
      const ref = `D${n + 1}`;
      refs.set(ref, { kind: 'department', name: safeData(d.name) });
      const markers: string[] = [];
      for (const [suffix, v] of [
        ['initial', d.initial],
        ['entrees', d.hires],
        ['sorties', d.departures],
        ['final', d.final],
      ] as const) {
        if (!Number.isFinite(v)) return;
        values.set(`[[${ref}.${suffix}]]`, fmt(v));
        markers.push(`[[${ref}.${suffix}]]`);
      }
      view.departments.push({ ref, markers });
    });
  }
  return { ok: true, view, values, refs, bindings };
}

export type RenderFailure =
  | 'empty'
  | 'too_long'
  | 'markup'
  | 'bare_number'
  | 'number_word'
  | 'unknown_marker'
  | 'unknown_ref';
export type RenderResult =
  | { ok: true; text: string }
  | { ok: false; reason: RenderFailure };

const VALUE_MARKER = /\[\[[A-Za-z0-9_.]{1,40}\]\]/g;
const REF = new RegExp(`\\b[ED]${REF_NUM}\\b`, 'g');
const NUMBER_WORDS =
  /\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|vingts|trente|quarante|cinquante|soixante|cent|cents|mille|million|millions|milliard|milliards|zero|premier|deuxieme)\b/;

/**
 * `names` : repère (E1) -> nom d'affichage réel, fourni par le serveur pour l'entreprise vérifiée.
 */
export function renderModelText(
  raw: unknown,
  values: Map<string, string>,
  refs: Map<string, RefTarget>,
  names: Map<string, string>,
): RenderResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' };
  if (raw.length > MAX_MODEL_TEXT) return { ok: false, reason: 'too_long' };
  // Pas de balise, d'entité, de lien, de markdown actif ni de caractère de contrôle.
  if (/[<>]|&#|&\w+;|https?:|www\.|\]\(|[\u0000-\u0008\u000b-\u001f\u007f]/i.test(raw))
    return { ok: false, reason: 'markup' };
  const markers = raw.match(VALUE_MARKER) || [];
  if (markers.some((m) => !values.has(m))) return { ok: false, reason: 'unknown_marker' };
  const stripped = raw.replace(VALUE_MARKER, ' ');
  if (/[\[\]]/.test(stripped)) return { ok: false, reason: 'unknown_marker' };
  const refList = stripped.match(REF) || [];
  if (refList.some((r) => !refs.has(r))) return { ok: false, reason: 'unknown_ref' };
  const bare = stripped.replace(REF, ' ');
  if (/\d/.test(bare)) return { ok: false, reason: 'bare_number' };
  if (NUMBER_WORDS.test(bare.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))
    return { ok: false, reason: 'number_word' };
  // Une seule passe : un texte issu des données n'est jamais réinterprété comme marqueur ou repère.
  const text = raw.replace(
    new RegExp(`\\[\\[[A-Za-z0-9_.]{1,40}\\]\\]|\\b[ED]${REF_NUM}\\b`, 'g'),
    (m) => {
      if (m.startsWith('[[')) return values.get(m) as string;
      const t = refs.get(m)!;
      return t.kind === 'department' ? t.name : safeData(names.get(m) || 'Employé indisponible');
    },
  );
  return { ok: true, text };
}