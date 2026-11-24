// ============================================================================
// 📁 src/workforce-dashboard/workforce-excel-orca.ts
// ✅ Export "FICHIER EFFECTIF" — modèle ORCA (depuis la liste des employés).
//
// Onglets (comme le modèle) : LISTE EMPLOYES · LISTE Stagiaires ·
// LISTE Prestataire · TB Effectif (4 graphiques). Période en plage : un onglet
// "Evolution effectif" + un "TB Effectif <mois>" par mois.
//
// DYNAMIQUE : chaque tableau du TB est une FORMULE (SUMPRODUCT) qui lit les
// onglets de liste (dates d'entrée/sortie incluses) ; les graphiques pointent
// sur ces cellules. Modifier une ligne dans une liste (genre, fonction,
// nationalité, date de sortie…) met à jour tableaux ET graphiques. Les
// formules couvrent 300 lignes libres sous chaque liste pour les ajouts.
// ============================================================================

import * as ExcelJS from 'exceljs';
import { ChartSpec, injectCharts, sheetRef } from './xlsx-chart-injector';
import {
  CellStyle, ListRef, PALETTE_MULTI, argb, border, colLetter, countAt, eq, fx, jsCount, lit, put, q, rng,
  uniqueSheetName, addEvolutionSheet, serial,
} from './workforce-excel-common';
import { CONTRACT_LABEL_ORCA, NATIONAL_LABEL, isPresent } from './workforce-calc';
import { WfEmployee, WfMonth, WfSnapshot, WorkforceDashboardData } from './workforce-dashboard.types';

const NAVY = '002060';
const BLUE = '0070C0';
const DARKBLUE = '000066';
const MAGENTA = 'FF33CC';
const GREY_TITLE = 'D0CECE';
const GENDER_M = 'Masculin';
const GENDER_F = 'Féminin';

interface Col { key: string; header: string; width: number }
const COLS: Col[] = [
  { key: 'mat', header: 'N° Mat', width: 10 },
  { key: 'num', header: 'N°', width: 8 },
  { key: 'name', header: 'NOM(S)', width: 38 },
  { key: 'position', header: 'FONCTION', width: 36 },
  { key: 'phone', header: 'Contact téléphonique', width: 26 },
  { key: 'gender', header: 'GENRE', width: 14 },
  { key: 'nationality', header: 'NATIONALITE', width: 18 },
  { key: 'children', header: "NOMBRES D'ENFANTS", width: 16 },
  { key: 'marital', header: 'SITUATION MATRIMONIALE', width: 24 },
  { key: 'cnss', header: 'NUMEROS CNSS', width: 24 },
  { key: 'hire', header: "DATE D'ENTRÉE", width: 15 },
  { key: 'exit', header: 'DATE DE SORTIE', width: 15 },
  { key: 'contract', header: 'TYPE DE CONTRAT', width: 30 },
];
const LETTER: Record<string, string> = Object.fromEntries(COLS.map((c, i) => [c.key, colLetter(i + 1)]));

const FREE_ROWS = 300; // lignes libres couvertes par les formules sous chaque liste

export async function buildOrcaWorkbook(data: WorkforceDashboardData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KonzaRH';
  wb.created = new Date();
  (wb as any).calcProperties = { fullCalcOnLoad: true };

  const charts: ChartSpec[] = [];
  const company = data.scope.companyName;
  const city = (data.scope.city || '').toUpperCase();
  const single = data.period.months.length === 1;
  const lastEom = data.period.last.eom;

  // ── 1. Listes ────────────────────────────────────────────────────────────
  const base = data.employees
    .filter((e) => (single ? isPresent(e, lastEom) : true))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'));

  const groups: { sheet: string; title: string; pick: (e: WfEmployee) => boolean }[] = [
    { sheet: 'LISTE EMPLOYES', title: `EFFECTIF EMPLOYES ${company.toUpperCase()}`, pick: (e) => e.contractGroup === 'PERMANENT' || e.contractGroup === 'EXPATRIE' },
    { sheet: 'LISTE Stagiaires', title: 'EFFECTIF STAGIAIRES', pick: (e) => e.contractGroup === 'STAGIAIRE' },
    { sheet: 'LISTE Prestataire', title: 'EFFECTIF PRESTATAIRE', pick: (e) => e.contractGroup === 'PRESTATAIRE' },
  ];

  const lists: ListRef[] = [];
  for (const g of groups) {
    const rows = base.filter(g.pick);
    const name = uniqueSheetName(wb, g.sheet);
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 4, xSplit: 3 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

    ws.mergeCells(1, 3, 1, 4);
    put(ws, 1, 3, g.title, { font: { name: 'Calibri', size: 20, bold: true }, align: { horizontal: 'center', vertical: 'middle' } });
    ws.getRow(1).height = 34;

    COLS.forEach((c, i) =>
      put(ws, 4, i + 1, c.header, {
        font: { name: 'Arial Black', size: i === 0 ? 11 : 11, bold: true },
        fill: i < 2 ? 'D9D9D9' : 'F2F2F2',
        border: border('000000', i === 0 ? 'medium' : 'thin'),
        align: { horizontal: 'center', vertical: 'middle', wrapText: true },
      }),
    );
    ws.getRow(4).height = 36;

    const r0 = 5;
    rows.forEach((e, idx) => {
      const r = r0 + idx;
      const cell = (key: string, v: ExcelJS.CellValue, st: CellStyle = {}) =>
        put(ws, r, COLS.findIndex((c) => c.key === key) + 1, v, {
          font: { name: 'Calibri', size: 12 }, border: border('808080'), align: { vertical: 'middle' }, ...st,
        });
      cell('mat', e.matricule, { align: { horizontal: 'center', vertical: 'middle' } });
      cell('num', fx('ROW()-4', idx + 1), { font: { name: 'Calibri', size: 12, bold: true }, align: { horizontal: 'center', vertical: 'middle' } });
      cell('name', e.fullName);
      cell('position', e.position, { font: { name: 'Calibri', size: 12, bold: true } });
      cell('phone', e.phone, { font: { name: 'Calibri', size: 11, bold: true }, align: { horizontal: 'center', vertical: 'middle' } });
      cell('gender', e.genderLabel, { align: { horizontal: 'center', vertical: 'middle' } });
      cell('nationality', e.nationalityLabel, { align: { horizontal: 'center', vertical: 'middle' } });
      cell('children', e.children, { align: { horizontal: 'center', vertical: 'middle' } });
      cell('marital', e.maritalLabel, { align: { horizontal: 'center', vertical: 'middle' } });
      cell('cnss', e.cnss, { align: { horizontal: 'center', vertical: 'middle' } });
      cell('hire', e.hireDate, { numFmt: 'dd/mm/yyyy', align: { horizontal: 'center', vertical: 'middle' } });
      cell('exit', e.exitDate ?? null, { numFmt: 'dd/mm/yyyy', align: { horizontal: 'center', vertical: 'middle' } });
      cell('contract', CONTRACT_LABEL_ORCA[e.contractGroup], { align: { horizontal: 'center', vertical: 'middle' } });
      ws.getRow(r).height = 24;
    });

    // Les cellules libres sous la liste restent saisissables (format date prêt).
    const lastDataRow = r0 + Math.max(rows.length, 1) - 1;
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(lastDataRow, 5), column: COLS.length } };

    lists.push({
      sheet: name,
      r0,
      r1: lastDataRow + FREE_ROWS,
      cols: { hire: LETTER.hire, exit: LETTER.exit, gender: LETTER.gender, nationality: LETTER.nationality, position: LETTER.position, contract: LETTER.contract },
    });
  }

  // ── 2. Évolution (plage / année) ─────────────────────────────────────────
  if (!single) {
    charts.push(
      ...addEvolutionSheet(wb, data, lists, {
        title: 'Évolution',
        withNationality: true,
        genderLabels: { M: 'HOMMES', F: 'FEMMES' },
        headerFill: BLUE,
        headerFont: 'FFFFFF',
        accent: BLUE,
        accent2: MAGENTA,
        accent3: '1F497D',
      }),
    );
  }

  // ── 3. Un TB par mois ─────────────────────────────────────────────────────
  const used = new Set<string>();
  data.snapshots.forEach((snap) => {
    const sheetName = uniqueSheetName(wb, single ? 'TB Effectif' : `TB Effectif ${snap.month.short}`);
    used.add(sheetName);
    charts.push(...addTb(wb, sheetName, snap, data, lists, city, company));
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return injectCharts(buf, charts);
}

// ───────────────────────────── Onglet TB (1 mois) ─────────────────────────────

function addTb(
  wb: ExcelJS.Workbook,
  sheetName: string,
  snap: WfSnapshot,
  data: WorkforceDashboardData,
  lists: ListRef[],
  city: string,
  company: string,
): ChartSpec[] {
  const ws = wb.addWorksheet(sheetName, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 1;
  ws.getColumn(3).width = 46;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 3;

  const m: WfMonth = snap.month;
  const emps = data.employees;
  const EOM = '$D$3';
  const ville = city ? `VILLE DE ${city}` : 'ENTREPRISE';
  const out: ChartSpec[] = [];

  // En-tête
  put(ws, 2, 3, `MOIS DE: ${m.label}`, { font: { name: 'Calibri', size: 20, bold: true } });
  put(ws, 3, 3, 'SITUATION AU :', { font: { name: 'Calibri', size: 11, bold: true, color: { argb: argb('595959') } }, align: { horizontal: 'right' } });
  put(ws, 3, 4, fx(`DATE(${m.year},${m.month}+1,0)`, serial(m.eom)), {
    font: { name: 'Calibri', size: 11, bold: true }, numFmt: 'dd/mm/yyyy', align: { horizontal: 'center' }, border: border(BLUE),
  });
  put(ws, 4, 3, `TABLEAU DE BORD DE SUIVI DE EFFECTIF ${company.toUpperCase()}`, {
    font: { name: 'Arial', size: 20, bold: true, color: { argb: argb(NAVY) } },
  });
  ws.getRow(2).height = 30;
  ws.getRow(4).height = 30;

  const hdrTitle = (r: number, text: string, fill = GREY_TITLE) => {
    ws.mergeCells(r, 3, r, 4);
    put(ws, r, 3, text, {
      font: { name: 'Britannic Bold', size: 14, color: { argb: argb(DARKBLUE) } }, fill,
      border: border(BLUE), align: { horizontal: 'center', vertical: 'middle' },
    });
    ws.getCell(r, 4).border = border(BLUE);
    ws.getRow(r).height = 24;
  };
  const colHdr = (r: number, a: string, b: string, fill?: string) => {
    const st: CellStyle = { font: { name: 'Britannic Bold', size: 14, color: { argb: argb(DARKBLUE) } }, fill, border: border(BLUE), align: { horizontal: 'center', vertical: 'middle' } };
    put(ws, r, 3, a, st);
    put(ws, r, 4, b, st);
    ws.getRow(r).height = 24;
  };
  const label = (r: number, t: string, color = DARKBLUE, bold = false) =>
    put(ws, r, 3, t, { font: { name: 'Bookman Old Style', size: 13, bold, color: { argb: argb(color) } }, border: border(BLUE), align: { horizontal: 'left', vertical: 'middle' } });
  const value = (r: number, f: string, res: number, color = '335BA3') =>
    put(ws, r, 4, fx(f, res), { font: { name: 'Calibri', size: 14, bold: true, color: { argb: argb(color) } }, border: border(NAVY), align: { horizontal: 'center', vertical: 'middle' } });
  const cnt = (extra: (l: ListRef) => string[]) => countAt(lists, EOM, extra);
  const col = (key: string, text: string) => (l: ListRef) => eq(l, key, lit(text));

  // ── Tableau 1 : genre
  let r = 9;
  hdrTitle(r, 'EFFECTIF PAR GENRE');
  colHdr(r + 1, 'GENRE', 'EFFECTIF');
  const gHdr = r + 1;
  const gRows = r + 2;
  label(gRows, 'HOMMES', DARKBLUE, true);
  value(gRows, cnt((l) => [col('gender', GENDER_M)(l)]), snap.gender.M);
  label(gRows + 1, 'FEMMES', MAGENTA, true);
  value(gRows + 1, cnt((l) => [col('gender', GENDER_F)(l)]), snap.gender.F, MAGENTA);
  let gEnd = gRows + 1;
  if (snap.gender.O > 0) {
    gEnd++;
    label(gEnd, 'AUTRE', DARKBLUE, true);
    value(gEnd, cnt((l) => [`(${rng(l, 'gender')}="Autre")`]), snap.gender.O);
  }
  r = gEnd + 2;

  // ── Tableau 2 : type de contrat
  hdrTitle(r, ville);
  colHdr(r + 1, 'TYPE DE CONTRAT', 'EFFECTIF');
  const cHdr = r + 1;
  const cFirst = r + 2;
  const cKeys = ['PERMANENT', 'EXPATRIE', 'STAGIAIRE', 'PRESTATAIRE'] as const;
  cKeys.forEach((k, i) => {
    label(cFirst + i, CONTRACT_LABEL_ORCA[k]);
    value(cFirst + i, cnt((l) => [col('contract', CONTRACT_LABEL_ORCA[k])(l)]), snap.contract[k]);
  });
  const cTot = cFirst + cKeys.length;
  label(cTot, 'TOTAL', '000000');
  value(cTot, `SUM(D${cFirst}:D${cTot - 1})`, snap.total, '1F3864');
  r = cTot + 2;

  // ── Tableau 3 : nationalités
  hdrTitle(r, ville);
  colHdr(r + 1, 'NATIONALITES', 'EFFECTIF');
  const nHdr = r + 1;
  const nFirst = r + 2;
  const N = snap.nationality;
  const natExpr = (nat: boolean, g?: string) => (l: ListRef) => [
    nat ? eq(l, 'nationality', lit(NATIONAL_LABEL)) : `(${rng(l, 'nationality')}<>${lit(NATIONAL_LABEL)})`,
    ...(g ? [eq(l, 'gender', lit(g))] : []),
    // une ligne sans nationalité saisie n'est pas comptée "étrangère" par erreur
    ...(nat ? [] : [`(${rng(l, 'nationality')}<>"")`]),
  ];
  const natRows: [string, string, number, string?][] = [
    ['NATIONAUX', cnt(natExpr(true)), N.nat],
    ['ETRANGERS', cnt(natExpr(false)), N.etr],
    ['NATIONAUX HOMMES', cnt(natExpr(true, GENDER_M)), N.natM],
    ['NATIONAUX FEMMES', cnt(natExpr(true, GENDER_F)), N.natF, MAGENTA],
    ['ETRANGERS  HOMMES', cnt(natExpr(false, GENDER_M)), N.etrM],
    ['ETRANGERS FEMMES', cnt(natExpr(false, GENDER_F)), N.etrF, MAGENTA],
  ];
  natRows.forEach(([t, f, v, color], i) => {
    label(nFirst + i, t, color ?? DARKBLUE, !!color);
    value(nFirst + i, f, v, color ?? '335BA3');
  });
  const nTot = nFirst + natRows.length;
  label(nTot, 'TOTAL', '000000');
  value(nTot, `SUM(D${nFirst + 2}:D${nTot - 1})`, N.natM + N.natF + N.etrM + N.etrF, '1F3864');
  r = nTot + 2;

  // ── Tableau 4 : fonctions
  hdrTitle(r, ville, BLUE);
  colHdr(r + 1, `FONCTIONS (${city ? city.toLowerCase().replace(/(^|-)\w/g, (s) => s.toUpperCase()) : company})`, 'EFFECTIF', BLUE);
  const fHdr = r + 1;
  const fFirst = r + 2;
  snap.functions.forEach((f, i) => {
    const rr = fFirst + i;
    put(ws, rr, 3, f.label, { font: { name: 'Bookman Old Style', size: 12, color: { argb: argb(DARKBLUE) } }, border: border(BLUE), align: { horizontal: 'left', vertical: 'middle' } });
    value(rr, cnt((l) => [`(${rng(l, 'position')}=$C${rr})`]), f.count);
  });
  const fLast = fFirst + Math.max(snap.functions.length, 1) - 1;
  const fTot = fLast + 1;
  put(ws, fTot, 3, 'TOTAL', { font: { name: 'Bookman Old Style', size: 13, bold: true, color: { argb: argb(DARKBLUE) } }, fill: '95B3D7', border: border(BLUE) });
  value(fTot, `SUM(D${fFirst}:D${fLast})`, snap.functions.reduce((s, x) => s + x.count, 0), '1F3864');
  ws.getCell(fTot, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('95B3D7') } };

  // Total en en-tête (formule texte)
  ws.getCell(6, 3).value = fx(`"TOTAL EFFECTIF ${(city || company).replace(/"/g, '""')}: "&D${cTot}`, `TOTAL EFFECTIF ${city || company}: ${snap.total}`);
  ws.getCell(6, 3).font = { name: 'Calibri', size: 20, bold: true, color: { argb: argb(BLUE) } };
  ws.getRow(6).height = 30;

  // ── Graphiques (mêmes types/couleurs que le modèle ORCA) ──────────────────
  const T = (a1: string) => sheetRef(sheetName, a1);
  const titleCity = city ? `${city.replace(/-/g, ' ')}` : company.toUpperCase();

  out.push({
    sheet: sheetName, from: { col: 5, row: 8 }, to: { col: 12, row: 26 }, kind: 'col3d',
    title: `EFFECTIF ${titleCity} PAR GENRE`, titleColor: '1F497D',
    catsRef: T(`$D$${gHdr}`), cats: ['EFFECTIF'],
    series: [
      { name: 'HOMMES', nameRef: T(`$C$${gRows}`), valuesRef: T(`$D$${gRows}`), vals: [snap.gender.M], color: '1F497D' },
      { name: 'FEMMES', nameRef: T(`$C$${gRows + 1}`), valuesRef: T(`$D$${gRows + 1}`), vals: [snap.gender.F], color: MAGENTA },
    ],
    showLegend: true, gapWidth: 150,
  });
  const cLabels = [...cKeys.map((k) => CONTRACT_LABEL_ORCA[k]), 'TOTAL'];
  out.push({
    sheet: sheetName, from: { col: 12, row: 8 }, to: { col: 22, row: 26 }, kind: 'colStacked',
    title: `EFFECTIF ${titleCity} PAR CONTRAT`, titleColor: '404040',
    catsRef: T(`$C$${cFirst}:$C$${cTot}`), cats: cLabels,
    series: [{ name: 'EFFECTIF', nameRef: T(`$D$${cHdr}`), valuesRef: T(`$D$${cFirst}:$D$${cTot}`), vals: [...cKeys.map((k) => snap.contract[k]), snap.total], color: '4BACC6', labelColor: 'FFFFFF' }],
    gapWidth: 150,
  });
  const nLabels = [...natRows.map((x) => x[0]), 'TOTAL'];
  out.push({
    sheet: sheetName, from: { col: 5, row: 27 }, to: { col: 12, row: 46 }, kind: 'col3d',
    title: `EFFECTIF ${titleCity} PAR NATIONALITE`, titleColor: '404040',
    catsRef: T(`$C$${nFirst}:$C$${nTot}`), cats: nLabels,
    series: [{ name: 'EFFECTIF', nameRef: T(`$D$${nHdr}`), valuesRef: T(`$D$${nFirst}:$D$${nTot}`), vals: [...natRows.map((x) => x[2]), N.natM + N.natF + N.etrM + N.etrF], color: 'C0504D' }],
    gapWidth: 65,
  });
  const fnRows = Math.max(snap.functions.length, 1);
  out.push({
    sheet: sheetName, from: { col: 12, row: 27 }, to: { col: 22, row: 27 + Math.max(20, fnRows + 6) }, kind: 'bar',
    title: `EFFECTIF ${titleCity} PAR FONCTION`, titleColor: '404040',
    catsRef: T(`$C$${fFirst}:$C$${fLast}`), cats: snap.functions.map((f) => f.label),
    series: [{
      name: 'EFFECTIF', nameRef: T(`$D$${fHdr}`), valuesRef: T(`$D$${fFirst}:$D$${fLast}`),
      vals: snap.functions.map((f) => f.count),
      pointColors: snap.functions.map((_, i) => PALETTE_MULTI[i % PALETTE_MULTI.length]),
    }],
    gapWidth: 40, fontSize: 800,
  });
  return out;
}
