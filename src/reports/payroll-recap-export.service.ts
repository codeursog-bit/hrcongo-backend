// ============================================================================
// 📁 src/reports/payroll-recap-export.service.ts
// ✅ Export Excel "modèle Excel" du récapitulatif personnel — mensuel & annuel.
//
// Design : palette resserrée façon rapport financier (navy + or, gris
// neutres) plutôt que des couleurs vives saturées — l'objectif est un
// rendu qui ressemble à un vrai livrable de cabinet comptable, pas à un
// tableau coloré générique :
//   - bandeau KPI en haut de feuille (effectif, masse brute, charges, net
//     à payer) — même logique de "premier coup d'œil" qu'un dashboard,
//     mais en cellules Excel fusionnées avec liseré or.
//   - en-tête + colonne Nom figés → confort de lecture sur un grand tableau.
//   - formules SUM sur la ligne TOTAUX (jamais de nombre en dur — la
//     feuille se recalcule si l'utilisateur modifie une valeur à la main).
//   - toutes les cellules de données sont explicitement déverrouillées
//     (protection: locked=false) puisque l'utilisateur veut pouvoir
//     corriger à la main après export.
//   - une ligne de légende en bas de feuille pour rappeler la logique de
//     calcul et la date de génération (traçabilité).
// ============================================================================

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  MonthlyRecap,
  AnnualRecap,
  RecapRow,
  IndemniteColumn,
} from './payroll-recap.service';

// ─── Palette "rapport financier" — navy + or, gris neutres ─────────────────
const NAVY_DARK = 'FF1F3864'; // bandeau titre
const NAVY_MEDIUM = 'FF2F5496'; // en-têtes de colonnes
const GOLD_ACCENT = 'FFC9A227'; // liseré des cartes KPI, accents
const GOLD_ACCENT_LIGHT = 'FFF4E9C9'; // fond très clair sous le liseré or
const INDEMNITE_GREEN = 'FF2E7D4F'; // vert plus sourd que l'émeraude vif
const RETENUE_RED = 'FFB03A2E'; // rouge brique, moins criard que le rouge pur
const KPI_BG = 'FFEFF3F8'; // fond des cartes KPI (bleu très clair)
const ZEBRA = 'FFF7F8FA';
const BORDER = 'FFD9DEE4';
const TEXT_SLATE = 'FF334155';
// Fond des lignes "absentes" — bleu = congé (comme dans le fichier Excel
// d'origine, cellules bleutées sur les mois sans bulletin), gris = sans
// bulletin ni congé (anomalie).
const CONGE_FILL = 'FFDCEEFB';
const SANS_PAIE_FILL = 'FFE9EBEE';
const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

interface KpiCard {
  label: string;
  value: string;
}

@Injectable()
export class PayrollRecapExportService {
  // ══════════════════════════════════════════════════════════════════════
  // MENSUEL
  // ══════════════════════════════════════════════════════════════════════
  async exportMonthly(recap: MonthlyRecap, companyName: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KonzaRH';
    workbook.created = new Date();

    const monthLabel = `${MONTHS_FR[recap.month - 1]} ${recap.year}`;
    const ws = workbook.addWorksheet(`Récap ${recap.month}-${recap.year}`, {
      pageSetup: {
        orientation: 'landscape',
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 },
        horizontalCentered: true,
      },
    });

    this.buildSheet(ws, recap.rows, recap.totals, recap.indemniteColumns, {
      title: `RÉCAPITULATIF DU PERSONNEL — ${monthLabel.toUpperCase()}`,
      companyName,
      subtitle: `Période : ${monthLabel}`,
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // ══════════════════════════════════════════════════════════════════════
  // ANNUEL — feuille de synthèse + une feuille par mois disponible
  // ══════════════════════════════════════════════════════════════════════
  async exportAnnual(
    recap: AnnualRecap,
    companyName: string,
    monthlyBreakdown?: MonthlyRecap[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KonzaRH';
    workbook.created = new Date();

    const wsAnnual = workbook.addWorksheet(`RÉCAP ANNUEL ${recap.year}`, {
      pageSetup: {
        orientation: 'landscape',
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 },
        horizontalCentered: true,
      },
    });

    this.buildSheet(wsAnnual, recap.rows, recap.totals, recap.indemniteColumns, {
      title: `RÉCAPITULATIF ANNUEL ${recap.year} (JANVIER — DÉCEMBRE)`,
      companyName,
      subtitle: `Cumul ${recap.year} — ${recap.rows.length} employé${recap.rows.length > 1 ? 's' : ''}`,
    });

    if (monthlyBreakdown) {
      for (const m of monthlyBreakdown) {
        const wsMonth = workbook.addWorksheet(MONTHS_FR[m.month - 1].slice(0, 28), {
          pageSetup: {
            orientation: 'landscape',
            fitToWidth: 1,
            fitToHeight: 0,
            margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 },
            horizontalCentered: true,
          },
        });
        this.buildSheet(wsMonth, m.rows, m.totals, m.indemniteColumns, {
          title: `RÉCAPITULATIF DU PERSONNEL — ${MONTHS_FR[m.month - 1].toUpperCase()} ${m.year}`,
          companyName,
          subtitle: `Période : ${MONTHS_FR[m.month - 1]} ${m.year}`,
        });
      }
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // ══════════════════════════════════════════════════════════════════════
  // CONSTRUCTION D'UNE FEUILLE (commune mensuel/annuel/par-mois)
  // ══════════════════════════════════════════════════════════════════════
  private buildSheet(
    ws: ExcelJS.Worksheet,
    rows: RecapRow[],
    totals: RecapRow,
    indemniteColumns: IndemniteColumn[],
    header: { title: string; companyName: string; subtitle: string },
  ) {
    // ── Colonnes ────────────────────────────────────────────────────────
    const fixedCols = [
      { header: 'Nom & Prénom', key: 'nom', width: 22 },
      { header: 'Matricule', key: 'matricule', width: 10 },
      { header: 'Sal. Brut', key: 'brut', width: 12 },
      { header: 'CNSS 4%', key: 'cnss', width: 10 },
      { header: 'IRPP', key: 'irpp', width: 10 },
      { header: 'Reste 1', key: 'reste1', width: 12 },
    ];
    const indemCols = indemniteColumns.map((c) => ({ header: c.label, key: `ind_${c.key}`, width: 11 }));
    const tailCols = [
      { header: 'S/Total', key: 'soustotal', width: 13 },
      { header: 'Avance', key: 'avance', width: 10 },
      { header: 'Pharmacie', key: 'pharmacie', width: 11 },
      { header: 'TOL', key: 'tol', width: 9 },
      { header: 'Taxe Dpt', key: 'taxedept', width: 10 },
      { header: 'Autres', key: 'autres', width: 10 },
      { header: 'Net à Payer', key: 'net', width: 14 },
    ];
    const allCols = [...fixedCols, ...indemCols, ...tailCols];
    ws.columns = allCols.map((c) => ({ key: c.key, width: c.width }));
    const nbCols = allCols.length;

    // ── Ligne 1 : bandeau titre ───────────────────────────────────────────
    ws.mergeCells(1, 1, 1, nbCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = header.title;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_DARK } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 32;

    // ── Ligne 2 : sous-titre ───────────────────────────────────────────────
    ws.mergeCells(2, 1, 2, nbCols);
    const subtitleCell = ws.getCell(2, 1);
    subtitleCell.value = `${header.companyName}  •  ${header.subtitle}  •  Généré le ${new Date().toLocaleDateString('fr-FR')}`;
    subtitleCell.font = { italic: true, size: 10, color: { argb: 'FF64748B' }, name: 'Calibri' };
    subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 20;

    // ── Lignes 3-4 : bandeau KPI (4 cartes) ───────────────────────────────
    const effectifPaye = rows.filter((r) => r.status === 'PAYE').length;
    const chargesTotal = (totals.cnss || 0) + (totals.irpp || 0) + (totals.tol || 0) + (totals.taxeDept || 0) + (totals.autresTaxes || 0);
    const nfmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
    const kpis: KpiCard[] = [
      { label: 'EFFECTIF PAYÉ', value: `${effectifPaye} / ${rows.length}` },
      { label: 'MASSE SALARIALE BRUTE', value: `${nfmt(totals.salBrut)} F` },
      { label: 'CHARGES & RETENUES', value: `${nfmt(chargesTotal)} F` },
      { label: 'NET À PAYER', value: `${nfmt(totals.netAPayer)} F` },
    ];
    this.drawKpiBand(ws, kpis, nbCols, 3);
    ws.getRow(3).height = 16;
    ws.getRow(4).height = 24;

    // ── Ligne 5 : espaceur ─────────────────────────────────────────────────
    ws.getRow(5).height = 6;

    // ── Ligne 6 : en-têtes colonnes ───────────────────────────────────────
    const headerRowIdx = 6;
    const headerRow = ws.getRow(headerRowIdx);
    allCols.forEach((c, i) => {
      headerRow.getCell(i + 1).value = c.header;
    });
    headerRow.eachCell((cell, colNumber) => {
      const isIndem = colNumber > fixedCols.length && colNumber <= fixedCols.length + indemCols.length;
      const isRetenue = colNumber > fixedCols.length + indemCols.length && colNumber < nbCols;
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isIndem ? INDEMNITE_GREEN : isRetenue ? RETENUE_RED : NAVY_MEDIUM },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        left: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
      };
    });
    headerRow.height = 34;
    headerRow.commit();

    // ── Données ──────────────────────────────────────────────────────────
    const dataStart = headerRowIdx + 1;
    rows.forEach((r, idx) => {
      const isAbsent = r.status !== 'PAYE';
      const nameCell = isAbsent
        ? `${r.employeeName}${r.status === 'CONGE' ? `  (${r.leaveLabel ?? 'En congé'})` : '  (Sans bulletin ni congé)'}`
        : r.employeeName;
      const rowValues = [
        nameCell,
        r.matricule ?? '',
        isAbsent ? '' : r.salBrut,
        isAbsent ? '' : r.cnss,
        isAbsent ? '' : r.irpp,
        isAbsent ? '' : r.reste1,
        ...indemniteColumns.map((c) => (isAbsent ? '' : r.indemnites[c.key] ?? 0)),
        r.sousTotal,
        r.avance,
        r.pharmacie,
        r.tol,
        r.taxeDept,
        r.autresTaxes,
        r.netAPayer,
      ];
      const row = ws.addRow(rowValues);
      const bgColor = r.status === 'CONGE'
        ? CONGE_FILL
        : r.status === 'SANS_PAIE'
          ? SANS_PAIE_FILL
          : idx % 2 === 0 ? ZEBRA : 'FFFFFFFF';
      row.eachCell((cell, colNumber) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER } },
          bottom: { style: 'thin', color: { argb: BORDER } },
          left: { style: 'thin', color: { argb: BORDER } },
          right: { style: 'thin', color: { argb: BORDER } },
        };
        cell.font = { name: 'Calibri', size: 10, italic: isAbsent && colNumber === 1, color: { argb: TEXT_SLATE } };
        if (colNumber >= 3) {
          cell.numFmt = '#,##0;(#,##0);–';
          cell.alignment = { horizontal: 'right' };
        }
        // ✅ Cellule explicitement modifiable — l'utilisateur doit pouvoir
        // corriger une valeur à la main après export.
        cell.protection = { locked: false };
      });
    });

    // ── Ligne TOTAUX — formules, jamais de valeur figée ─────────────────
    const dataEnd = dataStart + rows.length - 1;
    const colLetterAt = (n: number) => ws.getColumn(n).letter;
    const totalsValues: (string | { formula: string })[] = ['TOTAL', ''];
    for (let c = 3; c <= nbCols; c++) {
      const letter = colLetterAt(c);
      totalsValues.push({ formula: `SUM(${letter}${dataStart}:${letter}${dataEnd})` });
    }
    const totalsRow = ws.addRow(totalsValues);
    totalsRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: NAVY_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_ACCENT_LIGHT } };
      cell.border = {
        top: { style: 'double', color: { argb: NAVY_DARK } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        left: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
      };
      if (colNumber >= 3) {
        cell.numFmt = '#,##0;(#,##0);–';
        cell.alignment = { horizontal: 'right' };
      }
    });

    // ── Légende / traçabilité en bas de feuille ─────────────────────────
    const legendRowIdx = dataEnd + 3;
    ws.mergeCells(legendRowIdx, 1, legendRowIdx, nbCols);
    const legend = ws.getCell(legendRowIdx, 1);
    legend.value =
      "Reste 1 = Sal. Brut − CNSS − IRPP  •  S/Total = Reste 1 + indemnités  •  " +
      'Net à payer = solde réel du bulletin validé (peut différer du calcul manuel si un prêt ou une retenue non listée existe).';
    legend.font = { italic: true, size: 8, color: { argb: 'FF94A3B8' }, name: 'Calibri' };
    legend.alignment = { horizontal: 'left' };

    const legendColorsRowIdx = legendRowIdx + 1;
    ws.mergeCells(legendColorsRowIdx, 1, legendColorsRowIdx, nbCols);
    const legendColors = ws.getCell(legendColorsRowIdx, 1);
    legendColors.value =
      '■ Bleu = employé en congé ce mois (normal, pas de bulletin)   ' +
      '■ Gris = aucun bulletin ni congé trouvé (à vérifier)';
    legendColors.font = { italic: true, size: 8, color: { argb: 'FF94A3B8' }, name: 'Calibri' };
    legendColors.alignment = { horizontal: 'left' };

    // ── Mise en page : en-tête + colonne Nom figés, répétés à l'impression
    // (fait ici plutôt qu'au addWorksheet car la ligne d'en-tête réelle a
    // bougé — ligne 6 maintenant, à cause du bandeau KPI en lignes 3-4).
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRowIdx }];
    ws.pageSetup.printTitlesRow = `1:${headerRowIdx}`;
    ws.pageSetup.printTitlesColumn = 'A:A';

    // Auto-filtre sur l'en-tête pour trier/filtrer facilement à la main.
    ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: nbCols } };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Bandeau KPI — 4 cartes fusionnées (libellé + grande valeur), liseré or
  // ══════════════════════════════════════════════════════════════════════
  private drawKpiBand(ws: ExcelJS.Worksheet, kpis: KpiCard[], nbCols: number, startRow: number) {
    const cardCount = kpis.length;
    const baseWidth = Math.floor(nbCols / cardCount);
    let col = 1;

    kpis.forEach((kpi, i) => {
      const isLast = i === cardCount - 1;
      const width = isLast ? nbCols - col + 1 : baseWidth;
      const endCol = col + width - 1;

      // Liseré or au-dessus de la carte (fine bande décorative)
      ws.mergeCells(startRow, col, startRow, endCol);
      const accentCell = ws.getCell(startRow, col);
      accentCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_ACCENT } };

      // Libellé + valeur, texte enrichi dans une seule cellule fusionnée
      ws.mergeCells(startRow + 1, col, startRow + 1, endCol);
      const valueCell = ws.getCell(startRow + 1, col);
      valueCell.value = {
        richText: [
          { font: { size: 8, bold: true, color: { argb: 'FF64748B' }, name: 'Calibri' }, text: `${kpi.label}\n` },
          { font: { size: 15, bold: true, color: { argb: NAVY_DARK }, name: 'Calibri' }, text: kpi.value },
        ],
      };
      valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KPI_BG } };
      valueCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      valueCell.border = {
        left: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
      };

      col = endCol + 1;
    });
  }
}