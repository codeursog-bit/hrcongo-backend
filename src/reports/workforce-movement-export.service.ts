// ============================================================================
// 📁 src/reports/workforce-movement-export.service.ts
// ✅ Export Excel "état des mouvements d'effectif" — mensuel ou annuel.
//
// Layout inspiré d'un modèle RH classique : départements en colonnes,
// 4 lignes (Effectif initial / Entrées / Sorties / Effectif actuel). La
// ligne "Effectif actuel" et la colonne "Total" sont des FORMULES
// (=initial+entrées-sorties, =SUM(...)) — jamais un nombre en dur — donc
// la feuille se recalcule si le RH corrige une valeur à la main.
//
// Même palette "rapport financier" (navy + or) que payroll-recap-export.service.ts
// pour rester cohérent avec les autres exports Konza RH.
// ============================================================================

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { WorkforceMovement } from './reports.service';

const NAVY_DARK = 'FF1F3864';
const NAVY_MEDIUM = 'FF2F5496';
const GOLD_ACCENT = 'FFC9A227';
const INDEMNITE_GREEN = 'FF2E7D4F'; // ligne "Entrées"
const RETENUE_RED = 'FFB03A2E'; // ligne "Sorties"
const ZEBRA = 'FFF7F8FA';
const BORDER = 'FFD9DEE4';
const TEXT_SLATE = 'FF334155';

@Injectable()
export class WorkforceMovementExportService {
  async export(data: WorkforceMovement, companyName: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KonzaRH';
    workbook.created = new Date();

    const ws = workbook.addWorksheet(`Effectif ${data.periodLabel}`.slice(0, 31), {
      pageSetup: {
        orientation: 'landscape',
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 },
        horizontalCentered: true,
      },
    });

    const nbDept = data.departments.length;
    const nbCols = 1 + nbDept + 1; // libellé + départements + Total
    ws.getColumn(1).width = 20;
    for (let i = 0; i < nbDept; i++) ws.getColumn(2 + i).width = 13;
    ws.getColumn(nbCols).width = 13;

    // ── Ligne 1 : bandeau titre ──────────────────────────────────────────
    ws.mergeCells(1, 1, 1, nbCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `ÉTAT DES MOUVEMENTS D'EFFECTIF — ${data.periodLabel.toUpperCase()}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_DARK } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 32;

    // ── Ligne 2 : sous-titre ─────────────────────────────────────────────
    ws.mergeCells(2, 1, 2, nbCols);
    const subtitleCell = ws.getCell(2, 1);
    subtitleCell.value = `${companyName}  •  ${data.mode === 'ANNEE' ? 'Vue annuelle' : 'Vue mensuelle'}  •  Généré le ${new Date().toLocaleDateString('fr-FR')}`;
    subtitleCell.font = { italic: true, size: 10, color: { argb: 'FF64748B' }, name: 'Calibri' };
    subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 20;

    // ── Ligne 3 : carte KPI "Effectif actuel total" (liseré or) ──────────
    ws.mergeCells(3, 1, 3, nbCols);
    const kpiCell = ws.getCell(3, 1);
    const nfmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
    kpiCell.value = `EFFECTIF ACTUEL TOTAL : ${nfmt(data.totals.final)}   (${data.totals.hires} entrée(s) • ${data.totals.departures} sortie(s) sur la période)`;
    kpiCell.font = { bold: true, size: 11, color: { argb: NAVY_DARK }, name: 'Calibri' };
    kpiCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E9C9' } };
    kpiCell.alignment = { horizontal: 'center', vertical: 'middle' };
    kpiCell.border = { top: { style: 'thin', color: { argb: GOLD_ACCENT } }, bottom: { style: 'thin', color: { argb: GOLD_ACCENT } } };
    ws.getRow(3).height = 22;

    ws.getRow(4).height = 6; // espaceur

    // ── Ligne 5 : en-têtes (départements + Total) ────────────────────────
    const headerRowIdx = 5;
    const headerRow = ws.getRow(headerRowIdx);
    headerRow.getCell(1).value = 'Département →';
    data.departments.forEach((d, i) => { headerRow.getCell(2 + i).value = d.name; });
    headerRow.getCell(nbCols).value = 'TOTAL';
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_MEDIUM } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: BORDER } }, bottom: { style: 'thin', color: { argb: BORDER } }, left: { style: 'thin', color: { argb: BORDER } }, right: { style: 'thin', color: { argb: BORDER } } };
    });

    // Colonnes en lettres pour les formules (B, C, D...)
    const colLetter = (n: number) => ws.getColumn(n).letter;
    const firstDeptCol = 2;
    const lastDeptCol = 1 + nbDept;

    const dataRow = (
      rowIdx: number,
      label: string,
      values: number[],
      opts: { bold?: boolean; fillColor?: string; formula?: boolean } = {},
    ) => {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = label;
      row.getCell(1).font = { bold: true, size: 10, color: { argb: TEXT_SLATE }, name: 'Calibri' };
      values.forEach((v, i) => { row.getCell(2 + i).value = v; });
      // Colonne Total = SUM des départements — jamais un nombre en dur
      const totalCell = row.getCell(nbCols);
      totalCell.value = { formula: `SUM(${colLetter(firstDeptCol)}${rowIdx}:${colLetter(lastDeptCol)}${rowIdx})` } as any;
      row.eachCell((cell, colNumber) => {
        if (colNumber === 1) return;
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { bold: !!opts.bold || colNumber === nbCols, size: 10, color: { argb: TEXT_SLATE }, name: 'Calibri' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fillColor ?? (rowIdx % 2 === 0 ? ZEBRA : 'FFFFFFFF') } };
        cell.border = { top: { style: 'thin', color: { argb: BORDER } }, bottom: { style: 'thin', color: { argb: BORDER } }, left: { style: 'thin', color: { argb: BORDER } }, right: { style: 'thin', color: { argb: BORDER } } };
        cell.protection = { locked: colNumber !== nbCols || opts.formula };
      });
      return row;
    };

    dataRow(6, 'Effectif initial', data.departments.map((d) => d.initial));
    dataRow(7, 'Entrées', data.departments.map((d) => d.hires), { fillColor: undefined });
    ws.getRow(7).eachCell((cell, colNumber) => { if (colNumber > 1 && colNumber < nbCols) cell.font = { ...cell.font, color: { argb: INDEMNITE_GREEN } }; });
    dataRow(8, 'Sorties', data.departments.map((d) => d.departures));
    ws.getRow(8).eachCell((cell, colNumber) => { if (colNumber > 1 && colNumber < nbCols) cell.font = { ...cell.font, color: { argb: RETENUE_RED } }; });

    // ── Ligne 9 : Effectif actuel — FORMULE (initial + entrées - sorties) ─
    const finalRowIdx = 9;
    const finalRow = ws.getRow(finalRowIdx);
    finalRow.getCell(1).value = 'Effectif actuel';
    finalRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    data.departments.forEach((d, i) => {
      const col = colLetter(2 + i);
      finalRow.getCell(2 + i).value = { formula: `${col}6+${col}7-${col}8` } as any;
    });
    finalRow.getCell(nbCols).value = { formula: `SUM(${colLetter(firstDeptCol)}${finalRowIdx}:${colLetter(lastDeptCol)}${finalRowIdx})` } as any;
    finalRow.eachCell((cell, colNumber) => {
      cell.numFmt = '#,##0';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (colNumber > 1) cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_MEDIUM } };
      cell.border = { top: { style: 'thin', color: { argb: BORDER } }, bottom: { style: 'thin', color: { argb: BORDER } }, left: { style: 'thin', color: { argb: BORDER } }, right: { style: 'thin', color: { argb: BORDER } } };
    });

    // ── Ligne 11 : légende ────────────────────────────────────────────────
    ws.mergeCells(11, 1, 11, nbCols);
    const legendCell = ws.getCell(11, 1);
    legendCell.value =
      "Effectif initial = effectif la veille du début de période • Entrées/Sorties = embauches/départs sur la période • " +
      "Effectif actuel = Effectif initial + Entrées − Sorties (formule, se recalcule si vous modifiez une valeur).";
    legendCell.font = { italic: true, size: 8, color: { argb: 'FF94A3B8' }, name: 'Calibri' };
    legendCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    ws.getRow(11).height = 24;

    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRowIdx }];

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}