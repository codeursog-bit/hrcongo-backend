// ============================================================================
// 📁 src/employees/import-bonuses.ts
//
// Import des PRIMES et INDEMNITÉS depuis un fichier Excel.
//
// Principe : une colonne Excel = une prime. Le NOM de la colonne devient le nom
// de la prime dans le catalogue de l'entreprise (BonusTemplate), et la cellule
// est le montant mensuel de l'employé (EmployeeBonus).
//
// La NATURE FISCALE est choisie par l'utilisateur au mapping (2 valeurs) :
//   BONUS_TAXABLE      → prime IMPOSABLE (soumise ITS + CNSS)  ← valeur par défaut
//   BONUS_NON_TAXABLE  → indemnité NON imposable (ni ITS ni CNSS)
// Pas de cas mixte (ITS sans CNSS ou l'inverse) pour l'instant.
// Si la prime existe déjà au catalogue, sa nature fait foi (l'écran la verrouille).
//
// COHÉRENCE DES DONNÉES (règles) :
//   1. Le catalogue existant fait foi : si une prime du même nom existe déjà,
//      on la réutilise telle quelle (on ne modifie JAMAIS un modèle existant :
//      sa mise à jour resynchroniserait les fiches de tous les employés).
//      Un désaccord de type fiscal est signalé en avertissement.
//   2. Une prime absente du catalogue est créée avec des drapeaux fiscaux
//      cohérents entre eux (isTaxable / isCnss / fiscalType) et les valeurs par
//      défaut de sa catégorie (CATEGORY_DEFAULTS).
//   3. Les fiches employé copient les drapeaux du MODÈLE (jamais du mapping) :
//      un même nom de prime a donc toujours le même traitement fiscal.
//   4. Un montant illisible bloque l'import (on ne devine jamais une somme).
//   5. Les primes ponctuelles (13e mois…) ne s'importent pas ici : ce sont des
//      primes mensuelles récurrentes.
//   6. Création du modèle + attribution : employé et primes sont écrits dans
//      la MÊME transaction (cf. options.initialBonuses de EmployeesService).
// ============================================================================

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CATEGORY_DEFAULTS } from '../bonus-templates/bonus-templates.service';

// ─── Types fiscaux ───────────────────────────────────────────────────────────

export type ImportBonusKind = 'BONUS_TAXABLE' | 'BONUS_NON_TAXABLE';

export const BONUS_KINDS: Record<
  ImportBonusKind,
  {
    label: string;
    fiscalType: 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE';
    isTaxable: boolean;
    isCnss: boolean;
    bonusCategory: 'POSTE' | 'FRAIS';
  }
> = {
  BONUS_TAXABLE: {
    label: 'Prime imposable',
    fiscalType: 'TAXABLE_CNSS',
    isTaxable: true,
    isCnss: true,
    bonusCategory: 'POSTE', // maintenue à 100 % : pas de réduction surprise
  },
  BONUS_NON_TAXABLE: {
    label: 'Indemnité non imposable',
    fiscalType: 'NON_TAXABLE',
    isTaxable: false,
    isCnss: false,
    bonusCategory: 'FRAIS',
  },
};

/** Anciennes valeurs (3 natures) → on les ramène à « imposable ». */
const LEGACY_TAXABLE_FIELDS = ['BONUS_TAXABLE_CNSS', 'BONUS_TAXABLE_NO_CNSS'];

export const isBonusField = (dbField: string): boolean =>
  Object.prototype.hasOwnProperty.call(BONUS_KINDS, dbField) ||
  LEGACY_TAXABLE_FIELDS.includes(dbField);

/** Valeur canonique d'un champ de mapping (anciennes valeurs de prime → BONUS_TAXABLE). */
export const canonicalBonusField = (dbField: string): string =>
  LEGACY_TAXABLE_FIELDS.includes(dbField) ? 'BONUS_TAXABLE' : dbField;

export function normalizeBonusMappings(
  mappings: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, df] of Object.entries(mappings)) out[col] = canonicalBonusField(df);
  return out;
}

type FiscalType = 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE';

/** Type fiscal EFFECTIF d'un modèle du catalogue (fiscalType si présent, sinon drapeaux). */
export function templateFiscalType(t: {
  fiscalType?: string | null;
  isTaxable: boolean;
  isCnss: boolean;
}): FiscalType {
  if (
    t.fiscalType === 'NON_TAXABLE' ||
    t.fiscalType === 'TAXABLE_NO_CNSS' ||
    t.fiscalType === 'TAXABLE_CNSS'
  )
    return t.fiscalType;
  if (!t.isTaxable) return 'NON_TAXABLE';
  return t.isCnss ? 'TAXABLE_CNSS' : 'TAXABLE_NO_CNSS';
}

// ─── Noms ────────────────────────────────────────────────────────────────────

/** Normalisation pour comparer deux noms (sans accents, minuscules, sans ponctuation). */
export function normalizeBonusName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'et', 'au', 'aux', 'en', 'a']);

/**
 * Clé de rapprochement avec le catalogue : insensible à la casse, aux accents ET
 * aux petits mots — « Indemnité de transport » = « indemnité_transport (FCFA) »
 * = « Indemnite du transport » (évite les doublons quasi identiques).
 */
export function bonusMatchKey(raw: string): string {
  return normalizeBonusName(raw)
    .split(' ')
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(' ');
}

/** Part de mots communs entre deux noms (0 → 1), sur la clé de rapprochement. */
function nameSimilarity(a: string, b: string): number {
  const A = new Set(bonusMatchKey(a).split(' ').filter(Boolean));
  const B = new Set(bonusMatchKey(b).split(' ').filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

/** En-tête de colonne → nom de prime propre : « indemnité_transport (FCFA) » → « Indemnité transport ». */
export function cleanBonusName(header: string): string {
  let s = String(header ?? '')
    .replace(/\([^)]*\)/g, ' ') // (FCFA), (mensuel)…
    .replace(/[_*:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 100) s = s.slice(0, 100).trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ─── Détection automatique d'une colonne de prime ───────────────────────────

const NOT_A_BONUS =
  /\b(total|totaux|brut|net|cumul|cumule|somme|recap|solde)\b/;
const ALLOWANCE_WORDS =
  /(indemnit|transport|panier|repas|logement|deplacement|mission|frais|loyer)/;
const BONUS_WORDS = /(prime|gratification|bonus|commission|sujetion|astreinte)/;

/** true si l'en-tête ressemble à une colonne de TOTAL (piège : double comptage). */
export function looksLikeTotalColumn(header: string): boolean {
  const n = normalizeBonusName(header);
  return NOT_A_BONUS.test(n) && (BONUS_WORDS.test(n) || ALLOWANCE_WORDS.test(n));
}

/**
 * Suggestion pour un en-tête : une colonne qui ressemble à une prime / indemnité
 * est proposée comme prime — TOUJOURS « imposable » par défaut ; c'est à
 * l'utilisateur de changer la nature fiscale (cf. looksLikeAllowance pour l'aide).
 */
export function suggestBonusKind(header: string): ImportBonusKind | null {
  const n = normalizeBonusName(header);
  if (!n) return null;
  if (NOT_A_BONUS.test(n)) return null;
  if (ALLOWANCE_WORDS.test(n) || BONUS_WORDS.test(n)) return 'BONUS_TAXABLE';
  return null;
}

/** Aide à l'écran : ce type de prime (transport, panier, logement…) est souvent NON imposable. */
export function looksLikeAllowance(header: string): boolean {
  return ALLOWANCE_WORDS.test(normalizeBonusName(header));
}

interface MappingLike {
  excelColumn: string;
  dbField: string;
  confidence: number;
  isRequired: boolean;
}

/**
 * Ajoute / corrige les suggestions « prime » dans une liste de mappings.
 *  - mapping neuf (fuzzy) : une colonne qui ressemble à une prime passe en BONUS_*
 *    (évite qu'« Indemnité logement » soit rapprochée par erreur d'« Adresse »).
 *  - mapping appris : on n'ajoute que pour les colonnes absentes (choix passé respecté).
 */
export function applyBonusSuggestions<T extends MappingLike>(
  columns: string[],
  mappings: T[],
  fromLearned: boolean,
): MappingLike[] {
  const out: MappingLike[] = mappings.map((m) => ({
    ...m,
    dbField: canonicalBonusField(m.dbField),
  }));
  for (const col of columns) {
    const kind = suggestBonusKind(col);
    if (!kind) continue;
    const idx = out.findIndex((m) => m.excelColumn === col);
    if (idx >= 0) {
      if (fromLearned || isBonusField(out[idx].dbField)) continue;
      out[idx] = { excelColumn: col, dbField: kind, confidence: 80, isRequired: false };
    } else {
      out.push({ excelColumn: col, dbField: kind, confidence: 80, isRequired: false });
    }
  }
  return out;
}

// ─── Montants ────────────────────────────────────────────────────────────────

export type ParsedAmount =
  | { state: 'EMPTY'; value: 0 }
  | { state: 'OK'; value: number }
  | { state: 'INVALID'; value: 0 };

/**
 * Lit un montant FCFA tel qu'Excel l'exporte : « 25000 », « 25 000 », « 25.000 »,
 * « 25 000 FCFA », « 1.500,50 ». Vide, « - », 0, « néant » ou un commentaire entre
 * parenthèses (ligne d'aide du modèle) → EMPTY. Tout le reste d'illisible → INVALID.
 */
export function parseBonusAmount(input: unknown): ParsedAmount {
  let s = String(input ?? '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .trim();
  if (!s) return { state: 'EMPTY', value: 0 };
  if (/^[-–—.\s]+$/.test(s)) return { state: 'EMPTY', value: 0 };
  if (/^(n\/?a|nc|neant|néant|aucun|aucune|null|nul)$/i.test(s))
    return { state: 'EMPTY', value: 0 };
  if (s.startsWith('(')) return { state: 'EMPTY', value: 0 }; // ligne d'aide du modèle

  s = s.replace(/(f\s?cfa|xaf|cfa|fcfa|f)\s*$/i, '').replace(/\s+/g, '');
  if (!s) return { state: 'INVALID', value: 0 };

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // le dernier séparateur est la décimale, l'autre sépare les milliers
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thousands = dec === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(dec, '.');
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = s.split(sep);
    const isThousands =
      parts.length > 1 &&
      parts[0].length >= 1 &&
      parts[0].length <= 3 &&
      parts.slice(1).every((p) => p.length === 3);
    s = isThousands ? parts.join('') : s.replace(sep, '.');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { state: 'INVALID', value: 0 };
  const n = Math.round(parseFloat(s));
  if (!isFinite(n) || n < 0) return { state: 'INVALID', value: 0 };
  if (n === 0) return { state: 'EMPTY', value: 0 };
  return { state: 'OK', value: n };
}

// ─── Plan d'import (analyse + validation, sans rien écrire) ─────────────────

export interface BonusColumnPlan {
  column: string;
  name: string;
  kind: ImportBonusKind;
  kindLabel: string;
  action: 'REUSE' | 'CREATE';
  templateId: string | null;
  /** type fiscal du modèle existant (si réutilisé) */
  catalogFiscalType: FiscalType | null;
  /** désaccord entre la nature choisie et celle du catalogue (le catalogue gagne) */
  conflict: 'NONE' | 'TAXABILITY';
  /** nb d'employés (lignes) avec un montant > 0 */
  employees: number;
  totalAmount: number;
  invalidCount: number;
}

export interface BonusPlanResult {
  plan: BonusColumnPlan[];
  errors: string[];
  warnings: string[];
}

export async function planBonusColumns(
  prisma: PrismaService,
  companyId: string,
  mappings: Record<string, string>,
  rows: Array<Record<string, unknown>>,
): Promise<BonusPlanResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan: BonusColumnPlan[] = [];

  const cols = Object.entries(mappings).filter(([, df]) => isBonusField(df));
  if (cols.length === 0) return { plan, errors, warnings };

  const templates = await prisma.bonusTemplate.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      isActive: true,
      isRecurring: true,
      isTaxable: true,
      isCnss: true,
      fiscalType: true,
      bonusCategory: true,
      quantityMode: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const seen = new Map<string, string>(); // nom normalisé → colonne
  for (const [column, df] of cols) {
    const kind = canonicalBonusField(df) as ImportBonusKind;
    const name = cleanBonusName(column);
    const norm = bonusMatchKey(name);
    if (!norm) {
      errors.push(`❌ La colonne « ${column} » n'a pas de nom exploitable pour une prime.`);
      continue;
    }
    if (seen.has(norm)) {
      errors.push(
        `❌ Les colonnes « ${seen.get(norm)} » et « ${column} » donneraient la même prime « ${name} » — ignorez-en une.`,
      );
      continue;
    }
    seen.set(norm, column);

    if (looksLikeTotalColumn(column)) {
      warnings.push(
        `⚠️ « ${column} » ressemble à une colonne de TOTAL : l'importer comme prime fausserait les gains (double comptage). Ignorez-la si c'est bien un total.`,
      );
    }

    // Modèles du même nom : on préfère l'actif, puis le plus récent
    const matches = templates.filter((t) => bonusMatchKey(t.name) === norm);
    const tpl = matches.find((t) => t.isActive) ?? matches[0] ?? null;

    // Aucun nom identique : y a-t-il une prime TRÈS proche (doublon probable) ?
    if (!tpl) {
      const close = templates
        .filter((t) => t.isActive && nameSimilarity(t.name, name) >= 0.5)
        .slice(0, 2)
        .map((t) => `« ${t.name} »`);
      if (close.length > 0) {
        warnings.push(
          `⚠️ « ${name} » sera créée comme nouvelle prime, mais le catalogue contient déjà ${close.join(' / ')}. Si c'est la même prime, renommez la colonne exactement comme dans le catalogue pour éviter un doublon.`,
        );
      }
    }

    let conflict: BonusColumnPlan['conflict'] = 'NONE';
    let catalogFiscalType: FiscalType | null = null;
    if (tpl) {
      if (!tpl.isActive) {
        errors.push(
          `❌ La prime « ${tpl.name} » existe mais est désactivée dans le catalogue : réactivez-la ou renommez la colonne.`,
        );
      }
      if (!tpl.isRecurring || tpl.bonusCategory === 'EXCEPTIONNELLE') {
        errors.push(
          `❌ « ${tpl.name} » est une prime ponctuelle (13e mois, prime exceptionnelle…) : elle ne peut pas être importée comme prime mensuelle.`,
        );
      }
      catalogFiscalType = templateFiscalType(tpl);
      const wanted = BONUS_KINDS[kind].fiscalType;
      if ((catalogFiscalType === 'NON_TAXABLE') !== (wanted === 'NON_TAXABLE')) {
        conflict = 'TAXABILITY';
        warnings.push(
          `⚠️ « ${tpl.name} » est déjà dans votre catalogue comme « ${labelOfFiscal(catalogFiscalType)} » alors que vous l'avez choisie « ${BONUS_KINDS[kind].label} ». Le catalogue est conservé : la prime sera importée comme « ${labelOfFiscal(catalogFiscalType)} ».`,
        );
      }
      if (tpl.quantityMode === 'FREE') {
        warnings.push(
          `ℹ️ « ${tpl.name} » est une prime à quantité variable dans le catalogue : les montants importés seront appliqués comme montants fixes mensuels.`,
        );
      }
    }

    // Statistiques de la colonne
    let employees = 0;
    let totalAmount = 0;
    let invalidCount = 0;
    const invalidMessages: string[] = [];
    rows.forEach((row, i) => {
      const parsed = parseBonusAmount(row[column]);
      if (parsed.state === 'OK') {
        employees++;
        totalAmount += parsed.value;
      } else if (parsed.state === 'INVALID') {
        invalidCount++;
        if (invalidMessages.length < 5)
          invalidMessages.push(
            `Ligne ${i + 2} : montant illisible « ${String(row[column]).slice(0, 30)} » dans la colonne « ${column} »`,
          );
      }
    });
    if (invalidCount > 0) {
      errors.push(...invalidMessages.map((m) => `❌ ${m}`));
      if (invalidCount > invalidMessages.length)
        errors.push(
          `❌ … et ${invalidCount - invalidMessages.length} autre(s) montant(s) illisible(s) dans « ${column} »`,
        );
    }
    if (employees === 0 && invalidCount === 0) {
      warnings.push(
        `ℹ️ La colonne « ${column} » ne contient aucun montant : aucune prime ne sera créée.`,
      );
    }

    // Nature RÉELLEMENT appliquée : celle du catalogue si la prime existe, sinon le choix
    const effKind: ImportBonusKind = catalogFiscalType
      ? catalogFiscalType === 'NON_TAXABLE'
        ? 'BONUS_NON_TAXABLE'
        : 'BONUS_TAXABLE'
      : kind;
    plan.push({
      column,
      name: tpl?.name ?? name,
      kind: effKind,
      kindLabel:
        catalogFiscalType === 'TAXABLE_NO_CNSS'
          ? 'Prime imposable (sans CNSS)'
          : BONUS_KINDS[effKind].label,
      action: tpl ? 'REUSE' : 'CREATE',
      templateId: tpl?.id ?? null,
      catalogFiscalType,
      conflict,
      employees,
      totalAmount,
      invalidCount,
    });
  }

  return { plan, errors, warnings };
}

function labelOfFiscal(f: FiscalType): string {
  return f === 'NON_TAXABLE'
    ? 'indemnité non imposable'
    : f === 'TAXABLE_NO_CNSS'
      ? 'prime imposable (sans CNSS)'
      : 'prime imposable';
}

// ─── Aide à l'écran de mapping : infos par colonne (avant tout choix) ────────

export interface ColumnBonusInfo {
  /** nom de prime qui serait utilisé pour cette colonne */
  name: string;
  /** la colonne ressemble à une indemnité de frais (transport, panier…) : souvent non imposable */
  allowanceHint: boolean;
  /** prime déjà présente au catalogue (même nom, à la casse/accents/petits mots près) */
  catalogName: string | null;
  /** nature du catalogue : l'écran verrouille alors le choix */
  catalogNature: 'TAXABLE' | 'NON_TAXABLE' | null;
  catalogLabel: string | null;
}

export async function describeColumnsForBonus(
  prisma: PrismaService,
  companyId: string,
  columns: string[],
): Promise<Record<string, ColumnBonusInfo>> {
  const templates = await prisma.bonusTemplate.findMany({
    where: { companyId, isActive: true, isRecurring: true },
    select: { name: true, isTaxable: true, isCnss: true, fiscalType: true, bonusCategory: true },
  });
  const out: Record<string, ColumnBonusInfo> = {};
  for (const col of columns) {
    const name = cleanBonusName(col);
    const key = bonusMatchKey(name);
    const tpl = key
      ? templates.find(
          (t) => t.bonusCategory !== 'EXCEPTIONNELLE' && bonusMatchKey(t.name) === key,
        )
      : undefined;
    const fiscal = tpl ? templateFiscalType(tpl) : null;
    out[col] = {
      name: tpl?.name ?? name,
      allowanceHint: looksLikeAllowance(col),
      catalogName: tpl?.name ?? null,
      catalogNature: fiscal ? (fiscal === 'NON_TAXABLE' ? 'NON_TAXABLE' : 'TAXABLE') : null,
      catalogLabel: fiscal ? labelOfFiscal(fiscal) : null,
    };
  }
  return out;
}

// ─── Création des modèles manquants ──────────────────────────────────────────

/** Modèle prêt à être attribué (drapeaux lus sur le MODÈLE, jamais sur le mapping). */
export interface ResolvedBonusTemplate {
  id: string;
  name: string;
  bonusCategory: any;
  isTaxable: boolean;
  isCnss: boolean;
  isProratized: boolean;
  isInLeaveBase: boolean;
  fiscalType: FiscalType;
}

export interface ImportBonusSummary {
  templatesCreated: Array<{ name: string; kind: string }>;
  templatesReused: Array<{ name: string; kind: string }>;
  bonusesAssigned: number;
  totalAmount: number;
}

export const emptyBonusSummary = (): ImportBonusSummary => ({
  templatesCreated: [],
  templatesReused: [],
  bonusesAssigned: 0,
  totalAmount: 0,
});

/**
 * Crée les modèles manquants (uniquement pour les colonnes qui ont au moins un
 * montant) et renvoie, par colonne Excel, le modèle à attribuer.
 * Relançable : un second passage retrouve les modèles par leur nom.
 */
export async function ensureBonusTemplates(
  prisma: PrismaService,
  companyId: string,
  plan: BonusColumnPlan[],
  summary: ImportBonusSummary,
): Promise<Map<string, ResolvedBonusTemplate>> {
  const out = new Map<string, ResolvedBonusTemplate>();

  for (const p of plan) {
    if (p.employees === 0) continue; // colonne vide : on ne pollue pas le catalogue

    if (p.action === 'REUSE' && p.templateId) {
      const t = await prisma.bonusTemplate.findUnique({
        where: { id: p.templateId },
        select: {
          id: true,
          name: true,
          bonusCategory: true,
          isTaxable: true,
          isCnss: true,
          isProratized: true,
          isInLeaveBase: true,
          fiscalType: true,
        },
      });
      if (!t) continue;
      out.set(p.column, {
        ...t,
        fiscalType: templateFiscalType(t),
      });
      summary.templatesReused.push({ name: t.name, kind: p.catalogFiscalType ?? p.kind });
      continue;
    }

    const k = BONUS_KINDS[p.kind];
    const d = CATEGORY_DEFAULTS[k.bonusCategory];
    const created = await prisma.bonusTemplate.create({
      data: {
        companyId,
        name: p.name,
        bonusCategory: k.bonusCategory,
        defaultAmount: null, // le montant est propre à chaque employé
        defaultPercentage: null,
        baseCalculation: null,
        isRecurring: true,
        isTaxable: k.isTaxable,
        isCnss: k.isCnss,
        fiscalType: k.fiscalType,
        isProratized: d.isProratized,
        isInLeaveBase: d.isInLeaveBase,
        isNature: false,
        description: `Créée automatiquement par l'import Excel — ${k.label}.`,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        bonusCategory: true,
        isTaxable: true,
        isCnss: true,
        isProratized: true,
        isInLeaveBase: true,
        fiscalType: true,
      },
    });
    out.set(p.column, { ...created, fiscalType: templateFiscalType(created) });
    summary.templatesCreated.push({ name: created.name, kind: k.fiscalType });
  }
  return out;
}

// ─── Attribution aux employés (dans la transaction de création) ─────────────

export interface ImportedBonusAssignment {
  template: ResolvedBonusTemplate;
  amount: number;
}

/** Écrit les EmployeeBonus d'un employé, avec les drapeaux fiscaux du MODÈLE. */
export async function createImportedEmployeeBonuses(
  db: Prisma.TransactionClient | PrismaService,
  employeeId: string,
  items: ImportedBonusAssignment[],
): Promise<number> {
  let created = 0;
  for (const { template: t, amount } of items) {
    if (!(amount > 0)) continue;
    await db.employeeBonus.create({
      data: {
        employeeId,
        bonusType: t.name,
        calculationType: 'FIXED_AMOUNT',
        fixedAmount: amount,
        frequency: 'MONTHLY',
        startDate: new Date(),
        isActive: true,
        isAutomatic: false,
        bonusCategory: t.bonusCategory,
        isTaxable: t.isTaxable,
        isCnss: t.isCnss,
        isProratized: t.isProratized,
        isInLeaveBase: t.isInLeaveBase,
        fiscalType: t.fiscalType,
        bonusTemplateId: t.id,
        notes: 'Importé depuis Excel',
      },
    });
    created++;
  }
  return created;
}