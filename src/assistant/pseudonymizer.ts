/**
 * Frontière de confidentialité de l'Assistant (lot 1 du chantier C2).
 *
 * Principe : le texte libre de l'utilisateur ne quitte JAMAIS le serveur tel quel.
 * `sanitizeQuestion` produit un texte sortant composé uniquement de :
 *   - mots d'un vocabulaire fermé (VOCAB, sans accents, écrits par nous) ;
 *   - années 20xx ;
 *   - repères d'employés E1, E2… (section 8 de ASSISTANT.md) et marqueurs [[N1]]… pour
 *     les nombres saisis (ex. nombre de jours). Les valeurs de résultat d'outil
 *     ([[E1.hs_montant]], [[delta_total]]) sont gérées par le lot « réponse ».
 * Tout autre mot (nom inconnu, consigne, injection, identifiant, e-mail…) fait
 * échouer la fonction : on demande une précision ou on refuse LOCALEMENT, sans
 * rien envoyer. Aucun caractère de l'utilisateur n'est recopié dans `outbound`.
 *
 * Fonction pure : aucun accès base, réseau ni variable d'environnement.
 * Les correspondances marqueur -> valeur restent dans `bindings` (mémoire locale).
 */
import { MAX_REFS, REF_NUM } from './refs';

export interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
}
export type Binding =
  | { kind: 'employee'; id: string }
  | { kind: 'number'; value: number };
export type Bindings = Map<string, Binding>;
/** Affichage local uniquement (jamais envoyé au fournisseur). */
export interface Candidate {
  id: string;
  label: string;
  employeeNumber?: string | null;
}
export type RefusalReason =
  | 'empty'
  | 'too_long'
  | 'injection'
  | 'sensitive_identifier'
  | 'ambiguous_employee'
  | 'unknown_name'
  | 'uncertain';
export type SanitizeResult =
  | { ok: true; outbound: string; bindings: Bindings }
  | {
      ok: false;
      reason: RefusalReason;
      clarification: string;
      candidates?: Candidate[];
    };

export const MAX_QUESTION_CHARS = 400;
export const MAX_TOKENS = 40;
export const MAX_MARKERS = 6;
/** Repères connus du texte sortant : E1..E9 et [[N1]]..[[N9]]. */
export const MARKER_RE = new RegExp(`\\bE${REF_NUM}\\b|\\[\\[N${REF_NUM}\\]\\]`, 'g');
const EXACT_MARKER_RE = new RegExp(`^(?:E${REF_NUM}|\\[\\[N${REF_NUM}\\]\\])$`);

/** Minuscules, sans accents, sans diacritiques combinants. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const words = (s: string) => s.split(/\s+/).filter(Boolean);
export const VOCAB: ReadonlySet<string> = new Set(
  words(`
  le la les l un une des du de d au aux a en et ou mais donc pour par sur sous dans avec sans chez entre vers
  ce cet cette ces ci mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs
  il elle ils elles lui eux je tu nous vous me te se moi toi qui que qu quoi dont
  quel quelle quels quelles quand comment pourquoi combien est sont etait ete etre avons avez ont ai as y
  plus moins tres trop pas ne n s t m c j si oui non aussi meme autre autres tout tous toute toutes
  celui celle ceux celles cela ca bonjour salut merci svp stp plait
  effectif effectifs employe employes employee salarie salaries personnel equipe entreprise societe service departement
  paie paye payes bulletin bulletins salaire salaires brut net masse salariale remuneration remunerations
  prime primes heure heures supplementaire supplementaires retenue retenues cout employeur fcfa
  conge conges permission permissions retour retours depart departs solde soldes jour jours
  allocation indemnite acquis pris restant restants ecart ecarts evolution variation comparaison
  augmente augmenter baisse baisser diminue change changer evolue varie
  mois annee annees semaine dernier derniere precedent precedente prochain courant actuel actuelle actuellement
  aujourd hui hier demain trimestre janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre
  donne donnez montre montrez affiche afficher peux pouvez veux voudrais souhaite voir calcule calculer
  explique expliquer comparer compare detaille detailler liste lister classement top eleve eleves
  gagne gagnent mieux part partent partir revient reviennent revenir approuve approuves approuvee approuvees
  combien nombre total notre cet ecart difference raison cause
  faire fait creer ajouter importer modifier consulter generer demander guide guider aide aider ou
`),
);
/** Refus immédiat (avant toute autre analyse) : tentatives de détournement. */
const INJECTION_RE =
  /\b(ignore\w*|oublie\w*|instruction\w*|system\w*|prompt\w*|sql\w*|jailbreak\w*|developer|mot de passe|cle api|api key|token|autre entreprise|entreprise b|base de donnees|requete\w*|script\w*|json|html)\b/;
const SENSITIVE_RE =
  /[\w.+-]+@[\w-]+\.[\w.-]+|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\d[\d\s.\-]{7,}\d|https?:\/\/|www\./i;
const TOKEN_RE = /\d+(?:[.,]\d+)?|\p{L}+/gu;

const refuse = (
  reason: RefusalReason,
  clarification: string,
  candidates?: Candidate[],
): SanitizeResult => ({ ok: false, reason, clarification, candidates });
export const REFUSAL_TEXT: Record<RefusalReason, string> = {
  empty: 'Écrivez une question.',
  too_long: `Votre question est trop longue. Reformulez-la en moins de ${MAX_QUESTION_CHARS} caractères.`,
  injection:
    'Je ne peux pas traiter cette demande. Posez une question sur vos données RH ou sur l’utilisation de l’application.',
  sensitive_identifier:
    'Votre message contient un identifiant, une adresse ou un numéro que je ne transmets pas. Désignez l’employé par son nom.',
  ambiguous_employee: 'Plusieurs employés correspondent. Lequel voulez-vous ?',
  unknown_name:
    'Je ne retrouve pas cet employé dans votre entreprise. Vérifiez l’orthographe ou choisissez-le dans la liste.',
  uncertain:
    'Je n’ai pas compris certains mots de votre question. Reformulez-la plus simplement (période, employé, sujet), ou utilisez « Explorer mes données ».',
};

const nameTokens = (e: EmployeeRef) =>
  new Set(
    [...(norm(`${e.firstName} ${e.lastName}`).match(TOKEN_RE) || [])].filter(
      (t) => t.length >= 2 && !/^\d/.test(t),
    ),
  );

/**
 * `seed` : repères déjà attribués plus tôt dans la même conversation (côté serveur).
 * Ils sont repris tels quels pour que « et lui ? » désigne toujours le même E1.
 */
export function sanitizeQuestion(
  message: string,
  employees: EmployeeRef[],
  seed?: Bindings,
): SanitizeResult {
  if (typeof message !== 'string' || !message.trim())
    return refuse('empty', REFUSAL_TEXT.empty);
  if (message.length > MAX_QUESTION_CHARS)
    return refuse('too_long', REFUSAL_TEXT.too_long);
  const flat = norm(message).replace(/[^a-z0-9@:/. -]/g, ' ');
  if (SENSITIVE_RE.test(message) || SENSITIVE_RE.test(flat))
    return refuse('sensitive_identifier', REFUSAL_TEXT.sensitive_identifier);
  if (INJECTION_RE.test(norm(message).replace(/[^a-z0-9]+/g, ' ')))
    return refuse('injection', REFUSAL_TEXT.injection);

  const raw = message.match(TOKEN_RE) || [];
  if (!raw.length || raw.length > MAX_TOKENS)
    return refuse('uncertain', REFUSAL_TEXT.uncertain);
  const toks = raw.map((original, i) => ({
    original,
    n: norm(original),
    // Majuscule initiale en milieu de phrase : indice de nom propre.
    cap: i > 0 && /^\p{Lu}\p{Ll}/u.test(original),
  }));
  const index = employees.map((e) => ({ e, names: nameTokens(e) }));
  const MONTHS = new Set(
    words(
      'janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre',
    ),
  );
  const PRE_MONTH = new Set(['en', 'de', 'd', 'du', 'fin', 'debut', 'mois']);
  const known = (t?: (typeof toks)[number]) =>
    !!t && /^\p{L}+$/u.test(t.n) && t.n.length >= 2 && index.some((x) => x.names.has(t.n));
  const isNameToken = (k: number): boolean => {
    const t = toks[k];
    if (!known(t)) return false;
    if (!VOCAB.has(t.n)) return true;
    // Mot courant (ex. « mai ») : un mois s'il suit « en/de… » ou précède une année.
    if (
      MONTHS.has(t.n) &&
      (PRE_MONTH.has(toks[k - 1]?.n) || /^20\d{2}$/.test(toks[k + 1]?.n || ''))
    )
      return false;
    // Sinon un nom seulement avec majuscule (ou début de phrase suivi d'un autre nom).
    return t.cap || (k === 0 && known(toks[1]) && !VOCAB.has(toks[1].n));
  };

  const bindings: Bindings = new Map(seed || []);
  const empMarker = new Map<string, string>();
  for (const [k, b] of bindings) if (b.kind === 'employee') empMarker.set(b.id, k);
  const out: string[] = [];
  let markers = 0;
  const bind = (b: Binding) => {
    if (++markers > MAX_MARKERS) return null;
    const count = [...bindings.values()].filter((v) => v.kind === b.kind)
      .length;
    if (count >= MAX_REFS) return null;
    const key = b.kind === 'employee' ? `E${count + 1}` : `[[N${count + 1}]]`;
    bindings.set(key, b);
    return key;
  };

  for (let i = 0; i < toks.length; ) {
    const t = toks[i];
    if (/^\d/.test(t.n)) {
      if (/^20\d{2}$/.test(t.n)) {
        out.push(t.n);
        i++;
        continue;
      }
      const value = Number(t.n.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0 || value > 100000)
        return refuse('uncertain', REFUSAL_TEXT.uncertain);
      const key = bind({ kind: 'number', value });
      if (!key) return refuse('uncertain', REFUSAL_TEXT.uncertain);
      out.push(key);
      i++;
      continue;
    }
    if (isNameToken(i)) {
      let run = 1;
      while (i + run < toks.length && isNameToken(i + run)) run++;
      let used = 0,
        found: typeof index = [];
      for (let len = run; len >= 1 && !found.length; len--) {
        const set = new Set(toks.slice(i, i + len).map((x) => x.n));
        const exact = index.filter(
          (x) => x.names.size === set.size && [...set].every((s) => x.names.has(s)),
        );
        const superset = index.filter((x) => [...set].every((s) => x.names.has(s)));
        // Nom complet identique (homonymes) => ambigu ; sinon correspondance exacte unique prioritaire.
        found = exact.length ? exact : superset;
        used = len;
      }
      if (found.length !== 1)
        return refuse(
          found.length > 1 ? 'ambiguous_employee' : 'unknown_name',
          found.length > 1
            ? REFUSAL_TEXT.ambiguous_employee
            : REFUSAL_TEXT.unknown_name,
          found.slice(0, 8).map(({ e }) => ({
            id: e.id,
            label: `${e.firstName} ${e.lastName}`.trim(),
            employeeNumber: e.employeeNumber ?? null,
          })),
        );
      const id = found[0].e.id;
      let key = empMarker.get(id);
      if (!key) {
        key = bind({ kind: 'employee', id }) || undefined;
        if (!key) return refuse('uncertain', REFUSAL_TEXT.uncertain);
        empMarker.set(id, key);
      }
      out.push(key);
      i += used;
      continue;
    }
    if (VOCAB.has(t.n)) {
      // On envoie le mot canonique du vocabulaire, jamais les caractères saisis.
      out.push(t.n);
      i++;
      continue;
    }
    // Mot inconnu : nom propre probable (majuscule) ou vocabulaire non couvert.
    return t.cap
      ? refuse('unknown_name', REFUSAL_TEXT.unknown_name)
      : refuse('uncertain', REFUSAL_TEXT.uncertain);
  }
  const outbound = out.join(' ');
  const leak = findLeak(outbound, employees, bindings);
  if (leak) return refuse('uncertain', REFUSAL_TEXT.uncertain);
  return { ok: true, outbound, bindings };
}

/**
 * Dernière barrière avant tout envoi : renvoie un motif si le texte sortant
 * contient autre chose que vocabulaire, années et marqueurs connus.
 */
export function findLeak(
  outbound: string,
  employees: EmployeeRef[],
  bindings: Bindings,
): string | null {
  const stripped = outbound.replace(MARKER_RE, (m) =>
    bindings.has(m) ? ' ' : '\u0000',
  );
  if (stripped.includes('\u0000') || /[\[\]]/.test(stripped))
    return 'unknown_marker';
  for (const part of stripped.split(/\s+/).filter(Boolean)) {
    if (/^20\d{2}$/.test(part) || VOCAB.has(part)) continue;
    return 'token_outside_vocabulary';
  }
  const names = new Set(employees.flatMap((e) => [...nameTokens(e)]));
  for (const part of stripped.split(/\s+/))
    if (names.has(part) && !VOCAB.has(part)) return 'employee_name';
  return null;
}

/** Valeur de marqueur renvoyée par le modèle -> liaison locale (ou null). */
export function resolveMarker(
  value: unknown,
  bindings: Bindings,
  kind: Binding['kind'],
): Binding | null {
  if (typeof value !== 'string' || !EXACT_MARKER_RE.test(value)) return null;
  const b = bindings.get(value);
  return b && b.kind === kind ? b : null;
}

/** Tout repère (E1, [[N1]]) d'un texte du modèle doit exister dans les liaisons. */
export function markersKnown(text: string, bindings: Bindings): boolean {
  const found = text.match(MARKER_RE) || [];
  return found.every((m) => bindings.has(m));
}