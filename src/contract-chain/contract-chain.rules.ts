// ============================================================================
// 📁 src/contract-chain/contract-chain.rules.ts
// Règles de renouvellement d'un CDD (Code du travail congolais) — FONCTION PURE,
// sans base de données : testable à part et réutilisable par le futur moteur
// d'audit (même règle = même résultat à la saisie et à l'audit).
//
// Sources (à faire valider par ton juriste avant mise en production) :
//   - Art. 32-5 : CDD renouvelable UNE SEULE fois, pour une durée ≤ à la période
//     initiale ; au total ≤ 2 ans, renouvellement compris.
//   - Cas des alinéas 2 et 5 de l'art. 32-2 : ≤ 6 mois, renouvellement compris.
//   - Poursuite du contrat après son terme = CDI (art. 32, tacite reconduction).
// ============================================================================

export const CDD_RULES = {
  MAX_RENEWALS: 1,
  MAX_TOTAL_MONTHS: 24,
  SHORT_MOTIF_MAX_MONTHS: 6,
} as const;

/** Motifs de CDD (liste fermée côté code → ajouter une ligne = pas de migration). */
export const CDD_MOTIFS = [
  { code: 'OUVRAGE_CHANTIER', label: 'Exécution d’un ouvrage ou d’un chantier', shortCap: false },
  { code: 'SURCROIT_OU_URGENCE', label: 'Surcroît exceptionnel et temporaire / travaux urgents', shortCap: true },
  { code: 'REMPLACEMENT', label: 'Remplacement d’un salarié absent', shortCap: false },
  { code: 'AUTRE', label: 'Autre (précisé dans le contrat)', shortCap: false },
] as const;
// ⚠️ À confirmer : l'alinéa 5 de l'art. 32-2 (plafond 6 mois) — si c'est un autre
// motif que « SURCROIT_OU_URGENCE », passe son `shortCap` à true ici.

export const CDD_MOTIF_CODES: string[] = CDD_MOTIFS.map((m) => m.code);
const SHORT_CAP_MOTIFS = new Set<string>(
  CDD_MOTIFS.filter((m) => m.shortCap).map((m) => m.code),
);

/** Violations que seul un ADMIN peut passer outre (régularisation de procédure). */
export const OVERRIDABLE_CODES = new Set([
  'TERM_PASSED',
  'RENEWAL_SIGNED_AFTER_TERM',
]);

export interface ChainLink {
  rank: number;
  kind: 'INITIAL' | 'RENEWAL' | 'CONVERSION_CDI';
  contractType: string;
  startDate: Date;
  endDate: Date | null;
  cddMotif?: string | null;
}

export interface RenewalRuleInput {
  today: Date; // minuit UTC
  chain: ChainLink[]; // trié par rank croissant ; le dernier = contrat courant
  currentStatus: string;
  proposed: {
    startDate: Date;
    endDate: Date;
    cddMotif?: string | null;
    signedAt?: Date | null;
  };
}

export interface RuleViolation {
  code: string;
  level: 'BLOCK' | 'WARN';
  message: string;
  legalRef?: string;
  overridable: boolean;
}

// ── Dates en UTC pur (les colonnes @db.Date sont à minuit UTC ; évite les
//    décalages si le serveur n'est pas en UTC) ───────────────────────────────
export const toUtcDate = (s: string | Date): Date => {
  const d = new Date(s);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
export const addDaysUtc = (d: Date, n: number): Date =>
  new Date(d.getTime() + n * 86_400_000);
export const addMonthsUtc = (d: Date, n: number): Date => {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
};
export const diffDaysUtc = (a: Date, b: Date): number =>
  Math.round((a.getTime() - b.getTime()) / 86_400_000);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function evaluateRenewal(input: RenewalRuleInput): RuleViolation[] {
  const out: RuleViolation[] = [];
  const add = (
    code: string,
    level: 'BLOCK' | 'WARN',
    message: string,
    legalRef?: string,
  ) =>
    out.push({
      code,
      level,
      message,
      legalRef,
      overridable: level === 'BLOCK' && OVERRIDABLE_CODES.has(code),
    });

  const { chain, proposed, today } = input;
  const current = chain[chain.length - 1];
  const root = chain[0];

  if (current.contractType !== 'CDD') {
    add('NOT_CDD', 'BLOCK', 'Seul un CDD peut être renouvelé.');
    return out; // inutile d'aller plus loin
  }
  if (!['ACTIVE', 'TRIAL'].includes(input.currentStatus)) {
    add('NOT_CURRENT', 'BLOCK', 'Ce contrat n’est plus en cours : impossible de le renouveler.');
    return out;
  }
  if (!current.endDate) {
    add('NO_END_DATE', 'BLOCK', 'Le CDD actuel n’a pas de date de fin renseignée.');
    return out;
  }

  const renewals = chain.filter((c) => c.kind === 'RENEWAL').length;
  if (renewals >= CDD_RULES.MAX_RENEWALS) {
    add(
      'ALREADY_RENEWED',
      'BLOCK',
      'Ce CDD a déjà été renouvelé : la loi n’autorise qu’un seul renouvellement. Passez en CDI.',
      'Code du travail, art. 32-5',
    );
  }

  if (proposed.endDate.getTime() < proposed.startDate.getTime()) {
    add('END_BEFORE_START', 'BLOCK', 'La date de fin est antérieure à la date de début.');
    return out;
  }
  if (proposed.startDate.getTime() <= current.endDate.getTime()) {
    add('OVERLAP', 'BLOCK', `Le renouvellement doit commencer après la fin du contrat actuel (${fmt(current.endDate)}).`);
  }
  const gap = diffDaysUtc(proposed.startDate, current.endDate) - 1;
  if (gap > 0) {
    add('GAP', 'WARN', `${gap} jour(s) sans contrat entre les deux périodes : vérifiez la continuité (risque de requalification).`);
  }

  if (today.getTime() > current.endDate.getTime()) {
    add(
      'TERM_PASSED',
      'BLOCK',
      `Le CDD est arrivé à terme le ${fmt(current.endDate)}. Sans avenant signé avant cette date, la relation est présumée à durée indéterminée.`,
      'Code du travail, art. 32 (poursuite après le terme)',
    );
  }
  if (!proposed.signedAt) {
    add('NO_SIGNATURE_DATE', 'WARN', 'Date de signature de l’avenant non renseignée : impossible de prouver qu’il précède le terme.');
  } else if (proposed.signedAt.getTime() > current.endDate.getTime()) {
    add(
      'RENEWAL_SIGNED_AFTER_TERM',
      'BLOCK',
      `L’avenant est signé le ${fmt(proposed.signedAt)}, après la fin du contrat (${fmt(current.endDate)}).`,
      'Code du travail, art. 32 (poursuite après le terme)',
    );
  }

  // Durée du renouvellement ≤ durée de la période initiale.
  if (root.endDate) {
    const d = initialDurationCheck(root, proposed.startDate, proposed.endDate);
    if (d.exceeded) {
      add('DURATION_EXCEEDS_INITIAL', 'BLOCK', d.message, 'Code du travail, art. 32-5');
    }
  }

  // Plafond total 24 mois (le 1er jour compte : 01/01 → 31/12 de l'année N+1)
  const maxEnd24 = addDaysUtc(addMonthsUtc(root.startDate, CDD_RULES.MAX_TOTAL_MONTHS), -1);
  if (proposed.endDate.getTime() > maxEnd24.getTime()) {
    add(
      'TOTAL_EXCEEDS_24M',
      'BLOCK',
      `Durée totale supérieure à 24 mois (limite : ${fmt(maxEnd24)}).`,
      'Code du travail, art. 32-5',
    );
  }

  // Plafond 6 mois selon le motif
  const motif = proposed.cddMotif ?? root.cddMotif ?? chain.find((c) => c.cddMotif)?.cddMotif ?? null;
  if (!motif) {
    add('NO_MOTIF', 'WARN', 'Motif du CDD non renseigné : le plafond de 6 mois (surcroît, urgence) ne peut pas être vérifié.');
  } else if (SHORT_CAP_MOTIFS.has(motif)) {
    const maxEnd6 = addDaysUtc(addMonthsUtc(root.startDate, CDD_RULES.SHORT_MOTIF_MAX_MONTHS), -1);
    if (proposed.endDate.getTime() > maxEnd6.getTime()) {
      add(
        'SHORT_MOTIF_EXCEEDS_6M',
        'BLOCK',
        `Pour ce motif, la durée totale ne peut pas dépasser 6 mois (limite : ${fmt(maxEnd6)}).`,
        'Code du travail, art. 32-5 (cas des alinéas 2 et 5 de l’art. 32-2)',
      );
    }
  }

  return out;
}

/**
 * Un renouvellement ne peut pas dépasser la période initiale.
 * Période initiale en MOIS ENTIERS (01/01→30/06 = 6 mois) : comparaison en mois,
 * sinon janv→juin (181 j) refuserait juil→déc (184 j) à tort. Sinon, en jours.
 */
export function initialDurationCheck(
  root: ChainLink,
  start: Date,
  end: Date,
): { exceeded: boolean; message: string } {
  if (!root.endDate) return { exceeded: false, message: '' };
  let wholeMonths: number | null = null;
  for (let n = 1; n <= 60; n++) {
    if (addDaysUtc(addMonthsUtc(root.startDate, n), -1).getTime() === root.endDate.getTime()) {
      wholeMonths = n;
      break;
    }
  }
  const initialDays = diffDaysUtc(root.endDate, root.startDate) + 1;
  const newDays = diffDaysUtc(end, start) + 1;
  const exceeded =
    wholeMonths !== null
      ? end.getTime() > addDaysUtc(addMonthsUtc(start, wholeMonths), -1).getTime()
      : newDays > initialDays;
  return {
    exceeded,
    message:
      wholeMonths !== null
        ? `Le renouvellement ne peut pas dépasser la durée de la période initiale (${wholeMonths} mois).`
        : `Le renouvellement dure ${newDays} jours, plus que la période initiale (${initialDays} jours).`,
  };
}

/**
 * Contrôle de l'ÉTAT d'une chaîne existante (utilisé par le moteur d'audit) :
 * on ne propose rien, on constate. Aucune règle « de procédure » ici, seulement
 * les plafonds légaux et le terme dépassé.
 */
export function evaluateChainCompliance(chain: ChainLink[], today: Date): RuleViolation[] {
  const out: RuleViolation[] = [];
  const add = (code: string, level: 'BLOCK' | 'WARN', message: string, legalRef?: string) =>
    out.push({ code, level, message, legalRef, overridable: false });
  if (chain.length === 0) return out;

  const root = chain[0];
  const last = chain[chain.length - 1];
  if (root.contractType !== 'CDD') return out; // règles propres au CDD

  const renewals = chain.filter((c) => c.kind === 'RENEWAL').length;
  if (renewals > CDD_RULES.MAX_RENEWALS) {
    add('TOO_MANY_RENEWALS', 'BLOCK', `${renewals} renouvellements enregistrés : un seul est autorisé.`, 'Code du travail, art. 32-5');
  }

  chain.forEach((l, i) => {
    if (l.kind === 'RENEWAL' && l.endDate && i > 0) {
      const d = initialDurationCheck(root, l.startDate, l.endDate);
      if (d.exceeded) add('DURATION_EXCEEDS_INITIAL', 'BLOCK', d.message, 'Code du travail, art. 32-5');
    }
  });

  const lastCdd = [...chain].reverse().find((c) => c.contractType === 'CDD' && c.endDate);
  if (lastCdd?.endDate) {
    const maxEnd24 = addDaysUtc(addMonthsUtc(root.startDate, CDD_RULES.MAX_TOTAL_MONTHS), -1);
    if (lastCdd.endDate.getTime() > maxEnd24.getTime()) {
      add('TOTAL_EXCEEDS_24M', 'BLOCK', `Durée totale supérieure à 24 mois (limite : ${fmt(maxEnd24)}).`, 'Code du travail, art. 32-5');
    }
    const motif = chain.find((c) => c.cddMotif)?.cddMotif ?? null;
    if (motif && SHORT_CAP_MOTIFS.has(motif)) {
      const maxEnd6 = addDaysUtc(addMonthsUtc(root.startDate, CDD_RULES.SHORT_MOTIF_MAX_MONTHS), -1);
      if (lastCdd.endDate.getTime() > maxEnd6.getTime()) {
        add('SHORT_MOTIF_EXCEEDS_6M', 'BLOCK', `Pour ce motif, la durée totale ne peut pas dépasser 6 mois (limite : ${fmt(maxEnd6)}).`, 'Code du travail, art. 32-5 (cas des alinéas 2 et 5 de l’art. 32-2)');
      }
    }
  }

  for (let i = 1; i < chain.length; i++) {
    const prevEnd = chain[i - 1].endDate;
    if (prevEnd) {
      const gap = diffDaysUtc(chain[i].startDate, prevEnd) - 1;
      if (gap > 0) add('GAP', 'WARN', `${gap} jour(s) sans contrat entre le rang ${chain[i - 1].rank} et le rang ${chain[i].rank}.`);
    }
  }

  if (last.contractType === 'CDD' && last.endDate && today.getTime() > last.endDate.getTime()) {
    add('TERM_PASSED', 'BLOCK', `Le CDD est arrivé à terme le ${fmt(last.endDate)} sans renouvellement ni conversion enregistré : relation présumée à durée indéterminée.`, 'Code du travail, art. 32 (poursuite après le terme)');
  }
  return out;
}

/**
 * Modification directe de la date de fin d'un CDD (depuis la fiche employé).
 * On N'EMPÊCHE PAS : la base doit refléter la réalité. On qualifie : plafonds
 * légaux dépassés = BLOCK (→ événement CRITIQUE + constat d'audit), simple
 * prolongation = WARN (assimilable à un renouvellement sans avenant).
 */
export function evaluateEndDateEdit(chain: ChainLink[], newEnd: Date, today: Date): RuleViolation[] {
  const out: RuleViolation[] = [];
  const last = chain[chain.length - 1];
  if (!last || last.contractType !== 'CDD') return out;

  if (newEnd.getTime() < last.startDate.getTime()) {
    out.push({ code: 'END_BEFORE_START', level: 'BLOCK', message: 'La nouvelle date de fin précède le début du contrat.', overridable: false });
    return out;
  }
  const modified = chain.map((l, i) => (i === chain.length - 1 ? { ...l, endDate: newEnd } : l));
  out.push(...evaluateChainCompliance(modified, today).filter((v) => v.code !== 'TERM_PASSED' && v.code !== 'GAP'));
  if (last.endDate && newEnd.getTime() > last.endDate.getTime()) {
    out.push({
      code: 'EXTENDED_WITHOUT_AMENDMENT',
      level: 'WARN',
      message: `Fin du CDD repoussée du ${fmt(last.endDate)} au ${fmt(newEnd)} par simple modification de fiche : une prolongation est un renouvellement et suppose un avenant signé.`,
      legalRef: 'Code du travail, art. 32-5',
      overridable: false,
    });
  }
  return out;
}