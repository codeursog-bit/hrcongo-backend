// ============================================================================
// 📁 src/loans-dashboard/loans-dashboard.excel.ts
// Classeur Excel « Prêts · Avances ».
//   Synthese        : indicateurs + répartitions + encours par département (formules) + graphiques
//   Evolution       : tableau mois par mois (formules) + 2 graphiques
//   Prets           : un prêt par ligne (rattaché au mois de début)
//   Avances         : une avance par ligne (rattachée au mois de la demande)
//   Remboursements  : une ligne par remboursement encaissé (journal)
//   Encours         : dette restante à CE JOUR, par salarié (prêts + avances)
// Les totaux des onglets Synthese / Evolution sont des FORMULES sur les onglets de
// données (valeur en cache = même calcul que l'écran) : si l'utilisateur corrige une
// ligne dans Excel, les totaux et les graphiques suivent.
// ============================================================================

import * as ExcelJS from 'exceljs';
import { ChartSpec, injectCharts, sheetRef } from '../workforce-dashboard/xlsx-chart-injector';
import { argb, border, fx, put, q, uniqueSheetName, CellStyle } from '../workforce-dashboard/workforce-excel-common';
import {
  ADVANCE_STATUS_LABEL, GRANTED_ADVANCE, GRANTED_LOAN, LOAN_STATUS_LABEL,
  METHOD_ORDER, NATURE_ORDER, TYPE_ORDER, advancesByStatus, departmentRows, evolution, loansByNature, loansByStatus,
  loansByType, repaymentsByMethod, round2, stockRows, totalsOf,
} from './loans-dashboard.calc';
import { LoansDashboardData } from './loans-dashboard.types';

const NAVY = '1F497D';
const SECTION = 'DCE6F1';
const GREY = '595959';
const MARGIN = 300; // lignes de marge sous les données pour que les formules couvrent les ajouts
const LOCAL_OFFSET_MS = 3600_000; // inutilisé pour les dates (colonnes « Date » seulement) — gardé pour homogénéité

const PCT = '0.00%';
const MONEY = '#,##0';
const hdrStyle: CellStyle = {
  font: { bold: true, color: { argb: argb('FFFFFF') } }, fill: NAVY, border: border(),
  align: { horizontal: 'center', vertical: 'middle', wrapText: true },
};
const cell: CellStyle = { border: border('BFBFBF'), align: { vertical: 'middle' } };
const cellC: CellStyle = { ...cell, align: { horizontal: 'center', vertical: 'middle' } };
const cellM: CellStyle = { ...cell, align: { horizontal: 'right', vertical: 'middle' }, numFmt: MONEY };
const sectionStyle: CellStyle = { font: { bold: true, color: { argb: argb(NAVY) } }, fill: SECTION, border: border('BFBFBF') };

const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
void LOCAL_OFFSET_MS;

const LOAN_GRANTED_LABELS = GRANTED_LOAN.map((s) => LOAN_STATUS_LABEL[s]); // En cours, Soldé
const ADV_GRANTED_LABELS = GRANTED_ADVANCE.map((s) => ADVANCE_STATUS_LABEL[s]); // À récupérer, Déduite, Soldée
const LOAN_OUT_LABEL = LOAN_STATUS_LABEL.ACTIVE; // « En cours »
const ADV_OUT_LABEL = ADVANCE_STATUS_LABEL.APPROVED; // « À récupérer »

export async function buildLoansWorkbook(data: LoansDashboardData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KonzaRH';
  wb.created = data.generatedAt;

  const wsSyn = wb.addWorksheet(uniqueSheetName(wb, 'Synthese'), { views: [{ showGridLines: false }] });
  const wsEvo = wb.addWorksheet(uniqueSheetName(wb, 'Evolution'), { views: [{ showGridLines: false }] });
  const wsPre = wb.addWorksheet(uniqueSheetName(wb, 'Prets'), { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsAva = wb.addWorksheet(uniqueSheetName(wb, 'Avances'), { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsRem = wb.addWorksheet(uniqueSheetName(wb, 'Remboursements'), { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsEnc = wb.addWorksheet(uniqueSheetName(wb, 'Encours'), { views: [{ state: 'frozen', ySplit: 4 }] });

  const empIdx = new Map(data.employees.map((e) => [e.id, e]));
  const title = (ws: ExcelJS.Worksheet, text: string, span: number) => {
    ws.mergeCells(2, 1, 2, span);
    put(ws, 2, 1, text, { font: { name: 'Arial', size: 16, bold: true, color: { argb: argb('002060') } }, align: { horizontal: 'left', vertical: 'middle' } });
    ws.getRow(2).height = 28;
    put(ws, 3, 1, `${data.scope.companyName} — ${data.period.label}`, { font: { italic: true, color: { argb: argb(GREY) } } });
  };
  const header = (ws: ExcelJS.Worksheet, labels: string[], widths: number[]) => {
    labels.forEach((l, i) => { put(ws, 4, i + 1, l, hdrStyle); ws.getColumn(i + 1).width = widths[i]; });
    ws.getRow(4).height = 34;
  };
  const wrap: CellStyle = { ...cell, align: { vertical: 'middle', wrapText: true } };

  // ═══════════════════════════════ PRÊTS (source) ═════════════════════════════
  const preCols = ['CLÉ MOIS', 'ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'NATURE', 'TYPE', 'STATUT', 'MONTANT', 'MENSUALITÉ',
    'DÉJÀ REMBOURSÉ', 'RESTE DÛ', 'DÉBUT', 'FIN', 'MOTIF'];
  title(wsPre, 'PRÊTS — rattachés au mois de début du prêt', preCols.length);
  header(wsPre, preCols, [10, 24, 12, 30, 24, 14, 13, 16, 14, 13, 15, 14, 12, 12, 46]);
  const P0 = 5;
  data.loans.forEach((l, i) => {
    const r = P0 + i;
    const e = empIdx.get(l.employeeId);
    [l.monthKey, e?.companyName ?? '', e?.matricule ?? '', e?.fullName ?? '', e?.department ?? '', l.natureLabel, l.typeLabel].forEach((v, c) => put(wsPre, r, c + 1, v, cell));
    put(wsPre, r, 8, l.statusLabel, cellC);
    put(wsPre, r, 9, l.amount, cellM);
    put(wsPre, r, 10, l.monthlyRepayment, cellM);
    put(wsPre, r, 11, l.repaid, cellM);
    put(wsPre, r, 12, fx(`IF(H${r}="${LOAN_OUT_LABEL}",MAX(0,I${r}-K${r}),0)`, l.outstanding), cellM);
    put(wsPre, r, 13, dateOnly(l.start), { ...cellC, numFmt: 'dd/mm/yyyy' });
    put(wsPre, r, 14, dateOnly(l.end), { ...cellC, numFmt: 'dd/mm/yyyy' });
    put(wsPre, r, 15, l.reason, wrap);
  });
  const P1 = P0 + data.loans.length + MARGIN;
  const pre = (col: string) => `${q(wsPre.name)}!$${col}$${P0}:$${col}$${P1}`;
  wsPre.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: preCols.length } };

  // ═══════════════════════════════ AVANCES (source) ═══════════════════════════
  const avaCols = ['CLÉ MOIS', 'ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'STATUT', 'MONTANT', 'DÉJÀ REMBOURSÉ', 'RESTE DÛ',
    'MOIS DE DÉDUCTION', 'RETENUE SUR PAIE', 'MOTIF'];
  title(wsAva, 'AVANCES SUR SALAIRE — rattachées au mois de la demande', avaCols.length);
  header(wsAva, avaCols, [10, 24, 12, 30, 24, 15, 14, 15, 14, 14, 13, 46]);
  const A0 = 5;
  data.advances.forEach((a, i) => {
    const r = A0 + i;
    const e = empIdx.get(a.employeeId);
    [a.monthKey, e?.companyName ?? '', e?.matricule ?? '', e?.fullName ?? '', e?.department ?? ''].forEach((v, c) => put(wsAva, r, c + 1, v, cell));
    put(wsAva, r, 6, a.statusLabel, cellC);
    put(wsAva, r, 7, a.amount, cellM);
    put(wsAva, r, 8, a.repaid, cellM);
    put(wsAva, r, 9, fx(`IF(F${r}="${ADV_OUT_LABEL}",MAX(0,G${r}-H${r}),0)`, a.outstanding), cellM);
    put(wsAva, r, 10, a.deductKey, cellC);
    put(wsAva, r, 11, a.viaPayroll ? 'Oui' : 'Non', cellC);
    put(wsAva, r, 12, a.reason, wrap);
  });
  const A1 = A0 + data.advances.length + MARGIN;
  const ava = (col: string) => `${q(wsAva.name)}!$${col}$${A0}:$${col}$${A1}`;
  wsAva.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: avaCols.length } };

  // ═══════════════════════════ REMBOURSEMENTS (source) ════════════════════════
  const remCols = ['CLÉ MOIS', 'ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'TYPE', 'MODE', 'MONTANT'];
  title(wsRem, 'REMBOURSEMENTS ENCAISSÉS — retenues sur paie et espèces', remCols.length);
  header(wsRem, remCols, [10, 24, 12, 30, 24, 10, 18, 15]);
  const sortedRem = [...data.repayments].sort((a, b) => a.monthKey.localeCompare(b.monthKey)
    || (empIdx.get(a.employeeId)?.fullName ?? '').localeCompare(empIdx.get(b.employeeId)?.fullName ?? ''));
  const R0 = 5;
  sortedRem.forEach((x, i) => {
    const r = R0 + i;
    const e = empIdx.get(x.employeeId);
    [x.monthKey, e?.companyName ?? '', e?.matricule ?? '', e?.fullName ?? '', e?.department ?? ''].forEach((v, c) => put(wsRem, r, c + 1, v, cell));
    put(wsRem, r, 6, x.kindLabel, cellC);
    put(wsRem, r, 7, x.methodLabel, cellC);
    put(wsRem, r, 8, x.amount, cellM);
  });
  const R1 = R0 + sortedRem.length + MARGIN;
  const rem = (col: string) => `${q(wsRem.name)}!$${col}$${R0}:$${col}$${R1}`;
  wsRem.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: remCols.length } };

  // ═════════════════════════════ ENCOURS (source) ═════════════════════════════
  const encCols = ['ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'ENCOURS PRÊTS', 'ENCOURS AVANCES', 'ENCOURS TOTAL'];
  title(wsEnc, 'DETTES EN COURS À CE JOUR — par salarié (indépendant de la période)', encCols.length);
  header(wsEnc, encCols, [24, 12, 30, 24, 16, 17, 16]);
  const stockList = stockRows(data);
  const E0 = 5;
  stockList.forEach((s, i) => {
    const r = E0 + i;
    [s.emp.companyName, s.emp.matricule, s.emp.fullName, s.emp.department].forEach((v, c) => put(wsEnc, r, c + 1, v, cell));
    put(wsEnc, r, 5, s.loans, cellM);
    put(wsEnc, r, 6, s.advances, cellM);
    put(wsEnc, r, 7, fx(`E${r}+F${r}`, round2(s.loans + s.advances)), { ...cellM, font: { bold: true } });
  });
  const E1 = E0 + stockList.length + MARGIN;
  const enc = (col: string) => `${q(wsEnc.name)}!$${col}$${E0}:$${col}$${E1}`;
  wsEnc.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: encCols.length } };

  // ═══════════════════════════════ SYNTHÈSE ═══════════════════════════════════
  const T = totalsOf(data);
  const LS = loansByStatus(data);
  const AS = advancesByStatus(data);
  const LN = loansByNature(data);
  const LT = loansByType(data);
  const RM = repaymentsByMethod(data);
  const depRows = departmentRows(data);
  const repaidLoans = round2(data.loans.filter((l) => l.granted).reduce((s, l) => s + l.repaid, 0));
  const repaidAdv = round2(data.advances.filter((a) => a.granted).reduce((s, a) => s + a.repaid, 0));

  title(wsSyn, 'TABLEAU DE BORD — PRÊTS · AVANCES', 8);
  wsSyn.getColumn(1).width = 2;
  wsSyn.getColumn(2).width = 52;
  [3, 4, 5, 6, 7].forEach((c) => (wsSyn.getColumn(c).width = 18));
  wsSyn.getColumn(8).width = 3;

  let r = 5;
  const section = (label: string, span = 3) => {
    for (let c = 2; c < 2 + span; c++) put(wsSyn, r, c, c === 2 ? label : '', sectionStyle);
    r++;
  };
  const tblHead = (labels: string[]) => { labels.forEach((l, i) => put(wsSyn, r, 2 + i, l, hdrStyle)); r++; };
  const sumLabels = (labels: string[], build: (l: string) => string) => labels.map(build).join('+');

  // — Prêts —
  section('PRÊTS (rattachés au mois de début)');
  tblHead(['Statut', 'PRÊTS', 'MONTANT']);
  const lsFirst = r;
  const lsRow = new Map<string, number>();
  for (const s of LS) {
    put(wsSyn, r, 2, s.label, cell);
    put(wsSyn, r, 3, fx(`COUNTIF(${pre('H')},B${r})`, s.count), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${pre('I')},${pre('H')},B${r})`, s.amount), cellM);
    lsRow.set(s.label, r); r++;
  }
  put(wsSyn, r, 2, 'TOTAL DES DEMANDES DE PRÊT', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(`SUM(C${lsFirst}:C${r - 1})`, T.loansRequested), { ...cellC, font: { bold: true } });
  put(wsSyn, r, 4, fx(`SUM(D${lsFirst}:D${r - 1})`, round2(LS.reduce((x, s) => x + s.amount, 0))), { ...cellM, font: { bold: true } });
  r++;
  const rLG = r;
  put(wsSyn, r, 2, 'Prêts accordés (en cours + soldés)', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `COUNTIF(${pre('H')},"${l}")`), T.loansGranted), { ...cellC, font: { bold: true } });
  put(wsSyn, r, 4, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `SUMIFS(${pre('I')},${pre('H')},"${l}")`), T.loansGrantedAmount), { ...cellM, font: { bold: true } });
  r++;
  const rLRej = lsRow.get(LOAN_STATUS_LABEL.REJECTED)!;
  put(wsSyn, r, 2, 'Taux d’acceptation (accordés / (accordés + refusés))', cell);
  put(wsSyn, r, 3, fx(`IF(C${rLG}+C${rLRej}>0,C${rLG}/(C${rLG}+C${rLRej}),0)`, T.loanAcceptanceRate), { ...cellC, numFmt: PCT });
  put(wsSyn, r, 4, '', cell); r++;
  const rLRepaid = r;
  put(wsSyn, r, 2, 'Déjà remboursé sur les prêts accordés', cell);
  put(wsSyn, r, 3, '', cell);
  put(wsSyn, r, 4, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `SUMIFS(${pre('K')},${pre('H')},"${l}")`), repaidLoans), cellM);
  r += 2;

  tblHead(['Prêts accordés par nature', 'PRÊTS', 'MONTANT']);
  const lnFirst = r;
  for (const label of NATURE_ORDER) {
    const f = LN.find((x) => x.label === label);
    put(wsSyn, r, 2, label, cell);
    put(wsSyn, r, 3, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `COUNTIFS(${pre('F')},$B${r},${pre('H')},"${l}")`), f?.count ?? 0), cellC);
    put(wsSyn, r, 4, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `SUMIFS(${pre('I')},${pre('F')},$B${r},${pre('H')},"${l}")`), f?.amount ?? 0), cellM);
    r++;
  }
  const lnLast = r - 1;
  r++;
  tblHead(['Prêts accordés par type', 'PRÊTS', 'MONTANT']);
  for (const label of TYPE_ORDER) {
    const f = LT.find((x) => x.label === label);
    put(wsSyn, r, 2, label, cell);
    put(wsSyn, r, 3, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `COUNTIFS(${pre('G')},$B${r},${pre('H')},"${l}")`), f?.count ?? 0), cellC);
    put(wsSyn, r, 4, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `SUMIFS(${pre('I')},${pre('G')},$B${r},${pre('H')},"${l}")`), f?.amount ?? 0), cellM);
    r++;
  }
  r++;

  // — Avances —
  section('AVANCES SUR SALAIRE (rattachées au mois de la demande)');
  tblHead(['Statut', 'AVANCES', 'MONTANT']);
  const asFirst = r;
  const asRow = new Map<string, number>();
  for (const s of AS) {
    put(wsSyn, r, 2, s.label, cell);
    put(wsSyn, r, 3, fx(`COUNTIF(${ava('F')},B${r})`, s.count), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${ava('G')},${ava('F')},B${r})`, s.amount), cellM);
    asRow.set(s.label, r); r++;
  }
  put(wsSyn, r, 2, 'TOTAL DES DEMANDES D’AVANCE', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(`SUM(C${asFirst}:C${r - 1})`, T.advancesRequested), { ...cellC, font: { bold: true } });
  put(wsSyn, r, 4, fx(`SUM(D${asFirst}:D${r - 1})`, round2(AS.reduce((x, s) => x + s.amount, 0))), { ...cellM, font: { bold: true } });
  r++;
  const rAG = r;
  put(wsSyn, r, 2, 'Avances accordées (à récupérer + déduites + soldées)', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(sumLabels(ADV_GRANTED_LABELS, (l) => `COUNTIF(${ava('F')},"${l}")`), T.advancesGranted), { ...cellC, font: { bold: true } });
  put(wsSyn, r, 4, fx(sumLabels(ADV_GRANTED_LABELS, (l) => `SUMIFS(${ava('G')},${ava('F')},"${l}")`), T.advancesGrantedAmount), { ...cellM, font: { bold: true } });
  r++;
  const rARej = asRow.get(ADVANCE_STATUS_LABEL.REJECTED)!;
  put(wsSyn, r, 2, 'Taux d’acceptation (accordées / (accordées + refusées))', cell);
  put(wsSyn, r, 3, fx(`IF(C${rAG}+C${rARej}>0,C${rAG}/(C${rAG}+C${rARej}),0)`, T.advanceAcceptanceRate), { ...cellC, numFmt: PCT });
  put(wsSyn, r, 4, '', cell); r++;
  const rARepaid = r;
  put(wsSyn, r, 2, 'Déjà remboursé sur les avances accordées', cell);
  put(wsSyn, r, 3, '', cell);
  put(wsSyn, r, 4, fx(sumLabels(ADV_GRANTED_LABELS, (l) => `SUMIFS(${ava('H')},${ava('F')},"${l}")`), repaidAdv), cellM);
  r += 2;

  // — Ensemble de la période —
  section('ENSEMBLE DE LA PÉRIODE');
  const line = (label: string, formula: string, cached: number | string, fmt?: string, bold = false): number => {
    put(wsSyn, r, 2, label, { ...cell, font: bold ? { bold: true } : undefined });
    put(wsSyn, r, 3, fx(formula, cached), { ...(fmt === MONEY ? cellM : cellC), numFmt: fmt, font: bold ? { bold: true } : undefined });
    put(wsSyn, r, 4, '', cell);
    return r++;
  };
  const rGranted = line('MONTANT TOTAL ACCORDÉ (prêts + avances)', `D${rLG}+D${rAG}`, T.grantedAmount, MONEY, true);
  put(wsSyn, r, 2, 'Salariés ayant obtenu un prêt ou une avance', cell); put(wsSyn, r, 3, T.borrowers, cellC); put(wsSyn, r, 4, '', cell); r++;
  line('Montant moyen accordé', `IF(C${rLG}+C${rAG}>0,C${rGranted}/(C${rLG}+C${rAG}),0)`, T.avgGrantedAmount, MONEY);
  const rRecovered = line('Déjà remboursé sur ce qui a été accordé', `D${rLRepaid}+D${rARepaid}`, T.recoveredAmount, MONEY);
  line('TAUX DE REMBOURSEMENT (remboursé / accordé)', `IF(C${rGranted}>0,C${rRecovered}/C${rGranted},0)`, T.recoveryRate, PCT, true);
  r++;

  // — Remboursements —
  section('REMBOURSEMENTS ENCAISSÉS PENDANT LA PÉRIODE');
  tblHead(['Mode', 'OPÉRATIONS', 'MONTANT']);
  const rmFirst = r;
  for (const label of METHOD_ORDER) {
    const f = RM.find((x) => x.label === label);
    put(wsSyn, r, 2, label, cell);
    put(wsSyn, r, 3, fx(`COUNTIF(${rem('G')},B${r})`, f?.count ?? 0), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${rem('H')},${rem('G')},B${r})`, f?.amount ?? 0), cellM);
    r++;
  }
  const rmLast = r - 1;
  put(wsSyn, r, 2, 'TOTAL REMBOURSÉ', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(`SUM(C${rmFirst}:C${r - 1})`, data.repayments.length), { ...cellC, font: { bold: true } });
  put(wsSyn, r, 4, fx(`SUM(D${rmFirst}:D${r - 1})`, T.repaidInPeriod), { ...cellM, font: { bold: true } });
  r++;
  for (const k of ['Prêt', 'Avance']) {
    const rows = data.repayments.filter((x) => x.kindLabel === k);
    put(wsSyn, r, 2, k === 'Prêt' ? 'dont remboursements de prêts' : 'dont remboursements d’avances', cell);
    put(wsSyn, r, 3, fx(`COUNTIF(${rem('F')},"${k}")`, rows.length), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${rem('H')},${rem('F')},"${k}")`, round2(rows.reduce((x, y) => x + y.amount, 0))), cellM);
    r++;
  }
  r++;

  // — Dettes en cours à ce jour —
  section('DETTES EN COURS À CE JOUR (indépendantes de la période)');
  const rOutL = line('Encours des prêts', `SUM(${enc('E')})`, T.outstandingLoans, MONEY);
  const rOutA = line('Encours des avances', `SUM(${enc('F')})`, T.outstandingAdvances, MONEY);
  line('ENCOURS TOTAL', `C${rOutL}+C${rOutA}`, T.outstandingTotal, MONEY, true);
  line('Salariés endettés', `COUNTIF(${enc('G')},">0")`, T.indebtedEmployees, undefined, true);
  put(wsSyn, r, 2, 'Prêts en cours (nombre)', cell); put(wsSyn, r, 3, T.loansInProgress, cellC); put(wsSyn, r, 4, '', cell); r++;
  put(wsSyn, r, 2, 'Avances à récupérer (nombre)', cell); put(wsSyn, r, 3, T.advancesToRecover, cellC); put(wsSyn, r, 4, '', cell); r += 2;

  // — Encours par département —
  section('ENCOURS PAR DÉPARTEMENT', 5);
  ['Département', 'SALARIÉS ENDETTÉS', 'ENCOURS PRÊTS', 'ENCOURS AVANCES', 'ENCOURS TOTAL'].forEach((l, i) => put(wsSyn, r, 2 + i, l, hdrStyle));
  wsSyn.getRow(r).height = 30; r++;
  const dFirst = r;
  for (const d of depRows) {
    put(wsSyn, r, 2, d.label, cell);
    put(wsSyn, r, 3, fx(`COUNTIFS(${enc('D')},B${r},${enc('G')},">0")`, d.indebted), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${enc('E')},${enc('D')},B${r})`, d.outstandingLoans), cellM);
    put(wsSyn, r, 5, fx(`SUMIFS(${enc('F')},${enc('D')},B${r})`, d.outstandingAdvances), cellM);
    put(wsSyn, r, 6, fx(`D${r}+E${r}`, d.outstandingTotal), { ...cellM, font: { bold: true } });
    r++;
  }
  const dLast = Math.max(dFirst, r - 1);
  wsSyn.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ═══════════════════════════════ ÉVOLUTION ══════════════════════════════════
  const months = data.period.months;
  const evo = evolution(data);
  const evoCols = ['MOIS', 'CLÉ', 'PRÊTS ACCORDÉS (MONTANT)', 'AVANCES ACCORDÉES (MONTANT)', 'TOTAL ACCORDÉ', 'REMBOURSÉ', 'NB PRÊTS ACCORDÉS', 'NB AVANCES ACCORDÉES'];
  title(wsEvo, 'ÉVOLUTION MENSUELLE', evoCols.length);
  header(wsEvo, evoCols, [22, 9, 19, 19, 16, 16, 14, 14]);
  months.forEach((m, i) => {
    const rr = 5 + i;
    const e = evo[i];
    put(wsEvo, rr, 1, m.label, { ...cell, font: { bold: true } });
    put(wsEvo, rr, 2, m.key, { ...cellC, font: { color: { argb: argb(GREY) } } });
    put(wsEvo, rr, 3, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `SUMIFS(${pre('I')},${pre('A')},$B${rr},${pre('H')},"${l}")`), e.loansGrantedAmount), cellM);
    put(wsEvo, rr, 4, fx(sumLabels(ADV_GRANTED_LABELS, (l) => `SUMIFS(${ava('G')},${ava('A')},$B${rr},${ava('F')},"${l}")`), e.advancesGrantedAmount), cellM);
    put(wsEvo, rr, 5, fx(`C${rr}+D${rr}`, round2(e.loansGrantedAmount + e.advancesGrantedAmount)), { ...cellM, font: { bold: true } });
    put(wsEvo, rr, 6, fx(`SUMIFS(${rem('H')},${rem('A')},$B${rr})`, e.repaidAmount), cellM);
    put(wsEvo, rr, 7, fx(sumLabels(LOAN_GRANTED_LABELS, (l) => `COUNTIFS(${pre('A')},$B${rr},${pre('H')},"${l}")`), e.loansGranted), cellC);
    put(wsEvo, rr, 8, fx(sumLabels(ADV_GRANTED_LABELS, (l) => `COUNTIFS(${ava('A')},$B${rr},${ava('F')},"${l}")`), e.advancesGranted), cellC);
  });
  const e0 = 5, e1 = 4 + months.length;
  wsEvo.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ═══════════════════════════════ GRAPHIQUES ═════════════════════════════════
  const S = (a1: string) => sheetRef(wsSyn.name, a1);
  const E = (a1: string) => sheetRef(wsEvo.name, a1);
  const charts: ChartSpec[] = [];
  if (depRows.length > 0) {
    charts.push({
      sheet: wsSyn.name, from: { col: 8, row: 4 }, to: { col: 17, row: 4 + Math.max(18, depRows.length + 6) }, kind: 'bar',
      title: 'ENCOURS PAR DÉPARTEMENT (FCFA)', titleColor: NAVY,
      catsRef: S(`$B$${dFirst}:$B$${dLast}`), cats: depRows.map((d) => d.label),
      series: [{ name: 'Encours total', nameRef: S(`$F$${dFirst - 1}`), valuesRef: S(`$F$${dFirst}:$F$${dLast}`), vals: depRows.map((d) => d.outstandingTotal), color: 'C0504D' }],
      gapWidth: 50, fontSize: 800,
    });
  }
  const top2 = 4 + Math.max(18, depRows.length + 6) + 2;
  charts.push({
    sheet: wsSyn.name, from: { col: 8, row: top2 }, to: { col: 17, row: top2 + 17 }, kind: 'col',
    title: 'PRÊTS ACCORDÉS PAR NATURE (FCFA)', titleColor: NAVY,
    catsRef: S(`$B$${lnFirst}:$B$${lnLast}`), cats: NATURE_ORDER,
    series: [{ name: 'Montant', valuesRef: S(`$D$${lnFirst}:$D$${lnLast}`), vals: NATURE_ORDER.map((l) => LN.find((x) => x.label === l)?.amount ?? 0), color: '4BACC6' }],
    gapWidth: 80,
  });
  charts.push({
    sheet: wsSyn.name, from: { col: 8, row: top2 + 18 }, to: { col: 17, row: top2 + 35 }, kind: 'col',
    title: 'REMBOURSEMENTS PAR MODE (FCFA)', titleColor: NAVY,
    catsRef: S(`$B$${rmFirst}:$B$${rmLast}`), cats: METHOD_ORDER,
    series: [{ name: 'Montant', valuesRef: S(`$D$${rmFirst}:$D$${rmLast}`), vals: METHOD_ORDER.map((l) => RM.find((x) => x.label === l)?.amount ?? 0), color: '9BBB59' }],
    gapWidth: 80,
  });
  const evoTop = e1 + 2;
  charts.push({
    sheet: wsEvo.name, from: { col: 0, row: evoTop }, to: { col: 5, row: evoTop + 18 }, kind: 'col',
    title: 'PRÊTS ET AVANCES ACCORDÉS PAR MOIS (FCFA)', titleColor: NAVY,
    catsRef: E(`$A$${e0}:$A$${e1}`), cats: months.map((m) => m.label),
    series: [
      { name: 'Prêts', nameRef: E('$C$4'), valuesRef: E(`$C$${e0}:$C$${e1}`), vals: evo.map((e) => e.loansGrantedAmount), color: '1F497D' },
      { name: 'Avances', nameRef: E('$D$4'), valuesRef: E(`$D$${e0}:$D$${e1}`), vals: evo.map((e) => e.advancesGrantedAmount), color: 'F79646' },
    ],
    showLegend: true, gapWidth: 60,
  });
  charts.push({
    sheet: wsEvo.name, from: { col: 5, row: evoTop }, to: { col: 11, row: evoTop + 18 }, kind: 'line',
    title: 'ACCORDÉ ET REMBOURSÉ PAR MOIS (FCFA)', titleColor: NAVY,
    catsRef: E(`$A$${e0}:$A$${e1}`), cats: months.map((m) => m.label),
    series: [
      { name: 'Total accordé', nameRef: E('$E$4'), valuesRef: E(`$E$${e0}:$E$${e1}`), vals: evo.map((e) => round2(e.loansGrantedAmount + e.advancesGrantedAmount)), color: 'C0504D' },
      { name: 'Remboursé', nameRef: E('$F$4'), valuesRef: E(`$F$${e0}:$F$${e1}`), vals: evo.map((e) => e.repaidAmount), color: '9BBB59' },
    ],
    showLegend: true,
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return injectCharts(buf, charts);
}