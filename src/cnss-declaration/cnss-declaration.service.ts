// ============================================================================
// cnss-declaration.service.ts — CNSS CONGO BRAZZAVILLE
// Lecture directe BDD — champs exacts du schéma Prisma
// Champs Payroll utilisés :
//   grossSalary, cnssSalarial, cnssEmployer,
//   cnssEmployerPension, cnssEmployerFamily, cnssEmployerAccident,
//   tusCnssAmount, tusDgiAmount, tusTotal, workedDays, its, netSalary
// ============================================================================

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

const PENSION_CEILING = 1_200_000;
const AT_PF_CEILING = 600_000;

function getDeadline(month: number, year: number): Date {
  const m = month === 12 ? 1 : month + 1;
  const y = month === 12 ? year + 1 : year;
  return new Date(y, m - 1, 15);
}

function formatDateCnss(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Ex: "MBEMBA NKOSI" → ["MBEMBA", "NKOSI"]
// Ex: "MBEMBA"       → ["MBEMBA", ""]
function splitNomPostNom(lastName: string): [string, string] {
  const parts = (lastName || '').trim().toUpperCase().split(/\s+/);
  return parts.length >= 2
    ? [parts[0], parts.slice(1).join(' ')]
    : [parts[0] || '', ''];
}

// Conversion sûre Prisma Decimal → number (évite NaN)
function n(v: any): number {
  const x = Number(v ?? 0);
  return isNaN(x) ? 0 : x;
}

@Injectable()
export class CnssDeclarationService {
  constructor(private prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════════════════════
  // RÉCAPITULATIF MENSUEL
  // ══════════════════════════════════════════════════════════════════════════
  async getMonthlyRecap(userId: string, month: number, year: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        id: true,
        legalName: true,
        cnssNumber: true,
        cnssAffiliationNumber: true,
        address: true,
        phone: true,
      },
    });

    const payrolls = await this.prisma.payroll.findMany({
      where: {
        companyId: user.companyId,
        month,
        year,
        status: { not: 'DRAFT' },
        // ✅ Un employé exonéré de CNSS ne doit apparaître dans AUCUN
        // export de déclaration (DNMS, TUS, DGC) ni dans les totaux
        // (masse salariale, effectif...) — la déclaration CNSS ne concerne
        // que les salariés effectivement soumis à cotisation.
        employee: { isSubjectToCnss: true },
      },
      select: {
        workedDays: true,
        grossSalary: true,
        // Part salariale
        cnssSalarial: true, // 4% × min(brut, 1 200 000)
        // Part patronale
        cnssEmployer: true, // total patronal CNSS
        cnssEmployerPension: true, // 8%     × min(brut, 1 200 000)
        cnssEmployerFamily: true, // 10,03% × min(brut, 600 000)
        cnssEmployerAccident: true, // 2,25%  × min(brut, 600 000)
        // TUS
        tusCnssAmount: true, // 5,475% × brut (part CNSS)
        tusDgiAmount: true, // 2,025% × brut (part DGI)
        tusTotal: true, // 7,5%   × brut
        // Autres
        its: true,
        netSalary: true,
        employee: {
          select: {
            id: true,
            employeeNumber: true,
            cnssNumber: true,
            firstName: true,
            lastName: true,
            contractType: true,
            position: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    // ℹ️ Pour information/traçabilité : employés exclus ce mois-ci car
    // exonérés de CNSS (utile si un jour on veut l'afficher à l'écran).
    const exemptedCount = await this.prisma.payroll.count({
      where: {
        companyId: user.companyId,
        month,
        year,
        status: { not: 'DRAFT' },
        employee: { isSubjectToCnss: false },
      },
    });

    const deadline = getDeadline(month, year);
    const isLate = new Date() > deadline;
    const periodeLabel = formatDateCnss(new Date(year, month - 1, 1));

    // ── Cumulateurs ───────────────────────────────────────────────────────
    let totBrut = 0;
    let totCnssSal = 0; // 4%
    let totPenPat = 0; // 8%
    let totFamPat = 0; // 10,03%
    let totAtPat = 0; // 2,25%
    let totEmpPat = 0; // total patronal
    let totCotis = 0; // salarial uniquement (DNMS)
    let totCotisTotal = 0; // salarial + patronal (pour DGC et versements)
    let totTusCnss = 0;
    let totTusDgi = 0;
    let totTus = 0;
    let totJours = 0;
    let totHeures = 0;
    // Pour DGC
    let totPenBase = 0; // somme salaires plafonnés 1 200 000
    let totAtPfBase = 0; // somme salaires plafonnés 600 000

    const employees = payrolls.map((p) => {
      const brut = n(p.grossSalary);
      const cnssSal = n(p.cnssSalarial);
      const empPat = n(p.cnssEmployer);
      const penPat = n(p.cnssEmployerPension);
      const famPat = n(p.cnssEmployerFamily);
      const atPat = n(p.cnssEmployerAccident);
      const tusCnss = n(p.tusCnssAmount);
      const tusDgi = n(p.tusDgiAmount);
      const tus = n(p.tusTotal);
      const jours = Math.round(n(p.workedDays) || 26);
      const heures = jours * 8;
      const cotis = cnssSal + empPat; // DNMS = salarial + patronal (24,28%)

      // Bases plafonnées (pour DGC) — calculées ici car absentes en BDD
      const penBase = Math.min(brut, PENSION_CEILING);
      const atPfBase = Math.min(brut, AT_PF_CEILING);

      totBrut += brut;
      totCnssSal += cnssSal;
      totPenPat += penPat;
      totFamPat += famPat;
      totAtPat += atPat;
      totEmpPat += empPat;
      totCotis += cotis;
      totCotisTotal += cnssSal + empPat;
      totTusCnss += tusCnss;
      totTusDgi += tusDgi;
      totTus += tus;
      totJours += jours;
      totHeures += heures;
      totPenBase += penBase;
      totAtPfBase += atPfBase;

      const [nomFamille, postNom] = splitNomPostNom(p.employee.lastName);
      const isStagiaire = p.employee.contractType === 'STAGE'; // ⚠️ mort-code : les STAGE sont filtrés en amont (isSubjectToCnss=false), donc toujours false ici — gardé si un jour la règle change

      return {
        employeeId: p.employee.id,
        matricule: p.employee.employeeNumber,
        cnssNumber: p.employee.cnssNumber || '',
        nomFamille,
        postNom,
        prenom: p.employee.firstName?.trim() || '',
        contractType: p.employee.contractType,
        typeWorker: isStagiaire ? 2 : 1,
        departement: p.employee.department?.name || '',
        poste: p.employee.position || '',
        periodeLabelCnss: periodeLabel,
        // Montants — lus directement BDD
        brutGlobal: brut,
        salaireSOumisCotisation: penBase, // min(brut, 1 200 000) — seul calcul ici
        cnssSalarial: cnssSal, // 4%
        cnssEmployerPension: penPat, // 8%
        cnssEmployerFamily: famPat, // 10,03%
        cnssEmployerAccident: atPat, // 2,25%
        cnssEmployeurTotal: empPat, // total patronal
        cotisationDeclaree: cotis, // salarial (4%) + patronal (20,28%) = 24,28%
        tusCnssAmount: tusCnss, // 5,475%
        tusDgiAmount: tusDgi, // 2,025%
        tusTotal: tus, // 7,5%
        nbrJoursTravailles: jours,
        nbrHeuresTravaillees: heures,
        its: n(p.its),
        netSalary: n(p.netSalary),
        missingCnss: !p.employee.cnssNumber,
      };
    });

    // ── Pénalités ─────────────────────────────────────────────────────────
    const monthsLate = isLate
      ? Math.max(
          1,
          Math.ceil(
            (Date.now() - deadline.getTime()) / (30 * 24 * 3600 * 1000),
          ),
        )
      : 0;
    const latePenalty = isLate
      ? Math.round(totCotisTotal * 0.1 * monthsLate)
      : 0;
    const tusMajoration = isLate
      ? Math.round(totTusCnss * 0.1 * monthsLate)
      : 0;

    // ── Totaux DGC ────────────────────────────────────────────────────────
    const dgcCotisationPension = totCnssSal + totPenPat; // base × 12%
    const dgcCotisationAtPf = totFamPat + totAtPat; // base × 12,28%
    const dgcSousTot1 = totTusCnss + tusMajoration; // TUS CNSS + majoration
    const dgcSousTot2 = dgcCotisationPension + dgcCotisationAtPf + latePenalty;

    const totals = {
      effectif: employees.length,
      masseSalariale: totBrut,
      // Cotisations détail
      cnssSalarial: totCnssSal,
      cnssEmployerPension: totPenPat,
      cnssEmployerFamily: totFamPat,
      cnssEmployerAccident: totAtPat,
      cnssEmployeurTotal: totEmpPat,
      totalCotisations: totCotis,
      // TUS détail
      tusCnss: totTusCnss,
      tusDgi: totTusDgi,
      tusTotal: totTus,
      // Versements
      totalAVerserCnss: totCotisTotal + totTusCnss,
      totalAVerserDgi: totTusDgi,
      // Jours/heures
      totalJours: totJours,
      totalHeures: totHeures,
      // DGC
      dgcPensionBase: totPenBase,
      dgcAtPfBase: totAtPfBase,
      dgcCotisationPension,
      dgcCotisationAtPf,
      dgcSousTot1,
      dgcSousTot2,
      dgcTotalAPayer: dgcSousTot1 + dgcSousTot2,
      // Pénalités
      isLate,
      monthsLate,
      latePenalty,
      tusMajoration,
      totalAvecPenalite: totCotisTotal + totTusCnss + latePenalty,
    };

    return {
      company,
      month,
      year,
      employees,
      totals,
      deadline,
      isLate,
      missingCnssCount: employees.filter((e) => e.missingCnss).length,
      // ℹ️ Employés payés ce mois-ci mais exclus de la déclaration car
      // exonérés de CNSS (isSubjectToCnss = false)
      exemptedFromCnssCount: exemptedCount,
      // 🆕 Statut réel de la déclaration (bouton "Je déclare la CNSS")
      declaration: await this.prisma.cnssDeclaration.findUnique({
        where: { companyId_month_year: { companyId: user.companyId, month, year } },
        select: { status: true, declaredAt: true, paymentReference: true, paymentMode: true, notes: true },
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🆕 DÉCLARATION MANUELLE — l'entreprise clique "Je déclare la CNSS"
  // ══════════════════════════════════════════════════════════════════════════
  // 🐛 CORRIGÉ : le statut "déclaré" se basait auparavant uniquement sur
  // l'existence de bulletins de paie non-brouillon (`payrollCount > 0` dans
  // getDeclarationHistory) — c'est-à-dire que générer la paie suffisait à
  // considérer la CNSS comme déclarée, alors que déclarer la paie et
  // déclarer/verser la CNSS sont deux actions distinctes et non liées. La
  // table `CnssDeclaration` existait déjà dans le schéma (avec un vrai
  // statut A_DECLARER/DECLAREE/PAYEE/EN_RETARD/REGULARISEE) mais n'était
  // jamais écrite nulle part — orpheline. On l'utilise maintenant vraiment :
  // ce bouton crée/mets à jour la ligne du mois avec status = DECLAREE,
  // horodatée. C'est cette table (et non plus la présence de paie) qui fait
  // foi pour savoir si la CNSS a été déclarée — y compris pour le rappel
  // d'échéance (cnss-camu-deadline-reminder.service.ts, qui interrogeait
  // déjà cette table correctement, mais qui ne pouvait jusqu'ici jamais
  // trouver de ligne puisqu'elle était toujours vide).
  async declareCnss(
    userId: string,
    month: number,
    year: number,
    options?: { paymentReference?: string; paymentMode?: string; notes?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');

    const recap = await this.getMonthlyRecap(userId, month, year);
    if (recap.employees.length === 0) {
      throw new BadRequestException(
        `Aucun employé soumis à CNSS avec bulletin de paie pour cette période — rien à déclarer.`,
      );
    }

    const t = recap.totals;

    const declaration = await this.prisma.cnssDeclaration.upsert({
      where: {
        companyId_month_year: { companyId: user.companyId, month, year },
      },
      create: {
        companyId: user.companyId,
        month,
        year,
        effectif: t.effectif,
        masseSalariale: t.masseSalariale,
        cotisationSalariale: t.cnssSalarial,
        cotisationPatronale: t.cnssEmployeurTotal,
        cotisationTotale: t.totalCotisations,
        tusCnss: t.tusCnss,
        tusDgi: t.tusDgi,
        totalAVerserCnss: t.totalAVerserCnss,
        totalAVerserDgi: t.totalAVerserDgi,
        status: 'DECLAREE',
        declaredAt: new Date(),
        isLate: t.isLate,
        monthsLate: t.monthsLate,
        penaltyAmount: t.latePenalty,
        declaredBy: userId,
        paymentReference: options?.paymentReference || null,
        paymentMode: options?.paymentMode || null,
        notes: options?.notes || null,
      },
      update: {
        effectif: t.effectif,
        masseSalariale: t.masseSalariale,
        cotisationSalariale: t.cnssSalarial,
        cotisationPatronale: t.cnssEmployeurTotal,
        cotisationTotale: t.totalCotisations,
        tusCnss: t.tusCnss,
        tusDgi: t.tusDgi,
        totalAVerserCnss: t.totalAVerserCnss,
        totalAVerserDgi: t.totalAVerserDgi,
        status: 'DECLAREE',
        declaredAt: new Date(),
        isLate: t.isLate,
        monthsLate: t.monthsLate,
        penaltyAmount: t.latePenalty,
        declaredBy: userId,
        ...(options?.paymentReference !== undefined && { paymentReference: options.paymentReference }),
        ...(options?.paymentMode !== undefined && { paymentMode: options.paymentMode }),
        ...(options?.notes !== undefined && { notes: options.notes }),
      },
    });

    // Snapshot ligne par ligne (remplace l'existant si redéclaration)
    await this.prisma.cnssDeclarationLine.deleteMany({
      where: { declarationId: declaration.id },
    });
    await this.prisma.cnssDeclarationLine.createMany({
      data: recap.employees.map((e) => ({
        declarationId: declaration.id,
        employeeId: e.employeeId,
        employeeNumber: e.matricule,
        employeeName: `${e.nomFamille} ${e.prenom}`.trim(),
        cnssNumber: e.cnssNumber || null,
        contractType: e.contractType,
        brutMensuel: e.brutGlobal,
        pensionSalarial: e.cnssSalarial,
        pensionPatronal: e.cnssEmployerPension,
        familyPatronal: e.cnssEmployerFamily,
        accidentPatronal: e.cnssEmployerAccident,
        totalCnss: e.cotisationDeclaree,
        tusCnss: e.tusCnssAmount,
        tusDgi: e.tusDgiAmount,
      })),
    });

    return declaration;
  }

  // Annule une déclaration (repasse à A_DECLARER) — utile en cas d'erreur
  async cancelDeclareCnss(userId: string, month: number, year: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');

    return this.prisma.cnssDeclaration.update({
      where: {
        companyId_month_year: { companyId: user.companyId, month, year },
      },
      data: { status: 'A_DECLARER', declaredAt: null },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXPORT EXCEL — 3 feuilles CNSS officielles
  // ══════════════════════════════════════════════════════════════════════════
  async exportDeclarationExcel(
    userId: string,
    month: number,
    year: number,
  ): Promise<{
    buffer: Buffer;
    filename: string;
    warnings: string[];
  }> {
    const recap = await this.getMonthlyRecap(userId, month, year);
    const warnings: string[] = [];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'KonzaRH';
    wb.created = new Date();

    const mm = String(month).padStart(2, '0');
    const monthName = new Date(year, month - 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
    const periode = `01/${mm}/${year}`;
    const affil =
      recap.company?.cnssAffiliationNumber ||
      recap.company?.cnssNumber ||
      'NON RENSEIGNÉ';

    const BLUE = 'FF1A5276';
    const PURPLE = 'FF4A235A';
    const WHITE = 'FFFFFFFF';

    const bd = (c = 'FFB0C4DE') => {
      const s = { style: 'thin' as const, color: { argb: c } };
      return { top: s, bottom: s, left: s, right: s };
    };

    const hCell = (cell: ExcelJS.Cell, bg = BLUE) => {
      cell.font = { bold: true, size: 9, color: { argb: WHITE } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = bd();
    };

    const numRight = (cell: ExcelJS.Cell) => {
      cell.numFmt = '#,##0';
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    };

    const f = (x: number) =>
      new Intl.NumberFormat('fr-FR').format(Math.round(x));

    // ─── FEUILLE 1 : DNMS ────────────────────────────────────────────────
    // Colonnes exactes Model_Declaration_Mensuelle_CNSS.xlsx officiel
    const ws1 = wb.addWorksheet('DNMS', {
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });
    ws1.columns = [
      { width: 14 },
      { width: 20 },
      { width: 18 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 18 },
      { width: 16 },
      { width: 18 },
      { width: 20 },
      { width: 20 },
      { width: 13 },
      { width: 14 },
    ];

    ws1.mergeCells('A1:M1');
    Object.assign(ws1.getCell('A1'), {
      value: `DÉCLARATION NOMINATIVE MENSUELLE DES SALAIRES — ${monthName.toUpperCase()}`,
      font: { bold: true, size: 12, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ws1.getRow(1).height = 30;

    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `Employeur : ${recap.company?.legalName || ''}`;
    ws1.getCell('A2').font = { bold: true };
    ws1.mergeCells('E2:I2');
    ws1.getCell('E2').value = `N° Affiliation CNSS : ${affil}`;
    ws1.getCell('E2').font = {
      bold: true,
      color: { argb: affil === 'NON RENSEIGNÉ' ? 'FFCC0000' : 'FF000000' },
    };
    ws1.mergeCells('J2:M2');
    ws1.getCell('J2').value =
      `Période : ${monthName} — Effectif : ${recap.totals.effectif}`;
    ws1.getRow(2).height = 18;
    ws1.addRow([]);

    // En-têtes EXACTES du modèle officiel
    const h1 = ws1.addRow([
      'Matricule solde',
      'Immatriculation\nnuméro CNSS',
      'Noms',
      'Post noms',
      'Prenoms',
      'Type travailleur\n(1=Travailleur\n2=Stagiaire)',
      'Département ou\nCommune affectation',
      'Periode Cotisee\n(jj/mm/aaaa)',
      'Salaire brut\nglobal',
      'Salaire soumis à\ncotisation CNSS',
      'Montant Cotisation\nDéclarée',
      'Nombre de\nJours travaillés',
      'Nombre\nheures travaillées',
    ]);
    h1.height = 54;
    h1.eachCell((c) => hCell(c));

    recap.employees.forEach((emp, i) => {
      if (!emp.cnssNumber)
        warnings.push(`${emp.nomFamille} ${emp.prenom} : N° CNSS manquant`);
      const row = ws1.addRow([
        emp.matricule,
        emp.cnssNumber,
        emp.nomFamille,
        emp.postNom,
        emp.prenom,
        emp.typeWorker,
        emp.departement,
        periode,
        emp.brutGlobal,
        emp.salaireSOumisCotisation,
        emp.cotisationDeclaree,
        emp.nbrJoursTravailles,
        emp.nbrHeuresTravaillees,
      ]);
      const bg = i % 2 === 0 ? 'FFF0F4F8' : 'FFFFFFFF';
      row.eachCell((c, col) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.border = bd('FFD1D9E0');
        c.alignment = { vertical: 'middle' };
        if ([9, 10, 11].includes(col)) numRight(c);
        if (col === 6)
          c.alignment = { horizontal: 'center', vertical: 'middle' };
        if (col === 2 && !emp.cnssNumber) {
          c.font = { bold: true, color: { argb: 'FFCC0000' } };
          c.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF0F0' },
          };
        }
      });
      row.height = 18;
    });

    // Totaux DNMS
    const t1 = ws1.addRow([
      'TOTAL',
      `${recap.totals.effectif} salarié(s)`,
      '',
      '',
      '',
      '',
      '',
      '',
      recap.totals.masseSalariale,
      recap.employees.reduce((s, e) => s + e.salaireSOumisCotisation, 0),
      recap.totals.totalCotisations,
      recap.totals.totalJours,
      recap.totals.totalHeures,
    ]);
    t1.height = 22;
    t1.eachCell((c, col) => {
      c.font = { bold: true, color: { argb: WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.border = bd();
      if ([9, 10, 11].includes(col)) numRight(c);
    });

    // ─── FEUILLE 2 : TUS ─────────────────────────────────────────────────
    // Colonnes exactes Model_Declaration_Mensuelle_CNSS_TUS.xlsx officiel
    const ws2 = wb.addWorksheet('TUS', {
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });
    ws2.columns = [
      { width: 14 },
      { width: 20 },
      { width: 18 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 18 },
      { width: 16 },
      { width: 18 },
      { width: 22 },
      { width: 13 },
    ];

    ws2.mergeCells('A1:K1');
    Object.assign(ws2.getCell('A1'), {
      value: `DÉCLARATION MENSUELLE TUS — ${monthName.toUpperCase()}`,
      font: { bold: true, size: 12, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ws2.getRow(1).height = 30;

    ws2.mergeCells('A2:D2');
    ws2.getCell('A2').value = `Employeur : ${recap.company?.legalName || ''}`;
    ws2.getCell('A2').font = { bold: true };
    ws2.mergeCells('E2:H2');
    ws2.getCell('E2').value = `N° Affiliation : ${affil}`;
    ws2.mergeCells('I2:K2');
    ws2.getCell('I2').value = `Période : ${monthName}`;
    ws2.getRow(2).height = 18;
    ws2.addRow([]);

    const h2 = ws2.addRow([
      'Matricule solde',
      'Immatriculation\nnuméro CNSS',
      'Noms',
      'Post noms',
      'Prenoms',
      'Type travailleur\n(1=Travailleur\n2=Stagiaire)',
      'Département ou\nCommune affectation',
      'Periode Cotisee\n(jj/mm/aaaa)',
      'Salaire brut\nglobal',
      'Montant Déclaration TUS',
      'Nombre de\nJours travaillés',
    ]);
    h2.height = 54;
    h2.eachCell((c) => hCell(c, PURPLE));

    recap.employees.forEach((emp, i) => {
      const row = ws2.addRow([
        emp.matricule,
        emp.cnssNumber,
        emp.nomFamille,
        emp.postNom,
        emp.prenom,
        emp.typeWorker,
        emp.departement,
        periode,
        emp.brutGlobal,
        emp.tusTotal,
        emp.nbrJoursTravailles,
      ]);
      const bg = i % 2 === 0 ? 'FFF5EEF8' : 'FFFFFFFF';
      row.eachCell((c, col) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.border = bd('FFD1D9E0');
        c.alignment = { vertical: 'middle' };
        if (col === 9 || col === 10) numRight(c);
        if (col === 6)
          c.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      row.height = 18;
    });

    const t2 = ws2.addRow([
      'TOTAL',
      `${recap.totals.effectif} salarié(s)`,
      '',
      '',
      '',
      '',
      '',
      '',
      recap.totals.masseSalariale,
      recap.totals.tusTotal,
      recap.totals.totalJours,
    ]);
    t2.height = 22;
    t2.eachCell((c, col) => {
      c.font = { bold: true, color: { argb: WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
      c.border = bd();
      if (col === 9 || col === 10) numRight(c);
    });

    ws2.addRow([]);
    const nr = ws2.addRow([
      `NOTE : TUS total = ${f(recap.totals.tusTotal)} FCFA` +
        ` (part CNSS 5,475% = ${f(recap.totals.tusCnss)} FCFA` +
        ` + part DGI 2,025% = ${f(recap.totals.tusDgi)} FCFA). 100% patronal, sans plafond.`,
    ]);
    ws2.mergeCells(`A${nr.number}:K${nr.number}`);
    nr.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF555555' } };
    nr.height = 24;

    // ─── FEUILLE 3 : DÉCLARATION GLOBALE ─────────────────────────────────
    const ws3 = wb.addWorksheet('Déclaration Globale');
    ws3.columns = [{ width: 5 }, { width: 58 }, { width: 26 }];

    const addTitle = (txt: string, color = BLUE) => {
      ws3.addRow([]);
      const r = ws3.addRow(['', txt]);
      ws3.mergeCells(`B${r.number}:C${r.number}`);
      r.getCell(2).font = { bold: true, size: 11, color: { argb: WHITE } };
      r.getCell(2).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: color },
      };
      r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      r.height = 22;
    };

    const addRow = (
      label: string,
      value: number | string,
      bold = false,
      bg?: string,
    ) => {
      const r = ws3.addRow([
        '',
        label,
        typeof value === 'number' ? value : value,
      ]);
      r.getCell(2).font = { bold, size: 10 };
      r.getCell(3).font = { bold, size: 10 };
      r.getCell(2).alignment = { vertical: 'middle', indent: 1 };
      r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
      if (typeof value === 'number') r.getCell(3).numFmt = '#,##0 "F CFA"';
      if (bg)
        [2, 3].forEach((c) => {
          r.getCell(c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bg },
          };
        });
      r.height = 20;
    };

    ws3.mergeCells('A1:C1');
    Object.assign(ws3.getCell('A1'), {
      value:
        'DÉCLARATION GLOBALE — DIRECTION DU RECOUVREMENT ET DU CONTENTIEUX — SERVICE COTISANTS',
      font: { bold: true, size: 11, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ws3.getRow(1).height = 28;

    addRow('Nom et Raison Sociale', recap.company?.legalName || '');
    addRow('Matricule employeur (N° Affiliation CNSS)', affil);
    addRow('Période', `${mm} / ${year}`);
    addRow('Effectif déclaré', `${recap.totals.effectif} salarié(s)`);
    ws3.addRow([]);
    addRow(
      'Salaire Brut déplafonné (toutes rémunérations)',
      recap.totals.masseSalariale,
      true,
      'FFE8F4FD',
    );

    addTitle('SOUS-TOTAL (1) — TUS (Taxe Unique sur Salaires — 7,5%)', PURPLE);
    addRow(
      `TUS 7,5% × brut — dont CNSS 5,475% = ${f(recap.totals.tusCnss)} F`,
      recap.totals.tusTotal,
    );
    addRow(
      `Majoration retard (10% × ${recap.totals.monthsLate} mois)`,
      recap.totals.tusMajoration,
    );
    addRow('SOUS-TOTAL (1)', recap.totals.dgcSousTot1, true, 'FFE8D5F5');

    addTitle('SOUS-TOTAL (2) — COTISATIONS RÉGIMES CNSS', 'FF0E6655');
    addRow(
      `Assurance Pensions — base plaf. 1 200 000 F : ${f(recap.totals.dgcPensionBase)} F × 12% (4% sal + 8% pat)`,
      recap.totals.dgcCotisationPension,
    );
    addRow(
      `AT & Prest. Familiales — base plaf. 600 000 F : ${f(recap.totals.dgcAtPfBase)} F × 12,28%`,
      recap.totals.dgcCotisationAtPf,
    );
    addRow(
      `Majoration retard (10% × ${recap.totals.monthsLate} mois)`,
      recap.totals.latePenalty,
    );
    addRow('Pénalité', 0);
    addRow('Déduction sur avis de crédit', 0);
    addRow('SOUS-TOTAL (2)', recap.totals.dgcSousTot2, true, 'FFD1F2EB');

    ws3.addRow([]);
    const totRow = ws3.addRow([
      '',
      'TOTAL À PAYER (1 + 2)',
      recap.totals.dgcTotalAPayer,
    ]);
    totRow.getCell(2).font = { bold: true, size: 12, color: { argb: WHITE } };
    totRow.getCell(3).font = {
      bold: true,
      size: 12,
      color: { argb: 'FF00FF88' },
    };
    totRow.getCell(2).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BLUE },
    };
    totRow.getCell(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BLUE },
    };
    totRow.getCell(3).numFmt = '#,##0 "F CFA"';
    totRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    totRow.height = 28;
    ws3.mergeCells(`B${totRow.number}:B${totRow.number}`);

    ws3.addRow([]);
    addRow(
      `→ À verser CNSS : ${f(recap.totals.totalAVerserCnss)} F CFA  (Cotisations + TUS 5,475%)`,
      '',
    );
    addRow(
      `→ À verser DGI  : ${f(recap.totals.totalAVerserDgi)} F CFA  (TUS part Trésor 2,025%)`,
      '',
    );
    ws3.addRow([]);
    addRow(
      `Fait à Brazzaville, le ${new Date().toLocaleDateString('fr-FR')}`,
      '',
    );
    addRow("(Cachet & Signature de l'Employeur)", '');
    ws3.addRow([]);
    const nbRow = ws3.addRow([
      '',
      'NB : Joindre obligatoirement la liste nominative ou télédéclarer sur edeclaration.cnss.cg.',
    ]);
    nbRow.getCell(2).font = { italic: true, size: 9 };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = (recap.company?.legalName || 'ENTREPRISE')
      .replace(/\s+/g, '_')
      .toUpperCase();
    return {
      buffer,
      filename: `CNSS_DNMS_${mm}_${year}_${slug}.xlsx`,
      warnings,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXPORT CSV — edeclaration.cnss.cg
  // ══════════════════════════════════════════════════════════════════════════
  async exportDeclarationCsv(
    userId: string,
    month: number,
    year: number,
  ): Promise<{
    content: string;
    filename: string;
  }> {
    const recap = await this.getMonthlyRecap(userId, month, year);
    const mm = String(month).padStart(2, '0');
    const per = `01/${mm}/${year}`;
    const affil =
      recap.company?.cnssAffiliationNumber || recap.company?.cnssNumber || '';

    const headers = [
      'N_AFFILIATION_CNSS',
      'MATRICULE_SOLDE',
      'IMMATRICULATION_CNSS',
      'NOMS',
      'POST_NOMS',
      'PRENOMS',
      'TYPE_TRAVAILLEUR',
      'DEPARTEMENT_COMMUNE',
      'PERIODE_COTISEE',
      'SALAIRE_BRUT_GLOBAL',
      'SALAIRE_SOUMIS_COTISATION',
      'MONTANT_COTISATION_DECLAREE',
      'NB_JOURS_TRAVAILLES',
      'NB_HEURES_TRAVAILLEES',
    ];

    const rows = recap.employees.map((e) =>
      [
        affil,
        e.matricule,
        e.cnssNumber,
        e.nomFamille,
        e.postNom,
        e.prenom,
        e.typeWorker,
        e.departement,
        per,
        e.brutGlobal,
        e.salaireSOumisCotisation,
        e.cotisationDeclaree,
        e.nbrJoursTravailles,
        e.nbrHeuresTravaillees,
      ].join(';'),
    );

    const slug = (recap.company?.legalName || 'ENTREPRISE')
      .replace(/\s+/g, '_')
      .toUpperCase();
    return {
      content: '\uFEFF' + [headers.join(';'), ...rows].join('\n'),
      filename: `CNSS_DNMS_${mm}_${year}_${slug}.csv`,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HISTORIQUE
  // ══════════════════════════════════════════════════════════════════════════
  async getDeclarationHistory(userId: string, year: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');

    // 🆕 On lit désormais le vrai statut de déclaration (table
    // CnssDeclaration, alimentée par le bouton "Je déclare la CNSS"), plus
    // la simple présence de bulletins de paie non-brouillon — voir
    // declareCnss() pour le contexte du correctif.
    const declarations = await this.prisma.cnssDeclaration.findMany({
      where: { companyId: user.companyId, year },
      select: { month: true, status: true, declaredAt: true },
    });
    const declByMonth = new Map(declarations.map((d) => [d.month, d]));

    const history: Array<{
      month: number;
      year: number;
      monthLabel: string;
      payrollCount: number;
      deadline: Date;
      hasPaid: boolean;
      status: string;
      declaredAt: Date | null;
    }> = [];

    for (let m = 1; m <= 12; m++) {
      const count = await this.prisma.payroll.count({
        where: {
          companyId: user.companyId,
          month: m,
          year,
          status: { not: 'DRAFT' },
          employee: { isSubjectToCnss: true },
        },
      });
      const deadline = getDeadline(m, year);
      const isPast = new Date() > new Date(year, m - 1, 1);
      const decl = declByMonth.get(m);
      const isDeclared =
        decl && ['DECLAREE', 'PAYEE', 'REGULARISEE'].includes(decl.status);

      history.push({
        month: m,
        year,
        monthLabel: new Date(year, m - 1).toLocaleDateString('fr-FR', {
          month: 'long',
        }),
        payrollCount: count,
        deadline,
        hasPaid: count > 0,
        status: isDeclared
          ? 'DÉCLARÉ'
          : isPast && new Date() > deadline
            ? 'EN RETARD'
            : isPast
              ? 'À DÉCLARER'
              : 'À VENIR',
        declaredAt: decl?.declaredAt || null,
      });
    }
    return history;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Export template officiel DNMS — format exact e-déclaration CNSS
  // ════════════════════════════════════════════════════════════════════════
  async exportDnmsTemplate(
    userId: string,
    month: number,
    year: number,
  ): Promise<{
    buffer: Buffer;
    filename: string;
    warnings: string[];
  }> {
    const recap = await this.getMonthlyRecap(userId, month, year);
    const warnings: string[] = [];
    const mm = String(month).padStart(2, '0');
    const slug = (recap.company?.legalName || 'ENTREPRISE')
      .replace(/\s+/g, '_')
      .toUpperCase();

    recap.employees.forEach((emp) => {
      if (!emp.cnssNumber)
        warnings.push(`${emp.nomFamille} ${emp.prenom} : N° CNSS manquant`);
    });

    const { fillDnmsTemplate } = await import('./export-cnss-template.js');
    const buffer = await fillDnmsTemplate(recap.employees, month, year);

    return {
      buffer,
      filename: `CNSS_DNMS_${mm}_${year}_${slug}.xlsx`,
      warnings,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Export template officiel TUS — format exact e-déclaration CNSS
  // ════════════════════════════════════════════════════════════════════════
  async exportTusTemplate(
    userId: string,
    month: number,
    year: number,
  ): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const recap = await this.getMonthlyRecap(userId, month, year);
    const mm = String(month).padStart(2, '0');
    const slug = (recap.company?.legalName || 'ENTREPRISE')
      .replace(/\s+/g, '_')
      .toUpperCase();

    const { fillTusTemplate } = await import('./export-cnss-template.js');
    const buffer = await fillTusTemplate(recap.employees, month, year);

    return {
      buffer,
      filename: `CNSS_TUS_${mm}_${year}_${slug}.xlsx`,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Export template officiel DGC (Déclaration Globale de Cotisation) — .docx
  // ════════════════════════════════════════════════════════════════════════
  async exportDgcTemplate(
    userId: string,
    month: number,
    year: number,
    options?: { ville?: string; acompte?: number },
  ): Promise<{
    buffer: Buffer;
    filename: string;
    warnings: string[];
  }> {
    const recap = await this.getMonthlyRecap(userId, month, year);
    const warnings: string[] = [];
    const mm = String(month).padStart(2, '0');
    const slug = (recap.company?.legalName || 'ENTREPRISE')
      .replace(/\s+/g, '_')
      .toUpperCase();

    if (
      !recap.company?.cnssAffiliationNumber &&
      !recap.company?.cnssNumber
    ) {
      warnings.push("N° d'affiliation CNSS de l'entreprise manquant");
    }
    warnings.push(
      'Le formulaire imprime "TUS 3%" — à confirmer auprès de la CNSS, le calcul KonzaRH utilise TUS part CNSS 5,475%',
    );

    const { fillDgcTemplate } = await import('./export-cnss-template.js');
    const buffer = await fillDgcTemplate(
      {
        company: recap.company
          ? {
              legalName: recap.company.legalName ?? undefined,
              cnssAffiliationNumber:
                recap.company.cnssAffiliationNumber ?? undefined,
              cnssNumber: recap.company.cnssNumber ?? undefined,
              address: recap.company.address ?? undefined,
              phone: recap.company.phone ?? undefined,
            }
          : undefined,
        totals: recap.totals,
      },
      month,
      year,
      options,
    );

    return {
      buffer,
      filename: `CNSS_DGC_${mm}_${year}_${slug}.docx`,
      warnings,
    };
  }
}