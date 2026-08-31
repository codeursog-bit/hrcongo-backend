// // ============================================================================
// // 📁 export.service.ts — VERSION FINALE
// // ✅ Export Excel standard (CNSS, ITS, HS 10/25/50/100, primes, charges)
// // ✅ Export Sage (.TXT format journal Sage)
// // ✅ Export eTax Congo (format DGID déclaration IRPP/ITS)
// // ✅ Export CSV générique
// // ============================================================================

// import { Injectable } from '@nestjs/common';
// import * as ExcelJS from 'exceljs';
// import { PrismaService } from '../prisma/prisma.service';

// @Injectable()
// export class ExportService {
//   constructor(private prisma: PrismaService) {}

//   // ═══════════════════════════════════════════════════════════════════════
//   // EXCEL STANDARD — Feuille de paie complète
//   // ✅ Colonnes : Brut, CNSS (4%), ITS, HS +10/+25/+50/+100, Primes, Net
//   // ✅ Feuille 2 : Charges patronales (CNSS 8%+10%+2.25%, TUS 2%)
//   // ═══════════════════════════════════════════════════════════════════════
//   async exportPayrollsToExcel(userId: string, month: number, year: number): Promise<Buffer> {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true }
//     });

//     if (!user?.companyId) throw new Error("Accès refusé");

//     const payrolls = await this.prisma.payroll.findMany({
//       where: { companyId: user.companyId, month, year },
//       include: {
//         employee: {
//           select: {
//             employeeNumber: true,
//             firstName: true,
//             lastName: true,
//             position: true,
//             maritalStatus: true,
//             numberOfChildren: true,
//             cnssNumber: true,
//           }
//         }
//       },
//       orderBy: { employee: { lastName: 'asc' } }
//     });

//     const workbook = new ExcelJS.Workbook();
//     workbook.creator = 'HRCongo';
//     workbook.created = new Date();

//     const monthName = new Date(year, month - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

//     // ──────────────────────────────────────────────────
//     // FEUILLE 1 : Bulletin de paie complet
//     // ──────────────────────────────────────────────────
//     const ws = workbook.addWorksheet(`Paie ${month}-${year}`, {
//       pageSetup: { orientation: 'landscape', fitToPage: true }
//     });

//     // Titre
//     ws.mergeCells('A1:P1');
//     const titleCell = ws.getCell('A1');
//     titleCell.value = `ÉTAT DE PAIE — ${monthName.toUpperCase()}`;
//     titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
//     titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E4C96' } };
//     titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
//     ws.getRow(1).height = 32;

//     // En-têtes colonnes
//     ws.columns = [
//       { key: 'matricule',    width: 14 },
//       { key: 'nom',          width: 24 },
//       { key: 'poste',        width: 20 },
//       { key: 'situation',    width: 14 },
//       { key: 'base',         width: 16 },
//       { key: 'joursTravaill',width: 10 },
//       { key: 'hs10',         width: 10 },
//       { key: 'hs25',         width: 10 },
//       { key: 'hs50',         width: 10 },
//       { key: 'hs100',        width: 10 },
//       { key: 'primes',       width: 16 },
//       { key: 'brut',         width: 18 },
//       { key: 'cnss',         width: 14 },
//       { key: 'its',          width: 14 },
//       { key: 'autresDed',    width: 14 },
//       { key: 'net',          width: 18 },
//     ];

//     const headers = [
//       'Matricule', 'Nom & Prénom', 'Poste', 'Situation Familiale',
//       'Salaire Base', 'Jours', 'HS +10%', 'HS +25%', 'HS +50%', 'HS +100%',
//       'Primes', 'Salaire Brut', 'CNSS Sal. (4%)', 'ITS',
//       'Autres Ret.', 'Net à Payer'
//     ];

//     const headerRow = ws.addRow(headers);
//     headerRow.eachCell((cell) => {
//       cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
//       cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5E9' } };
//       cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
//       cell.border = {
//         top: { style: 'thin', color: { argb: 'FFB0C4DE' } },
//         bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } },
//         left: { style: 'thin', color: { argb: 'FFB0C4DE' } },
//         right: { style: 'thin', color: { argb: 'FFB0C4DE' } }
//       };
//     });
//     ws.getRow(2).height = 36;

//     // Données
//     const dataStart = 3;
//     payrolls.forEach((p, idx) => {
//       const emp = p.employee;
//       const situation = this.formatSituation(emp.maritalStatus, emp.numberOfChildren);

//       const row = ws.addRow([
//         emp.employeeNumber,
//         `${emp.firstName} ${emp.lastName}`,
//         emp.position,
//         situation,
//         Number(p.baseSalary),
//         Number(p.workedDays),
//         Number((p as any).overtimeHours10  || 0),
//         Number((p as any).overtimeHours25  || 0),
//         Number((p as any).overtimeHours50  || 0),
//         Number((p as any).overtimeHours100 || 0),
//         Number(p.totalBonuses  || 0),
//         Number(p.grossSalary),
//         Number(p.cnssSalarial),
//         Number(p.its),
//         Number(p.totalDeductions) - Number(p.cnssSalarial) - Number(p.its),
//         Number(p.netSalary),
//       ]);

//       // Alterner fond de ligne
//       const bgColor = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
//       row.eachCell((cell, colNumber) => {
//         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
//         cell.border = {
//           top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
//           bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
//           left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
//           right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
//         };
//         // Format monétaire pour les colonnes numériques
//         if (colNumber >= 5) {
//           cell.numFmt = '#,##0';
//           cell.alignment = { horizontal: 'right' };
//         }
//       });
//     });

//     // Ligne TOTAUX
//     const dataEnd = dataStart + payrolls.length - 1;
//     const totalsRow = ws.addRow([
//       '', 'TOTAUX', '', '', '', '',
//       { formula: `SUM(G${dataStart}:G${dataEnd})` },
//       { formula: `SUM(H${dataStart}:H${dataEnd})` },
//       { formula: `SUM(I${dataStart}:I${dataEnd})` },
//       { formula: `SUM(J${dataStart}:J${dataEnd})` },
//       { formula: `SUM(K${dataStart}:K${dataEnd})` },
//       { formula: `SUM(L${dataStart}:L${dataEnd})` },
//       { formula: `SUM(M${dataStart}:M${dataEnd})` },
//       { formula: `SUM(N${dataStart}:N${dataEnd})` },
//       { formula: `SUM(O${dataStart}:O${dataEnd})` },
//       { formula: `SUM(P${dataStart}:P${dataEnd})` },
//     ]);
//     totalsRow.eachCell((cell, colNumber) => {
//       cell.font = { bold: true };
//       cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
//       cell.border = {
//         top: { style: 'medium', color: { argb: 'FF94A3B8' } },
//         bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
//       };
//       if (colNumber >= 5) {
//         cell.numFmt = '#,##0';
//         cell.alignment = { horizontal: 'right' };
//       }
//     });

//     // Fixer l'en-tête (freeze row 2)
//     ws.views = [{ state: 'frozen', ySplit: 2 }];

//     // ──────────────────────────────────────────────────
//     // FEUILLE 2 : Charges patronales
//     // ──────────────────────────────────────────────────
//     const ws2 = workbook.addWorksheet(`Charges Patronales ${month}-${year}`);
//     ws2.mergeCells('A1:I1');
//     const t2 = ws2.getCell('A1');
//     t2.value = `CHARGES PATRONALES — ${monthName.toUpperCase()}`;
//     t2.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
//     t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E4C96' } };
//     t2.alignment = { horizontal: 'center', vertical: 'middle' };
//     ws2.getRow(1).height = 32;

//     ws2.columns = [
//       { key: 'matricule', width: 14 },
//       { key: 'nom',       width: 24 },
//       { key: 'brut',      width: 16 },
//       { key: 'cnssRet',   width: 14 },
//       { key: 'cnssRetr',  width: 14 },
//       { key: 'cnssAT',    width: 14 },
//       { key: 'cnssFam',   width: 14 },
//       { key: 'tus',       width: 12 },
//       { key: 'coutTotal', width: 18 },
//     ];

//     const h2Row = ws2.addRow([
//       'Matricule', 'Nom & Prénom',
//       'Salaire Brut',
//       'CNSS Salarié (4%)',
//       'CNSS Retraite (8%)',
//       'CNSS Accident (2.25%)',
//       'CNSS Famille (10%)',
//       'TUS (5%)',
//       'Coût Total Employeur'
//     ]);
//     h2Row.eachCell((cell) => {
//       cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
//       cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } };
//       cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
//     });
//     ws2.getRow(2).height = 36;

//     const d2Start = 3;
//     payrolls.forEach((p, idx) => {
//       const brut = Number(p.grossSalary);
//       const cnssRetr  = Math.round(Math.min(brut, 1_200_000) * 0.08);
//       const cnssAT    = Math.round(Math.min(brut,   600_000) * 0.0225);
//       const cnssFam   = Math.round(Math.min(brut,   600_000) * 0.10);
//       const tus       = Math.round(brut * 0.05);
//       const coutTotal = brut + Number(p.cnssEmployer || 0) + tus;

//       const row = ws2.addRow([
//         p.employee.employeeNumber,
//         `${p.employee.firstName} ${p.employee.lastName}`,
//         brut,
//         Number(p.cnssSalarial),
//         cnssRetr,
//         cnssAT,
//         cnssFam,
//         tus,
//         coutTotal
//       ]);

//       const bgColor = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
//       row.eachCell((cell, col) => {
//         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
//         if (col >= 3) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; }
//       });
//     });

//     const d2End = d2Start + payrolls.length - 1;
//     const t2Row = ws2.addRow([
//       '', 'TOTAUX',
//       { formula: `SUM(C${d2Start}:C${d2End})` },
//       { formula: `SUM(D${d2Start}:D${d2End})` },
//       { formula: `SUM(E${d2Start}:E${d2End})` },
//       { formula: `SUM(F${d2Start}:F${d2End})` },
//       { formula: `SUM(G${d2Start}:G${d2End})` },
//       { formula: `SUM(H${d2Start}:H${d2End})` },
//       { formula: `SUM(I${d2Start}:I${d2End})` },
//     ]);
//     t2Row.eachCell((cell, col) => {
//       cell.font = { bold: true };
//       cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
//       if (col >= 3) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; }
//     });

//     // ──────────────────────────────────────────────────
//     // FEUILLE 3 : Récap Déclaration CNSS (CNSS & ITS)
//     // ──────────────────────────────────────────────────
//     const ws3 = workbook.addWorksheet(`Déclaration CNSS ${month}-${year}`);
//     ws3.mergeCells('A1:G1');
//     const t3 = ws3.getCell('A1');
//     t3.value = `RÉCAPITULATIF DÉCLARATION CNSS — ${monthName.toUpperCase()}`;
//     t3.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
//     t3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
//     t3.alignment = { horizontal: 'center', vertical: 'middle' };
//     ws3.getRow(1).height = 30;

//     ws3.columns = [
//       { key: 'matricule', width: 14 },
//       { key: 'cnssNum',   width: 18 },
//       { key: 'nom',       width: 24 },
//       { key: 'brut',      width: 16 },
//       { key: 'cnssSal',   width: 14 },
//       { key: 'cnssEmp',   width: 14 },
//       { key: 'its',       width: 14 },
//     ];

//     const h3Row = ws3.addRow([
//       'Matricule', 'N° CNSS', 'Nom & Prénom',
//       'Salaire Brut', 'CNSS Salarié', 'CNSS Employeur', 'ITS'
//     ]);
//     h3Row.eachCell((cell) => {
//       cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
//       cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
//       cell.alignment = { horizontal: 'center', wrapText: true };
//     });
//     ws3.getRow(2).height = 30;

//     const d3Start = 3;
//     payrolls.forEach((p, idx) => {
//       const row = ws3.addRow([
//         p.employee.employeeNumber,
//         p.employee.cnssNumber || 'N/A',
//         `${p.employee.firstName} ${p.employee.lastName}`,
//         Number(p.grossSalary),
//         Number(p.cnssSalarial),
//         Number(p.cnssEmployer),
//         Number(p.its),
//       ]);
//       const bgColor = idx % 2 === 0 ? 'FFF0FFF4' : 'FFFFFFFF';
//       row.eachCell((cell, col) => {
//         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
//         if (col >= 4) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; }
//       });
//     });

//     const d3End = d3Start + payrolls.length - 1;
//     const t3Row = ws3.addRow([
//       '', '', 'TOTAUX',
//       { formula: `SUM(D${d3Start}:D${d3End})` },
//       { formula: `SUM(E${d3Start}:E${d3End})` },
//       { formula: `SUM(F${d3Start}:F${d3End})` },
//       { formula: `SUM(G${d3Start}:G${d3End})` },
//     ]);
//     t3Row.eachCell((cell, col) => {
//       cell.font = { bold: true };
//       cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
//       if (col >= 4) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; }
//     });

//     const buffer = await workbook.xlsx.writeBuffer();
//     return Buffer.from(buffer);
//   }

//   // ═══════════════════════════════════════════════════════════════════════
//   // SAGE — Format journal Sage Comptabilité (.TXT)
//   // Format : Journal|Date|Compte|Libellé|Débit|Crédit|Réf
//   // ═══════════════════════════════════════════════════════════════════════
//   async exportToSage(userId: string, month: number, year: number): Promise<string> {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true }
//     });
//     if (!user?.companyId) throw new Error("Accès refusé");

//     const payrolls = await this.prisma.payroll.findMany({
//       where: { companyId: user.companyId, month, year },
//       include: { employee: { select: { employeeNumber: true, firstName: true, lastName: true } } }
//     });

//     // Date Sage : dernier jour du mois au format DD/MM/YYYY
//     const lastDay = new Date(year, month, 0).getDate();
//     const date = `${String(lastDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
//     const journal = 'PAIE';
//     const lines: string[] = [];

//     // En-tête Sage
//     lines.push('JNL|DATEPCE|NUMCPTE|LIBELLE|DEBIT|CREDIT|REFPCE|NUMPIECE');

//     for (const p of payrolls) {
//       const name = `${p.employee.firstName} ${p.employee.lastName}`;
//       const ref   = `PAY-${p.employee.employeeNumber}-${String(month).padStart(2, '0')}-${year}`;
//       const brut  = Number(p.grossSalary);
//       const cnssS = Number(p.cnssSalarial);
//       const cnssE = Number(p.cnssEmployer);
//       const its   = Number(p.its);
//       const net   = Number(p.netSalary);
//       const tus   = Math.round(brut * 0.05);

//       // Écriture : Salaire brut au débit
//       lines.push(`${journal}|${date}|661100|Salaire brut - ${name}|${brut}|0|${ref}|${ref}`);
//       // CNSS Salarié au crédit — 4313 Caisse de retraite obligatoire (OHADA)
//       lines.push(`${journal}|${date}|431100|CNSS salarié - ${name}|0|${cnssS}|${ref}|${ref}`);
//       // ITS/IRPP au crédit — 4472 Impôts sur salaires (OHADA)
//       lines.push(`${journal}|${date}|447200|ITS/IRPP - ${name}|0|${its}|${ref}|${ref}`);
//       // Net à payer au crédit — 422 Personnel rémunérations dues (OHADA)
//       lines.push(`${journal}|${date}|422100|Rémunération due - ${name}|0|${net}|${ref}|${ref}`);
//       // CNSS Patronale au débit — 664 Charges sociales (OHADA)
//       lines.push(`${journal}|${date}|664100|Charges patronales CNSS - ${name}|${cnssE}|0|${ref}|${ref}`);
//       // TUS au débit — 6413 Taxes sur appointements et salaires (OHADA)
//       lines.push(`${journal}|${date}|641300|TUS - ${name}|${tus}|0|${ref}|${ref}`);
//       // CNSS Patronale au crédit — 4313 (OHADA)
//       lines.push(`${journal}|${date}|431300|CNSS Employeur - ${name}|0|${cnssE}|${ref}|${ref}`);
//       // TUS à reverser au crédit — 4472 État impôts retenus à la source (OHADA)
//       lines.push(`${journal}|${date}|447200|TUS à reverser - ${name}|0|${tus}|${ref}|${ref}`);
//     }

//     return lines.join('\n');
//   }

//   // ═══════════════════════════════════════════════════════════════════════
//   // eTAX DGI CONGO — Export conforme portail e-Tax
//   // ✅ Format XLSX strict (pas de couleurs, pas de fusion, zéro style)
//   // ✅ Colonnes exactes DGI : NIU | Nom | Brut | Base ITS | ITS | TUS
//   // ✅ Validation NIU 13 chiffres avant génération
//   // ✅ TUS = Brut × 5% (charge patronale déclarée à la DGI)
//   // ✅ Nom fichier normalisé : DECLARATION_ITS_MM_YYYY_ENTREPRISE.xlsx
//   // ═══════════════════════════════════════════════════════════════════════
//   async generateEtaxExport(
//     userId: string,
//     month: number,
//     year: number
//   ): Promise<{ buffer: Buffer; filename: string; warnings: string[] }> {
//     // ── 1. Charger user + company ──────────────────────────────────────
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: {
//         companyId: true,
//         company: {
//           select: { name: true, nif: true }
//         } as any
//       }
//     });
//     if (!user?.companyId) throw new Error("Accès refusé");

//     const company     = (user as any).company;
//     const companyName = (company?.name || 'ENTREPRISE')
//       .toUpperCase()
//       .replace(/\s+/g, '_')
//       .replace(/[^A-Z0-9_]/g, '');
//     const mm     = String(month).padStart(2, '0');
//     const filename = `DECLARATION_ITS_${mm}_${year}_${companyName}.xlsx`;

//     // ── 2. Charger les bulletins avec champs NIU ───────────────────────
//     const payrolls = await this.prisma.payroll.findMany({
//       where: { companyId: user.companyId, month, year },
//       include: {
//         employee: {
//           select: {
//             firstName:  true,
//             lastName:   true,
//             niu:        true,   // NIU DGI — 13 chiffres
//             cnssNumber: true,   // fallback si NIU absent
//           }
//         }
//       },
//       orderBy: { employee: { lastName: 'asc' } }
//     });

//     if (payrolls.length === 0) {
//       throw new Error(`Aucun bulletin trouvé pour ${mm}/${year}. Générez d'abord les bulletins de paie.`);
//     }

//     // ── 3. Validation NIU — règle DGI : NIU manquant = rejet fichier ──
//     const warnings: string[] = [];
//     const missingNiu: string[] = [];

//     payrolls.forEach(p => {
//       const emp = p.employee;
//       const name = `${emp.firstName} ${emp.lastName}`;
//       const niu  = (emp as any).niu || '';

//       if (!niu || niu.trim() === '') {
//         missingNiu.push(name);
//         warnings.push(`NIU manquant pour ${name} — ligne incluse avec NIU vide (risque de rejet DGI)`);
//       } else if (!/^\d{13}$/.test(niu.trim())) {
//         warnings.push(`NIU invalide pour ${name} : "${niu}" (doit être 13 chiffres)`);
//       }
//     });

//     if (missingNiu.length === payrolls.length) {
//       throw new Error(
//         `ERREUR CRITIQUE : Aucun employé n'a de NIU dans la base. ` +
//         `Renseignez les NIU avant de générer la déclaration eTax DGI. ` +
//         `Employés concernés : ${missingNiu.join(', ')}`
//       );
//     }

//     // ── 4. Construire le fichier Excel STRICT (zéro formatage) ────────
//     const workbook  = new ExcelJS.Workbook();
//     workbook.creator = 'HRCongo';
//     workbook.created = new Date();

//     const ws = workbook.addWorksheet('DECLARATION_ITS');

//     // Colonnes DGI — ordre OBLIGATOIRE — AUCUN style
//     ws.columns = [
//       { key: 'niu',     width: 18 },  // A
//       { key: 'nom',     width: 30 },  // B
//       { key: 'brut',    width: 16 },  // C
//       { key: 'baseIts', width: 16 },  // D
//       { key: 'its',     width: 14 },  // E
//       { key: 'tus',     width: 14 },  // F
//     ];

//     // Ligne d'en-tête — texte brut uniquement, aucun style
//     ws.addRow(['NIU', 'Nom & Prénom', 'Salaire Brut', 'Base ITS/IRPP', 'Montant ITS', 'TUS']);

//     // ── 5. Données — calculs ───────────────────────────────────────────
//     let totalBrut   = 0;
//     let totalBaseIts = 0;
//     let totalIts    = 0;
//     let totalTus    = 0;

//     payrolls.forEach(p => {
//       const emp   = p.employee;
//       const brut  = Math.round(Number(p.grossSalary));
//       const cnss  = Math.round(Number(p.cnssSalarial));
//       const its   = Math.round(Number(p.its));

//       // Base ITS = (Brut - CNSS) × 80% — abattement 20% CGI Congo Art. 41
//       const baseIts = Math.round((brut - cnss) * 0.80);

//       // TUS = Brut × 5% — charge patronale déclarée à la DGI (CGI Art. 188)
//       const tus = Math.round(brut * 0.05);

//       const niu = ((emp as any).niu || emp.cnssNumber || '').toString().trim();

//       ws.addRow([
//         niu,
//         `${emp.firstName} ${emp.lastName}`,
//         brut,
//         baseIts,
//         its,
//         tus,
//       ]);

//       totalBrut    += brut;
//       totalBaseIts += baseIts;
//       totalIts     += its;
//       totalTus     += tus;
//     });

//     // ── 6. Ligne TOTAL — obligatoire pour la DGI ──────────────────────
//     ws.addRow([
//       'TOTAL',
//       `${payrolls.length} salarié(s)`,
//       totalBrut,
//       totalBaseIts,
//       totalIts,
//       totalTus,
//     ]);

//     // ── 7. Retourner le buffer ─────────────────────────────────────────
//     const buffer = await workbook.xlsx.writeBuffer();

//     return {
//       buffer:   Buffer.from(buffer),
//       filename,
//       warnings,
//     };
//   }

//   // Méthode legacy conservée pour compatibilité (redirige vers generateEtaxExport)
//   async exportToETax(userId: string, month: number, year: number): Promise<string> {
//     const result = await this.generateEtaxExport(userId, month, year);
//     // Retourne un résumé texte pour les anciens appels
//     return `Export eTax généré : ${result.filename}\nAvertissements : ${result.warnings.length > 0 ? result.warnings.join('\n') : 'Aucun'}`;
//   }

//   // ═══════════════════════════════════════════════════════════════════════
//   // CSV GÉNÉRIQUE
//   // ═══════════════════════════════════════════════════════════════════════
//   async exportToCSV(userId: string, month: number, year: number): Promise<string> {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true }
//     });
//     if (!user?.companyId) throw new Error("Accès refusé");

//     const payrolls = await this.prisma.payroll.findMany({
//       where: { companyId: user.companyId, month, year },
//       include: {
//         employee: {
//           select: { employeeNumber: true, firstName: true, lastName: true, position: true }
//         }
//       }
//     });

//     const headers = [
//       'Matricule', 'Nom', 'Prénom', 'Poste',
//       'Salaire Brut', 'CNSS Salarié', 'ITS',
//       'HS +10%', 'HS +25%', 'HS +50%', 'HS +100%',
//       'Primes', 'Net à Payer',
//       'CNSS Employeur', 'Coût Total Employeur'
//     ];

//     const rows = payrolls.map(p => [
//       p.employee.employeeNumber,
//       p.employee.lastName,
//       p.employee.firstName,
//       p.employee.position,
//       Number(p.grossSalary),
//       Number(p.cnssSalarial),
//       Number(p.its),
//       Number((p as any).overtimeAmount10  || 0),
//       Number((p as any).overtimeAmount25  || 0),
//       Number((p as any).overtimeAmount50  || 0),
//       Number((p as any).overtimeAmount100 || 0),
//       Number(p.totalBonuses  || 0),
//       Number(p.netSalary),
//       Number(p.cnssEmployer),
//       Number(p.totalEmployerCost),
//     ].join(';'));

//     return [headers.join(';'), ...rows].join('\n');
//   }

//   // ═══════════════════════════════════════════════════════════════════════
//   // HELPERS
//   // ═══════════════════════════════════════════════════════════════════════
//   private formatSituation(status: string, children: number): string {
//     const s: Record<string, string> = {
//       SINGLE: 'Célibataire', MARRIED: 'Marié(e)',
//       DIVORCED: 'Divorcé(e)', WIDOWED: 'Veuf/Veuve'
//     };
//     const base = s[status] || status;
//     return children > 0 ? `${base} ${children}E` : base;
//   }

//   private formatSituationETax(status: string): string {
//     const s: Record<string, string> = {
//       SINGLE: 'C', MARRIED: 'M',
//       DIVORCED: 'D', WIDOWED: 'V'
//     };
//     return s[status] || 'C';
//   }
// }

// ============================================================================
// 📁 export.service.ts — VERSION FINALE
// ✅ Export Excel standard (CNSS, ITS, HS 10/25/50/100, primes, charges)
// ✅ Export Sage (.TXT format journal Sage)
// ✅ Export eTax Congo (format DGID déclaration IRPP/ITS)
// ✅ Export CSV générique
// ✅ Export Sage par liste d'IDs (POST depuis le cabinet)
// ✅ Export PDF groupé de bulletins (batch-pdf → XLSX)
// ✅ Export PDF déclarations CNSS + TUS + ITS
// ============================================================================

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExportService {
  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════
  // EXCEL STANDARD — Feuille de paie complète
  // ✅ Colonnes : Brut, CNSS (4%), ITS, HS +10/+25/+50/+100, Primes, Net
  // ✅ Feuille 2 : Charges patronales (CNSS 8%+10%+2.25%, TUS 2%)
  // ═══════════════════════════════════════════════════════════════════════
  async exportPayrollsToExcel(
    userId: string,
    month: number,
    year: number,
  ): Promise<Buffer> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) throw new Error('Accès refusé');

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId: user.companyId, month, year },
      include: {
        employee: {
          select: {
            employeeNumber: true,
            firstName: true,
            lastName: true,
            position: true,
            maritalStatus: true,
            numberOfChildren: true,
            cnssNumber: true,
          },
        },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRCongo';
    workbook.created = new Date();

    const monthName = new Date(year, month - 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });

    // ──────────────────────────────────────────────────
    // FEUILLE 1 : Bulletin de paie complet
    // ──────────────────────────────────────────────────
    const ws = workbook.addWorksheet(`Paie ${month}-${year}`, {
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });

    // Titre
    ws.mergeCells('A1:P1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `ÉTAT DE PAIE — ${monthName.toUpperCase()}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E4C96' },
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 32;

    // En-têtes colonnes
    ws.columns = [
      { key: 'matricule', width: 14 },
      { key: 'nom', width: 24 },
      { key: 'poste', width: 20 },
      { key: 'situation', width: 14 },
      { key: 'base', width: 16 },
      { key: 'joursTravaill', width: 10 },
      { key: 'hs10', width: 10 },
      { key: 'hs25', width: 10 },
      { key: 'hs50', width: 10 },
      { key: 'hs100', width: 10 },
      { key: 'primes', width: 16 },
      { key: 'brut', width: 18 },
      { key: 'cnss', width: 14 },
      { key: 'its', width: 14 },
      { key: 'autresDed', width: 14 },
      { key: 'net', width: 18 },
    ];

    const headers = [
      'Matricule',
      'Nom & Prénom',
      'Poste',
      'Situation Familiale',
      'Salaire Base',
      'Jours',
      'HS +10%',
      'HS +25%',
      'HS +50%',
      'HS +100%',
      'Primes',
      'Salaire Brut',
      'CNSS Sal. (4%)',
      'ITS',
      'Autres Ret.',
      'Net à Payer',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0EA5E9' },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        left: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        right: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      };
    });
    ws.getRow(2).height = 36;

    // Données
    const dataStart = 3;
    payrolls.forEach((p, idx) => {
      const emp = p.employee;
      const situation = this.formatSituation(
        emp.maritalStatus,
        emp.numberOfChildren,
      );

      const row = ws.addRow([
        emp.employeeNumber,
        `${emp.firstName} ${emp.lastName}`,
        emp.position,
        situation,
        Number(p.baseSalary),
        Number(p.workedDays),
        Number((p as any).overtimeHours10 || 0),
        Number((p as any).overtimeHours25 || 0),
        Number((p as any).overtimeHours50 || 0),
        Number((p as any).overtimeHours100 || 0),
        Number(p.totalBonuses || 0),
        Number(p.grossSalary),
        Number(p.cnssSalarial),
        Number(p.its),
        Number(p.totalDeductions) - Number(p.cnssSalarial) - Number(p.its),
        Number(p.netSalary),
      ]);

      // Alterner fond de ligne
      const bgColor = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
      row.eachCell((cell, colNumber) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        // Format monétaire pour les colonnes numériques
        if (colNumber >= 5) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      });
    });

    // Ligne TOTAUX
    const dataEnd = dataStart + payrolls.length - 1;
    const totalsRow = ws.addRow([
      '',
      'TOTAUX',
      '',
      '',
      '',
      '',
      { formula: `SUM(G${dataStart}:G${dataEnd})` },
      { formula: `SUM(H${dataStart}:H${dataEnd})` },
      { formula: `SUM(I${dataStart}:I${dataEnd})` },
      { formula: `SUM(J${dataStart}:J${dataEnd})` },
      { formula: `SUM(K${dataStart}:K${dataEnd})` },
      { formula: `SUM(L${dataStart}:L${dataEnd})` },
      { formula: `SUM(M${dataStart}:M${dataEnd})` },
      { formula: `SUM(N${dataStart}:N${dataEnd})` },
      { formula: `SUM(O${dataStart}:O${dataEnd})` },
      { formula: `SUM(P${dataStart}:P${dataEnd})` },
    ]);
    totalsRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
      };
      if (colNumber >= 5) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
    });

    // Fixer l'en-tête (freeze row 2)
    ws.views = [{ state: 'frozen', ySplit: 2 }];

    // ──────────────────────────────────────────────────
    // FEUILLE 2 : Charges patronales
    // ──────────────────────────────────────────────────
    const ws2 = workbook.addWorksheet(`Charges Patronales ${month}-${year}`);
    ws2.mergeCells('A1:I1');
    const t2 = ws2.getCell('A1');
    t2.value = `CHARGES PATRONALES — ${monthName.toUpperCase()}`;
    t2.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t2.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E4C96' },
    };
    t2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 32;

    ws2.columns = [
      { key: 'matricule', width: 14 },
      { key: 'nom', width: 24 },
      { key: 'brut', width: 16 },
      { key: 'cnssRet', width: 14 },
      { key: 'cnssRetr', width: 14 },
      { key: 'cnssAT', width: 14 },
      { key: 'cnssFam', width: 14 },
      { key: 'tus', width: 12 },
      { key: 'coutTotal', width: 18 },
    ];

    const h2Row = ws2.addRow([
      'Matricule',
      'Nom & Prénom',
      'Salaire Brut',
      'CNSS Salarié (4%)',
      'CNSS Retraite (8%)',
      'CNSS Accident (2.25%)',
      'CNSS Famille (10%)',
      'TUS (5%)',
      'Coût Total Employeur',
    ]);
    h2Row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF59E0B' },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });
    ws2.getRow(2).height = 36;

    const d2Start = 3;
    payrolls.forEach((p, idx) => {
      const brut = Number(p.grossSalary);
      const cnssRetr = Math.round(Math.min(brut, 1_200_000) * 0.08);
      const cnssAT = Math.round(Math.min(brut, 600_000) * 0.0225);
      const cnssFam = Math.round(Math.min(brut, 600_000) * 0.1);
      const tus = Math.round(brut * 0.05);
      const coutTotal = brut + Number(p.cnssEmployer || 0) + tus;

      const row = ws2.addRow([
        p.employee.employeeNumber,
        `${p.employee.firstName} ${p.employee.lastName}`,
        brut,
        Number(p.cnssSalarial),
        cnssRetr,
        cnssAT,
        cnssFam,
        tus,
        coutTotal,
      ]);

      const bgColor = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
      row.eachCell((cell, col) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        if (col >= 3) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      });
    });

    const d2End = d2Start + payrolls.length - 1;
    const t2Row = ws2.addRow([
      '',
      'TOTAUX',
      { formula: `SUM(C${d2Start}:C${d2End})` },
      { formula: `SUM(D${d2Start}:D${d2End})` },
      { formula: `SUM(E${d2Start}:E${d2End})` },
      { formula: `SUM(F${d2Start}:F${d2End})` },
      { formula: `SUM(G${d2Start}:G${d2End})` },
      { formula: `SUM(H${d2Start}:H${d2End})` },
      { formula: `SUM(I${d2Start}:I${d2End})` },
    ]);
    t2Row.eachCell((cell, col) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
      if (col >= 3) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
    });

    // ──────────────────────────────────────────────────
    // FEUILLE 3 : Récap Déclaration CNSS (CNSS & ITS)
    // ──────────────────────────────────────────────────
    const ws3 = workbook.addWorksheet(`Déclaration CNSS ${month}-${year}`);
    ws3.mergeCells('A1:G1');
    const t3 = ws3.getCell('A1');
    t3.value = `RÉCAPITULATIF DÉCLARATION CNSS — ${monthName.toUpperCase()}`;
    t3.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    t3.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF059669' },
    };
    t3.alignment = { horizontal: 'center', vertical: 'middle' };
    ws3.getRow(1).height = 30;

    ws3.columns = [
      { key: 'matricule', width: 14 },
      { key: 'cnssNum', width: 18 },
      { key: 'nom', width: 24 },
      { key: 'brut', width: 16 },
      { key: 'cnssSal', width: 14 },
      { key: 'cnssEmp', width: 14 },
      { key: 'its', width: 14 },
    ];

    const h3Row = ws3.addRow([
      'Matricule',
      'N° CNSS',
      'Nom & Prénom',
      'Salaire Brut',
      'CNSS Salarié',
      'CNSS Employeur',
      'ITS',
    ]);
    h3Row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF10B981' },
      };
      cell.alignment = { horizontal: 'center', wrapText: true };
    });
    ws3.getRow(2).height = 30;

    const d3Start = 3;
    payrolls.forEach((p, idx) => {
      const row = ws3.addRow([
        p.employee.employeeNumber,
        p.employee.cnssNumber || 'N/A',
        `${p.employee.firstName} ${p.employee.lastName}`,
        Number(p.grossSalary),
        Number(p.cnssSalarial),
        Number(p.cnssEmployer),
        Number(p.its),
      ]);
      const bgColor = idx % 2 === 0 ? 'FFF0FFF4' : 'FFFFFFFF';
      row.eachCell((cell, col) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        if (col >= 4) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      });
    });

    const d3End = d3Start + payrolls.length - 1;
    const t3Row = ws3.addRow([
      '',
      '',
      'TOTAUX',
      { formula: `SUM(D${d3Start}:D${d3End})` },
      { formula: `SUM(E${d3Start}:E${d3End})` },
      { formula: `SUM(F${d3Start}:F${d3End})` },
      { formula: `SUM(G${d3Start}:G${d3End})` },
    ]);
    t3Row.eachCell((cell, col) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1FAE5' },
      };
      if (col >= 4) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SAGE — Format journal Sage Comptabilité (.TXT)
  // Format : Journal|Date|Compte|Libellé|Débit|Crédit|Réf
  // ═══════════════════════════════════════════════════════════════════════
  async exportToSage(
    userId: string,
    month: number,
    year: number,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new Error('Accès refusé');

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId: user.companyId, month, year },
      include: {
        employee: {
          select: { employeeNumber: true, firstName: true, lastName: true },
        },
      },
    });

    // Date Sage : dernier jour du mois au format DD/MM/YYYY
    const lastDay = new Date(year, month, 0).getDate();
    const date = `${String(lastDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    const journal = 'PAIE';
    const lines: string[] = [];

    // En-tête Sage
    lines.push('JNL|DATEPCE|NUMCPTE|LIBELLE|DEBIT|CREDIT|REFPCE|NUMPIECE');

    for (const p of payrolls) {
      const name = `${p.employee.firstName} ${p.employee.lastName}`;
      const ref = `PAY-${p.employee.employeeNumber}-${String(month).padStart(2, '0')}-${year}`;
      const brut = Number(p.grossSalary);
      const cnssS = Number(p.cnssSalarial);
      const cnssE = Number(p.cnssEmployer);
      const its = Number(p.its);
      const net = Number(p.netSalary);
      const tus = Math.round(brut * 0.05);

      // Écriture : Salaire brut au débit
      lines.push(
        `${journal}|${date}|661100|Salaire brut - ${name}|${brut}|0|${ref}|${ref}`,
      );
      // CNSS Salarié au crédit — 4313 Caisse de retraite obligatoire (OHADA)
      lines.push(
        `${journal}|${date}|431100|CNSS salarié - ${name}|0|${cnssS}|${ref}|${ref}`,
      );
      // ITS/IRPP au crédit — 4472 Impôts sur salaires (OHADA)
      lines.push(
        `${journal}|${date}|447200|ITS/IRPP - ${name}|0|${its}|${ref}|${ref}`,
      );
      // Net à payer au crédit — 422 Personnel rémunérations dues (OHADA)
      lines.push(
        `${journal}|${date}|422100|Rémunération due - ${name}|0|${net}|${ref}|${ref}`,
      );
      // CNSS Patronale au débit — 664 Charges sociales (OHADA)
      lines.push(
        `${journal}|${date}|664100|Charges patronales CNSS - ${name}|${cnssE}|0|${ref}|${ref}`,
      );
      // TUS au débit — 6413 Taxes sur appointements et salaires (OHADA)
      lines.push(
        `${journal}|${date}|641300|TUS - ${name}|${tus}|0|${ref}|${ref}`,
      );
      // CNSS Patronale au crédit — 4313 (OHADA)
      lines.push(
        `${journal}|${date}|431300|CNSS Employeur - ${name}|0|${cnssE}|${ref}|${ref}`,
      );
      // TUS à reverser au crédit — 4472 État impôts retenus à la source (OHADA)
      lines.push(
        `${journal}|${date}|447200|TUS à reverser - ${name}|0|${tus}|${ref}|${ref}`,
      );
    }

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // eTAX DGI CONGO — Export conforme portail e-Tax
  // ✅ Format XLSX strict (pas de couleurs, pas de fusion, zéro style)
  // ✅ Colonnes exactes DGI : NIU | Nom | Brut | Base ITS | ITS | TUS
  // ✅ Validation NIU 13 chiffres avant génération
  // ✅ TUS = Brut × 5% (charge patronale déclarée à la DGI)
  // ✅ Nom fichier normalisé : DECLARATION_ITS_MM_YYYY_ENTREPRISE.xlsx
  // ═══════════════════════════════════════════════════════════════════════
  async generateEtaxExport(
    userId: string,
    month: number,
    year: number,
  ): Promise<{ buffer: Buffer; filename: string; warnings: string[] }> {
    // ── 1. Charger user + company ──────────────────────────────────────
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        companyId: true,
        company: {
          select: { name: true, nif: true },
        } as any,
      },
    });
    if (!user?.companyId) throw new Error('Accès refusé');

    const company = (user as any).company;
    const companyName = (company?.name || 'ENTREPRISE')
      .toUpperCase()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/g, '');
    const mm = String(month).padStart(2, '0');
    const filename = `DECLARATION_ITS_${mm}_${year}_${companyName}.xlsx`;

    // ── 2. Charger les bulletins avec champs NIU ───────────────────────
    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId: user.companyId, month, year },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            niu: true, // NIU DGI — 13 chiffres
            cnssNumber: true, // fallback si NIU absent
          },
        },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    if (payrolls.length === 0) {
      throw new Error(
        `Aucun bulletin trouvé pour ${mm}/${year}. Générez d'abord les bulletins de paie.`,
      );
    }

    // ── 3. Validation NIU — règle DGI : NIU manquant = rejet fichier ──
    const warnings: string[] = [];
    const missingNiu: string[] = [];

    payrolls.forEach((p) => {
      const emp = p.employee;
      const name = `${emp.firstName} ${emp.lastName}`;
      const niu = (emp as any).niu || '';

      if (!niu || niu.trim() === '') {
        missingNiu.push(name);
        warnings.push(
          `NIU manquant pour ${name} — ligne incluse avec NIU vide (risque de rejet DGI)`,
        );
      } else if (!/^\d{13}$/.test(niu.trim())) {
        warnings.push(
          `NIU invalide pour ${name} : "${niu}" (doit être 13 chiffres)`,
        );
      }
    });

    if (missingNiu.length === payrolls.length) {
      throw new Error(
        `ERREUR CRITIQUE : Aucun employé n'a de NIU dans la base. ` +
          `Renseignez les NIU avant de générer la déclaration eTax DGI. ` +
          `Employés concernés : ${missingNiu.join(', ')}`,
      );
    }

    // ── 4. Construire le fichier Excel STRICT (zéro formatage) ────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRCongo';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('DECLARATION_ITS');

    // Colonnes DGI — ordre OBLIGATOIRE — AUCUN style
    ws.columns = [
      { key: 'niu', width: 18 }, // A
      { key: 'nom', width: 30 }, // B
      { key: 'brut', width: 16 }, // C
      { key: 'baseIts', width: 16 }, // D
      { key: 'its', width: 14 }, // E
      { key: 'tus', width: 14 }, // F
    ];

    // Ligne d'en-tête — texte brut uniquement, aucun style
    ws.addRow([
      'NIU',
      'Nom & Prénom',
      'Salaire Brut',
      'Base ITS/IRPP',
      'Montant ITS',
      'TUS',
    ]);

    // ── 5. Données — calculs ───────────────────────────────────────────
    let totalBrut = 0;
    let totalBaseIts = 0;
    let totalIts = 0;
    let totalTus = 0;

    payrolls.forEach((p) => {
      const emp = p.employee;
      const brut = Math.round(Number(p.grossSalary));
      const cnss = Math.round(Number(p.cnssSalarial));
      const its = Math.round(Number(p.its));

      // Base ITS = (Brut - CNSS) × 80% — abattement 20% CGI Congo Art. 41
      const baseIts = Math.round((brut - cnss) * 0.8);

      // TUS = Brut × 5% — charge patronale déclarée à la DGI (CGI Art. 188)
      const tus = Math.round(brut * 0.05);

      const niu = ((emp as any).niu || emp.cnssNumber || '').toString().trim();

      ws.addRow([
        niu,
        `${emp.firstName} ${emp.lastName}`,
        brut,
        baseIts,
        its,
        tus,
      ]);

      totalBrut += brut;
      totalBaseIts += baseIts;
      totalIts += its;
      totalTus += tus;
    });

    // ── 6. Ligne TOTAL — obligatoire pour la DGI ──────────────────────
    ws.addRow([
      'TOTAL',
      `${payrolls.length} salarié(s)`,
      totalBrut,
      totalBaseIts,
      totalIts,
      totalTus,
    ]);

    // ── 7. Retourner le buffer ─────────────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer: Buffer.from(buffer),
      filename,
      warnings,
    };
  }

  // Méthode legacy conservée pour compatibilité (redirige vers generateEtaxExport)
  async exportToETax(
    userId: string,
    month: number,
    year: number,
  ): Promise<string> {
    const result = await this.generateEtaxExport(userId, month, year);
    // Retourne un résumé texte pour les anciens appels
    return `Export eTax généré : ${result.filename}\nAvertissements : ${result.warnings.length > 0 ? result.warnings.join('\n') : 'Aucun'}`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CSV GÉNÉRIQUE
  // ═══════════════════════════════════════════════════════════════════════
  async exportToCSV(
    userId: string,
    month: number,
    year: number,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new Error('Accès refusé');

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId: user.companyId, month, year },
      include: {
        employee: {
          select: {
            employeeNumber: true,
            firstName: true,
            lastName: true,
            position: true,
          },
        },
      },
    });

    const headers = [
      'Matricule',
      'Nom',
      'Prénom',
      'Poste',
      'Salaire Brut',
      'CNSS Salarié',
      'ITS',
      'HS +10%',
      'HS +25%',
      'HS +50%',
      'HS +100%',
      'Primes',
      'Net à Payer',
      'CNSS Employeur',
      'Coût Total Employeur',
    ];

    const rows = payrolls.map((p) =>
      [
        p.employee.employeeNumber,
        p.employee.lastName,
        p.employee.firstName,
        p.employee.position,
        Number(p.grossSalary),
        Number(p.cnssSalarial),
        Number(p.its),
        Number((p as any).overtimeAmount10 || 0),
        Number((p as any).overtimeAmount25 || 0),
        Number((p as any).overtimeAmount50 || 0),
        Number((p as any).overtimeAmount100 || 0),
        Number(p.totalBonuses || 0),
        Number(p.netSalary),
        Number(p.cnssEmployer),
        Number(p.totalEmployerCost),
      ].join(';'),
    );

    return [headers.join(';'), ...rows].join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Export Sage par liste d'IDs de bulletins (POST depuis le cabinet)
  // ═══════════════════════════════════════════════════════════════════════
  async exportToSageByIds(
    payrollIds: string[],
    companyId: string,
  ): Promise<string> {
    const payrolls = await this.prisma.payroll.findMany({
      where: { id: { in: payrollIds }, companyId },
      include: {
        employee: {
          select: { employeeNumber: true, firstName: true, lastName: true },
        },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    const lines: string[] = [];
    lines.push('Journal|Pièce|Date|Compte|Libellé|Débit|Crédit');

    for (const p of payrolls) {
      const name = `${p.employee.firstName} ${p.employee.lastName}`;
      const piece = `PAY-${p.employee.employeeNumber}-${p.month}-${p.year}`;
      const date = `${p.year}-${String(p.month).padStart(2, '0')}-28`;

      lines.push(
        `PAIE|${piece}|${date}|661100|Salaire brut - ${name}|${p.grossSalary}|0`,
      );
      lines.push(
        `PAIE|${piece}|${date}|431100|CNSS salarié - ${name}|0|${p.cnssSalarial}`,
      );
      lines.push(`PAIE|${piece}|${date}|447200|ITS/IRPP - ${name}|0|${p.its}`);
      lines.push(
        `PAIE|${piece}|${date}|422100|Rémunération due - ${name}|0|${p.netSalary}`,
      );
      if (Number(p.cnssEmployer) > 0) {
        lines.push(
          `PAIE|${piece}|${date}|664100|Charges patronales CNSS - ${name}|${p.cnssEmployer}|0`,
        );
        lines.push(
          `PAIE|${piece}|${date}|431300|CNSS employeur crédit - ${name}|0|${p.cnssEmployer}`,
        );
      }
      if (Number((p as any).tusTotal ?? 0) > 0) {
        const tusDgi = Number((p as any).tusDgiAmount ?? 0);
        const tusCnss = Number((p as any).tusCnssAmount ?? 0);
        const tusTotal = Number((p as any).tusTotal ?? 0);
        lines.push(
          `PAIE|${piece}|${date}|641300|TUS (7,5%) - ${name}|${tusTotal}|0`,
        );
        lines.push(
          `PAIE|${piece}|${date}|447200|TUS-DGI à reverser - ${name}|0|${tusDgi}`,
        );
        lines.push(
          `PAIE|${piece}|${date}|431300|TUS-CNSS à reverser - ${name}|0|${tusCnss}`,
        );
      }
    }

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Export PDF groupé de bulletins (batch-pdf → XLSX)
  // Génère un XLSX récapitulatif avec les données de chaque bulletin
  // ═══════════════════════════════════════════════════════════════════════
  async exportBatchPdf(payrollIds: string[]): Promise<Buffer> {
    const payrolls = await this.prisma.payroll.findMany({
      where: { id: { in: payrollIds } },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            employeeNumber: true,
          },
        },
        company: { select: { legalName: true, tradeName: true } },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bulletins');

    worksheet.columns = [
      { header: 'Matricule', key: 'num', width: 12 },
      { header: 'Nom', key: 'name', width: 25 },
      { header: 'Poste', key: 'pos', width: 20 },
      { header: 'Brut', key: 'brut', width: 15 },
      { header: 'CNSS sal.', key: 'cnss', width: 12 },
      { header: 'ITS', key: 'its', width: 12 },
      { header: 'Net à payer', key: 'net', width: 15 },
      { header: 'Coût emp.', key: 'cout', width: 15 },
      { header: 'Statut', key: 'status', width: 12 },
    ];

    for (const p of payrolls) {
      worksheet.addRow({
        num: p.employee.employeeNumber,
        name: `${p.employee.firstName} ${p.employee.lastName}`,
        pos: p.employee.position,
        brut: Number(p.grossSalary),
        cnss: Number(p.cnssSalarial),
        its: Number(p.its),
        net: Number(p.netSalary),
        cout: Number(p.totalEmployerCost),
        status: p.status,
      });
    }

    // Style en-tête
    worksheet.getRow(1).eachCell((cell: any) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Export PDF déclarations CNSS + TUS + ITS (→ XLSX multi-feuilles)
  // ═══════════════════════════════════════════════════════════════════════
  async exportDeclarationsPdf(
    companyId: string,
    month: number,
    year: number,
  ): Promise<Buffer> {
    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year, status: { not: 'CANCELLED' } },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
            cnssNumber: true,
          },
        },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { legalName: true, tradeName: true },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KonzaRH';

    // ── Feuille 1 : Récap CNSS ───────────────────────────────────────
    const ws1 = workbook.addWorksheet('Déclaration CNSS');
    ws1.mergeCells('A1:G1');
    ws1.getCell('A1').value =
      `DÉCLARATION CNSS — ${company?.legalName ?? ''} — ${month}/${year}`;
    ws1.getCell('A1').font = { bold: true, size: 14 };

    ws1.addRow([]);
    ws1.addRow([
      'Matricule',
      'Nom & Prénom',
      'Salaire Brut',
      'Plafond CNSS',
      'CNSS Salarié (4%)',
      'CNSS Retraite (8%)',
      'Prest. Fam. (10.03%)',
      'Accidents (2.25%)',
    ]);
    ws1.getRow(3).font = { bold: true };

    let totalBrut = 0,
      totalCnssSal = 0,
      totalPension = 0,
      totalFamily = 0,
      totalAccident = 0;

    for (const p of payrolls) {
      const brut = Number(p.grossSalary);
      const cnssBase = Math.min(brut, 1_200_000);
      const cnssSal = Number(p.cnssSalarial);
      const pension = Number(p.cnssEmployerPension);
      const family = Number(p.cnssEmployerFamily);
      const accident = Number(p.cnssEmployerAccident);

      totalBrut += brut;
      totalCnssSal += cnssSal;
      totalPension += pension;
      totalFamily += family;
      totalAccident += accident;

      ws1.addRow([
        p.employee.employeeNumber ?? p.employee.cnssNumber ?? '',
        `${p.employee.firstName} ${p.employee.lastName}`,
        brut,
        cnssBase,
        cnssSal,
        pension,
        family,
        accident,
      ]);
    }

    ws1.addRow([]);
    const totRow = ws1.addRow([
      '',
      'TOTAL',
      totalBrut,
      '',
      totalCnssSal,
      totalPension,
      totalFamily,
      totalAccident,
    ]);
    totRow.font = { bold: true };

    // ── Feuille 2 : TUS + ITS ────────────────────────────────────────
    const ws2 = workbook.addWorksheet('TUS & ITS');
    ws2.mergeCells('A1:F1');
    ws2.getCell('A1').value =
      `TUS & ITS — ${company?.legalName ?? ''} — ${month}/${year}`;
    ws2.getCell('A1').font = { bold: true, size: 14 };
    ws2.addRow([]);
    ws2.addRow([
      'Matricule',
      'Nom & Prénom',
      'Salaire Brut',
      'TUS DGI (4.13%)',
      'TUS CNSS (3.38%)',
      'ITS',
    ]);
    ws2.getRow(3).font = { bold: true };

    let totalTusDgi = 0,
      totalTusCnss = 0,
      totalIts = 0;

    for (const p of payrolls) {
      const tusDgi = Number((p as any).tusDgiAmount ?? 0);
      const tusCnss = Number((p as any).tusCnssAmount ?? 0);
      const its = Number(p.its);
      totalTusDgi += tusDgi;
      totalTusCnss += tusCnss;
      totalIts += its;
      ws2.addRow([
        p.employee.employeeNumber ?? '',
        `${p.employee.firstName} ${p.employee.lastName}`,
        Number(p.grossSalary),
        tusDgi,
        tusCnss,
        its,
      ]);
    }

    ws2.addRow([]);
    const tot2 = ws2.addRow([
      '',
      'TOTAL',
      '',
      totalTusDgi,
      totalTusCnss,
      totalIts,
    ]);
    tot2.font = { bold: true };

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════
  private formatSituation(status: string, children: number): string {
    const s: Record<string, string> = {
      SINGLE: 'Célibataire',
      MARRIED: 'Marié(e)',
      DIVORCED: 'Divorcé(e)',
      WIDOWED: 'Veuf/Veuve',
    };
    const base = s[status] || status;
    return children > 0 ? `${base} ${children}E` : base;
  }

  private formatSituationETax(status: string): string {
    const s: Record<string, string> = {
      SINGLE: 'C',
      MARRIED: 'M',
      DIVORCED: 'D',
      WIDOWED: 'V',
    };
    return s[status] || 'C';
  }
}
