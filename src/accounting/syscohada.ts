// ============================================================================
// 📁 src/accounting/syscohada.ts
// CATALOGUE des rubriques comptables de la paie + comptes PAR DÉFAUT.
// Les numéros et libellés par défaut sont ceux du plan SYSCOHADA révisé
// (liste officielle, comptes à 3-4 chiffres). Ils sont SURCHARGEABLES par pays
// depuis le super admin (voir accounting-plan.service.ts) : ce fichier ne sert
// que de valeur par défaut. Aucun autre fichier ne code un numéro de compte.
// scope = 'CG' : rubrique propre au Congo (CNSS, TUS, ITS, TOL, CAMU) ; d'autres
// pays peuvent ne pas l'utiliser — elle n'apparaît alors simplement pas.
// ============================================================================
import { normalizeNationality } from '../common/utils/nationality.util';

export type PlanAccount = { code: string; name: string };
export type AccountPlan = Record<string, PlanAccount>;
export type RubricDef = { key: string; group: string; code: string; name: string; scope: 'SYSCOHADA' | 'CG'; hint?: string };

const SAL = 'Appointements, salaires et commissions';
export const RUBRICS: readonly RubricDef[] = Object.freeze([
  // ── Charges de personnel — personnel national (661) ─────────────────────
  { key: 'PAY_BASE', group: 'Charges de personnel — national', code: '6611', name: SAL, scope: 'SYSCOHADA' },
  { key: 'PAY_OVERTIME', group: 'Charges de personnel — national', code: '6611', name: SAL, scope: 'SYSCOHADA', hint: 'Heures supplémentaires : le plan n’a pas de compte dédié' },
  { key: 'PAY_BONUS', group: 'Charges de personnel — national', code: '6612', name: 'Primes et gratifications', scope: 'SYSCOHADA' },
  { key: 'PAY_LEAVE', group: 'Charges de personnel — national', code: '6613', name: 'Congés payés', scope: 'SYSCOHADA' },
  { key: 'PAY_SEVERANCE', group: 'Charges de personnel — national', code: '6614', name: 'Indemnités de préavis, de licenciement et de recherche d’embauche', scope: 'SYSCOHADA' },
  { key: 'PAY_NATURE', group: 'Charges de personnel — national', code: '6617', name: 'Avantages en nature', scope: 'SYSCOHADA' },
  // ── Charges de personnel — personnel non national (662) ─────────────────
  { key: 'PAY_BASE_PE', group: 'Charges de personnel — non national', code: '6621', name: SAL, scope: 'SYSCOHADA' },
  { key: 'PAY_OVERTIME_PE', group: 'Charges de personnel — non national', code: '6621', name: SAL, scope: 'SYSCOHADA' },
  { key: 'PAY_BONUS_PE', group: 'Charges de personnel — non national', code: '6622', name: 'Primes et gratifications', scope: 'SYSCOHADA' },
  { key: 'PAY_LEAVE_PE', group: 'Charges de personnel — non national', code: '6623', name: 'Congés payés', scope: 'SYSCOHADA' },
  { key: 'PAY_SEVERANCE_PE', group: 'Charges de personnel — non national', code: '6624', name: 'Indemnités de préavis, de licenciement et de recherche d’embauche', scope: 'SYSCOHADA' },
  { key: 'PAY_NATURE_PE', group: 'Charges de personnel — non national', code: '6627', name: 'Avantages en nature', scope: 'SYSCOHADA' },
  // ── Indemnités forfaitaires (663) ───────────────────────────────────────
  { key: 'ALLOW_HOUSING', group: 'Indemnités (663)', code: '6631', name: 'Indemnités de logement', scope: 'SYSCOHADA' },
  { key: 'ALLOW_REPRESENTATION', group: 'Indemnités (663)', code: '6632', name: 'Indemnités de représentation', scope: 'SYSCOHADA' },
  { key: 'ALLOW_EXPATRIATION', group: 'Indemnités (663)', code: '6633', name: 'Indemnités d’expatriation', scope: 'SYSCOHADA' },
  { key: 'ALLOW_TRANSPORT', group: 'Indemnités (663)', code: '6638', name: 'Autres indemnités et avantages divers', scope: 'SYSCOHADA', hint: 'Transport : pas de compte dédié au plan (6638)' },
  { key: 'ALLOW_OTHER', group: 'Indemnités (663)', code: '6638', name: 'Autres indemnités et avantages divers', scope: 'SYSCOHADA' },
  // ── Charges sociales et taxes patronales ────────────────────────────────
  { key: 'CNSS_EMP_EXPENSE', group: 'Charges patronales', code: '6641', name: 'Charges sociales sur rémunération du personnel national', scope: 'CG' },
  { key: 'CNSS_EMP_EXPENSE_PE', group: 'Charges patronales', code: '6642', name: 'Charges sociales sur rémunération du personnel non national', scope: 'CG' },
  { key: 'TUS_DGI_EXPENSE', group: 'Charges patronales', code: '6413', name: 'Taxes sur appointements et salaires', scope: 'CG', hint: 'TUS (7,5 %) : charge de l’employeur' },
  { key: 'TUS_CNSS_EXPENSE', group: 'Charges patronales', code: '6413', name: 'Taxes sur appointements et salaires', scope: 'CG' },
  // ── Personnel (42) ──────────────────────────────────────────────────────
  { key: 'NET', group: 'Personnel (42)', code: '422', name: 'Personnel, rémunérations dues', scope: 'SYSCOHADA' },
  { key: 'ADVANCE', group: 'Personnel (42)', code: '4211', name: 'Personnel, avances', scope: 'SYSCOHADA', hint: 'Récupération d’avance sur salaire' },
  { key: 'LOAN', group: 'Personnel (42)', code: '272', name: 'Prêts au personnel', scope: 'SYSCOHADA', hint: 'Remboursement de prêt (le plan liste aussi 2762) — à confirmer avec le comptable' },
  { key: 'SALARY_ROUNDING', group: 'Personnel (42)', code: '7588', name: 'Autres produits divers', scope: 'SYSCOHADA', hint: 'Arrondi du net à 50 FCFA' },
  // ── Organismes sociaux (43) ─────────────────────────────────────────────
  { key: 'CNSS_SAL', group: 'Organismes sociaux (43)', code: '4313', name: 'Caisse de retraite obligatoire', scope: 'CG', hint: 'Part salariale 4 % (PVID)' },
  { key: 'CNSS_EMP_PENSION_LIABILITY', group: 'Organismes sociaux (43)', code: '4313', name: 'Caisse de retraite obligatoire', scope: 'CG' },
  { key: 'CNSS_EMP_FAMILY_LIABILITY', group: 'Organismes sociaux (43)', code: '4311', name: 'Prestations familiales', scope: 'CG' },
  { key: 'CNSS_EMP_ACCIDENT_LIABILITY', group: 'Organismes sociaux (43)', code: '4312', name: 'Accidents du travail', scope: 'CG' },
  { key: 'CNSS_EMP_LIABILITY', group: 'Organismes sociaux (43)', code: '431', name: 'Sécurité sociale', scope: 'CG', hint: 'Bulletins anciens dont la CNSS patronale n’est pas ventilée' },
  // ── État (44) ───────────────────────────────────────────────────────────
  { key: 'ITS', group: 'État (44)', code: '4472', name: 'Impôts sur salaires', scope: 'CG' },
  { key: 'BNC', group: 'État (44)', code: '4472', name: 'Impôts sur salaires', scope: 'CG', hint: 'Retenue BNC traitée comme l’ITS' },
  { key: 'TUS_DGI_LIABILITY', group: 'État (44)', code: '4421', name: 'Impôts et taxes d’Etat', scope: 'CG' },
  { key: 'TUS_CNSS_LIABILITY', group: 'État (44)', code: '4421', name: 'Impôts et taxes d’Etat', scope: 'CG', hint: 'TUS recouvrée par la CNSS : reste une taxe d’État' },
  { key: 'CTAX_CAMU', group: 'État (44)', code: '4474', name: 'Contribution nationale de solidarité', scope: 'CG', hint: 'CAMU solidarité' },
  { key: 'CTAX_TOL', group: 'État (44)', code: '4478', name: 'Autres impôts et contributions', scope: 'CG', hint: 'TOL — propre au Congo' },
  // ── Trésorerie ──────────────────────────────────────────────────────────
  { key: 'BANK', group: 'Trésorerie', code: '521', name: 'Banques locales', scope: 'SYSCOHADA' },
  // ── Provisions de personnel ─────────────────────────────────────────────
  { key: 'LEAVE_PROVISION_LIABILITY', group: 'Provisions de personnel', code: '4281', name: 'Dettes provisionnées pour congés à payer', scope: 'SYSCOHADA' },
  { key: 'LEAVE_PROVISION_SOCIAL_LIABILITY', group: 'Provisions de personnel', code: '4382', name: 'Charges sociales sur congés à payer', scope: 'SYSCOHADA' },
]);

export const DEFAULT_PLAN: Readonly<AccountPlan> = Object.freeze(
  Object.fromEntries(RUBRICS.map((r) => [r.key, Object.freeze({ code: r.code, name: r.name })])),
);

/** Compatibilité : clé → numéro par défaut. */
export const SYSCOHADA_DEFAULTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(RUBRICS.map((r) => [r.key, r.code])),
);

/**
 * Compte d'une rubrique : 1) affectation propre à l'entreprise (liaison Compta),
 * 2) plan en vigueur (défaut ⊕ surcharges super admin), jamais de valeur inventée.
 */
export function resolveAccount(
  key: string,
  mappings?: Record<string, string> | null,
  plan: Readonly<AccountPlan> = DEFAULT_PLAN,
): PlanAccount | undefined {
  const custom = mappings?.[key];
  if (/^\d{2,10}$/.test(custom ?? '')) return { code: custom as string, name: plan[key]?.name ?? '' };
  return plan[key];
}

// ── Plan en vigueur à une période (branché par AccountingPlanService) ──────
type PlanResolver = (country: string, dateKey: string) => AccountPlan;
let boundResolver: PlanResolver | null = null;
export const bindAccountingPlanResolver = (fn: PlanResolver | null) => { boundResolver = fn; };
export const periodKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;
export const DEFAULT_COUNTRY = 'CG';
/** Plan applicable à une période de paie ; défaut du code si rien n'est publié. */
export function getPlanForPeriod(year: number, month: number, country: string = DEFAULT_COUNTRY): AccountPlan {
  return boundResolver ? boundResolver(country, periodKey(year, month)) : { ...DEFAULT_PLAN };
}

/** Personnel non national = nationalité renseignée et différente du Congo. */
export function isNonNational(nationality?: string | null): boolean {
  const raw = (nationality ?? '').trim();
  if (!raw) return false;
  return (normalizeNationality(raw) ?? raw) !== 'Congo';
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export type GainKind =
  | 'BONUS' | 'OVERTIME' | 'LEAVE' | 'SEVERANCE' | 'NATURE'
  | 'HOUSING' | 'REPRESENTATION' | 'EXPATRIATION' | 'TRANSPORT' | 'OTHER_ALLOWANCE';

/** Classe une rubrique GAIN (hors SAL_BASE) vers sa nature comptable. */
export function classifyGain(item: { code: string | null; label: string; isTaxable: boolean; isNature?: boolean | null }): GainKind {
  const code = item.code ?? '';
  if (/^HS_/.test(code)) return 'OVERTIME';
  if (code === 'INDEM_CONGE' || code === 'CONGE_SUPP') return 'LEAVE';
  if (item.isNature === true) return 'NATURE';
  const label = fold(item.label);
  if (/preavis|licenciement|recherche d.?embauche|indemnite de depart|fin de contrat/.test(label)) return 'SEVERANCE';
  if (/logement|loyer|habitation/.test(label)) return 'HOUSING';
  if (/representation/.test(label)) return 'REPRESENTATION';
  if (/expatriation/.test(label)) return 'EXPATRIATION';
  if (/transport|deplacement|velo|vehicule|carburant/.test(label)) return 'TRANSPORT';
  return item.isTaxable ? 'BONUS' : 'OTHER_ALLOWANCE';
}

const SUFFIX = (nonNational: boolean) => (nonNational ? '_PE' : '');
export const grossKey = (kind: GainKind | 'BASE', nonNational: boolean): string => {
  switch (kind) {
    case 'BASE': return 'PAY_BASE' + SUFFIX(nonNational);
    case 'BONUS': return 'PAY_BONUS' + SUFFIX(nonNational);
    case 'OVERTIME': return 'PAY_OVERTIME' + SUFFIX(nonNational);
    case 'LEAVE': return 'PAY_LEAVE' + SUFFIX(nonNational);
    case 'SEVERANCE': return 'PAY_SEVERANCE' + SUFFIX(nonNational);
    case 'NATURE': return 'PAY_NATURE' + SUFFIX(nonNational);
    case 'HOUSING': return 'ALLOW_HOUSING';
    case 'REPRESENTATION': return 'ALLOW_REPRESENTATION';
    case 'EXPATRIATION': return 'ALLOW_EXPATRIATION';
    case 'TRANSPORT': return 'ALLOW_TRANSPORT';
    default: return 'ALLOW_OTHER';
  }
};
export const GROSS_LABELS: Record<string, string> = {
  PAY_BASE: 'Salaires de base', PAY_BONUS: 'Primes et gratifications', PAY_OVERTIME: 'Heures supplémentaires', PAY_LEAVE: 'Indemnités de congé payé',
  PAY_SEVERANCE: 'Indemnités de préavis et de licenciement', PAY_NATURE: 'Avantages en nature',
  ALLOW_HOUSING: 'Indemnité de logement', ALLOW_REPRESENTATION: 'Indemnité de représentation', ALLOW_EXPATRIATION: 'Indemnité d’expatriation',
  ALLOW_TRANSPORT: 'Indemnité de transport', ALLOW_OTHER: 'Autres indemnités',
};
export const labelOfGrossKey = (key: string) => GROSS_LABELS[key.replace(/_PE$/, '')] + (key.endsWith('_PE') ? ' (personnel non national)' : '');

/** Libellé lisible de chaque rubrique (écran super admin). */
export const RUBRIC_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PAY_BASE: 'Salaire de base', PAY_OVERTIME: 'Heures supplémentaires', PAY_BONUS: 'Primes et gratifications (13e mois inclus)', PAY_LEAVE: 'Indemnité de congé payé',
  PAY_SEVERANCE: 'Indemnités de préavis / licenciement', PAY_NATURE: 'Avantages en nature',
  PAY_BASE_PE: 'Salaire de base', PAY_OVERTIME_PE: 'Heures supplémentaires', PAY_BONUS_PE: 'Primes et gratifications', PAY_LEAVE_PE: 'Indemnité de congé payé',
  PAY_SEVERANCE_PE: 'Indemnités de préavis / licenciement', PAY_NATURE_PE: 'Avantages en nature',
  ALLOW_HOUSING: 'Indemnité de logement', ALLOW_REPRESENTATION: 'Indemnité de représentation', ALLOW_EXPATRIATION: 'Indemnité d’expatriation',
  ALLOW_TRANSPORT: 'Indemnité de transport', ALLOW_OTHER: 'Autres indemnités (panier, tenue…)',
  CNSS_EMP_EXPENSE: 'CNSS patronale — charge (personnel national)', CNSS_EMP_EXPENSE_PE: 'CNSS patronale — charge (non national)',
  TUS_DGI_EXPENSE: 'TUS — charge part DGI', TUS_CNSS_EXPENSE: 'TUS — charge part CNSS',
  NET: 'Net à payer (rémunérations dues)', ADVANCE: 'Récupération d’avance sur salaire', LOAN: 'Remboursement de prêt', SALARY_ROUNDING: 'Arrondi sur salaire',
  CNSS_SAL: 'CNSS salariale (retenue)', CNSS_EMP_PENSION_LIABILITY: 'CNSS patronale à reverser — retraite', CNSS_EMP_FAMILY_LIABILITY: 'CNSS patronale à reverser — famille',
  CNSS_EMP_ACCIDENT_LIABILITY: 'CNSS patronale à reverser — accidents du travail', CNSS_EMP_LIABILITY: 'CNSS patronale à reverser — non ventilée',
  ITS: 'ITS retenu à reverser', BNC: 'Retenue BNC', TUS_DGI_LIABILITY: 'TUS à reverser — part DGI', TUS_CNSS_LIABILITY: 'TUS à reverser — part CNSS',
  CTAX_CAMU: 'CAMU solidarité', CTAX_TOL: 'TOL', BANK: 'Banque (règlements)',
  LEAVE_PROVISION_LIABILITY: 'Provision congés payés', LEAVE_PROVISION_SOCIAL_LIABILITY: 'Charges sociales sur congés à payer',
});