// ============================================================================
// 📁 src/payroll-journal/payroll-journal-export.service.ts
// ✅ Export EXCEL DYNAMIQUE du journal de paie — même design que l'Excel du
//    récap personnel (bleu marine + or, grille fine, en-têtes colorés par
//    groupe, ligne TOTAL), pour un rendu "cabinet comptable".
//
//    DYNAMIQUE = rien de figé quand ça peut être calculé :
//      • Brut Congo   = formule (base + primes + ancienneté + congés + HS − absences)
//      • Net Congo    = formule (brut − CNSS − impôt − taxes + indemnités − retenues)
//      • Brut/Net étranger = SUMIFS sur la feuille « Paies étrangères »
//      • Brut/Net total    = Congo + étranger
//      • Ligne TOTAL  = SUM de chaque colonne ; bandeau KPI = renvois vers les totaux
//      → l'utilisateur corrige une cellule à la main, tout se recalcule.
//    Si, pour un employé, la formule ne retombe pas sur le montant du bulletin
//    (écart > 1 F), la valeur du bulletin est conservée telle quelle et la
//    cellule est surlignée en jaune (le bulletin reste la référence).
//
//    Toutes les cellules de données sont déverrouillées (modifiables).
//    En-têtes + colonnes N°/Employé figés, filtre automatique, A4 paysage
//    ajusté en largeur, lignes de titre répétées à l'impression.
// ============================================================================
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { PayrollJournal, JournalRow } from './payroll-journal.service';

// ─── Palette (identique au récap personnel) ─────────────────────────────────
const NAVY_DARK = 'FF1F3864';
const NAVY_MEDIUM = 'FF2F5496';
const GOLD_ACCENT = 'FFC9A227';
const GOLD_ACCENT_LIGHT = 'FFF4E9C9';
const GREEN = 'FF2E7D4F';
const RED = 'FFB03A2E';
const AMBER = 'FFB7791F';
const VIOLET = 'FF6B4E9B';
const GOLD_DARK = 'FF8A6D0B';
const KPI_BG = 'FFEFF3F8';
const ZEBRA = 'FFF7F8FA';
const BORDER = 'FFD9DEE4';
const TEXT_SLATE = 'FF334155';
const MISMATCH_FILL = 'FFFFF3CD';
const WHITE = 'FFFFFFFF';
const NUM_FMT = '#,##0;(#,##0);–';

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

type GroupKey = 'REMU' | 'CHARGES' | 'INDEM' | 'RETENUES' | 'NET' | 'ETRANGER' | 'TOTAL';

const GROUP_LABEL: Record<GroupKey, string> = {
  REMU: 'RÉMUNÉRATION',
  CHARGES: 'CHARGES SALARIALES',
  INDEM: 'INDEMNITÉS NON IMPOSABLES',
  RETENUES: 'RETENUES',
  NET: 'NET',
  ETRANGER: 'EXPATRIÉS — PAYS ÉTRANGER',
  TOTAL: 'TOTAL CONGO + ÉTRANGER',
};
const GROUP_COLOR: Record<GroupKey, string> = {
  REMU: NAVY_MEDIUM,
  CHARGES: RED,
  INDEM: GREEN,
  RETENUES: AMBER,
  NET: NAVY_DARK,
  ETRANGER: VIOLET,
  TOTAL: GOLD_DARK,
};

interface Col {
  id: string;
  group: GroupKey;
  label: string;
  width: number;
  strong?: boolean;
  get: (r: JournalRow) => number;
}

const FOREIGN_SHEET = 'Paies étrangères';
const FIXED = 3; // N°, Employé, Fonction

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const allBorders = { top: thin, bottom: thin, left: thin, right: thin };
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

@Injectable()
export class PayrollJournalExportService {
  async exportExcel(j: PayrollJournal): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'KonzaRH';
    wb.created = new Date();

    const monthLabel = `${MONTHS_FR[j.month - 1]} ${j.year}`;
    const ws = wb.addWorksheet(`Journal ${String(j.month).padStart(2, '0')}-${j.year}`, {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 },
        horizontalCentered: true,
      },
    });

    const hasForeignRows = j.options.hasExpat && j.rows.some((r) => r.foreign.length > 0);
    this.buildMainSheet(ws, j, monthLabel, hasForeignRows);
    if (hasForeignRows) this.buildForeignSheet(wb, j, monthLabel);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ══════════════════════════════════════════════════════════════════════
  // Colonnes (même logique que le tableau à l'écran)
  // ══════════════════════════════════════════════════════════════════════
  private buildColumns(j: PayrollJournal): Col[] {
    const o = j.options;
    const cols: Col[] = [];
    cols.push({ id: 'base', group: 'REMU', label: 'Salaire de base', width: 14, get: (r) => r.baseSalary });
    for (const c of j.columns.primes) {
      cols.push({ id: `prime:${c.key}`, group: 'REMU', label: c.label, width: 13, get: (r) => r.primes[c.key] ?? 0 });
    }
    if (o.showAnciennete) cols.push({ id: 'anciennete', group: 'REMU', label: 'Ancienneté', width: 12, get: (r) => r.anciennete });
    if (o.showConges) cols.push({ id: 'conges', group: 'REMU', label: 'Indemnité de congé', width: 13, get: (r) => r.conges });
    if (o.showOvertime) cols.push({ id: 'overtime', group: 'REMU', label: 'Heures sup.', width: 12, get: (r) => r.overtime });
    if (o.showAbsences) cols.push({ id: 'absences', group: 'REMU', label: 'Absences (−)', width: 12, get: (r) => r.absences });
    cols.push({ id: 'grossCongo', group: 'REMU', label: 'BRUT', width: 14, strong: true, get: (r) => r.grossCongo });

    const hasBnc = j.rows.some((r) => r.itsLabel === 'BNC');
    const hasIts = j.rows.some((r) => r.itsLabel !== 'BNC' && r.its > 0);
    const itsLabel = hasBnc && hasIts ? 'ITS / BNC' : hasBnc ? 'BNC' : 'ITS';
    cols.push({ id: 'cnss', group: 'CHARGES', label: 'CNSS', width: 12, get: (r) => r.cnss });
    cols.push({ id: 'its', group: 'CHARGES', label: itsLabel, width: 12, get: (r) => r.its });
    for (const c of j.columns.taxes) {
      cols.push({ id: `tax:${c.key}`, group: 'CHARGES', label: c.label, width: 11, get: (r) => r.taxes[c.key] ?? 0 });
    }
    for (const c of j.columns.indemnites) {
      cols.push({ id: `ind:${c.key}`, group: 'INDEM', label: c.label, width: 13, get: (r) => r.indemnites[c.key] ?? 0 });
    }
    if (o.showLoan) cols.push({ id: 'loan', group: 'RETENUES', label: 'Prêt', width: 11, get: (r) => r.loan });
    if (o.showAdvance) cols.push({ id: 'advance', group: 'RETENUES', label: 'Avance', width: 11, get: (r) => r.advance });
    if (o.showOtherDeductions) cols.push({ id: 'otherDeductions', group: 'RETENUES', label: 'Autres retenues', width: 12, get: (r) => r.otherDeductions });

    cols.push({
      id: 'netCongo', group: 'NET', label: o.hasExpat ? 'NET CONGO' : 'NET À PAYER',
      width: 15, strong: true, get: (r) => r.netCongo,
    });

    if (o.hasExpat) {
      cols.push({ id: 'foreignGross', group: 'ETRANGER', label: 'Brut étranger', width: 14, get: (r) => r.foreignGross });
      cols.push({ id: 'foreignNet', group: 'ETRANGER', label: 'Net étranger', width: 14, get: (r) => r.foreignNet });
      cols.push({ id: 'totalGross', group: 'TOTAL', label: 'BRUT TOTAL', width: 15, strong: true, get: (r) => r.totalGross });
      cols.push({ id: 'totalNet', group: 'TOTAL', label: 'NET TOTAL', width: 15, strong: true, get: (r) => r.totalNet });
    }
    return cols;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Feuille principale
  // ══════════════════════════════════════════════════════════════════════
  private buildMainSheet(ws: ExcelJS.Worksheet, j: PayrollJournal, monthLabel: string, hasForeignRows: boolean) {
    const cols = this.buildColumns(j);
    const nbCols = FIXED + cols.length;
    const colNo = (id: string): number => FIXED + cols.findIndex((c) => c.id === id) + 1; // 1-based
    const has = (id: string) => cols.some((c) => c.id === id);
    const L = (n: number) => ws.getColumn(n).letter;

    ws.columns = [
      { key: 'no', width: 5 },
      { key: 'name', width: 30 },
      { key: 'pos', width: 24 },
      ...cols.map((c) => ({ key: c.id, width: c.width })),
    ];

    const HEADER_GROUP_ROW = 6;
    const HEADER_ROW = 7;
    const dataStart = HEADER_ROW + 1;
    const dataEnd = dataStart + Math.max(j.rows.length, 1) - 1;
    const totalsRowIdx = dataEnd + 1;

    // ── Titre ───────────────────────────────────────────────────────────
    ws.mergeCells(1, 1, 1, nbCols);
    const t = ws.getCell(1, 1);
    t.value = `JOURNAL DE PAIE — ${monthLabel.toUpperCase()}`;
    t.font = { bold: true, size: 14, color: { argb: WHITE }, name: 'Calibri' };
    t.fill = solid(NAVY_DARK);
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 32;

    ws.mergeCells(2, 1, 2, nbCols);
    const c = j.company;
    const st = ws.getCell(2, 1);
    st.value =
      `${c.name}${c.legalForm ? ` (${c.legalForm})` : ''}  •  RCCM ${c.rccm}` +
      `${c.cnssNumber ? `  •  CNSS ${c.cnssNumber}` : ''}  •  ${c.city}  •  Généré le ${new Date().toLocaleDateString('fr-FR')}`;
    st.font = { italic: true, size: 10, color: { argb: 'FF64748B' }, name: 'Calibri' };
    st.fill = solid('FFF1F5F9');
    st.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 20;

    // ── Bandeau KPI dynamique (renvois vers la ligne TOTAL) ─────────────
    const ref = (id: string) => `${L(colNo(id))}${totalsRowIdx}`;
    const totalGrossRef = has('totalGross') ? ref('totalGross') : ref('grossCongo');
    const totalNetRef = has('totalNet') ? ref('totalNet') : ref('netCongo');
    const chargesParts = cols
      .filter((x) => x.group === 'CHARGES' || x.group === 'RETENUES')
      .map((x) => ref(x.id));
    const kpis: { label: string; formula: string; result: number; fmt: string }[] = [
      {
        label: j.options.hasExpat ? `EFFECTIF (dont ${j.summary.expatCount} expatrié${j.summary.expatCount > 1 ? 's' : ''})` : 'EFFECTIF',
        formula: `COUNTA(B${dataStart}:B${dataEnd})`,
        result: j.rows.length,
        fmt: '0',
      },
      {
        label: j.options.hasExpat ? 'BRUT TOTAL (CONGO + ÉTRANGER)' : 'MASSE SALARIALE BRUTE',
        formula: totalGrossRef,
        result: j.options.hasExpat ? j.summary.totalGross : j.summary.grossCongo,
        fmt: '#,##0 "F"',
      },
      {
        label: 'CHARGES & RETENUES (CONGO)',
        formula: chargesParts.length ? chargesParts.join('+') : '0',
        result: j.summary.totalChargesCongo + j.summary.retenues,
        fmt: '#,##0 "F"',
      },
      {
        label: j.options.hasExpat ? 'NET TOTAL (CONGO + ÉTRANGER)' : 'NET À PAYER',
        formula: totalNetRef,
        result: j.options.hasExpat ? j.summary.totalNet : j.summary.netCongo,
        fmt: '#,##0 "F"',
      },
    ];
    this.drawKpiBand(ws, kpis, nbCols, 3);
    ws.getRow(3).height = 16;
    ws.getRow(4).height = 26;
    ws.getRow(5).height = 6;

    // ── En-têtes : ligne de groupes (6) + ligne de colonnes (7) ─────────
    const fixedHeads = ['N°', 'Employé', 'Fonction'];
    fixedHeads.forEach((label, i) => {
      ws.mergeCells(HEADER_GROUP_ROW, i + 1, HEADER_ROW, i + 1);
      const cell = ws.getCell(HEADER_GROUP_ROW, i + 1);
      cell.value = label;
      this.styleHeader(cell, NAVY_DARK);
    });

    let start = 0;
    while (start < cols.length) {
      let end = start;
      while (end + 1 < cols.length && cols[end + 1].group === cols[start].group) end++;
      const g = cols[start].group;
      const from = FIXED + start + 1;
      const to = FIXED + end + 1;
      if (to > from) ws.mergeCells(HEADER_GROUP_ROW, from, HEADER_GROUP_ROW, to);
      const gc = ws.getCell(HEADER_GROUP_ROW, from);
      gc.value = GROUP_LABEL[g];
      this.styleHeader(gc, GROUP_COLOR[g]);
      gc.font = { bold: true, size: 9, color: { argb: WHITE }, name: 'Calibri' };
      for (let k = start; k <= end; k++) {
        const hc = ws.getCell(HEADER_ROW, FIXED + k + 1);
        hc.value = cols[k].label;
        this.styleHeader(hc, GROUP_COLOR[g]);
      }
      start = end + 1;
    }
    ws.getRow(HEADER_GROUP_ROW).height = 20;
    ws.getRow(HEADER_ROW).height = 34;

    // ── Données ─────────────────────────────────────────────────────────
    const grossIds = cols
      .filter((x) => x.group === 'REMU' && x.id !== 'grossCongo' && x.id !== 'absences')
      .map((x) => x.id);
    const dedIds = cols.filter((x) => x.group === 'CHARGES' || x.group === 'RETENUES').map((x) => x.id);
    const indemIds = cols.filter((x) => x.group === 'INDEM').map((x) => x.id);

    let mismatches = 0;
    j.rows.forEach((r, idx) => {
      const n = dataStart + idx;
      const rowFill = idx % 2 === 0 ? ZEBRA : WHITE;
      const addr = (id: string) => `${L(colNo(id))}${n}`;
      const val = (id: string) => cols.find((x) => x.id === id)!.get(r);

      // Texte
      this.dataCell(ws.getCell(n, 1), r.rank, rowFill, 'center');
      const nameCell = ws.getCell(n, 2);
      this.dataCell(nameCell, r.isExpat ? `${r.employeeName}  [Expat ${r.foreign.map((f) => f.countryCode).join('/')}]` : r.employeeName, rowFill, 'left');
      nameCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: TEXT_SLATE } };
      this.dataCell(ws.getCell(n, 3), r.position, rowFill, 'left');

      // Montants saisis (valeurs modifiables)
      for (const col of cols) {
        if (['grossCongo', 'netCongo', 'foreignGross', 'foreignNet', 'totalGross', 'totalNet'].includes(col.id)) continue;
        this.dataCell(ws.getCell(n, colNo(col.id)), col.get(r), rowFill, 'right', true);
      }

      // BRUT Congo = formule si elle retombe sur le bulletin
      const grossCalc = grossIds.reduce((s, id) => s + val(id), 0) - (has('absences') ? val('absences') : 0);
      const grossExpr = [...grossIds.map(addr), ...(has('absences') ? [`-${addr('absences')}`] : [])]
        .join('+')
        .replace(/\+-/g, '-');
      const grossOk = r.status !== 'PAYE' || Math.abs(grossCalc - r.grossCongo) <= 1;
      const grossCell = ws.getCell(n, colNo('grossCongo'));
      if (grossOk) {
        grossCell.value = { formula: grossExpr || '0', result: r.status === 'PAYE' ? grossCalc : 0 };
        this.dataCell(grossCell, undefined, rowFill, 'right', true, true);
      } else {
        grossCell.value = r.grossCongo;
        this.dataCell(grossCell, undefined, MISMATCH_FILL, 'right', true, true);
        mismatches++;
      }

      // NET Congo = formule si elle retombe sur le bulletin
      const grossNow = grossOk ? (r.status === 'PAYE' ? grossCalc : 0) : r.grossCongo;
      const netCalc =
        grossNow - dedIds.reduce((s, id) => s + val(id), 0) + indemIds.reduce((s, id) => s + val(id), 0);
      const netExpr =
        `${addr('grossCongo')}` +
        dedIds.map((id) => `-${addr(id)}`).join('') +
        indemIds.map((id) => `+${addr(id)}`).join('');
      const netOk = r.status !== 'PAYE' || Math.abs(netCalc - r.netCongo) <= 1;
      const netCell = ws.getCell(n, colNo('netCongo'));
      if (netOk) {
        netCell.value = { formula: netExpr, result: r.status === 'PAYE' ? netCalc : 0 };
        this.dataCell(netCell, undefined, rowFill, 'right', true, true);
      } else {
        netCell.value = r.netCongo;
        this.dataCell(netCell, undefined, MISMATCH_FILL, 'right', true, true);
        mismatches++;
      }

      // Étranger : SUMIFS sur la feuille détail (clé = N° du journal)
      if (j.options.hasExpat) {
        const f = `'${FOREIGN_SHEET}'`;
        const gCell = ws.getCell(n, colNo('foreignGross'));
        const nCell = ws.getCell(n, colNo('foreignNet'));
        if (hasForeignRows) {
          gCell.value = { formula: `SUMIFS(${f}!$F:$F,${f}!$A:$A,$A${n})`, result: r.foreignGross };
          nCell.value = { formula: `SUMIFS(${f}!$G:$G,${f}!$A:$A,$A${n})`, result: r.foreignNet };
        } else {
          gCell.value = r.foreignGross;
          nCell.value = r.foreignNet;
        }
        this.dataCell(gCell, undefined, rowFill, 'right', true);
        this.dataCell(nCell, undefined, rowFill, 'right', true);

        const tg = ws.getCell(n, colNo('totalGross'));
        const tn = ws.getCell(n, colNo('totalNet'));
        tg.value = { formula: `${addr('grossCongo')}+${addr('foreignGross')}`, result: r.totalGross };
        tn.value = { formula: `${addr('netCongo')}+${addr('foreignNet')}`, result: r.totalNet };
        this.dataCell(tg, undefined, rowFill, 'right', true, true);
        this.dataCell(tn, undefined, rowFill, 'right', true, true);
      }
    });

    // ── Ligne TOTAL (SUM) ───────────────────────────────────────────────
    const totalsRow = ws.getRow(totalsRowIdx);
    for (let k = 1; k <= nbCols; k++) {
      const cell = totalsRow.getCell(k);
      cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: NAVY_DARK } };
      cell.fill = solid(GOLD_ACCENT_LIGHT);
      cell.border = {
        top: { style: 'double', color: { argb: NAVY_DARK } },
        bottom: thin, left: thin, right: thin,
      };
      if (k === 2) cell.value = `TOTAL (${j.rows.length})`;
      if (k > FIXED) {
        const col = cols[k - FIXED - 1];
        const letter = L(k);
        const sumResult = j.rows.reduce((s, r) => s + col.get(r), 0);
        cell.value = { formula: `SUM(${letter}${dataStart}:${letter}${dataEnd})`, result: sumResult };
        cell.numFmt = NUM_FMT;
        cell.alignment = { horizontal: 'right' };
      }
    }
    totalsRow.height = 22;

    // ── Légende ─────────────────────────────────────────────────────────
    const legend1 = totalsRowIdx + 2;
    ws.mergeCells(legend1, 1, legend1, nbCols);
    const l1 = ws.getCell(legend1, 1);
    l1.value =
      'BRUT = base + primes + ancienneté + congés + heures sup. − absences  •  ' +
      'NET = brut − charges salariales − retenues + indemnités non imposables  •  ' +
      'Classement : du plus payé au moins payé.';
    l1.font = { italic: true, size: 8, color: { argb: 'FF94A3B8' }, name: 'Calibri' };

    if (j.options.hasExpat) {
      const legend2 = legend1 + 1;
      ws.mergeCells(legend2, 1, legend2, nbCols);
      const l2 = ws.getCell(legend2, 1);
      l2.value =
        `Paie étrangère : saisie manuelle en FCFA, détaillée dans la feuille « ${FOREIGN_SHEET} » ` +
        '(modifier cette feuille met à jour le journal).';
      l2.font = { italic: true, size: 8, color: { argb: 'FF94A3B8' }, name: 'Calibri' };
    }
    if (mismatches > 0) {
      const legend3 = legend1 + (j.options.hasExpat ? 2 : 1);
      ws.mergeCells(legend3, 1, legend3, nbCols);
      const l3 = ws.getCell(legend3, 1);
      l3.value =
        `■ Jaune = montant du bulletin conservé tel quel (la formule ne retombe pas sur le bulletin : ${mismatches} cellule${mismatches > 1 ? 's' : ''}).`;
      l3.font = { italic: true, size: 8, color: { argb: AMBER }, name: 'Calibri' };
    }

    // ── Mise en page ────────────────────────────────────────────────────
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: HEADER_ROW }];
    ws.pageSetup.printTitlesRow = `1:${HEADER_ROW}`;
    ws.pageSetup.printTitlesColumn = 'A:B';
    ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: nbCols } };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Feuille « Paies étrangères » — le détail qui alimente le journal
  // ══════════════════════════════════════════════════════════════════════
  private buildForeignSheet(wb: ExcelJS.Workbook, j: PayrollJournal, monthLabel: string) {
    const ws = wb.addWorksheet(FOREIGN_SHEET, {
      pageSetup: {
        paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 },
        horizontalCentered: true,
      },
    });
    ws.columns = [
      { key: 'no', width: 10 },
      { key: 'emp', width: 30 },
      { key: 'country', width: 22 },
      { key: 'code', width: 8 },
      { key: 'payer', width: 28 },
      { key: 'gross', width: 16 },
      { key: 'net', width: 16 },
      { key: 'note', width: 36 },
    ];
    const nb = 8;

    ws.mergeCells(1, 1, 1, nb);
    const t = ws.getCell(1, 1);
    t.value = `PAIES À L'ÉTRANGER — ${monthLabel.toUpperCase()}`;
    t.font = { bold: true, size: 14, color: { argb: WHITE }, name: 'Calibri' };
    t.fill = solid(VIOLET);
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    ws.mergeCells(2, 1, 2, nb);
    const s = ws.getCell(2, 1);
    s.value = `${j.company.name}  •  Montants en FCFA, saisis manuellement  •  Le N° est celui du journal (modifier un montant ici met à jour le journal)`;
    s.font = { italic: true, size: 9, color: { argb: 'FF64748B' }, name: 'Calibri' };
    s.fill = solid('FFF1F5F9');
    s.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    const HEAD = 4;
    ['N° journal', 'Employé', 'Pays', 'Code', 'Entité qui paie', 'Brut (FCFA)', 'Net (FCFA)', 'Note'].forEach((h, i) => {
      const c = ws.getCell(HEAD, i + 1);
      c.value = h;
      this.styleHeader(c, VIOLET);
    });
    ws.getRow(HEAD).height = 28;

    const lines = j.rows.flatMap((r) => r.foreign.map((f) => ({ r, f })));
    lines.forEach(({ r, f }, idx) => {
      const n = HEAD + 1 + idx;
      const fill = idx % 2 === 0 ? ZEBRA : WHITE;
      this.dataCell(ws.getCell(n, 1), r.rank, fill, 'center');
      this.dataCell(ws.getCell(n, 2), r.employeeName, fill, 'left');
      this.dataCell(ws.getCell(n, 3), f.countryName, fill, 'left');
      this.dataCell(ws.getCell(n, 4), f.countryCode, fill, 'center');
      this.dataCell(ws.getCell(n, 5), f.payerName ?? '', fill, 'left');
      this.dataCell(ws.getCell(n, 6), f.grossAmount, fill, 'right', true);
      this.dataCell(ws.getCell(n, 7), f.netAmount, fill, 'right', true);
      this.dataCell(ws.getCell(n, 8), f.note ?? '', fill, 'left');
    });

    const first = HEAD + 1;
    const last = HEAD + lines.length;
    const tot = last + 1;
    const row = ws.getRow(tot);
    for (let k = 1; k <= nb; k++) {
      const cell = row.getCell(k);
      cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: NAVY_DARK } };
      cell.fill = solid(GOLD_ACCENT_LIGHT);
      cell.border = { top: { style: 'double', color: { argb: NAVY_DARK } }, bottom: thin, left: thin, right: thin };
    }
    row.getCell(2).value = 'TOTAL';
    for (const [col, letter, sum] of [
      [6, 'F', lines.reduce((x, l) => x + l.f.grossAmount, 0)],
      [7, 'G', lines.reduce((x, l) => x + l.f.netAmount, 0)],
    ] as [number, string, number][]) {
      const cell = row.getCell(col);
      cell.value = { formula: `SUM(${letter}${first}:${letter}${last})`, result: sum };
      cell.numFmt = NUM_FMT;
      cell.alignment = { horizontal: 'right' };
    }
    row.height = 22;

    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: HEAD }];
    ws.pageSetup.printTitlesRow = `1:${HEAD}`;
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: nb } };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Helpers de style
  // ══════════════════════════════════════════════════════════════════════
  private styleHeader(cell: ExcelJS.Cell, color: string) {
    cell.font = { bold: true, size: 10, color: { argb: WHITE }, name: 'Calibri' };
    cell.fill = solid(color);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = allBorders;
  }

  private dataCell(
    cell: ExcelJS.Cell,
    value: string | number | undefined,
    fill: string,
    align: 'left' | 'center' | 'right',
    numeric = false,
    bold = false,
  ) {
    if (value !== undefined) cell.value = value;
    cell.fill = solid(fill);
    cell.border = allBorders;
    cell.font = { name: 'Calibri', size: 10, bold, color: { argb: TEXT_SLATE } };
    cell.alignment = { horizontal: align, vertical: 'middle', wrapText: align === 'left' };
    if (numeric) cell.numFmt = NUM_FMT;
    // ✅ Cellule modifiable à la main après export
    cell.protection = { locked: false };
  }

  /** 4 cartes KPI : ligne 1 = libellé (liseré or), ligne 2 = valeur (formule vivante). */
  private drawKpiBand(
    ws: ExcelJS.Worksheet,
    kpis: { label: string; formula: string; result: number; fmt: string }[],
    nbCols: number,
    startRow: number,
  ) {
    const count = kpis.length;
    const base = Math.floor(nbCols / count);
    let col = 1;
    kpis.forEach((kpi, i) => {
      const w = i === count - 1 ? nbCols - col + 1 : base;
      const end = col + w - 1;

      ws.mergeCells(startRow, col, startRow, end);
      const lab = ws.getCell(startRow, col);
      lab.value = kpi.label;
      lab.font = { size: 8, bold: true, color: { argb: 'FF64748B' }, name: 'Calibri' };
      lab.fill = solid(KPI_BG);
      lab.alignment = { horizontal: 'center', vertical: 'middle' };
      lab.border = { top: { style: 'medium', color: { argb: GOLD_ACCENT } }, left: thin, right: thin };

      ws.mergeCells(startRow + 1, col, startRow + 1, end);
      const v = ws.getCell(startRow + 1, col);
      v.value = { formula: kpi.formula, result: kpi.result };
      v.numFmt = kpi.fmt;
      v.font = { size: 15, bold: true, color: { argb: NAVY_DARK }, name: 'Calibri' };
      v.fill = solid(KPI_BG);
      v.alignment = { horizontal: 'center', vertical: 'middle' };
      v.border = { left: thin, right: thin, bottom: thin };
      col = end + 1;
    });
  }
}