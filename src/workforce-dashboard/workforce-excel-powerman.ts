// ============================================================================
// 📁 src/workforce-dashboard/workforce-excel-powerman.ts
// ✅ Export "TABLEAU DE BORD GESTION DES EFFECTIFS" — modèle POWERMAN
// (depuis le portefeuille : une entreprise ou toutes).
//
// Onglets (comme le modèle) : Effectif personnel · Repart effectifs ·
// TB RH <mois> (indicateurs sociaux) · Classification et net <mois>.
// Période en plage : + "Evolution effectif" ; TB RH et Classification et net
// sont produits mois par mois ; Effectif personnel / Répartition donnent la
// situation à la fin de la période.
//
// DYNAMIQUE : effectifs, âges, répartitions, pyramide des âges, taux = formules
// qui lisent la liste "Effectif personnel" (avec dates d'entrée/sortie) ; les
// graphiques pointent sur ces cellules. Seules les données de présence
// (jours d'absence…) sont des saisies issues de l'app, repérées dans un bloc
// "DONNÉES DE CALCUL" ; les taux en sont déduits par formule.
// ============================================================================

import * as ExcelJS from 'exceljs';
import { ChartSpec, injectCharts, sheetRef } from './xlsx-chart-injector';
import {
  CellStyle, ListRef, PALETTE_MULTI, addEvolutionSheet, argb, border, colLetter, countAt, eq, fx, lit, put, rng,
  serial, uniqueSheetName,
} from './workforce-excel-common';
import { AGE_BUCKETS, CONTRACT_LABELS_POWERMAN, CSP_ORDER, ageAt, isPresent, tally } from './workforce-calc';
import { WfEmployee, WfMonth, WfSnapshot, WorkforceDashboardData } from './workforce-dashboard.types';

const NAVY = '002060';
const BLUE = '0070C0';
const ORANGE = 'ED7D31';
const ORANGE_DARK = 'C55A11';
const PURPLE = '9900CC';
const KPI = '28236B';
const DARKBLUE = '000066';
const GENDER_M = 'Masculin';
const GENDER_F = 'Féminin';
const FREE_ROWS = 300;

interface Col { key: string; header: string; width: number }

export async function buildPowermanWorkbook(data: WorkforceDashboardData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KonzaRH';
  wb.created = new Date();
  (wb as any).calcProperties = { fullCalcOnLoad: true };

  const charts: ChartSpec[] = [];
  const multi = data.scope.multi;
  const company = data.scope.companyName;
  const last = data.period.last;
  const single = data.period.months.length === 1;
  const lastSnap = data.snapshots[data.snapshots.length - 1];

  const COLS: Col[] = [
    { key: 'num', header: 'N°', width: 6 },
    { key: 'name', header: 'NOMS ET PRÉNOMS', width: 38 },
    { key: 'position', header: 'FONCTIONS', width: 30 },
    { key: 'age', header: 'AGE', width: 8 },
    { key: 'city', header: "VILLE/VILLAGE D'ORIGINE", width: 26 },
    { key: 'hire', header: "DATE D'EMBAUCHE", width: 16 },
    { key: 'phone', header: 'N° PHONE', width: 20 },
    { key: 'dept', header: 'DEPARTEMENT', width: 30 },
    { key: 'gender', header: 'GENRE', width: 12 },
    { key: 'birth', header: 'DATE DE NAISSANCE', width: 16 },
    { key: 'csp', header: 'CATEGORIE SP', width: 20 },
    { key: 'grade', header: 'GRADE / CATEGORIE', width: 18 },
    { key: 'contract', header: 'TYPE DE CONTRAT', width: 32 },
    { key: 'exit', header: 'DATE DE SORTIE', width: 16 },
    ...(multi ? [{ key: 'company', header: 'ENTREPRISE', width: 28 }] : []),
  ];
  const L: Record<string, string> = Object.fromEntries(COLS.map((c, i) => [c.key, colLetter(i + 1)]));
  const ci = (k: string) => COLS.findIndex((c) => c.key === k) + 1;

  // ── 1. Effectif personnel ────────────────────────────────────────────────
  const listName = uniqueSheetName(wb, `Effectif personnel ${last.short}`);
  const ws = wb.addWorksheet(listName, {
    views: [{ state: 'frozen', ySplit: 8, xSplit: 2, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

  const people = data.employees
    .filter((e) => (single ? isPresent(e, last.eom) : true))
    .sort((a, b) => (multi ? a.companyName.localeCompare(b.companyName, 'fr') : 0) || a.fullName.localeCompare(b.fullName, 'fr'));

  const statsCol = COLS.length + 2; // laisse une colonne vide
  const sc = (n: number) => statsCol + n; // n-ième colonne de la zone stats (0-based)
  const EOM = `$${colLetter(sc(1))}$4`;

  ws.mergeCells(6, 2, 6, 6);
  put(ws, 6, 2, `LISTE DU PERSONNEL ${company.toUpperCase()}`, {
    font: { name: 'Arial', size: 16, bold: true }, align: { horizontal: 'center', vertical: 'middle' },
  });
  ws.getRow(6).height = 30;
  put(ws, 3, 2, data.period.mode === 'MOIS' ? `SITUATION AU ${last.label}` : `PÉRIODE ${data.period.label} — SITUATION À LA FIN DE LA PÉRIODE`, {
    font: { name: 'Bahnschrift SemiBold', size: 12, bold: true },
  });

  const HR = 8;
  COLS.forEach((c, i) =>
    put(ws, HR, i + 1, c.header, {
      font: { name: 'Arial', size: 11, bold: true }, border: border(BLUE),
      align: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),
  );
  ws.getRow(HR).height = 34;

  const r0 = HR + 1;
  people.forEach((e, idx) => {
    const r = r0 + idx;
    const c = (key: string, v: ExcelJS.CellValue, st: CellStyle = {}) =>
      put(ws, r, ci(key), v, { font: { name: 'Arial', size: 11 }, border: border(BLUE), align: { vertical: 'middle' }, ...st });
    const ctr = { align: { horizontal: 'center' as const, vertical: 'middle' as const } };
    c('num', fx('ROW()-8', idx + 1), { ...ctr, font: { name: 'Arial', size: 11, bold: true } });
    c('name', e.fullName);
    c('position', e.position);
    const age = ageAt(e.birthDate, last.eom);
    c('age', fx(`IF(${L.birth}${r}="","",INT((${EOM}-${L.birth}${r})/365.25))`, age === null ? '' : age), ctr);
    c('city', e.originCity);
    c('hire', e.hireDate, { ...ctr, numFmt: 'dd/mm/yyyy' });
    c('phone', e.phone, ctr);
    c('dept', e.department);
    c('gender', e.genderLabel, ctr);
    c('birth', e.birthDate ?? null, { ...ctr, numFmt: 'dd/mm/yyyy' });
    c('csp', e.csp, ctr);
    c('grade', e.grade, ctr);
    c('contract', e.contractLabelPowerman, ctr);
    c('exit', e.exitDate ?? null, { ...ctr, numFmt: 'dd/mm/yyyy' });
    if (multi) c('company', e.companyName);
  });
  const lastDataRow = r0 + Math.max(people.length, 1) - 1;
  ws.autoFilter = { from: { row: HR, column: 1 }, to: { row: Math.max(lastDataRow, HR + 1), column: COLS.length } };

  const list: ListRef = {
    sheet: listName, r0, r1: lastDataRow + FREE_ROWS,
    cols: { hire: L.hire, exit: L.exit, gender: L.gender, position: L.position, dept: L.dept, csp: L.csp, contract: L.contract, city: L.city, age: L.age },
  };
  const lists = [list];

  // ── Zone statistiques (à droite) ──────────────────────────────────────────
  put(ws, 3, sc(0), 'SITUATION AU :', { font: { name: 'Arial', size: 10, bold: true }, align: { horizontal: 'right' } });
  put(ws, 4, sc(0), 'DATE DE RÉFÉRENCE', { font: { name: 'Arial', size: 9, color: { argb: argb('7F7F7F') } }, align: { horizontal: 'right' } });
  put(ws, 4, sc(1), fx(`DATE(${last.year},${last.month}+1,0)`, serial(last.eom)), {
    font: { name: 'Arial', size: 11, bold: true }, numFmt: 'dd/mm/yyyy', border: border(BLUE), align: { horizontal: 'center' },
  });
  put(ws, 6, sc(0), "DONNEES STATISTIQUES DE L'EFFECTIF DU PERSONNEL PAR DISTRICTS /VILLES ET FONCTIONS", {
    font: { name: 'Bahnschrift SemiBold', size: 12, bold: true },
  });
  ws.getColumn(sc(0)).width = 34; ws.getColumn(sc(1)).width = 12; ws.getColumn(sc(2)).width = 13;
  ws.getColumn(sc(3)).width = 3;
  ws.getColumn(sc(4)).width = 34; ws.getColumn(sc(5)).width = 12; ws.getColumn(sc(6)).width = 13;

  const grey = 'D9D9D9';
  const th = (r: number, c: number, t: string) =>
    put(ws, r, c, t, { font: { name: 'Arial Black', size: 10, bold: true }, fill: grey, border: border(BLUE), align: { horizontal: 'center', vertical: 'middle' } });
  const totalPeople = lastSnap.total;
  const pct = (n: number) => (totalPeople > 0 ? n / totalPeople : 0);
  const TOTCELL = (rowTotal: number, c: number) => `$${colLetter(c)}$${rowTotal}`;

  // Villes (bleu marine)
  th(8, sc(0), 'VILLE/VILLAGE'); th(8, sc(1), 'EFFECTIF'); th(8, sc(2), 'POURCENTAGE');
  const vFirst = 9;
  const cities = lastSnap.cities;
  const vTot = vFirst + cities.length;
  cities.forEach((c, i) => {
    const r = vFirst + i;
    const base: CellStyle = { font: { name: 'Arial', size: 11, color: { argb: argb('FFFFFF') } }, fill: NAVY, border: border(BLUE) };
    put(ws, r, sc(0), c.label, base);
    put(ws, r, sc(1), fx(countAt(lists, EOM, (l) => [`(${rng(l, 'city')}=$${colLetter(sc(0))}${r})`]), c.count), { ...base, font: { ...base.font, bold: true }, align: { horizontal: 'center' } });
    put(ws, r, sc(2), fx(`IF(${TOTCELL(vTot, sc(1))}=0,0,${colLetter(sc(1))}${r}/${TOTCELL(vTot, sc(1))})`, pct(c.count)), { ...base, numFmt: '0%', align: { horizontal: 'center' } });
  });
  const totSt: CellStyle = { font: { name: 'Arial Black', size: 11, bold: true }, fill: grey, border: border(BLUE), align: { horizontal: 'center' } };
  put(ws, vTot, sc(0), 'TOTAL', { ...totSt, align: { horizontal: 'left' } });
  put(ws, vTot, sc(1), fx(`SUM(${colLetter(sc(1))}${vFirst}:${colLetter(sc(1))}${vTot - 1})`, cities.reduce((s, x) => s + x.count, 0)), totSt);
  put(ws, vTot, sc(2), fx(`IF(${colLetter(sc(1))}${vTot}=0,0,SUM(${colLetter(sc(2))}${vFirst}:${colLetter(sc(2))}${vTot - 1}))`, cities.length ? 1 : 0), { ...totSt, numFmt: '0%' });

  // Fonctions (orange)
  th(8, sc(4), 'FONCTION/ POSTE'); th(8, sc(5), 'NOMBRE'); th(8, sc(6), '%');
  const fFirst = 9;
  const funcs = lastSnap.functions;
  const fTot = fFirst + funcs.length;
  funcs.forEach((f, i) => {
    const r = fFirst + i;
    const base: CellStyle = { font: { name: 'Arial', size: 11, color: { argb: argb('FFFFFF') } }, fill: ORANGE, border: border(BLUE) };
    put(ws, r, sc(4), f.label, base);
    put(ws, r, sc(5), fx(countAt(lists, EOM, (l) => [`(${rng(l, 'position')}=$${colLetter(sc(4))}${r})`]), f.count), { ...base, font: { ...base.font, bold: true }, align: { horizontal: 'center' } });
    put(ws, r, sc(6), fx(`IF(${TOTCELL(fTot, sc(5))}=0,0,${colLetter(sc(5))}${r}/${TOTCELL(fTot, sc(5))})`, pct(f.count)), { ...base, numFmt: '0%', align: { horizontal: 'center' } });
  });
  put(ws, fTot, sc(4), 'TOTAL', { ...totSt, align: { horizontal: 'left' } });
  put(ws, fTot, sc(5), fx(`SUM(${colLetter(sc(5))}${fFirst}:${colLetter(sc(5))}${fTot - 1})`, funcs.reduce((s, x) => s + x.count, 0)), totSt);
  put(ws, fTot, sc(6), fx(`IF(${colLetter(sc(5))}${fTot}=0,0,SUM(${colLetter(sc(6))}${fFirst}:${colLetter(sc(6))}${fTot - 1}))`, funcs.length ? 1 : 0), { ...totSt, numFmt: '0%' });

  // Pyramide des âges (formules sur la colonne AGE de la liste)
  const pTop = Math.max(vTot, fTot) + 3;
  put(ws, pTop - 1, sc(0), 'PYRAMIDE DES ÂGES', { font: { name: 'Bahnschrift SemiBold', size: 12, bold: true } });
  th(pTop, sc(0), "TRANCHE D'ÂGE"); th(pTop, sc(1), 'HOMMES'); th(pTop, sc(2), 'FEMMES');
  const pFirst = pTop + 1;
  lastSnap.ageBuckets.forEach((b, i) => {
    const r = pFirst + i;
    const base: CellStyle = { font: { name: 'Arial', size: 11, color: { argb: argb('FFFFFF') } }, fill: NAVY, border: border(BLUE) };
    put(ws, r, sc(0), b.label, base);
    const f = (g: string) => countAt(lists, EOM, (l) => [eq(l, 'gender', lit(g)), `ISNUMBER(${rng(l, 'age')})`, `(${rng(l, 'age')}>=${b.lo})`, `(${rng(l, 'age')}<=${b.hi})`]);
    put(ws, r, sc(1), fx(f(GENDER_M), b.M), { ...base, align: { horizontal: 'center' } });
    put(ws, r, sc(2), fx(f(GENDER_F), b.F), { ...base, fill: PURPLE, align: { horizontal: 'center' } });
  });
  const pLast = pFirst + AGE_BUCKETS.length - 1;

  const T = (a1: string) => sheetRef(listName, a1);
  const cV = colLetter(sc(0)), nV = colLetter(sc(1)), cF = colLetter(sc(4)), nF = colLetter(sc(5)), cP = colLetter(sc(2));
  const cTop = pLast + 3;
  charts.push({
    sheet: listName, from: { col: sc(0) - 1, row: cTop }, to: { col: sc(2) + 4, row: cTop + 20 }, kind: 'pie',
    title: 'EFFECTIF PAR VILLE/VILLAGE', titleColor: NAVY,
    catsRef: T(`$${cV}$${vFirst}:$${cV}$${vTot - 1}`), cats: cities.map((c) => c.label),
    series: [{ name: 'EFFECTIF', valuesRef: T(`$${nV}$${vFirst}:$${nV}$${vTot - 1}`), vals: cities.map((c) => c.count), pointColors: cities.map((_, i) => PALETTE_MULTI[i % PALETTE_MULTI.length]) }],
    showLegend: true,
  });
  charts.push({
    sheet: listName, from: { col: sc(2) + 4, row: cTop }, to: { col: sc(6) + 6, row: cTop + Math.max(22, funcs.length + 6) }, kind: 'bar',
    title: "EFFECTIF PAR FONCTION / NOMBRE D'AGENTS", titleColor: NAVY,
    catsRef: T(`$${cF}$${fFirst}:$${cF}$${fTot - 1}`), cats: funcs.map((f) => f.label),
    series: [{ name: 'NOMBRE', valuesRef: T(`$${nF}$${fFirst}:$${nF}$${fTot - 1}`), vals: funcs.map((f) => f.count), color: ORANGE }],
    gapWidth: 40, fontSize: 800,
  });
  charts.push({
    sheet: listName, from: { col: sc(0) - 1, row: cTop + 21 }, to: { col: sc(2) + 4, row: cTop + 41 }, kind: 'col3d',
    title: 'PYRAMIDE DES ÂGES', titleColor: NAVY,
    catsRef: T(`$${cV}$${pFirst}:$${cV}$${pLast}`), cats: AGE_BUCKETS.map((b) => b.label),
    series: [
      { name: 'HOMMES', nameRef: T(`$${nV}$${pTop}`), valuesRef: T(`$${nV}$${pFirst}:$${nV}$${pLast}`), vals: lastSnap.ageBuckets.map((b) => b.M), color: NAVY },
      { name: 'FEMMES', nameRef: T(`$${cP}$${pTop}`), valuesRef: T(`$${cP}$${pFirst}:$${cP}$${pLast}`), vals: lastSnap.ageBuckets.map((b) => b.F), color: PURPLE },
    ],
    showLegend: true, gapWidth: 60,
  });

  // ── 2. Répartition des effectifs (situation à la fin de la période) ───────
  charts.push(...addRepartition(wb, data, list, last, lastSnap, people));

  // ── 3. Évolution (plage) ──────────────────────────────────────────────────
  if (!single) {
    charts.push(
      ...addEvolutionSheet(wb, data, lists, {
        title: 'Évolution', withNationality: false, genderLabels: { M: GENDER_M, F: GENDER_F },
        headerFill: ORANGE_DARK, headerFont: DARKBLUE, accent: ORANGE, accent2: PURPLE, accent3: NAVY,
      }),
    );
  }

  // ── 4. TB RH + Classification et net, mois par mois ──────────────────────
  let logoId: number | null = null;
  if (data.scope.logo && !multi) {
    logoId = wb.addImage({ buffer: data.scope.logo as any, extension: data.scope.logoExt ?? 'png' });
  }
  data.snapshots.forEach((snap) => {
    charts.push(...addTbRh(wb, snap, data, list, logoId));
  });
  if (data.canSeeNet) {
    data.snapshots.forEach((snap) => addClassification(wb, snap, data));
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return injectCharts(buf, charts);
}

// ───────────────────────────── Répartition effectifs ──────────────────────────

function addRepartition(
  wb: ExcelJS.Workbook, data: WorkforceDashboardData, list: ListRef, m: WfMonth, snap: WfSnapshot, people: WfEmployee[],
): ChartSpec[] {
  const name = uniqueSheetName(wb, `Repart effectifs ${m.short}`);
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  [46, 12, 22, 18, 14, 10, 10].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const EOM = '$B$3';
  put(ws, 2, 1, `REPARTITION DES EFFECTIFS PAR DEPARTEMENT — ${m.label}`, { font: { name: 'Arial', size: 16, bold: true, color: { argb: argb(NAVY) } } });
  put(ws, 3, 1, 'SITUATION AU :', { font: { name: 'Arial', size: 10, bold: true }, align: { horizontal: 'right' } });
  put(ws, 3, 2, fx(`DATE(${m.year},${m.month}+1,0)`, serial(m.eom)), { font: { name: 'Arial', size: 11, bold: true }, numFmt: 'dd/mm/yyyy', border: border(BLUE), align: { horizontal: 'center' } });

  const HR = 5;
  ['DEPARTEMENT / POSTE', 'EFFECTIF', 'CATEGORIE SOCIO-PRO', 'GRADE', 'GENRE', 'CDI', 'CDD / TEMP.'].forEach((h, i) =>
    put(ws, HR, i + 1, h, { font: { name: 'Britannic Bold', size: 11, color: { argb: argb(DARKBLUE) } }, fill: ORANGE_DARK, border: border(BLUE), align: { horizontal: 'center', vertical: 'middle', wrapText: true } }),
  );
  ws.getRow(HR).height = 30;

  const here = people.filter((e) => isPresent(e, m.eom));
  const depts = tally(here.map((e) => e.department), 'Sans département').map((d) => d.label);
  let r = HR + 1;
  const totalRows: number[] = [];
  let totalCount = 0;
  const dataStyle: CellStyle = { font: { name: 'Calibri', size: 11, color: { argb: argb('FFFFFF') } }, fill: PURPLE, border: border(BLUE) };

  for (const d of depts) {
    const inDept = here.filter((e) => (e.department || 'Sans département').toLowerCase() === d.toLowerCase());
    put(ws, r, 1, d, { font: { name: 'Calibri', size: 11, bold: true, color: { argb: argb(DARKBLUE) } }, border: border(BLUE) });
    for (let c = 2; c <= 7; c++) ws.getCell(r, c).border = border(BLUE);
    r++;
    // (poste, genre) distincts
    const keys = new Map<string, WfEmployee[]>();
    for (const e of inDept) {
      const k = `${e.position.toLowerCase()}|${e.gender}`;
      if (!keys.has(k)) keys.set(k, []);
      keys.get(k)!.push(e);
    }
    const first = r;
    for (const grp of [...keys.values()].sort((a, b) => a[0].position.localeCompare(b[0].position, 'fr'))) {
      const s = grp[0];
      put(ws, r, 1, s.position, { ...dataStyle, font: { name: 'Calibri', size: 11, bold: true, color: { argb: argb('FFFFFF') } } });
      const cond = (extra: string[] = []) => (l: ListRef) => [
        `(${rng(l, 'dept')}=${lit(d)})`, `(${rng(l, 'position')}=$A${r})`, eq(l, 'gender', lit(s.genderLabel)), ...extra,
      ];
      const cdi = grp.filter((e) => e.contractLabelPowerman === CONTRACT_LABELS_POWERMAN[0]).length;
      const tmp = grp.filter((e) => e.contractLabelPowerman === CONTRACT_LABELS_POWERMAN[1]).length;
      put(ws, r, 2, fx(countAt([list], EOM, cond()), grp.length), { ...dataStyle, align: { horizontal: 'center' } });
      put(ws, r, 3, tally(grp.map((e) => e.csp))[0].label, { ...dataStyle, align: { horizontal: 'center' } });
      put(ws, r, 4, tally(grp.map((e) => e.grade), '—')[0].label, { ...dataStyle, align: { horizontal: 'center' } });
      put(ws, r, 5, s.genderLabel, { ...dataStyle, align: { horizontal: 'center' } });
      put(ws, r, 6, fx(countAt([list], EOM, cond([`(${rng(list, 'contract')}=${lit(CONTRACT_LABELS_POWERMAN[0])})`])), cdi), { ...dataStyle, align: { horizontal: 'center' } });
      put(ws, r, 7, fx(countAt([list], EOM, cond([`(${rng(list, 'contract')}=${lit(CONTRACT_LABELS_POWERMAN[1])})`])), tmp), { ...dataStyle, align: { horizontal: 'center' } });
      r++;
    }
    const lastRow = r - 1;
    put(ws, r, 1, `Sous-total ${d}`, { font: { name: 'Calibri', size: 11, bold: true, italic: true }, fill: 'F2F2F2', border: border(BLUE) });
    put(ws, r, 2, fx(`SUM(B${first}:B${lastRow})`, inDept.length), { font: { name: 'Calibri', size: 11, bold: true }, fill: 'F2F2F2', border: border(BLUE), align: { horizontal: 'center' } });
    for (let c = 3; c <= 7; c++) { ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('F2F2F2') } }; ws.getCell(r, c).border = border(BLUE); }
    totalRows.push(r);
    totalCount += inDept.length;
    r++;
  }
  put(ws, r, 1, 'TOTAL EFFECTIF', { font: { name: 'Calibri', size: 14, bold: true, color: { argb: argb('FFFFFF') } }, fill: DARKBLUE, border: border(BLUE) });
  put(ws, r, 2, fx(totalRows.length ? totalRows.map((x) => `B${x}`).join('+') : '0', totalCount), { font: { name: 'Calibri', size: 14, bold: true, color: { argb: argb('FFFFFF') } }, fill: DARKBLUE, border: border(BLUE), align: { horizontal: 'center' } });
  for (let c = 3; c <= 7; c++) { ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(DARKBLUE) } }; ws.getCell(r, c).border = border(BLUE); }
  return [];
}

// ─────────────────────────────── TB RH (1 mois) ───────────────────────────────

function addTbRh(
  wb: ExcelJS.Workbook, snap: WfSnapshot, data: WorkforceDashboardData, list: ListRef, logoId: number | null,
): ChartSpec[] {
  const m = snap.month;
  const name = uniqueSheetName(wb, `TB RH ${m.short} Indic sociaux`);
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.getColumn(1).width = 44; ws.getColumn(2).width = 16; ws.getColumn(3).width = 3;
  const out: ChartSpec[] = [];
  const EOM = '$B$4';
  const T = (a1: string) => sheetRef(name, a1);

  ws.getRow(1).height = 34;
  ws.getRow(2).height = 34;
  if (logoId !== null) ws.addImage(logoId, { tl: { col: 0.1, row: 0.1 } as any, ext: { width: 170, height: 62 } });
  put(ws, 3, 1, `TABLEAU DE BORD RH — ${data.scope.companyName.toUpperCase()} — ${m.label}`, { font: { name: 'Arial', size: 14, bold: true, color: { argb: argb(NAVY) } } });
  put(ws, 4, 1, 'SITUATION AU :', { font: { name: 'Arial', size: 10, bold: true }, align: { horizontal: 'right' } });
  put(ws, 4, 2, fx(`DATE(${m.year},${m.month}+1,0)`, serial(m.eom)), { font: { name: 'Arial', size: 11, bold: true }, numFmt: 'dd/mm/yyyy', border: border(BLUE), align: { horizontal: 'center' } });

  const hdr = (r: number, a: string, b: string) => {
    const st: CellStyle = { font: { name: 'Britannic Bold', size: 11, color: { argb: argb(DARKBLUE) } }, fill: ORANGE_DARK, border: border(BLUE) };
    put(ws, r, 1, a, st);
    put(ws, r, 2, b, { ...st, align: { horizontal: 'center' } });
  };
  const row = (r: number, label: string, f: string, v: number) => {
    put(ws, r, 1, label, { font: { name: 'Calibri', size: 11, bold: true, color: { argb: argb(DARKBLUE) } }, border: border(BLUE) });
    put(ws, r, 2, fx(f, v), { font: { name: 'Calibri', size: 11, bold: true }, border: border(BLUE), align: { horizontal: 'center' } });
  };
  const cnt = (extra: (l: ListRef) => string[]) => countAt([list], EOM, extra);

  // Département
  let r = 6;
  hdr(r, 'DEPARTEMENT', 'EFFECTIF');
  const dFirst = r + 1;
  snap.departments.forEach((d, i) => row(dFirst + i, d.label, cnt((l) => [`(${rng(l, 'dept')}=$A${dFirst + i})`]), d.count));
  const dLast = dFirst + Math.max(snap.departments.length, 1) - 1;
  row(dLast + 1, 'TOTAL', `SUM(B${dFirst}:B${dLast})`, snap.total);
  r = dLast + 3;

  // Genre
  hdr(r, 'GENRE', 'EFFECTIF');
  const gFirst = r + 1;
  row(gFirst, 'HOMME', cnt((l) => [eq(l, 'gender', lit(GENDER_M))]), snap.gender.M);
  row(gFirst + 1, 'FEMME', cnt((l) => [eq(l, 'gender', lit(GENDER_F))]), snap.gender.F);
  r = gFirst + 3;

  // CSP
  hdr(r, 'CATEGORIE SOCIO-PROFESSIONNELLE', 'EFFECTIF');
  const cspFirst = r + 1;
  const cspLabels = CSP_ORDER.filter((c) => c !== 'NON CLASSÉ' || snap.csp.some((x) => x.label === c && x.count > 0));
  cspLabels.forEach((c, i) =>
    row(cspFirst + i, c, cnt((l) => [eq(l, 'csp', lit(c))]), snap.csp.find((x) => x.label === c)?.count ?? 0),
  );
  const cspLast = cspFirst + cspLabels.length - 1;
  r = cspLast + 2;

  // Contrat
  hdr(r, 'CONTRAT', 'EFFECTIF');
  const kFirst = r + 1;
  CONTRACT_LABELS_POWERMAN.forEach((c, i) =>
    row(kFirst + i, c, cnt((l) => [eq(l, 'contract', lit(c))]), snap.contractPowerman[i].count),
  );
  const kLast = kFirst + CONTRACT_LABELS_POWERMAN.length - 1;
  r = kLast + 3;

  // Données de calcul (issues des synthèses de présence de l'app) + indicateurs
  const ind = snap.indicators;
  const nd = !ind.hasAttendance;
  hdr(r, 'DONNÉES DE CALCUL (issues de l\'app)', 'VALEUR');
  const inp = r + 1;
  const input = (rr: number, label: string, v: number | string) => {
    put(ws, rr, 1, label, { font: { name: 'Calibri', size: 10, italic: true, color: { argb: argb(DARKBLUE) } }, border: border(BLUE) });
    put(ws, rr, 2, v, { font: { name: 'Calibri', size: 11, color: { argb: argb('0000FF') } }, border: border(BLUE), align: { horizontal: 'center' }, numFmt: '#,##0.##' });
  };
  input(inp, "Jours d'absence (payée + non payée)", nd ? 0 : ind.absenceDays);
  input(inp + 1, 'Jours à travailler (présence + absences)', nd ? 0 : ind.theoreticalDays);
  input(inp + 2, 'Nombre de salariés ayant été absents', nd ? 0 : ind.absenceCount);
  input(inp + 3, 'Effectif moyen de l\'année (janv. → ce mois)', Math.round(ind.avgHeadcountYtd * 100) / 100);
  r = inp + 5;

  const pctSt = (fill = true): CellStyle => ({ font: { name: 'Calibri', size: 14, bold: true }, border: border(BLUE), align: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00%', ...(fill ? {} : {}) });
  hdr(r, "TAUX D'ABSENTEISME", 'POURCENTAGE');
  put(ws, r + 1, 1, "CALCUL D'ABSENTEISME: jours d'absence / jours à travailler x100", { font: { name: 'Calibri', size: 9, bold: true, color: { argb: argb(DARKBLUE) } }, border: border(BLUE) });
  const absRow = r + 1;
  put(ws, absRow, 2, fx(`IF(B${inp + 1}=0,"n/d",B${inp}/B${inp + 1})`, nd ? 'n/d' : ind.absenteeismRate), pctSt());
  r += 3;
  hdr(r, 'DUREE MOYENNE DES ABSENCES', 'JOURS');
  put(ws, r + 1, 1, "NBRE DE JOURS D'ABSENCES / NBRE DE SALARIÉS ABSENTS", { font: { name: 'Calibri', size: 9, bold: true, color: { argb: argb(DARKBLUE) } }, border: border(BLUE) });
  put(ws, r + 1, 2, fx(`IF(B${inp + 2}=0,"n/d",B${inp}/B${inp + 2})`, nd ? 'n/d' : ind.avgAbsenceDuration), { ...pctSt(), numFmt: '0.00' });
  r += 3;
  hdr(r, 'TURN OVER', 'POURCENTAGE');
  put(ws, r + 1, 1, "Nombre total de départs durant l'année / Effectif moyen annuel", { font: { name: 'Calibri', size: 9, bold: true, color: { argb: argb(DARKBLUE) } }, border: border(BLUE) });
  const yStart = `DATE(${m.year},1,1)`;
  const dep = `SUMPRODUCT((${rng(list, 'exit')}>=${yStart})*(${rng(list, 'exit')}<=${EOM}))`;
  put(ws, r + 1, 2, fx(`IF(B${inp + 3}=0,0,${dep}/B${inp + 3})`, ind.turnover), pctSt());
  ws.getRow(absRow).height = 26; ws.getRow(r + 1).height = 26;

  // Cartes KPI (comme le modèle : effectif général + taux de présence)
  const card = (r1: number, title: string, f: string, res: number | string, fmt?: string) => {
    ws.mergeCells(r1, 4, r1, 5);
    ws.mergeCells(r1 + 1, 4, r1 + 3, 5);
    put(ws, r1, 4, title, { font: { name: 'Cambria', size: 12, bold: true, color: { argb: argb('FFFFFF') } }, fill: KPI, align: { horizontal: 'center', vertical: 'middle' } });
    put(ws, r1 + 1, 4, fx(f, res as any), { font: { name: 'Cambria', size: 26, bold: true, color: { argb: argb('FFFFFF') } }, fill: KPI, align: { horizontal: 'center', vertical: 'middle' }, numFmt: fmt });
    for (const rr of [r1, r1 + 1, r1 + 2, r1 + 3]) for (const cc of [4, 5]) ws.getCell(rr, cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(KPI) } };
  };
  ws.getColumn(4).width = 18; ws.getColumn(5).width = 18;
  card(6, 'EFFECTIF GENERAL', `B${dLast + 1}`, snap.total);
  card(11, 'TAUX DE PRESENCE', `IF(ISNUMBER(B${absRow}),1-B${absRow},"n/d")`, nd ? 'n/d' : ind.presenceRate, '0.00%');

  // Graphiques (à droite des cartes)
  const c0 = 6;
  out.push({
    sheet: name, from: { col: c0, row: 5 }, to: { col: c0 + 8, row: 22 }, kind: 'bar',
    title: 'EFFECTIF PAR DEPARTEMENT', titleColor: NAVY,
    catsRef: T(`$A$${dFirst}:$A$${dLast}`), cats: snap.departments.map((d) => d.label),
    series: [{ name: 'EFFECTIF', valuesRef: T(`$B$${dFirst}:$B$${dLast}`), vals: snap.departments.map((d) => d.count), color: ORANGE }],
    gapWidth: 50, fontSize: 800,
  });
  out.push({
    sheet: name, from: { col: c0 + 8, row: 5 }, to: { col: c0 + 15, row: 22 }, kind: 'pie',
    title: 'REPARTITION PAR GENRE', titleColor: NAVY,
    catsRef: T(`$A$${gFirst}:$A$${gFirst + 1}`), cats: ['HOMME', 'FEMME'],
    series: [{ name: 'EFFECTIF', valuesRef: T(`$B$${gFirst}:$B$${gFirst + 1}`), vals: [snap.gender.M, snap.gender.F], pointColors: [NAVY, PURPLE] }],
    showLegend: true,
  });
  out.push({
    sheet: name, from: { col: c0, row: 23 }, to: { col: c0 + 8, row: 40 }, kind: 'col',
    title: 'CATEGORIE SOCIO-PROFESSIONNELLE', titleColor: NAVY,
    catsRef: T(`$A$${cspFirst}:$A$${cspLast}`), cats: cspLabels,
    series: [{ name: 'EFFECTIF', valuesRef: T(`$B$${cspFirst}:$B$${cspLast}`), vals: cspLabels.map((c) => snap.csp.find((x) => x.label === c)?.count ?? 0), color: NAVY }],
    gapWidth: 60,
  });
  out.push({
    sheet: name, from: { col: c0 + 8, row: 23 }, to: { col: c0 + 15, row: 40 }, kind: 'col',
    title: 'TYPE DE CONTRAT', titleColor: NAVY,
    catsRef: T(`$A$${kFirst}:$A$${kLast}`), cats: CONTRACT_LABELS_POWERMAN,
    series: [{ name: 'EFFECTIF', valuesRef: T(`$B$${kFirst}:$B$${kLast}`), vals: snap.contractPowerman.map((c) => c.count), color: ORANGE_DARK }],
    gapWidth: 60, fontSize: 700,
  });
  return out;
}

// ─────────────────────────── Classification et net (1 mois) ───────────────────

function addClassification(wb: ExcelJS.Workbook, snap: WfSnapshot, data: WorkforceDashboardData) {
  const m = snap.month;
  const name = uniqueSheetName(wb, `Classification et net ${m.short}`);
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const multi = data.scope.multi;
  const heads = ['N°', 'Names Surnames', 'Fonction', 'Printed', 'Handed over', 'Signed', 'Category', 'Net'];
  if (multi) heads.splice(2, 0, 'Entreprise');
  const widths = multi ? [6, 36, 26, 28, 12, 14, 12, 20, 18] : [6, 36, 28, 12, 14, 12, 20, 18];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  put(ws, 2, 2, `LIST OF EMPLOYEE OF MONTH OF ${m.label}`, { font: { name: 'Arial', size: 14, bold: true, color: { argb: argb(NAVY) } } });
  heads.forEach((h, i) =>
    put(ws, 6, i + 1, h, { font: { name: 'Arial', size: 11, bold: true }, fill: ORANGE, border: border(BLUE), align: { horizontal: 'center', vertical: 'middle' } }),
  );
  ws.getRow(6).height = 26;

  const here = data.employees.filter((e) => isPresent(e, m.eom)).sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'));
  const netCol = heads.length;
  const catCol = heads.length - 1;
  here.forEach((e, i) => {
    const r = 7 + i;
    const st: CellStyle = { font: { name: 'Calibri', size: 11 }, border: border(BLUE), align: { vertical: 'middle' } };
    const ctr: CellStyle = { ...st, align: { horizontal: 'center', vertical: 'middle' } };
    put(ws, r, 1, i + 1, ctr);
    put(ws, r, 2, e.fullName, st);
    let c = 3;
    if (multi) put(ws, r, c++, e.companyName, st);
    put(ws, r, c++, e.position, st);
    put(ws, r, c++, '', ctr); put(ws, r, c++, '', ctr); put(ws, r, c++, '', ctr);
    put(ws, r, catCol, e.grade || e.csp, ctr);
    const net = e.netByMonth[m.key];
    put(ws, r, netCol, net ?? null, { ...st, numFmt: '#,##0', align: { horizontal: 'right', vertical: 'middle' } });
  });
  const rEnd = 6 + here.length;
  const rt = rEnd + 1;
  put(ws, rt, 2, 'TOTAL NET', { font: { name: 'Arial', size: 12, bold: true, color: { argb: argb('FFFFFF') } }, fill: DARKBLUE, border: border(BLUE) });
  for (let c = 3; c < netCol; c++) { ws.getCell(rt, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(DARKBLUE) } }; ws.getCell(rt, c).border = border(BLUE); }
  const total = here.reduce((s, e) => s + (e.netByMonth[m.key] ?? 0), 0);
  const nl = colLetter(netCol);
  put(ws, rt, netCol, fx(`SUM(${nl}7:${nl}${Math.max(rEnd, 7)})`, total), { font: { name: 'Arial', size: 12, bold: true, color: { argb: argb('FFFFFF') } }, fill: DARKBLUE, border: border(BLUE), numFmt: '#,##0', align: { horizontal: 'right' } });

  // Fin de service du mois
  const leavers = data.employees.filter((e) => e.exitDate && e.exitDate >= m.bom && e.exitDate <= m.eom);
  const sTop = rt + 3;
  put(ws, sTop, 2, 'End of service', { font: { name: 'Arial', size: 12, bold: true, color: { argb: argb(NAVY) } } });
  ['Names Surnames', 'Fonction', 'Date de sortie'].forEach((h, i) =>
    put(ws, sTop + 1, 2 + i, h, { font: { name: 'Arial', size: 11, bold: true }, fill: ORANGE, border: border(BLUE), align: { horizontal: 'center' } }),
  );
  leavers.forEach((e, i) => {
    const r = sTop + 2 + i;
    put(ws, r, 2, e.fullName, { font: { name: 'Calibri', size: 11 }, border: border(BLUE) });
    put(ws, r, 3, e.position, { font: { name: 'Calibri', size: 11 }, border: border(BLUE) });
    put(ws, r, 4, e.exitDate, { font: { name: 'Calibri', size: 11 }, border: border(BLUE), numFmt: 'dd/mm/yyyy', align: { horizontal: 'center' } });
  });
}