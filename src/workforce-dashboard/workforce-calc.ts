// ============================================================================
// 📁 src/workforce-dashboard/workforce-calc.ts
// ✅ Règles de calcul PURES (aucun accès base) — utilisées à la fois pour
// l'écran (JSON) et pour les valeurs en cache de l'Excel. Les formules Excel
// reproduisent exactement ces règles, donc écran et fichier concordent.
//
// Règle de présence (identique à PortfolioReportsService) : un employé compte
// pour un mois s'il est embauché au plus tard le dernier jour du mois ET n'est
// pas parti à cette date ou avant (sortie le dernier jour = déjà parti).
// ============================================================================

import {
  AgeBucket,
  ContractGroup,
  CountRow,
  PeriodMode,
  WfEmployee,
  WfIndicators,
  WfMonth,
  WfPeriod,
  WfSnapshot,
} from './workforce-dashboard.types';

export const MONTHS_FR = [
  'JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
  'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE',
];
export const MONTHS_SHORT = ['JAN', 'FEV', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOUT', 'SEPT', 'OCT', 'NOV', 'DEC'];

export const NATIONAL_LABEL = 'Congolaise';
export const MAX_MONTHS = 24;

export const CONTRACT_LABEL_ORCA: Record<ContractGroup, string> = {
  PERMANENT: 'CONTRAT PERMANENT LOCAL',
  EXPATRIE: "CONTRAT D'EXPATRIE (CDD)",
  STAGIAIRE: 'STAGIAIRE',
  PRESTATAIRE: 'CONTRAT DE PRESTATIONS',
};

export const CONTRACT_LABELS_POWERMAN = [
  'CONTRAT DUREE INDETERMINEE',
  'CONTRAT DE TRAVAIL TEMPORAIRE',
  'CONTRAT DE PRESTATION',
  'STAGE',
];

export const CSP_ORDER = ['CADRES', 'AGENT DE MAITRISE', 'EXECUTANT', 'NON CLASSÉ'];

export const AGE_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: '< 20 ans', lo: 0, hi: 19 },
  { label: '20-24 ans', lo: 20, hi: 24 },
  { label: '25-29 ans', lo: 25, hi: 29 },
  { label: '30-34 ans', lo: 30, hi: 34 },
  { label: '35-39 ans', lo: 35, hi: 39 },
  { label: '40-44 ans', lo: 40, hi: 44 },
  { label: '45-49 ans', lo: 45, hi: 49 },
  { label: '50-54 ans', lo: 50, hi: 54 },
  { label: '55-59 ans', lo: 55, hi: 59 },
  { label: '60 ans et +', lo: 60, hi: 200 },
];

// ───────────────────────────── Dates / période ──────────────────────────────

export const utcDate = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));

export function toDateOnly(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x.getTime())) return null;
  return utcDate(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

export function makeMonth(month: number, year: number): WfMonth {
  return {
    month,
    year,
    label: `${MONTHS_FR[month - 1]} ${year}`,
    short: `${MONTHS_SHORT[month - 1]} ${String(year).slice(-2)}`,
    eom: utcDate(year, month, 0),
    bom: utcDate(year, month - 1, 1),
    key: `${year}-${String(month).padStart(2, '0')}`,
  };
}

export interface PeriodInput {
  mode?: string;
  fromMonth?: number;
  fromYear?: number;
  toMonth?: number;
  toYear?: number;
  month?: number;
  year?: number;
}

/**
 * MOIS  : un mois ; PLAGE : de fromMonth/fromYear à toMonth/toYear ;
 * ANNEE : janvier → décembre (limité au mois en cours si l'année est en cours,
 * on ne génère jamais de mois futurs).
 */
export function buildPeriod(input: PeriodInput, now = new Date()): WfPeriod {
  const curM = now.getUTCMonth() + 1;
  const curY = now.getUTCFullYear();
  const mode: PeriodMode = input.mode === 'PLAGE' ? 'PLAGE' : input.mode === 'ANNEE' ? 'ANNEE' : 'MOIS';

  let fm: number, fy: number, tm: number, ty: number;
  if (mode === 'ANNEE') {
    const y = int(input.year ?? input.toYear, curY);
    fm = 1; fy = y; tm = 12; ty = y;
  } else if (mode === 'PLAGE') {
    fm = int(input.fromMonth, 1); fy = int(input.fromYear, curY);
    tm = int(input.toMonth, curM); ty = int(input.toYear, curY);
  } else {
    fm = tm = int(input.month ?? input.toMonth, curM);
    fy = ty = int(input.year ?? input.toYear, curY);
  }
  fm = clamp(fm, 1, 12); tm = clamp(tm, 1, 12);

  // pas de mois futur
  if (ty > curY || (ty === curY && tm > curM)) { ty = curY; tm = curM; }
  if (fy > ty || (fy === ty && fm > tm)) { fy = ty; fm = tm; }

  const months: WfMonth[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(makeMonth(m, y));
    m++; if (m > 12) { m = 1; y++; }
    if (months.length > MAX_MONTHS) throw new RangeError(`Période trop longue (maximum ${MAX_MONTHS} mois).`);
  }
  const first = months[0], last = months[months.length - 1];
  const label =
    months.length === 1
      ? first.label
      : first.year === last.year
        ? `${MONTHS_FR[first.month - 1]} → ${last.label}`
        : `${first.label} → ${last.label}`;
  return { mode, months, label, first, last };
}

const int = (v: unknown, d: number) => {
  const n = typeof v === 'string' ? parseInt(v, 10) : (v as number);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

// ───────────────────────────── Règles métier ────────────────────────────────

export function isPresent(e: Pick<WfEmployee, 'hireDate' | 'exitDate'>, eom: Date): boolean {
  return e.hireDate.getTime() <= eom.getTime() && (!e.exitDate || e.exitDate.getTime() > eom.getTime());
}

export function ageAt(birth: Date | null, at: Date): number | null {
  if (!birth) return null;
  return Math.floor((at.getTime() - birth.getTime()) / 86400000 / 365.25);
}

/** Même formule que la cellule AGE de l'Excel : INT((fin de mois - naissance)/365.25). */
export const excelAge = ageAt;

export function groupContract(contractType: string, isNational: boolean): ContractGroup {
  if (contractType === 'STAGE') return 'STAGIAIRE';
  if (contractType === 'PRESTATAIRE' || contractType === 'CONSULTANT' || contractType === 'INTERIM') return 'PRESTATAIRE';
  if (contractType === 'CDD' && !isNational) return 'EXPATRIE';
  return 'PERMANENT';
}

export function contractLabelPowerman(contractType: string): string {
  if (contractType === 'CDI') return CONTRACT_LABELS_POWERMAN[0];
  if (contractType === 'CDD' || contractType === 'INTERIM') return CONTRACT_LABELS_POWERMAN[1];
  if (contractType === 'PRESTATAIRE' || contractType === 'CONSULTANT') return CONTRACT_LABELS_POWERMAN[2];
  return CONTRACT_LABELS_POWERMAN[3];
}

/**
 * Catégorie socio-professionnelle à partir de la classification de la convention
 * (ex. "Cat.3 Éch.4", "A1", "Cadre"). Règle : mot-clé d'abord, sinon numéro de
 * catégorie — ≤ 8 exécutant, 9-14 agent de maîtrise, ≥ 15 cadre (grille relevée
 * dans le modèle POWERMAN). Non reconnu → NON CLASSÉ (jamais deviné).
 */
export function cspFromCategory(cat: string | null | undefined): string {
  const s = (cat ?? '').trim();
  if (!s) return 'NON CLASSÉ';
  const low = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bcadre/.test(low)) return 'CADRES';
  if (/maitrise|\bam\b/.test(low)) return 'AGENT DE MAITRISE';
  if (/executant|ouvrier|manoeuvre|employe/.test(low)) return 'EXECUTANT';
  const n = low.match(/(?:cat(?:egorie)?\.?\s*|^)(\d{1,2})\b/);
  if (n) {
    const v = parseInt(n[1], 10);
    if (v <= 8) return 'EXECUTANT';
    if (v <= 14) return 'AGENT DE MAITRISE';
    return 'CADRES';
  }
  return 'NON CLASSÉ';
}

export const cleanText = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Regroupe sans tenir compte de la casse (comme l'égalité Excel), garde la 1re graphie rencontrée. */
export function tally(values: string[], emptyLabel = 'Non renseigné'): CountRow[] {
  const map = new Map<string, CountRow>();
  for (const raw of values) {
    const v = cleanText(raw) || emptyLabel;
    // Même règle que l'égalité Excel (insensible à la casse, sensible aux accents),
    // pour que les lignes du tableau et les formules COUNTIFS/SUMPRODUCT concordent.
    const key = v.toLowerCase();
    const row = map.get(key);
    if (row) row.count++;
    else map.set(key, { label: v, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
}

export const sameText = (a: string, b: string) =>
  cleanText(a).toLowerCase() === cleanText(b).toLowerCase();

// ─────────────────────────────── Instantané ─────────────────────────────────

export interface AttendanceAgg {
  /** "AAAA-MM" → agrégats de présence de tous les salariés du périmètre */
  [monthKey: string]: { present: number; remote: number; absPaid: number; absUnpaid: number; absentEmployees: number } | undefined;
}

export function snapshotFor(
  employees: WfEmployee[],
  month: WfMonth,
  attendance: AttendanceAgg,
  allMonthsOfYear: WfMonth[],
): WfSnapshot {
  const here = employees.filter((e) => isPresent(e, month.eom));
  const g = { M: 0, F: 0, O: 0 };
  const c = { PERMANENT: 0, EXPATRIE: 0, STAGIAIRE: 0, PRESTATAIRE: 0 };
  const n = { nat: 0, etr: 0, natM: 0, natF: 0, etrM: 0, etrF: 0 };
  for (const e of here) {
    g[e.gender]++;
    c[e.contractGroup]++;
    if (e.isNational) { n.nat++; if (e.gender === 'M') n.natM++; if (e.gender === 'F') n.natF++; }
    else { n.etr++; if (e.gender === 'M') n.etrM++; if (e.gender === 'F') n.etrF++; }
  }

  const buckets: AgeBucket[] = AGE_BUCKETS.map((b) => ({ ...b, M: 0, F: 0 }));
  for (const e of here) {
    const a = ageAt(e.birthDate, month.eom);
    if (a === null) continue;
    const b = buckets.find((x) => a >= x.lo && a <= x.hi);
    if (b) { if (e.gender === 'M') b.M++; else if (e.gender === 'F') b.F++; }
  }

  const cspRows = tally(here.map((e) => e.csp));
  cspRows.sort((a, b) => CSP_ORDER.indexOf(a.label) - CSP_ORDER.indexOf(b.label));

  const hires = employees.filter((e) => e.hireDate >= month.bom && e.hireDate <= month.eom).length;
  const departures = employees.filter((e) => e.exitDate && e.exitDate >= month.bom && e.exitDate <= month.eom).length;

  // Turn-over : départs de l'année civile jusqu'à fin du mois / effectif moyen
  const yStart = utcDate(month.year, 0, 1);
  const ytdMonths = allMonthsOfYear.filter((m) => m.year === month.year && m.month <= month.month);
  const departuresYtd = employees.filter((e) => e.exitDate && e.exitDate >= yStart && e.exitDate <= month.eom).length;
  const avgHeadcount = ytdMonths.length
    ? ytdMonths.reduce((s, m) => s + employees.filter((e) => isPresent(e, m.eom)).length, 0) / ytdMonths.length
    : 0;

  const att = attendance[month.key];
  const turnover = avgHeadcount > 0 ? departuresYtd / avgHeadcount : 0;
  let indicators: WfIndicators;
  if (att) {
    const absenceDays = att.absPaid + att.absUnpaid;
    const theoretical = att.present + att.remote + absenceDays;
    const rate = theoretical > 0 ? absenceDays / theoretical : 0;
    indicators = {
      hasAttendance: true,
      absenceDays,
      theoreticalDays: theoretical,
      absenceCount: att.absentEmployees,
      absenteeismRate: rate,
      avgAbsenceDuration: att.absentEmployees > 0 ? absenceDays / att.absentEmployees : 0,
      presenceRate: theoretical > 0 ? 1 - rate : 0,
      departuresYtd,
      avgHeadcountYtd: avgHeadcount,
      turnover,
    };
  } else {
    // pas de synthèse de présence : le turn-over reste calculable (il ne dépend que des dates)
    indicators = {
      hasAttendance: false,
      absenceDays: 0,
      theoreticalDays: 0,
      absenceCount: 0,
      absenteeismRate: 0,
      avgAbsenceDuration: 0,
      presenceRate: 0,
      departuresYtd,
      avgHeadcountYtd: avgHeadcount,
      turnover,
    };
  }

  return {
    month,
    total: here.length,
    gender: g,
    contract: c,
    nationality: n,
    functions: tally(here.map((e) => e.position), 'Non renseigné'),
    departments: tally(here.map((e) => e.department), 'Sans département'),
    csp: cspRows,
    contractPowerman: CONTRACT_LABELS_POWERMAN.map((label) => ({
      label,
      count: here.filter((e) => e.contractLabelPowerman === label).length,
    })),
    cities: tally(here.map((e) => e.originCity), 'Non renseigné'),
    ageBuckets: buckets,
    hires,
    departures,
    indicators,
  };
}