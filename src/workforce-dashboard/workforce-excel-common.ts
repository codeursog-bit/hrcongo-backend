// ============================================================================
// 📁 src/workforce-dashboard/workforce-excel-common.ts
// Outils communs aux exports ORCA et POWERMAN : styles, références de
// plages, expressions SUMPRODUCT de "présence à une date", onglet Évolution.
// ============================================================================

import * as ExcelJS from 'exceljs';
import { ChartSpec, sheetRef } from './xlsx-chart-injector';
import { isPresent } from './workforce-calc';
import { WfEmployee, WfMonth, WorkforceDashboardData } from './workforce-dashboard.types';

export const colLetter = (n: number): string => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** Numéro de série Excel d'une date (UTC). */
export const serial = (d: Date): number => Math.round(d.getTime() / 86400000) + 25569;

export const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

export function uniqueSheetName(wb: ExcelJS.Workbook, raw: string): string {
  const base = raw.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Feuille';
  let name = base, i = 2;
  while (wb.getWorksheet(name)) {
    const suf = ` ${i++}`;
    name = base.slice(0, 31 - suf.length) + suf;
  }
  return name;
}

// ───────────────────────────────── Styles ─────────────────────────────────────

export const argb = (rgb: string) => `FF${rgb}`;
export const solid = (rgb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(rgb) } });
export const border = (rgb = '000000', style: ExcelJS.BorderStyle = 'thin'): Partial<ExcelJS.Borders> => ({
  top: { style, color: { argb: argb(rgb) } },
  left: { style, color: { argb: argb(rgb) } },
  bottom: { style, color: { argb: argb(rgb) } },
  right: { style, color: { argb: argb(rgb) } },
});

export interface CellStyle {
  font?: Partial<ExcelJS.Font>;
  fill?: string; // RRGGBB
  border?: Partial<ExcelJS.Borders>;
  align?: Partial<ExcelJS.Alignment>;
  numFmt?: string;
}

export function put(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue, st: CellStyle = {}) {
  const c = ws.getCell(row, col);
  c.value = value;
  if (st.font) c.font = { name: 'Calibri', size: 11, ...st.font };
  if (st.fill) c.fill = solid(st.fill);
  if (st.border) c.border = st.border;
  if (st.align) c.alignment = st.align;
  if (st.numFmt) c.numFmt = st.numFmt;
  return c;
}

/** Cellule formule avec valeur en cache (aperçus sans recalcul). */
export const fx = (formula: string, result: number | string | boolean | null): ExcelJS.CellFormulaValue =>
  ({ formula: formula.replace(/^=/, ''), result: result as any });

// ───────────────────── Expressions "présent à une date" ───────────────────────

/** Description d'un onglet liste : où sont les colonnes (lettres) et les lignes. */
export interface ListRef {
  sheet: string;
  r0: number; // première ligne de données
  r1: number; // dernière ligne couverte par les formules (marge pour ajouts)
  cols: Record<string, string>; // clé logique → lettre de colonne
}

export const rng = (l: ListRef, key: string) => `${q(l.sheet)}!$${l.cols[key]}$${l.r0}:$${l.cols[key]}$${l.r1}`;

/** Condition booléenne-tableau : embauché ≤ date ET (sans sortie OU sortie > date). */
export function presentExpr(l: ListRef, eomRef: string): string {
  const h = rng(l, 'hire');
  const x = rng(l, 'exit');
  return `(${h}>0)*(${h}<=${eomRef})*((((${x}="")+(${x}>${eomRef}))>0))`;
}

/** Somme SUMPRODUCT sur plusieurs onglets avec conditions supplémentaires. */
export function countAt(
  lists: ListRef[],
  eomRef: string,
  extra: (l: ListRef) => string[] = () => [],
): string {
  return lists.map((l) => `SUMPRODUCT(${[presentExpr(l, eomRef), ...extra(l)].join('*')})`).join('+');
}

export const eq = (l: ListRef, key: string, valueExpr: string) => `(${rng(l, key)}=${valueExpr})`;
export const lit = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Même calcul en JS (valeur en cache). */
export function jsCount(employees: WfEmployee[], eom: Date, pred: (e: WfEmployee) => boolean = () => true): number {
  return employees.filter((e) => isPresent(e, eom) && pred(e)).length;
}

export const PALETTE_MULTI = [
  '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646',
  '2C4D75', '772C2A', '5F7530', '4D3B62', '276A7C', 'B65708',
];

// ───────────────────────── Onglet "Évolution" ────────────────────────────────

export interface EvolutionOptions {
  title: string;
  withNationality: boolean;
  genderLabels: { M: string; F: string };
  headerFill: string; // RRGGBB
  headerFont: string; // RRGGBB
  accent: string; // RRGGBB (barre "total")
  accent2: string; // RRGGBB (femmes)
  accent3: string; // RRGGBB (hommes)
}

/**
 * Tableau mois par mois (formules sur la/les listes) + 2 graphiques natifs.
 * Retourne les graphiques à injecter après coup.
 */
export function addEvolutionSheet(
  wb: ExcelJS.Workbook,
  data: WorkforceDashboardData,
  lists: ListRef[],
  opt: EvolutionOptions,
): ChartSpec[] {
  const name = uniqueSheetName(wb, 'Evolution effectif');
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  const months = data.period.months;
  const headers = ['MOIS', 'DU', 'AU', 'EFFECTIF FIN DE MOIS', opt.genderLabels.M, opt.genderLabels.F, 'ENTRÉES', 'SORTIES'];
  if (opt.withNationality) headers.push('NATIONAUX', 'ÉTRANGERS');
  const nCols = headers.length;

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 12;
  for (let c = 4; c <= nCols; c++) ws.getColumn(c).width = 16;

  ws.mergeCells(2, 1, 2, nCols);
  put(ws, 2, 1, `ÉVOLUTION DE L'EFFECTIF — ${data.period.label}`, {
    font: { name: 'Arial', size: 18, bold: true, color: { argb: argb('002060') } },
    align: { horizontal: 'center', vertical: 'middle' },
  });
  ws.getRow(2).height = 34;
  ws.mergeCells(3, 1, 3, nCols);
  put(ws, 3, 1, data.scope.companyName, {
    font: { name: 'Calibri', size: 12, italic: true, color: { argb: argb('595959') } },
    align: { horizontal: 'center' },
  });

  const HR = 5;
  headers.forEach((h, i) =>
    put(ws, HR, i + 1, h, {
      font: { name: 'Britannic Bold', size: 11, bold: true, color: { argb: argb(opt.headerFont) } },
      fill: opt.headerFill,
      border: border(),
      align: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),
  );
  ws.getRow(HR).height = 32;

  const tx = { font: { name: 'Calibri', size: 11 }, border: border(), align: { horizontal: 'center' as const } };
  const emps = data.employees;

  months.forEach((m, i) => {
    const r = HR + 1 + i;
    const bom = `$B${r}`;
    const eom = `$C${r}`;
    put(ws, r, 1, m.label, { ...tx, font: { name: 'Calibri', size: 11, bold: true }, align: { horizontal: 'left' } });
    put(ws, r, 2, m.bom, { ...tx, numFmt: 'dd/mm/yyyy' });
    put(ws, r, 3, m.eom, { ...tx, numFmt: 'dd/mm/yyyy' });

    const M = lists.map((l) => eq(l, 'gender', lit(opt.genderLabels.M)));
    const F = lists.map((l) => eq(l, 'gender', lit(opt.genderLabels.F)));
    const total = emps.filter((e) => isPresent(e, m.eom)).length;
    const nM = jsCount(emps, m.eom, (e) => e.gender === 'M');
    const nF = jsCount(emps, m.eom, (e) => e.gender === 'F');
    put(ws, r, 4, fx(countAt(lists, eom), total), { ...tx, font: { name: 'Calibri', size: 11, bold: true } });
    put(ws, r, 5, fx(countAt(lists, eom, (l) => [M[lists.indexOf(l)]]), nM), tx);
    put(ws, r, 6, fx(countAt(lists, eom, (l) => [F[lists.indexOf(l)]]), nF), tx);

    const hires = emps.filter((e) => e.hireDate >= m.bom && e.hireDate <= m.eom).length;
    const exits = emps.filter((e) => e.exitDate && e.exitDate >= m.bom && e.exitDate <= m.eom).length;
    put(ws, r, 7, fx(lists.map((l) => `SUMPRODUCT((${rng(l, 'hire')}>=${bom})*(${rng(l, 'hire')}<=${eom}))`).join('+'), hires), tx);
    put(ws, r, 8, fx(lists.map((l) => `SUMPRODUCT((${rng(l, 'exit')}>=${bom})*(${rng(l, 'exit')}<=${eom}))`).join('+'), exits), tx);

    if (opt.withNationality) {
      const nat = jsCount(emps, m.eom, (e) => e.isNational);
      put(ws, r, 9, fx(countAt(lists, eom, (l) => [eq(l, 'nationality', lit('Congolaise'))]), nat), tx);
      put(ws, r, 10, fx(`D${r}-I${r}`, total - nat), tx);
    }
  });

  const r0 = HR + 1, r1 = HR + months.length;
  const cats = months.map((m) => m.short);
  // libellés de catégories : on utilise le libellé complet du mois (col A)
  const catsRef = sheetRef(name, `$A$${r0}:$A$${r1}`);
  const catsLabel = months.map((m) => m.label);
  const vals = (key: (m: WfMonth) => number) => months.map(key);
  const totals = vals((m) => emps.filter((e) => isPresent(e, m.eom)).length);
  const hs = vals((m) => jsCount(emps, m.eom, (e) => e.gender === 'M'));
  const fs = vals((m) => jsCount(emps, m.eom, (e) => e.gender === 'F'));

  const top = r1 + 3;
  const rows = 18;
  const charts: ChartSpec[] = [
    {
      sheet: name,
      from: { col: 0, row: top },
      to: { col: Math.min(nCols, 5), row: top + rows },
      kind: 'line',
      title: "ÉVOLUTION DE L'EFFECTIF TOTAL",
      titleColor: '002060',
      catsRef,
      cats: catsLabel,
      series: [{ name: 'Effectif', nameRef: sheetRef(name, `$D$${HR}`), valuesRef: sheetRef(name, `$D$${r0}:$D$${r1}`), vals: totals, color: opt.accent, labelColor: '002060' }],
      gapWidth: 80,
    },
    {
      sheet: name,
      from: { col: Math.min(nCols, 5), row: top },
      to: { col: Math.min(nCols, 5) + 5, row: top + rows },
      kind: 'col',
      title: `EFFECTIF PAR GENRE — ${cats[0]} → ${cats[cats.length - 1]}`,
      titleColor: '002060',
      catsRef,
      cats: catsLabel,
      series: [
        { name: opt.genderLabels.M, nameRef: sheetRef(name, `$E$${HR}`), valuesRef: sheetRef(name, `$E$${r0}:$E$${r1}`), vals: hs, color: opt.accent3 },
        { name: opt.genderLabels.F, nameRef: sheetRef(name, `$F$${HR}`), valuesRef: sheetRef(name, `$F$${r0}:$F$${r1}`), vals: fs, color: opt.accent2 },
      ],
      showLegend: true,
      gapWidth: 60,
    },
  ];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return charts;
}

/**
 * Nom lisible + sécurisé pour le fichier téléchargé : <préfixe>_<entreprise>_<période>.xlsx
 * Aucune marque de modèle (ni « ORCA » ni « POWERMAN ») : uniquement le nom de l'entreprise,
 * ou « Konza RH » quand le fichier couvre tout le portefeuille.
 */
export function exportFileName(prefix: string, data: WorkforceDashboardData): string {
  const clean = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const p = data.period;
  const span =
    p.months.length === 1
      ? `${String(p.first.month).padStart(2, '0')}_${p.first.year}`
      : `${p.first.key.replace('-', '_')}_a_${p.last.key.replace('-', '_')}`;
  const who = data.scope.multi ? 'Konza RH' : data.scope.companyName;
  return `${prefix}_${clean(who).slice(0, 40) || 'Konza_RH'}_${span}.xlsx`;
}