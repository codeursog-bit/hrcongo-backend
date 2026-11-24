// ============================================================================
// 📁 src/attendance-dashboard/attendance-dashboard.excel.ts
// Classeur Excel « Présences · Absences · Permissions ».
//   Synthèse     : indicateurs + répartitions + par département (formules) + 3 graphiques
//   Evolution    : tableau mois par mois (formules) + 2 graphiques
//   Présences    : une ligne par employé et par mois (données source)
//   Absences     : une ligne par demande d'absence
//   Permissions  : une ligne par ticket de permission
//   Conges       : une ligne par demande de congé (rattachée au mois de début)
// Les chiffres des onglets Synthèse / Evolution sont des FORMULES sur les trois
// onglets de données (valeur en cache = même calcul que l'écran) : si l'utilisateur
// corrige une ligne dans Excel, les totaux et les graphiques suivent.
// ============================================================================

import * as ExcelJS from 'exceljs';
import { ChartSpec, injectCharts, sheetRef } from '../workforce-dashboard/xlsx-chart-injector';
import { argb, border, colLetter, fx, put, q, uniqueSheetName, CellStyle } from '../workforce-dashboard/workforce-excel-common';
import { LEAVE_TYPE_ORDER, absenceBreakdown, absenceStats, departmentRows, evolution, leaveStats, motifLabels, permissionStats, splitAbs, totalsOf, round2 } from './attendance-dashboard.calc';
import { AttendanceDashboardData } from './attendance-dashboard.types';

const NAVY = '1F497D';
const SECTION = 'DCE6F1';
const GREY = '595959';
const MARGIN = 300; // lignes de marge sous les données pour que les formules couvrent les ajouts
const LOCAL_OFFSET_MS = 3600_000; // Africa/Brazzaville (UTC+1)

const PCT = '0.00%';
const hdrStyle: CellStyle = {
  font: { bold: true, color: { argb: argb('FFFFFF') } }, fill: NAVY, border: border(),
  align: { horizontal: 'center', vertical: 'middle', wrapText: true },
};
const cell: CellStyle = { border: border('BFBFBF'), align: { vertical: 'middle' } };
const cellC: CellStyle = { ...cell, align: { horizontal: 'center', vertical: 'middle' } };
const sectionStyle: CellStyle = { font: { bold: true, color: { argb: argb(NAVY) } }, fill: SECTION, border: border('BFBFBF') };

const local = (d: Date) => new Date(d.getTime() + LOCAL_OFFSET_MS);
const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function buildAttendanceWorkbook(data: AttendanceDashboardData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KonzaRH';
  wb.created = data.generatedAt;

  const wsSyn = wb.addWorksheet(uniqueSheetName(wb, 'Synthese'), { views: [{ showGridLines: false }] });
  const wsEvo = wb.addWorksheet(uniqueSheetName(wb, 'Evolution'), { views: [{ showGridLines: false }] });
  const wsPre = wb.addWorksheet(uniqueSheetName(wb, 'Presences'), { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsAbs = wb.addWorksheet(uniqueSheetName(wb, 'Absences'), { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsPer = wb.addWorksheet(uniqueSheetName(wb, 'Permissions'), { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsCon = wb.addWorksheet(uniqueSheetName(wb, 'Conges'), { views: [{ state: 'frozen', ySplit: 4 }] });

  const empIdx = new Map(data.employees.map((e) => [e.id, e]));
  const monthLabel = new Map(data.period.months.map((m) => [m.key, m.label]));
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

  // ════════════════════════════ PRÉSENCES (source) ════════════════════════════
  const preCols = ['MOIS', 'CLÉ', 'ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'PRÉSENT', 'TÉLÉTRAVAIL', 'RETARDS', 'CONGÉS',
    'ABS. PAYÉE', 'ABS. NON PAYÉE', 'FÉRIÉS', 'REPOS', 'JOURS TRAVAILLÉS', 'JOURS D’ABSENCE', 'JOURS À TRAVAILLER', 'TAUX PRÉSENCE', 'TAUX ABSENTÉISME',
    'ABS. JUSTIFIÉES', 'ABS. NON JUSTIFIÉES', 'MOTIFS DES ABSENCES JUSTIFIÉES'];
  title(wsPre, 'PRÉSENCES — détail par employé et par mois', preCols.length);
  header(wsPre, preCols, [20, 9, 24, 12, 30, 24, 10, 12, 10, 10, 11, 13, 9, 9, 13, 13, 13, 12, 14, 13, 14, 44]);
  const sums = [...data.summaries].sort((a, b) => a.key.localeCompare(b.key) || (empIdx.get(a.employeeId)?.fullName ?? '').localeCompare(empIdx.get(b.employeeId)?.fullName ?? ''));
  const P0 = 5;
  sums.forEach((s, i) => {
    const r = P0 + i;
    const e = empIdx.get(s.employeeId);
    const worked = s.present + s.remote + s.late;
    const abs = s.absPaid + s.absUnpaid;
    const theo = worked + abs;
    const vals: (string | number)[] = [monthLabel.get(s.key) ?? s.key, s.key, e?.companyName ?? '', e?.matricule ?? '', e?.fullName ?? '', e?.department ?? '',
      s.present, s.remote, s.late, s.leave, s.absPaid, s.absUnpaid, s.holiday, s.offDay];
    vals.forEach((v, c) => put(wsPre, r, c + 1, v, c >= 6 ? cellC : cell));
    put(wsPre, r, 15, fx(`G${r}+H${r}+I${r}`, worked), { ...cellC, font: { bold: true } });
    put(wsPre, r, 16, fx(`K${r}+L${r}`, abs), cellC);
    put(wsPre, r, 17, fx(`O${r}+P${r}`, theo), cellC);
    put(wsPre, r, 18, fx(`IF(Q${r}>0,O${r}/Q${r},"")`, theo > 0 ? worked / theo : ''), { ...cellC, numFmt: PCT });
    put(wsPre, r, 19, fx(`IF(Q${r}>0,P${r}/Q${r},"")`, theo > 0 ? abs / theo : ''), { ...cellC, numFmt: PCT });
    // 🆕 absences justifiées (demande validée) / non justifiées + motifs
    const sp = splitAbs(s);
    put(wsPre, r, 20, sp.j, cellC);
    put(wsPre, r, 21, sp.u, cellC);
    const motifTxt = Object.entries(s.justifiedDetail ?? {})
      .map(([k, d]) => { const [t, sb = ''] = k.split('|'); return `${motifLabels(t, sb).label} ${d} j`; })
      .join(' · ');
    put(wsPre, r, 22, motifTxt, cell);
  });
  const P1 = P0 + sums.length + MARGIN;
  const pre = (col: string) => `${q(wsPre.name)}!$${col}$${P0}:$${col}$${P1}`;
  wsPre.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: preCols.length } };

  // ════════════════════════════ ABSENCES (source) ═════════════════════════════
  const absCols = ['CLÉ MOIS', 'ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'TYPE', 'MOTIF TYPE', 'PAYÉE', 'DU', 'AU', 'JOURS OUVRÉS', 'STATUT', 'MOTIF'];
  title(wsAbs, 'DEMANDES D’ABSENCE — rattachées au mois de début', absCols.length);
  header(wsAbs, absCols, [10, 24, 12, 30, 24, 16, 18, 8, 12, 12, 11, 13, 50]);
  const A0 = 5;
  data.absences.forEach((a, i) => {
    const r = A0 + i;
    const e = empIdx.get(a.employeeId);
    [a.monthKey, e?.companyName ?? '', e?.matricule ?? '', e?.fullName ?? '', e?.department ?? '', a.typeLabel, a.subTypeLabel, a.paid ? 'Oui' : 'Non'].forEach((v, c) => put(wsAbs, r, c + 1, v, c === 7 ? cellC : cell));
    put(wsAbs, r, 9, dateOnly(a.start), { ...cellC, numFmt: 'dd/mm/yyyy' });
    put(wsAbs, r, 10, dateOnly(a.end), { ...cellC, numFmt: 'dd/mm/yyyy' });
    put(wsAbs, r, 11, a.workingDays, { ...cellC, numFmt: '0.##' });
    put(wsAbs, r, 12, a.statusLabel, cellC);
    put(wsAbs, r, 13, a.reason, { ...cell, align: { vertical: 'middle', wrapText: true } });
  });
  const A1 = A0 + data.absences.length + MARGIN;
  const abr = (col: string) => `${q(wsAbs.name)}!$${col}$${A0}:$${col}$${A1}`;
  wsAbs.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: absCols.length } };

  // ═══════════════════════════ PERMISSIONS (source) ═══════════════════════════
  const perCols = ['CLÉ MOIS', 'ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'TYPE', 'MISSION', 'DESTINATION', 'SORTIE', 'RETOUR PRÉVU',
    'RETOUR VALIDÉ', 'DURÉE (H)', 'RETARD (MIN)', 'STATUT', 'RETOUR', 'MOTIF'];
  title(wsPer, 'PERMISSIONS DE SORTIE — rattachées au mois de la sortie', perCols.length);
  header(wsPer, perCols, [10, 24, 12, 30, 24, 12, 20, 22, 17, 17, 17, 10, 12, 13, 16, 46]);
  const R0 = 5;
  data.permissions.forEach((p, i) => {
    const r = R0 + i;
    const e = empIdx.get(p.employeeId);
    [p.monthKey, e?.companyName ?? '', e?.matricule ?? '', e?.fullName ?? '', e?.department ?? '', p.typeLabel, p.missionLabel, p.destination].forEach((v, c) => put(wsPer, r, c + 1, v, cell));
    const dt = { ...cellC, numFmt: 'dd/mm/yyyy hh:mm' };
    put(wsPer, r, 9, local(p.departure), dt);
    put(wsPer, r, 10, local(p.expectedReturn), dt);
    if (p.actualReturn) put(wsPer, r, 11, local(p.actualReturn), dt); else put(wsPer, r, 11, null, cellC);
    put(wsPer, r, 12, fx(`IF(K${r}="","",ROUND((K${r}-I${r})*24,2))`, p.durationHours ?? ''), { ...cellC, numFmt: '0.00' });
    put(wsPer, r, 13, fx(`IF(K${r}="","",MAX(0,ROUND((K${r}-J${r})*1440,0)))`, p.actualReturn ? p.lateMinutes : ''), cellC);
    put(wsPer, r, 14, p.statusLabel, cellC);
    put(wsPer, r, 15, p.returnLabel, cellC);
    put(wsPer, r, 16, p.reason, { ...cell, align: { vertical: 'middle', wrapText: true } });
  });
  const R1 = R0 + data.permissions.length + MARGIN;
  const per = (col: string) => `${q(wsPer.name)}!$${col}$${R0}:$${col}$${R1}`;
  wsPer.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: perCols.length } };

  // ═══════════════════════════════ CONGÉS (source) ════════════════════════════
  const conCols = ['CLÉ MOIS', 'ENTREPRISE', 'MATRICULE', 'NOM ET PRÉNOM', 'DÉPARTEMENT', 'TYPE', 'STATUT', 'DU', 'AU', 'JOURS', 'MOTIF'];
  title(wsCon, 'DEMANDES DE CONGÉ — rattachées au mois de début', conCols.length);
  header(wsCon, conCols, [10, 24, 12, 30, 24, 18, 13, 12, 12, 9, 46]);
  const C0 = 5;
  data.leaves.forEach((l, i) => {
    const r = C0 + i;
    const e = empIdx.get(l.employeeId);
    [l.monthKey, e?.companyName ?? '', e?.matricule ?? '', e?.fullName ?? '', e?.department ?? '', l.typeLabel].forEach((v, c) => put(wsCon, r, c + 1, v, cell));
    put(wsCon, r, 7, l.statusLabel, cellC);
    put(wsCon, r, 8, dateOnly(l.start), { ...cellC, numFmt: 'dd/mm/yyyy' });
    put(wsCon, r, 9, dateOnly(l.end), { ...cellC, numFmt: 'dd/mm/yyyy' });
    put(wsCon, r, 10, l.days, { ...cellC, numFmt: '0.##' });
    put(wsCon, r, 11, l.reason, { ...cell, align: { vertical: 'middle', wrapText: true } });
  });
  const C1 = C0 + data.leaves.length + MARGIN;
  const con = (col: string) => `${q(wsCon.name)}!$${col}$${C0}:$${col}$${C1}`;
  wsCon.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: conCols.length } };

  // ═══════════════════════════════ SYNTHÈSE ═══════════════════════════════════
  const T = totalsOf(data.summaries);
  const LS = leaveStats(data.leaves);
  const AS = absenceStats(data.absences);
  const PS = permissionStats(data.permissions);
  const depRows = departmentRows(data.employees, data.summaries);

  title(wsSyn, 'TABLEAU DE BORD — PRÉSENCES · ABSENCES · PERMISSIONS', 8);
  wsSyn.getColumn(1).width = 2;
  wsSyn.getColumn(2).width = 52;
  [3, 4, 5, 6, 7].forEach((c) => (wsSyn.getColumn(c).width = 16));
  wsSyn.getColumn(8).width = 3;

  let r = 5;
  const section = (label: string, span = 3) => {
    for (let c = 2; c < 2 + span; c++) put(wsSyn, r, c, c === 2 ? label : '', sectionStyle);
    r++;
  };
  const line = (label: string, formula: string, cached: number | string, fmt?: string, bold = false): number => {
    put(wsSyn, r, 2, label, { ...cell, font: bold ? { bold: true } : undefined });
    put(wsSyn, r, 3, fx(formula, cached), { ...cellC, numFmt: fmt, font: bold ? { bold: true } : undefined });
    return r++;
  };

  // — Présences —
  section('INDICATEURS DE PRÉSENCE');
  put(wsSyn, r, 2, 'Salariés concernés', cell); put(wsSyn, r, 3, data.employees.length, cellC); r++;
  const rPresent = line('Jours présents', `SUM(${pre('G')})`, T.present);
  const rRemote = line('Jours en télétravail', `SUM(${pre('H')})`, T.remote);
  const rLate = line('Jours en retard', `SUM(${pre('I')})`, T.late);
  const rWorked = line('Jours travaillés', `C${rPresent}+C${rRemote}+C${rLate}`, T.workedDays, undefined, true);
  const rAbsP = line('Absences payées (jours)', `SUM(${pre('K')})`, T.absPaid);
  const rAbsU = line('Absences non payées (jours)', `SUM(${pre('L')})`, T.absUnpaid);
  const rAbs = line('Jours d’absence', `C${rAbsP}+C${rAbsU}`, T.absenceDays, undefined, true);
  line('   dont justifiées (demande d’absence validée)', `SUM(${pre('T')})`, T.absJustified);
  line('   dont non justifiées (ni pointage ni demande validée)', `SUM(${pre('U')})`, T.absUnjustified);
  const rTheo = line('Jours à travailler', `C${rWorked}+C${rAbs}`, T.theoreticalDays);
  line('TAUX DE PRÉSENCE', `IF(C${rTheo}>0,C${rWorked}/C${rTheo},0)`, T.presenceRate, PCT, true);
  line('TAUX D’ABSENTÉISME', `IF(C${rTheo}>0,C${rAbs}/C${rTheo},0)`, T.absenteeismRate, PCT, true);
  line('Taux de retard (retards / jours travaillés)', `IF(C${rWorked}>0,C${rLate}/C${rWorked},0)`, T.lateRate, PCT);
  line('Taux de télétravail', `IF(C${rWorked}>0,C${rRemote}/C${rWorked},0)`, T.remoteRate, PCT);
  const rLeaveDays = line('Jours de congé (exclus des taux)', `SUM(${pre('J')})`, T.leave);
  line('Part des jours en congé (congés / (jours à travailler + congés))', `IF(C${rTheo}+C${rLeaveDays}>0,C${rLeaveDays}/(C${rTheo}+C${rLeaveDays}),0)`, T.leaveRate, PCT);
  const rAbsEmp = r;
  put(wsSyn, r, 2, 'Salariés ayant eu au moins 1 jour d’absence', cell); put(wsSyn, r, 3, T.absentEmployees, cellC); r++;
  line('Durée moyenne d’une absence (jours / salarié absent)', `IF(C${rAbsEmp}>0,C${rAbs}/C${rAbsEmp},0)`, T.avgAbsenceDuration, '0.00');
  r++;

  // 🆕 Absences justifiées par motif (valeurs calculées à la génération du fichier)
  const BRK = absenceBreakdown(data.summaries);
  if (BRK.total > 0) {
    section('ABSENCES JUSTIFIÉES / NON JUSTIFIÉES — PAR MOTIF', 5);
    ['Motif', 'JOURS', 'DONT PAYÉS', 'DONT NON PAYÉS', 'SALARIÉS'].forEach((h, i) => put(wsSyn, r, 2 + i, h, hdrStyle));
    r++;
    for (const m of BRK.motifs) {
      put(wsSyn, r, 2, m.typeLabel !== m.label ? `${m.label} (${m.typeLabel})` : m.label, cell);
      put(wsSyn, r, 3, m.days, cellC); put(wsSyn, r, 4, m.paidDays, cellC); put(wsSyn, r, 5, m.unpaidDays, cellC); put(wsSyn, r, 6, m.employees, cellC);
      r++;
    }
    put(wsSyn, r, 2, 'Absences justifiées (total)', { ...cell, font: { bold: true } });
    put(wsSyn, r, 3, BRK.justified, { ...cellC, font: { bold: true } }); put(wsSyn, r, 6, BRK.justifiedEmployees, cellC); r++;
    put(wsSyn, r, 2, 'Absences non justifiées', { ...cell, font: { bold: true } });
    put(wsSyn, r, 3, BRK.unjustified, { ...cellC, font: { bold: true } }); put(wsSyn, r, 6, BRK.unjustifiedEmployees, cellC); r++;
    r++;
  }

  // — Absences —
  section('DEMANDES D’ABSENCE', 3);
  put(wsSyn, r, 3, 'DEMANDES', { ...hdrStyle }); put(wsSyn, r, 4, 'JOURS', { ...hdrStyle }); put(wsSyn, r, 2, 'Statut', { ...hdrStyle }); r++;
  const stRows: [string, number, number][] = [];
  const stFirst = r;
  for (const s of AS.byStatus) {
    const days = round2(data.absences.filter((a) => a.statusLabel === s.label).reduce((x, a) => x + a.workingDays, 0));
    put(wsSyn, r, 2, s.label, cell);
    put(wsSyn, r, 3, fx(`COUNTIF(${abr('L')},B${r})`, s.count), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${abr('K')},${abr('L')},B${r})`, days), { ...cellC, numFmt: '0.##' });
    stRows.push([s.label, s.count, days]); r++;
  }
  put(wsSyn, r, 2, 'TOTAL DES DEMANDES', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(`SUM(C${stFirst}:C${r - 1})`, AS.total), { ...cellC, font: { bold: true } });
  put(wsSyn, r, 4, fx(`SUM(D${stFirst}:D${r - 1})`, round2(stRows.reduce((x, s) => x + s[2], 0))), { ...cellC, font: { bold: true }, numFmt: '0.##' });
  r += 2;
  put(wsSyn, r, 2, 'Par type (demandes approuvées)', { ...hdrStyle }); put(wsSyn, r, 3, 'DEMANDES', hdrStyle); put(wsSyn, r, 4, 'JOURS', hdrStyle); r++;
  const typeLabels = ['Maladie', 'Conventionnelle', 'Exceptionnelle'];
  const tyFirst = r;
  for (const label of typeLabels) {
    const found = AS.byType.find((t) => t.label === label);
    put(wsSyn, r, 2, label, cell);
    put(wsSyn, r, 3, fx(`COUNTIFS(${abr('F')},B${r},${abr('L')},"Approuvée")`, found?.count ?? 0), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${abr('K')},${abr('F')},B${r},${abr('L')},"Approuvée")`, found?.days ?? 0), { ...cellC, numFmt: '0.##' });
    r++;
  }
  const tyLast = r - 1;
  put(wsSyn, r, 2, 'dont jours payés', cell);
  put(wsSyn, r, 4, fx(`SUMIFS(${abr('K')},${abr('L')},"Approuvée",${abr('H')},"Oui")`, AS.paidDays), { ...cellC, numFmt: '0.##' }); put(wsSyn, r, 3, '', cell); r++;
  put(wsSyn, r, 2, 'dont jours non payés', cell);
  put(wsSyn, r, 4, fx(`SUMIFS(${abr('K')},${abr('L')},"Approuvée",${abr('H')},"Non")`, AS.unpaidDays), { ...cellC, numFmt: '0.##' }); put(wsSyn, r, 3, '', cell); r += 2;

  // — Permissions —
  section('PERMISSIONS DE SORTIE', 3);
  put(wsSyn, r, 2, 'Statut', hdrStyle); put(wsSyn, r, 3, 'TICKETS', hdrStyle); put(wsSyn, r, 4, '', hdrStyle); r++;
  const pFirst = r;
  for (const s of PS.byStatus) {
    put(wsSyn, r, 2, s.label, cell);
    put(wsSyn, r, 3, fx(`COUNTIF(${per('N')},B${r})`, s.count), cellC);
    put(wsSyn, r, 4, '', cell); r++;
  }
  put(wsSyn, r, 2, 'TOTAL DES TICKETS', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(`SUM(C${pFirst}:C${r - 1})`, PS.total), { ...cellC, font: { bold: true } }); put(wsSyn, r, 4, '', cell); r++;
  line('Heures de permission (retours validés)', `SUMIFS(${per('L')},${per('N')},"Approuvée")`, PS.totalHours, '0.00');
  const doneCount = data.permissions.filter((p) => p.status === 'APPROVED' && p.durationHours !== null).length;
  line('Durée moyenne d’une permission (heures)', `IFERROR(C${r - 1}/COUNTIFS(${per('N')},"Approuvée",${per('K')},"<>"),0)`, PS.avgHours, '0.00');
  void doneCount;
  line('Retours en retard', `COUNTIFS(${per('N')},"Approuvée",${per('M')},">0")`, PS.lateReturns);
  line('Retours non validés (approuvées)', `COUNTIFS(${per('N')},"Approuvée",${per('O')},"<>Retour validé")`, PS.notReturned);
  r++;
  put(wsSyn, r, 2, 'Par type (approuvées)', hdrStyle); put(wsSyn, r, 3, 'TICKETS', hdrStyle); put(wsSyn, r, 4, '', hdrStyle); r++;
  const ptFirst = r;
  for (const label of ['Urgence', 'Mission', 'Autre']) {
    const found = PS.byType.find((t) => t.label === label);
    put(wsSyn, r, 2, label, cell);
    put(wsSyn, r, 3, fx(`COUNTIFS(${per('F')},B${r},${per('N')},"Approuvée")`, found?.count ?? 0), cellC);
    put(wsSyn, r, 4, '', cell); r++;
  }
  const ptLast = r - 1;
  r++;

  // — Congés —
  section('DEMANDES DE CONGÉ', 3);
  put(wsSyn, r, 2, 'Statut', hdrStyle); put(wsSyn, r, 3, 'DEMANDES', hdrStyle); put(wsSyn, r, 4, 'JOURS', hdrStyle); r++;
  const lsFirst = r;
  for (const s of LS.byStatus) {
    const days = round2(data.leaves.filter((l) => l.statusLabel === s.label).reduce((x, l) => x + l.days, 0));
    put(wsSyn, r, 2, s.label, cell);
    put(wsSyn, r, 3, fx(`COUNTIF(${con('G')},B${r})`, s.count), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${con('J')},${con('G')},B${r})`, days), { ...cellC, numFmt: '0.##' });
    r++;
  }
  put(wsSyn, r, 2, 'TOTAL DES DEMANDES DE CONGÉ', { ...cell, font: { bold: true } });
  put(wsSyn, r, 3, fx(`SUM(C${lsFirst}:C${r - 1})`, LS.total), { ...cellC, font: { bold: true } });
  put(wsSyn, r, 4, fx(`SUM(D${lsFirst}:D${r - 1})`, round2(data.leaves.reduce((x, l) => x + l.days, 0))), { ...cellC, font: { bold: true }, numFmt: '0.##' });
  r += 2;
  put(wsSyn, r, 2, 'Par type (congés approuvés)', hdrStyle); put(wsSyn, r, 3, 'DEMANDES', hdrStyle); put(wsSyn, r, 4, 'JOURS', hdrStyle); r++;
  const ltFirst = r;
  for (const label of LEAVE_TYPE_ORDER) {
    const found = LS.byType.find((t) => t.label === label);
    put(wsSyn, r, 2, label, cell);
    put(wsSyn, r, 3, fx(`COUNTIFS(${con('F')},B${r},${con('G')},"Approuvée")`, found?.count ?? 0), cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${con('J')},${con('F')},B${r},${con('G')},"Approuvée")`, found?.days ?? 0), { ...cellC, numFmt: '0.##' });
    r++;
  }
  const ltLast = r - 1;
  r++;

  // — Par département —
  section('PAR DÉPARTEMENT', 6);
  ['Département', 'EFFECTIF', 'JOURS TRAVAILLÉS', 'JOURS D’ABSENCE', 'TAUX PRÉSENCE', 'TAUX ABSENTÉISME'].forEach((l, i) => put(wsSyn, r, 2 + i, l, hdrStyle));
  wsSyn.getRow(r).height = 30; r++;
  const dFirst = r;
  for (const d of depRows) {
    put(wsSyn, r, 2, d.label, cell);
    put(wsSyn, r, 3, d.headcount, cellC);
    put(wsSyn, r, 4, fx(`SUMIFS(${pre('O')},${pre('F')},B${r})`, d.workedDays), cellC);
    put(wsSyn, r, 5, fx(`SUMIFS(${pre('P')},${pre('F')},B${r})`, d.absenceDays), cellC);
    put(wsSyn, r, 6, fx(`IF(D${r}+E${r}>0,D${r}/(D${r}+E${r}),0)`, d.presenceRate), { ...cellC, numFmt: PCT });
    put(wsSyn, r, 7, fx(`IF(D${r}+E${r}>0,E${r}/(D${r}+E${r}),0)`, d.absenteeismRate), { ...cellC, numFmt: PCT });
    r++;
  }
  const dLast = Math.max(dFirst, r - 1);
  wsSyn.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ═══════════════════════════════ ÉVOLUTION ══════════════════════════════════
  const months = data.period.months;
  const evo = evolution(data);
  const evoCols = ['MOIS', 'CLÉ', 'JOURS TRAVAILLÉS', 'JOURS D’ABSENCE', 'JOURS EN RETARD', 'TAUX PRÉSENCE', 'TAUX ABSENTÉISME', 'ABSENCES APPROUVÉES', 'PERMISSIONS APPROUVÉES', 'PRÉSENCE (%)', 'ABSENTÉISME (%)', 'JOURS DE CONGÉ', 'CONGÉS APPROUVÉS'];
  title(wsEvo, 'ÉVOLUTION MENSUELLE', evoCols.length);
  header(wsEvo, evoCols, [22, 9, 14, 14, 14, 13, 14, 14, 15, 12, 14, 13, 14]);
  months.forEach((m, i) => {
    const rr = 5 + i;
    const e = evo[i];
    put(wsEvo, rr, 1, m.label, { ...cell, font: { bold: true } });
    put(wsEvo, rr, 2, m.key, { ...cellC, font: { color: { argb: argb(GREY) } } });
    put(wsEvo, rr, 3, fx(`SUMIFS(${pre('O')},${pre('B')},$B${rr})`, e.workedDays), cellC);
    put(wsEvo, rr, 4, fx(`SUMIFS(${pre('P')},${pre('B')},$B${rr})`, e.absenceDays), cellC);
    put(wsEvo, rr, 5, fx(`SUMIFS(${pre('I')},${pre('B')},$B${rr})`, e.lateDays), cellC);
    put(wsEvo, rr, 6, fx(`IF(C${rr}+D${rr}>0,C${rr}/(C${rr}+D${rr}),0)`, e.presenceRate), { ...cellC, numFmt: PCT });
    put(wsEvo, rr, 7, fx(`IF(C${rr}+D${rr}>0,D${rr}/(C${rr}+D${rr}),0)`, e.absenteeismRate), { ...cellC, numFmt: PCT });
    put(wsEvo, rr, 8, fx(`COUNTIFS(${abr('A')},$B${rr},${abr('L')},"Approuvée")`, e.absenceRequests), cellC);
    put(wsEvo, rr, 9, fx(`COUNTIFS(${per('A')},$B${rr},${per('N')},"Approuvée")`, e.permissions), cellC);
    put(wsEvo, rr, 10, fx(`ROUND(F${rr}*100,2)`, round2(e.presenceRate * 100)), { ...cellC, numFmt: '0.00' });
    put(wsEvo, rr, 11, fx(`ROUND(G${rr}*100,2)`, round2(e.absenteeismRate * 100)), { ...cellC, numFmt: '0.00' });
    put(wsEvo, rr, 12, fx(`SUMIFS(${pre('J')},${pre('B')},$B${rr})`, e.leaveDays), cellC);
    put(wsEvo, rr, 13, fx(`COUNTIFS(${con('A')},$B${rr},${con('G')},"Approuvée")`, e.leaveRequests), cellC);
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
      title: 'JOURS D’ABSENCE PAR DÉPARTEMENT', titleColor: NAVY,
      catsRef: S(`$B$${dFirst}:$B$${dLast}`), cats: depRows.map((d) => d.label),
      series: [{ name: 'Jours d’absence', nameRef: S(`$E$${dFirst - 1}`), valuesRef: S(`$E$${dFirst}:$E$${dLast}`), vals: depRows.map((d) => d.absenceDays), color: 'C0504D' }],
      gapWidth: 50, fontSize: 800,
    });
  }
  const top2 = 4 + Math.max(18, depRows.length + 6) + 2;
  charts.push({
    sheet: wsSyn.name, from: { col: 8, row: top2 }, to: { col: 17, row: top2 + 17 }, kind: 'col',
    title: 'DEMANDES D’ABSENCE APPROUVÉES PAR TYPE', titleColor: NAVY,
    catsRef: S(`$B$${tyFirst}:$B$${tyLast}`), cats: typeLabels,
    series: [{ name: 'Demandes', valuesRef: S(`$C$${tyFirst}:$C$${tyLast}`), vals: typeLabels.map((l) => AS.byType.find((t) => t.label === l)?.count ?? 0), color: '4BACC6' }],
    gapWidth: 80,
  });
  charts.push({
    sheet: wsSyn.name, from: { col: 8, row: top2 + 18 }, to: { col: 17, row: top2 + 35 }, kind: 'col',
    title: 'PERMISSIONS APPROUVÉES PAR TYPE', titleColor: NAVY,
    catsRef: S(`$B$${ptFirst}:$B$${ptLast}`), cats: ['Urgence', 'Mission', 'Autre'],
    series: [{ name: 'Tickets', valuesRef: S(`$C$${ptFirst}:$C$${ptLast}`), vals: ['Urgence', 'Mission', 'Autre'].map((l) => PS.byType.find((t) => t.label === l)?.count ?? 0), color: 'F79646' }],
    gapWidth: 80,
  });
  charts.push({
    sheet: wsSyn.name, from: { col: 8, row: top2 + 36 }, to: { col: 17, row: top2 + 53 }, kind: 'col',
    title: 'CONGÉS APPROUVÉS PAR TYPE (JOURS)', titleColor: NAVY,
    catsRef: S(`$B$${ltFirst}:$B$${ltLast}`), cats: LEAVE_TYPE_ORDER,
    series: [{ name: 'Jours', nameRef: S(`$D$${ltFirst - 1}`), valuesRef: S(`$D$${ltFirst}:$D$${ltLast}`), vals: LEAVE_TYPE_ORDER.map((l) => LS.byType.find((t) => t.label === l)?.days ?? 0), color: '9BBB59' }],
    gapWidth: 80,
  });
  const evoTop = e1 + 2;
  charts.push({
    sheet: wsEvo.name, from: { col: 0, row: evoTop }, to: { col: 6, row: evoTop + 18 }, kind: 'line',
    title: 'TAUX DE PRÉSENCE ET D’ABSENTÉISME (%)', titleColor: NAVY,
    catsRef: E(`$A$${e0}:$A$${e1}`), cats: months.map((m) => m.label),
    series: [
      { name: 'Présence (%)', nameRef: E('$J$4'), valuesRef: E(`$J$${e0}:$J$${e1}`), vals: evo.map((e) => round2(e.presenceRate * 100)), color: '1F497D' },
      { name: 'Absentéisme (%)', nameRef: E('$K$4'), valuesRef: E(`$K$${e0}:$K$${e1}`), vals: evo.map((e) => round2(e.absenteeismRate * 100)), color: 'C0504D' },
    ],
    showLegend: true,
  });
  charts.push({
    sheet: wsEvo.name, from: { col: 6, row: evoTop }, to: { col: 12, row: evoTop + 18 }, kind: 'col',
    title: 'JOURS D’ABSENCE ET DE RETARD PAR MOIS', titleColor: NAVY,
    catsRef: E(`$A$${e0}:$A$${e1}`), cats: months.map((m) => m.label),
    series: [
      { name: 'Jours d’absence', nameRef: E('$D$4'), valuesRef: E(`$D$${e0}:$D$${e1}`), vals: evo.map((e) => e.absenceDays), color: 'C0504D' },
      { name: 'Jours en retard', nameRef: E('$E$4'), valuesRef: E(`$E$${e0}:$E$${e1}`), vals: evo.map((e) => e.lateDays), color: 'F79646' },
    ],
    showLegend: true, gapWidth: 60,
  });

  charts.push({
    sheet: wsEvo.name, from: { col: 0, row: evoTop + 19 }, to: { col: 6, row: evoTop + 37 }, kind: 'col',
    title: 'JOURS DE CONGÉ PAR MOIS', titleColor: NAVY,
    catsRef: E(`$A$${e0}:$A$${e1}`), cats: months.map((m) => m.label),
    series: [{ name: 'Jours de congé', nameRef: E('$L$4'), valuesRef: E(`$L$${e0}:$L$${e1}`), vals: evo.map((e) => e.leaveDays), color: '9BBB59' }],
    gapWidth: 60,
  });

  void colLetter;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return injectCharts(buf, charts);
}