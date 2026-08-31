// ============================================================================
// 📁 src/documents/orca-planning-excel.util.ts
// ✅ Écrit directement dans le fichier "Programme des départs en congé"
//    original d'Orca (2 onglets : DEPART_CONGE, CONGE_A_PAYER) — nombre de
//    lignes variable selon le nombre d'employés, donc dupliquation de ligne
//    (avec son style) plutôt que des coordonnées fixes comme pour l'avance.
// ✅ Dépendance : `npm install exceljs` (même que orca-excel.util.ts)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

const TEMPLATES_DIR = path.join(__dirname, 'orca-templates');
const TEMPLATE_FILE = 'planning.xlsx';

export interface OrcaPlanningRow {
  employeeName: string;
  position: string;
  leaveMonth: string; // ex. "Juin"
  hireDate: string; // déjà formatée "DD/MM/YYYY" ou "DD-mmm-YY"
  contractType: string; // ex. "CDI", "Prestataire"
  startDate: string; // formatée
  endDate: string; // formatée
}

// Repérage des lignes/onglets fait une fois sur le fichier original — à
// ajuster ici si jamais Orca fait évoluer la mise en page de leur fichier.
const SHEET_CONFIG = {
  DEPART_CONGE: { titleRow: 7, headerRow: 8, firstDataRow: 9 },
  CONGE_A_PAYER: { titleRow: 4, headerRow: 6, firstDataRow: 7 },
};

function writeRow(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  index: number,
  row: OrcaPlanningRow,
) {
  const r = sheet.getRow(rowNum);
  r.getCell(1).value = index + 1;
  r.getCell(2).value = row.employeeName;
  r.getCell(3).value = row.position;
  r.getCell(4).value = row.leaveMonth;
  r.getCell(5).value = row.hireDate;
  r.getCell(6).value = row.contractType;
  r.getCell(7).value = row.startDate;
  r.getCell(8).value = row.endDate;
  r.commit();
}

/**
 * Remplit un onglet du planning (DEPART_CONGE ou CONGE_A_PAYER) avec la
 * liste de lignes fournie — clone le style de la première ligne de données
 * du template pour chaque ligne supplémentaire nécessaire, et supprime les
 * lignes en trop si moins d'employés que dans le fichier d'origine.
 */
function fillSheet(
  sheet: ExcelJS.Worksheet,
  config: { titleRow: number; firstDataRow: number },
  title: string,
  rows: OrcaPlanningRow[],
) {
  sheet.getCell(config.titleRow, 1).value = title;

  const templateRowNum = config.firstDataRow;
  let lastRowNum = templateRowNum;

  rows.forEach((row, i) => {
    if (i === 0) {
      writeRow(sheet, templateRowNum, i, row);
      return;
    }
    // Duplique la ligne juste précédente (même style) et écrit dedans —
    // en insérant toujours après la DERNIÈRE ligne créée, pas toujours après
    // le template d'origine, pour garder l'ordre des employés correct.
    sheet.duplicateRow(lastRowNum, 1, true);
    lastRowNum += 1;
    writeRow(sheet, lastRowNum, i, row);
  });
}

/**
 * Génère le fichier "Programme des départs en congé" Orca rempli — les deux
 * onglets (départs du mois + congés à payer) dans le même classeur.
 */
export async function fillOrcaPlanningTemplate(
  departData: { title: string; rows: OrcaPlanningRow[] },
  payableData: { title: string; rows: OrcaPlanningRow[] },
): Promise<Buffer> {
  const templatePath = path.join(TEMPLATES_DIR, TEMPLATE_FILE);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Modèle de planning Orca introuvable : ${templatePath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const departSheet = workbook.getWorksheet('DEPART_CONGE');
  const payableSheet = workbook.getWorksheet('CONGE_A_PAYER');
  if (!departSheet || !payableSheet) {
    throw new Error(
      'Onglets DEPART_CONGE / CONGE_A_PAYER introuvables dans le modèle.',
    );
  }

  fillSheet(
    departSheet,
    SHEET_CONFIG.DEPART_CONGE,
    departData.title,
    departData.rows,
  );
  fillSheet(
    payableSheet,
    SHEET_CONFIG.CONGE_A_PAYER,
    payableData.title,
    payableData.rows,
  );

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
