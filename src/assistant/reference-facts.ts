/**
 * Faits de référence de Sofia, lus à la source dans l'application (paramètres légaux publiés,
 * barèmes des conventions collectives, motifs d'absence) : rien n'est recopié à la main, donc
 * rien ne diverge. Ce sont des règles générales, identiques pour toutes les entreprises : elles
 * peuvent sans risque être envoyées au modèle. Une entreprise peut avoir réglé ses propres
 * paramètres : Sofia renvoie toujours vers l'écran correspondant pour confirmer.
 */
import {
  toRuntimeBrackets,
  type LegalParams,
} from '../legal-parameters/legal-parameters.core';
import { LEAVE_SENIORITY_CONVENTIONS } from '../leaves/config/leave-seniority-conventions';
import { ABSENCE_MOTIFS_GRILLE } from '../conventions/absence-motifs-grille';

import { score, tokenSet } from './match';
const strip = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
const has = (q: string, words: string[]) => words.some((w) => q.includes(w));
const pct = (v: number) => `${Math.round(v * 10000) / 100} %`.replace('.', ',');
const money = (v: number) => `${v.toLocaleString('fr-FR')} FCFA`;

/** « GENERALE » est une valeur technique par défaut, pas une convention collective réelle : Sofia ne la présente jamais. */
const REAL_CONVENTIONS = LEAVE_SENIORITY_CONVENTIONS.filter((c) => c.key !== 'GENERALE');
const ALIASES: Record<string, string[]> = {
  GENERALE: ['interprofessionnelle', 'generale'],
  COMMERCE: ['commerce'],
  TRANSPORT: ['transport', 'conteneur'],
  PETROLE: ['petrole', 'petrolier', 'petroliers'],
  INDUSTRIE: ['industrie', 'metallurgie'],
  PHARMACIE: ['pharmacie', 'officine'],
  MINE: ['mine', 'minier', 'miniere', 'minieres'],
  BANQUE: ['banque', 'bancaire'],
  BTP: ['btp', 'batiment', 'travaux publics'],
  NTIC: ['ntic', 'telecom', 'telecommunications', 'informatique'],
};
function namedConventions(q: string): string[] {
  const keys = new Set([
    ...REAL_CONVENTIONS.map((c) => c.key),
    ...Object.keys(ABSENCE_MOTIFS_GRILLE),
  ]);
  return [...keys].filter((k) =>
    (ALIASES[k] || [k.toLowerCase()]).some((a) => ` ${q} `.includes(` ${a} `)),
  );
}

interface Topic {
  id: string;
  keywords: string[];
  build: (p: LegalParams, q: string) => unknown;
}
const TOPICS: Topic[] = [
  {
    id: 'cnss',
    keywords: ['cnss', 'cotisation', 'cotisations', 'retraite', 'patronale', 'salariale', 'plafond', 'charges', 'accident', 'famille'],
    build: (p) => ({
      sujet: 'Cotisations CNSS (paramètres légaux en vigueur dans l’application)',
      partSalarie: pct(p.cnss.salarialRate),
      plafondRetraite: money(p.cnss.pensionCeiling),
      plafondFamilleEtAccidents: money(p.cnss.socialCeiling),
      partEmployeur: {
        retraite: pct(p.cnss.employerPensionRate),
        famille: pct(p.cnss.employerFamilyRate),
        accidentsDuTravail: pct(p.cnss.employerAccidentRate),
      },
    }),
  },
  {
    id: 'tus',
    keywords: ['tus', 'taxe unique', 'unique sur les salaires'],
    build: (p) => ({
      sujet: 'Taxe unique sur les salaires (TUS)',
      partEtat: pct(p.tus.dgiRate),
      partCnss: pct(p.tus.cnssRate),
    }),
  },
  {
    id: 'its',
    keywords: ['its', 'impot', 'irpp', 'fiscal', 'bareme', 'abattement', 'parts', 'quotient', 'retenue', 'retenues', 'net'],
    build: (p) => ({
      sujet: `Impôt sur les traitements et salaires (${p.fiscal.regimeLabel})`,
      abattement: pct(p.fiscal.abattementRate),
      bareme: toRuntimeBrackets(p.fiscal.brackets.ITS_2026).map((b) => b.label),
      parts:
        p.fiscal.partsMode === 'FAMILY_QUOTIENT'
          ? `parts selon la situation familiale, ${String(p.fiscal.maxParts).replace('.', ',')} au maximum`
          : 'une seule part pour tous',
      note: 'Le barème est appliqué après l’abattement ; il peut être mis à jour par l’administrateur de la plateforme.',
    }),
  },
  {
    id: 'conges',
    keywords: ['conge', 'conges', 'cumul', 'indemnite', 'droit', 'acquis', 'jours', 'annuel', 'payes'],
    build: (p) => ({
      sujet: 'Congés payés (règles légales en vigueur dans l’application)',
      joursOuvrablesParAn: p.leave.annualDays,
      cumulMaximumEnAnnees: p.leave.maxCumulYears,
      ancienneteMinimaleAvantPremierConge: `${p.leave.minMonthsBeforeLeave} mois`,
      note: 'Des jours supplémentaires d’ancienneté peuvent s’ajouter selon la convention collective choisie par l’entreprise.',
    }),
  },
  {
    id: 'anciennete',
    keywords: ['anciennete', 'supplementaire', 'supplementaires', 'bonus', 'convention', 'conventions', 'collective', 'collectives'],
    build: (_p, q) => {
      const named = namedConventions(q);
      const list = REAL_CONVENTIONS.filter((c) =>
        named.length ? named.includes(c.key) : false,
      );
      if (!list.length)
        return {
          sujet: 'Conventions collectives disponibles pour les congés d’ancienneté',
          conventions: REAL_CONVENTIONS.map((c) => c.label),
          note: 'Chaque entreprise choisit sa convention et décide si elle applique ou non le bonus d’ancienneté (Paramètres de l’entreprise).',
        };
      return {
        sujet: 'Jours de congé supplémentaires selon l’ancienneté',
        conventions: list.map((c) => ({
          convention: c.label,
          paliers: c.brackets.map(
            (b) => `à partir de ${b.minYears} ans : +${b.days} jours ouvrables`,
          ),
        })),
        note: 'Application facultative, selon le choix de l’entreprise.',
      };
    },
  },
  {
    id: 'motifs',
    keywords: ['permission exceptionnelle', 'evenement', 'familial', 'familiaux', 'mariage', 'deces', 'naissance', 'deuil', 'demenagement', 'bapteme', 'motif', 'motifs'],
    build: (_p, q) => {
      const named = namedConventions(q).filter((k) => ABSENCE_MOTIFS_GRILLE[k]);
      if (!named.length)
        return {
          sujet: 'Absences pour événements familiaux par convention',
          conventionsDisponibles: Object.keys(ABSENCE_MOTIFS_GRILLE),
          note: 'Précisez la convention pour obtenir le détail ; l’entreprise peut importer ces motifs depuis sa convention.',
        };
      return named.map((k) => ({
        sujet: `Événements familiaux — convention ${k}`,
        plafondAnnuelDeJours: ABSENCE_MOTIFS_GRILLE[k].annualCeiling,
        motifs: ABSENCE_MOTIFS_GRILLE[k].rows.map((r) => `${r.label} : ${r.days} jour(s)`),
      }));
    },
  },
  {
    id: 'heures_sup',
    keywords: ['heures supplementaires', 'heure supplementaire', 'majoration', 'nuit', 'dimanche', 'ferie', 'overtime'],
    build: () => ({
      sujet: 'Heures supplémentaires',
      principe:
        'L’application répartit les heures supplémentaires en quatre tranches de majoration (10 %, 25 %, 50 % et 100 %) : les majorations les plus élevées concernent le travail de nuit en jour de repos, férié ou dimanche. Les heures doivent être approuvées avant d’être payées.',
    }),
  },
  {
    id: 'paie',
    keywords: ['paie', 'bulletin', 'brut', 'calcul', 'calculer', 'salaire', 'cout employeur', 'masse salariale'],
    build: () => ({
      sujet: 'Principe de calcul d’une paie',
      principe:
        'En général : brut = salaire de base + primes + heures supplémentaires. On retire les cotisations du salarié (CNSS) et l’impôt (ITS, après abattement) pour obtenir le net. Le coût employeur ajoute les charges patronales (CNSS employeur, TUS) au brut.',
    }),
  },
  {
    id: 'planning_conges',
    keywords: ['planning', 'planifier', 'organiser', 'programmer', 'programme', 'chevauchement', 'equipe'],
    build: () => ({
      sujet: 'Bien planifier les congés',
      conseils: [
        'Vérifier d’abord les soldes de congé de chacun.',
        'Éviter que plusieurs personnes d’un même service partent en même temps ; échelonner les départs.',
        'Anticiper les périodes de forte activité et les jours fériés.',
        'Utiliser le planning et le calendrier des congés pour repérer les chevauchements.',
      ],
    }),
  },
];

/** Les faits les plus pertinents pour la question (4 sujets au plus, ~5 000 caractères). */
export function factsFor(message: string, params: LegalParams, max = 4): unknown[] {
  const q = strip(message);
  const set = tokenSet(message);
  return TOPICS.map((t) => ({
    t,
    score: score(set, t.keywords),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => ({ id: x.t.id, ...(Array.isArray(x.t.build(params, q)) ? { items: x.t.build(params, q) } : (x.t.build(params, q) as object)) }));
}