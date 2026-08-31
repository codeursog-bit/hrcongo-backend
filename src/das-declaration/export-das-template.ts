// ============================================================================
// export-das-template.ts
// Remplit le template officiel DAS I (das1-template.xlsx) avec ExcelJS —
// même principe que loans-orca-export.service.ts : on ouvre le template,
// on écrit UNIQUEMENT des valeurs dans des cellules déjà stylées, jamais de
// reconstruction de la feuille. Style/bordures/fusions du fichier fourni
// par l'utilisateur restent inchangés.
//
// ⚠️ Le fichier CNSS original fourni par l'utilisateur était un .xls
// binaire OLE2 (Excel 97-2003), pas un .xlsx. Il a été converti UNE FOIS
// (LibreOffice, en local, hors production) en .xlsx pour obtenir
// das1-template.xlsx — visuellement identique (mêmes bordures/polices/
// fusions/largeurs de colonnes), simplement dans un format que Node sait
// patcher nativement. Aucune conversion n'a lieu à l'exécution — zéro
// dépendance Python, zéro appel externe.
//
// Dépendance : `npm install exceljs` (déjà utilisé par loans-orca-export).
// ============================================================================

import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'das1-template.xlsx');

const PAGE_OFFSETS = [0, 45, 92]; // lignes 0-indexées où démarre chaque bloc de page
const EMPLOYEES_PER_PAGE = 7;
const EMP_BLOCK_HEIGHT = 4;
const MAX_EMPLOYEES = PAGE_OFFSETS.length * EMPLOYEES_PER_PAGE;

export interface DasIndemnite {
  taxeRegionale?: number; // colonne "i T.REGIONALE V.A.S."
  nature?: string; // "T" (transport), "P" (prime), etc.
  montant?: number;
}

export interface DasEmployeeLine {
  nomPrenom: string;
  profession: string;
  matriculeAssurance: string;
  sexe: 'M' | 'F' | '';
  situationMatrimoniale: 'C' | 'M' | 'V' | 'D' | '';
  nationaliteCode: string;
  nbEnfants: number;
  dateEmbauche: string; // "jj - mm - aa"
  dateParti: string;
  dureeEmploi: string;
  adresseLigne1: string;
  adresseLigne2: string;
  salaireBrut: number; // a
  salairePlafonne: number; // b
  salaireDePresence: number; // c
  salaireDeConge: number; // d
  avantageNature?: string; // e (nature)
  avantageMontant?: number; // e (montant)
  salaireBrutTaxable: number; // f
  baseImposable?: number; // g
  irppRetenu: number; // h
  indemnite1?: DasIndemnite;
  indemnite2?: DasIndemnite;
}

export interface DasExportPayload {
  company: {
    legalName: string;
    addressLine1: string;
    addressLine2: string;
    cnssAffiliationNumber: string;
    niu: string;
  };
  year: number;
  deadlineLabel: string;
  employees: DasEmployeeLine[];
}

// 1-indexé pour ExcelJS : (row0Indexed, col0Indexed) -> {row, col}
function cell(sheet: ExcelJS.Worksheet, r0: number, c0: number) {
  return sheet.getRow(r0 + 1).getCell(c0 + 1);
}

function setText(sheet: ExcelJS.Worksheet, r0: number, c0: number, value: string) {
  cell(sheet, r0, c0).value = value ?? '';
}

function setNumber(sheet: ExcelJS.Worksheet, r0: number, c0: number, value?: number) {
  const target = cell(sheet, r0, c0);
  if (value === undefined || value === null) {
    target.value = null;
    return;
  }
  target.value = Math.round(value);
}

// Lettre de colonne Excel à partir d'un index 0 (0→A, 6→G, 7→H, 10→K...).
// Suffisant ici : le formulaire ne dépasse jamais la colonne O (index 14).
function colLetter(c0: number): string {
  return String.fromCharCode(65 + c0);
}

// Écrit une formule Excel plutôt qu'une valeur figée — l'utilisateur peut
// corriger f ou d à la main dans le fichier exporté et voir c se
// recalculer automatiquement, au lieu d'un nombre qui resterait faux.
function setFormula(sheet: ExcelJS.Worksheet, r0: number, c0: number, formula: string) {
  cell(sheet, r0, c0).value = { formula };
}

export async function fillDasTemplate(payload: DasExportPayload): Promise<Buffer> {
  if (payload.employees.length > MAX_EMPLOYEES) {
    throw new BadRequestException(
      `La déclaration DAS I comporte ${payload.employees.length} salariés — ` +
        `le template actuel est limité à ${MAX_EMPLOYEES} salariés (3 pages × 7). ` +
        `Contactez le support pour étendre la capacité du template.`,
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const sheet = workbook.worksheets[0];

  const employees = payload.employees;
  const pages: DasEmployeeLine[][] = [];
  for (let i = 0; i < Math.max(employees.length, 1); i += EMPLOYEES_PER_PAGE) {
    pages.push(employees.slice(i, i + EMPLOYEES_PER_PAGE));
  }
  const totalPages = pages.length;

  pages.forEach((pageEmployees, pageIndex) => {
    const off = PAGE_OFFSETS[pageIndex];

    // ── En-tête entreprise / période (répété sur chaque page) ────────────
    setText(sheet, off + 2, 2, payload.company.legalName);
    setText(sheet, off + 3, 2, payload.company.addressLine1);
    setText(sheet, off + 4, 2, payload.company.addressLine2);
    setText(sheet, off + 2, 5, payload.company.cnssAffiliationNumber);
    setText(sheet, off + 4, 5, payload.company.niu);
    setText(sheet, off + 4, 0, `              VERSES EN ${payload.year}`);
    setText(sheet, off + 5, 0, `Déclaration à renvoyer avant le ${payload.deadlineLabel}`);
    setText(sheet, off + 5, 6, ` ${pageIndex + 1}/${totalPages}`);

    let totA = 0, totB = 0, totC = 0, totD = 0, totF = 0, totG = 0, totH = 0;
    let totMontantReporter = 0, totI = 0, totMontantOuTotaux = 0;

    pageEmployees.forEach((emp, i) => {
      const base = off + 12 + i * EMP_BLOCK_HEIGHT;

      const a = emp.salaireBrut || 0;
      const b = emp.salairePlafonne ?? a;
      const c = emp.salaireDePresence || 0;
      const d = emp.salaireDeConge || 0;
      const f = emp.salaireBrutTaxable || 0;
      const g = emp.baseImposable ?? Math.round(f * 0.8);
      const h = emp.irppRetenu || 0;
      const ind1 = emp.indemnite1 || {};
      const ind2 = emp.indemnite2 || {};

      // ligne 1 : nom / prénom
      setText(sheet, base + 0, 2, emp.nomPrenom);

      // ligne 2 : embauche / matricule / profession / sexe / sit.matri / a / b / d / e / f / g / h
      setText(sheet, base + 1, 0, `EMBAUCHE LE: ${emp.dateEmbauche || ''}`);
      setText(sheet, base + 1, 1, emp.matriculeAssurance);
      setText(sheet, base + 1, 2, emp.profession);
      setText(sheet, base + 1, 3, emp.sexe);
      setText(sheet, base + 1, 4, emp.situationMatrimoniale);
      setNumber(sheet, base + 1, 5, a);
      setNumber(sheet, base + 1, 6, b);
      setNumber(sheet, base + 1, 7, d);
      setText(sheet, base + 1, 8, emp.avantageNature || '');
      setNumber(sheet, base + 1, 9, emp.avantageMontant);
      setNumber(sheet, base + 1, 10, f);
      setNumber(sheet, base + 1, 11, g);
      setNumber(sheet, base + 1, 12, h);

      // ligne 3 : parti / adresse l1 / b (dupliqué) / c / i / nature1 / montant1
      setText(sheet, base + 2, 0, `PARTI LE: ${emp.dateParti || ''}`);
      setText(sheet, base + 2, 2, emp.adresseLigne1);
      setNumber(sheet, base + 2, 6, b);
      // c = f − d, en formule Excel réelle (pas une valeur calculée figée)
      // pour que la correction manuelle de f ou d dans le fichier exporté
      // recalcule automatiquement c — même principe que les totaux SUM()
      // de payroll-recap-export.service.ts, jamais de nombre en dur.
      {
        const embaucheRow1 = base + 1 + 1; // ligne EMBAUCHE (1-indexée), où vivent d et f
        setFormula(
          sheet,
          base + 2,
          7,
          `${colLetter(10)}${embaucheRow1}-${colLetter(7)}${embaucheRow1}`,
        );
      }
      setNumber(sheet, base + 2, 12, ind1.taxeRegionale);
      setText(sheet, base + 2, 13, ind1.nature || '');
      setNumber(sheet, base + 2, 14, ind1.montant);

      // ligne 4 : durée emploi / adresse l2 / nationalité / nb enfants / i / nature2 / montant2
      setText(sheet, base + 3, 0, `DUREE EMPLOI: ${emp.dureeEmploi || ''}`);
      setText(sheet, base + 3, 2, emp.adresseLigne2);
      setText(sheet, base + 3, 3, emp.nationaliteCode);
      setNumber(sheet, base + 3, 4, emp.nbEnfants);
      setNumber(sheet, base + 3, 12, ind2.taxeRegionale);
      setText(sheet, base + 3, 13, ind2.nature || '');
      setNumber(sheet, base + 3, 14, ind2.montant);

      totA += a;
      totB += b;
      totC += c;
      totD += d;
      totF += f;
      totG += g;
      totH += h;
      totI += (ind1.taxeRegionale || 0) + (ind2.taxeRegionale || 0);
      totMontantReporter += (ind1.montant || 0) + (ind2.montant || 0);
      totMontantOuTotaux += ind2.montant || 0;
    });

    // ── Totaux "A REPORTER" / "OU TOTAUX" ────────────────────────────────
    const tot1 = off + 12 + EMPLOYEES_PER_PAGE * EMP_BLOCK_HEIGHT;
    const tot2 = tot1 + 1;
    setNumber(sheet, tot1, 5, totA);
    setNumber(sheet, tot1, 6, totB);
    setNumber(sheet, tot1, 7, totD);
    setNumber(sheet, tot1, 10, totF);
    setNumber(sheet, tot1, 11, totG);
    setNumber(sheet, tot1, 12, totH);
    setNumber(sheet, tot1, 14, totMontantReporter);

    setNumber(sheet, tot2, 5, totA);
    setNumber(sheet, tot2, 6, totB);
    setNumber(sheet, tot2, 7, totC);
    setNumber(sheet, tot2, 12, totI);
    setNumber(sheet, tot2, 14, totMontantOuTotaux);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}