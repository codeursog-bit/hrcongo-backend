import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

export interface DeclarationSummary {
  month: number;
  year: number;
  companyId: string;
  companyName: string;
  employeeCount: number;
  totalGrossSalary: number;
  totalCnssSalarial: number;
  cnssEmployerPension: number;
  cnssEmployerFamily: number;
  cnssEmployerAccident: number;
  totalCnssEmployer: number;
  tusDgiAmount: number;
  tusCnssAmount: number;
  tusTotal: number;
  totalIts: number;
  customTaxDetails: Array<{
    name: string;
    code: string;
    employeeTotal: number;
    employerTotal: number;
  }>;
  totalSalarialDeductions: number;
  totalEmployerCharges: number;
  grandTotal: number;
}

@Injectable()
export class CabinetDeclarationsService {
  constructor(private prisma: PrismaService) {}

  async getSummary(
    cabinetId: string,
    companyId: string,
    month: number,
    year: number,
  ): Promise<DeclarationSummary> {
    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
      include: { company: { select: { legalName: true, tradeName: true } } },
    });

    if (!link || !link.isActive) {
      throw new ForbiddenException(
        "Cette entreprise n'est pas gérée par votre cabinet",
      );
    }

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year },
      select: {
        grossSalary: true,
        cnssSalarial: true,
        its: true,
        cnssEmployerPension: true,
        cnssEmployerFamily: true,
        cnssEmployerAccident: true,
        cnssEmployer: true,
        tusDgiAmount: true,
        tusCnssAmount: true,
        tusTotal: true,
        employeeCustomTaxTotal: true,
        employerCustomTaxTotal: true,
      },
    });

    if (payrolls.length === 0) {
      throw new NotFoundException(
        `Aucun bulletin trouvé pour ${month}/${year} — générez d'abord la paie`,
      );
    }

    const totals = payrolls.reduce(
      (acc, p) => ({
        grossSalary: acc.grossSalary + Number(p.grossSalary),
        cnssSalarial: acc.cnssSalarial + Number(p.cnssSalarial),
        its: acc.its + Number(p.its),
        cnssEmployerPension:
          acc.cnssEmployerPension + Number(p.cnssEmployerPension),
        cnssEmployerFamily:
          acc.cnssEmployerFamily + Number(p.cnssEmployerFamily),
        cnssEmployerAccident:
          acc.cnssEmployerAccident + Number(p.cnssEmployerAccident),
        cnssEmployer: acc.cnssEmployer + Number(p.cnssEmployer),
        tusDgiAmount: acc.tusDgiAmount + Number(p.tusDgiAmount),
        tusCnssAmount: acc.tusCnssAmount + Number(p.tusCnssAmount),
        tusTotal: acc.tusTotal + Number(p.tusTotal),
        employeeCustomTax:
          acc.employeeCustomTax + Number(p.employeeCustomTaxTotal ?? 0),
        employerCustomTax:
          acc.employerCustomTax + Number(p.employerCustomTaxTotal ?? 0),
      }),
      {
        grossSalary: 0,
        cnssSalarial: 0,
        its: 0,
        cnssEmployerPension: 0,
        cnssEmployerFamily: 0,
        cnssEmployerAccident: 0,
        cnssEmployer: 0,
        tusDgiAmount: 0,
        tusCnssAmount: 0,
        tusTotal: 0,
        employeeCustomTax: 0,
        employerCustomTax: 0,
      },
    );

    // Les taxes custom détaillées ne sont pas stockées en champ Prisma.
    // Elles peuvent être reconstituées depuis payrollItems si besoin.
    const customTaxDetails: DeclarationSummary['customTaxDetails'] = [];

    const totalSalarialDeductions = Math.round(
      totals.cnssSalarial + totals.its + totals.employeeCustomTax,
    );
    const totalEmployerCharges = Math.round(
      totals.cnssEmployer + totals.tusTotal + totals.employerCustomTax,
    );
    const grandTotal = totalSalarialDeductions + totalEmployerCharges;
    const companyName = link.company.tradeName ?? link.company.legalName;

    return {
      month,
      year,
      companyId,
      companyName,
      employeeCount: payrolls.length,
      totalGrossSalary: Math.round(totals.grossSalary),
      totalCnssSalarial: Math.round(totals.cnssSalarial),
      cnssEmployerPension: Math.round(totals.cnssEmployerPension),
      cnssEmployerFamily: Math.round(totals.cnssEmployerFamily),
      cnssEmployerAccident: Math.round(totals.cnssEmployerAccident),
      totalCnssEmployer: Math.round(totals.cnssEmployer),
      tusDgiAmount: Math.round(totals.tusDgiAmount),
      tusCnssAmount: Math.round(totals.tusCnssAmount),
      tusTotal: Math.round(totals.tusTotal),
      totalIts: Math.round(totals.its),
      customTaxDetails,
      totalSalarialDeductions,
      totalEmployerCharges,
      grandTotal,
    };
  }

  async exportDeclarationsExcel(
    cabinetId: string,
    companyId: string,
    month: number,
    year: number,
  ): Promise<Buffer> {
    const summary = await this.getSummary(cabinetId, companyId, month, year);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Konza RH';
    wb.created = new Date();

    const monthName = new Date(year, month - 1)
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      .toUpperCase();

    const ws = wb.addWorksheet('Déclarations');

    const headerStyle = {
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0E3460' },
      } as any,
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    };
    const sectionStyle = {
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8EFF7' },
      } as any,
      font: { bold: true, size: 10 },
    };
    const totalStyle = {
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0F7ED' },
      } as any,
      font: { bold: true, size: 10 },
    };

    ws.columns = [
      { key: 'label', width: 48 },
      { key: 'value', width: 22 },
      { key: 'note', width: 36 },
    ];

    const addRow = (
      label: string,
      value: string | number,
      note = '',
      style?: any,
    ) => {
      const row = ws.addRow({ label, value, note });
      if (style) row.eachCell((cell) => Object.assign(cell, style));
      return row;
    };

    ws.mergeCells('A1:C1');
    const title = ws.getCell('A1');
    title.value = `ÉTAT DES DÉCLARATIONS SOCIALES ET FISCALES — ${monthName}`;
    title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    title.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0A2547' },
    } as any;
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    ws.addRow({});
    addRow('Entreprise', summary.companyName);
    addRow('Période', `${month.toString().padStart(2, '0')}/${year}`);
    addRow('Effectif', `${summary.employeeCount} employé(s)`);
    addRow('Masse salariale brute', summary.totalGrossSalary, 'FCFA');
    ws.addRow({});

    addRow('CNSS — CAISSE NATIONALE DE SÉCURITÉ SOCIALE', '', '', sectionStyle);
    addRow(
      'Part salariale — CNSS salarié (4%)',
      summary.totalCnssSalarial,
      'FCFA → à verser à la CNSS',
    );
    addRow(
      'Part patronale — Retraite (8% × plaf. 1 200 000)',
      summary.cnssEmployerPension,
      'FCFA',
    );
    addRow(
      'Part patronale — Prestations familiales (10.03% × plaf. 600 000)',
      summary.cnssEmployerFamily,
      'FCFA',
    );
    addRow(
      'Part patronale — Accidents du travail (2.25% × plaf. 600 000)',
      summary.cnssEmployerAccident,
      'FCFA',
    );
    addRow(
      'TOTAL CNSS patronale',
      summary.totalCnssEmployer,
      'FCFA → à verser à la CNSS',
      totalStyle,
    );
    ws.addRow({});

    addRow(
      'TUS — TAXE UNIQUE SUR LES SALAIRES (Patronale)',
      '',
      '',
      sectionStyle,
    );
    addRow(
      'TUS versé à la DGI (4.13% × brut total)',
      summary.tusDgiAmount,
      'FCFA',
    );
    addRow(
      'TUS versé à la CNSS (3.38% × brut total)',
      summary.tusCnssAmount,
      'FCFA',
    );
    addRow(
      'TOTAL TUS (7.51%)',
      summary.tusTotal,
      'FCFA → patronal, sans plafond',
      totalStyle,
    );
    ws.addRow({});

    addRow('ITS — IMPÔT SUR LES TRAITEMENTS ET SALAIRES', '', '', sectionStyle);
    addRow(
      'Total ITS retenu à la source',
      summary.totalIts,
      'FCFA → à verser à la DGI',
      totalStyle,
    );
    ws.addRow({});

    if (summary.customTaxDetails.length > 0) {
      addRow('TAXES SPÉCIFIQUES (CAMU, TOL, etc.)', '', '', sectionStyle);
      for (const t of summary.customTaxDetails) {
        if (t.employeeTotal > 0)
          addRow(
            `${t.name} (${t.code}) — part salarié`,
            t.employeeTotal,
            'FCFA',
          );
        if (t.employerTotal > 0)
          addRow(
            `${t.name} (${t.code}) — part patronale`,
            t.employerTotal,
            'FCFA',
          );
      }
      ws.addRow({});
    }

    addRow(
      'TOTAL RETENUES SALARIALES',
      summary.totalSalarialDeductions,
      'FCFA',
      totalStyle,
    );
    addRow(
      'TOTAL CHARGES PATRONALES',
      summary.totalEmployerCharges,
      'FCFA',
      totalStyle,
    );

    const grandTotalRow = ws.addRow({
      label: `TOTAL À VERSER (État + CNSS) : ${summary.grandTotal.toLocaleString('fr-FR')} FCFA`,
    });
    grandTotalRow.getCell(1).font = {
      bold: true,
      size: 12,
      color: { argb: 'FFFFFFFF' },
    };
    grandTotalRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A6B35' },
    } as any;
    grandTotalRow.getCell(1).alignment = { horizontal: 'center' };
    grandTotalRow.height = 24;

    ws.getColumn('value').numFmt = '#,##0';
    ws.getColumn('value').alignment = { horizontal: 'right' };

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  async exportSageJournal(
    cabinetId: string,
    companyId: string,
    month: number,
    year: number,
  ): Promise<string> {
    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
    });
    if (!link || !link.isActive) {
      throw new ForbiddenException(
        "Cette entreprise n'est pas gérée par votre cabinet",
      );
    }

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year },
      include: {
        employee: {
          select: { employeeNumber: true, firstName: true, lastName: true },
        },
      },
    });

    if (payrolls.length === 0) {
      throw new NotFoundException('Aucun bulletin pour cette période');
    }

    const dateStr = `${String(month).padStart(2, '0')}/${year}`;
    const journal = 'PAIE';
    const lines: string[] = [];
    lines.push('JNL|DATEPCE|NUMCPTE|LIBELLE|DEBIT|CREDIT|REFPCE|NUMPIECE');

    for (const p of payrolls) {
      const name = `${p.employee.firstName} ${p.employee.lastName}`;
      const ref = `PAY-${p.employee.employeeNumber}-${String(month).padStart(2, '0')}-${year}`;
      const brut = Math.round(Number(p.grossSalary));
      const cnssS = Math.round(Number(p.cnssSalarial));
      const cnssE = Math.round(Number(p.cnssEmployer));
      const its = Math.round(Number(p.its));
      const net = Math.round(Number(p.netSalary));
      const tus = Math.round(Number(p.tusTotal ?? 0));

      lines.push(
        `${journal}|${dateStr}|661100|Salaire brut - ${name}|${brut}|0|${ref}|${ref}`,
      );
      lines.push(
        `${journal}|${dateStr}|645100|CNSS patronale - ${name}|${cnssE}|0|${ref}|${ref}`,
      );
      if (tus > 0)
        lines.push(
          `${journal}|${dateStr}|645200|TUS - ${name}|${tus}|0|${ref}|${ref}`,
        );
      lines.push(
        `${journal}|${dateStr}|431100|CNSS salarié - ${name}|0|${cnssS}|${ref}|${ref}`,
      );
      lines.push(
        `${journal}|${dateStr}|442000|ITS - ${name}|0|${its}|${ref}|${ref}`,
      );
      lines.push(
        `${journal}|${dateStr}|421000|Rémunération à payer - ${name}|0|${net}|${ref}|${ref}`,
      );
    }

    return lines.join('\r\n');
  }

  async generateClientReport(
    cabinetId: string,
    companyId: string,
    month: number,
    year: number,
  ): Promise<Buffer> {
    const summary = await this.getSummary(cabinetId, companyId, month, year);

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year },
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

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Konza RH';
    wb.created = new Date();

    const monthName = new Date(year, month - 1)
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      .toUpperCase();

    const ws1 = wb.addWorksheet('État de paie');
    ws1.columns = [
      { key: 'num', width: 10, header: 'Matricule' },
      { key: 'nom', width: 26, header: 'Nom & Prénom' },
      { key: 'poste', width: 22, header: 'Poste' },
      { key: 'cnss', width: 16, header: 'N° CNSS' },
      { key: 'base', width: 16, header: 'Salaire base' },
      { key: 'jours', width: 10, header: 'Jours trav.' },
      { key: 'hs10', width: 10, header: 'H.sup ×1.10' },
      { key: 'hs25', width: 10, header: 'H.sup ×1.25' },
      { key: 'hs50', width: 10, header: 'H.sup ×1.50' },
      { key: 'hs100', width: 10, header: 'H.sup ×2.00' },
      { key: 'primes', width: 14, header: 'Primes' },
      { key: 'brut', width: 16, header: 'Salaire brut' },
      { key: 'cnssS', width: 14, header: 'CNSS sal. (4%)' },
      { key: 'its', width: 14, header: 'ITS' },
      { key: 'net', width: 16, header: 'Net à payer' },
      { key: 'cnssP', width: 16, header: 'CNSS patron.' },
      { key: 'tus', width: 12, header: 'TUS' },
      { key: 'cout', width: 18, header: 'Coût employeur' },
    ];

    ws1.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0E3460' },
      } as any;
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });
    ws1.getRow(1).height = 28;

    ws1.insertRow(1, [`ÉTAT DE PAIE — ${summary.companyName} — ${monthName}`]);
    ws1.mergeCells('A1:R1');
    ws1.getCell('A1').font = {
      bold: true,
      size: 13,
      color: { argb: 'FFFFFFFF' },
    };
    ws1.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0A2547' },
    } as any;
    ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 30;

    for (const p of payrolls) {
      ws1.addRow({
        num: p.employee.employeeNumber ?? '—',
        nom: `${p.employee.lastName} ${p.employee.firstName}`,
        poste: p.employee.position,
        cnss: p.employee.cnssNumber ?? '—',
        base: Number(p.baseSalary ?? p.grossSalary),
        jours: Number(p.workedDays ?? 26),
        hs10: Number((p as any).overtimeHours10 ?? 0),
        hs25: Number((p as any).overtimeHours25 ?? 0),
        hs50: Number((p as any).overtimeHours50 ?? 0),
        hs100: Number((p as any).overtimeHours100 ?? 0),
        primes: Number(p.totalBonuses ?? 0),
        brut: Number(p.grossSalary),
        cnssS: Number(p.cnssSalarial),
        its: Number(p.its),
        net: Number(p.netSalary),
        cnssP: Number(p.cnssEmployer),
        tus: Number(p.tusTotal ?? 0),
        cout: Number(p.totalEmployerCost),
      });
    }

    const lastDataRow = ws1.lastRow!.number;
    const totalRow = ws1.addRow({
      num: 'TOTAUX',
      nom: '',
      poste: '',
      cnss: '',
      base: `=SUM(E3:E${lastDataRow})`,
      brut: `=SUM(L3:L${lastDataRow})`,
      cnssS: `=SUM(M3:M${lastDataRow})`,
      its: `=SUM(N3:N${lastDataRow})`,
      net: `=SUM(O3:O${lastDataRow})`,
      cnssP: `=SUM(P3:P${lastDataRow})`,
      tus: `=SUM(Q3:Q${lastDataRow})`,
      cout: `=SUM(R3:R${lastDataRow})`,
    });
    totalRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0F7ED' },
      } as any;
    });

    [
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
      'M',
      'N',
      'O',
      'P',
      'Q',
      'R',
    ].forEach((col) => {
      ws1.getColumn(col).numFmt = '#,##0';
    });

    const ws2 = wb.addWorksheet('Déclarations');
    ws2.columns = [
      { key: 'label', width: 50 },
      { key: 'montant', width: 20 },
      { key: 'note', width: 35 },
    ];

    const addDecl = (
      label: string,
      montant: number | string,
      note = '',
      bold = false,
    ) => {
      const row = ws2.addRow({ label, montant, note });
      if (bold) row.font = { bold: true };
      row.getCell('montant').numFmt = '#,##0';
      row.getCell('montant').alignment = { horizontal: 'right' };
    };

    ws2.addRow({ label: `DÉCLARATIONS SOCIALES & FISCALES — ${monthName}` });
    ws2.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0A2547' },
    } as any;
    ws2.mergeCells('A1:C1');
    ws2.addRow({});

    addDecl('Masse salariale brute', summary.totalGrossSalary, 'FCFA');
    addDecl('Effectif', summary.employeeCount, 'employés');
    ws2.addRow({});

    ws2.addRow({ label: '► CNSS' }).font = {
      bold: true,
      color: { argb: 'FF0E3460' },
    };
    addDecl('CNSS salarié (4%)', summary.totalCnssSalarial, '→ CNSS');
    addDecl(
      'CNSS patron. retraite (8%)',
      summary.cnssEmployerPension,
      '→ CNSS',
    );
    addDecl(
      'CNSS patron. famille (10.03%)',
      summary.cnssEmployerFamily,
      '→ CNSS',
    );
    addDecl(
      'CNSS patron. accidents (2.25%)',
      summary.cnssEmployerAccident,
      '→ CNSS',
    );
    addDecl('TOTAL CNSS patronale', summary.totalCnssEmployer, '', true);
    ws2.addRow({});

    ws2.addRow({ label: '► TUS' }).font = {
      bold: true,
      color: { argb: 'FF0E3460' },
    };
    addDecl('TUS DGI (4.13%)', summary.tusDgiAmount, '→ DGI');
    addDecl('TUS CNSS (3.38%)', summary.tusCnssAmount, '→ CNSS');
    addDecl('TOTAL TUS', summary.tusTotal, '', true);
    ws2.addRow({});

    ws2.addRow({ label: '► ITS' }).font = {
      bold: true,
      color: { argb: 'FF0E3460' },
    };
    addDecl('ITS retenu à la source', summary.totalIts, '→ DGI', true);
    ws2.addRow({});

    if (summary.customTaxDetails.length > 0) {
      ws2.addRow({ label: '► Taxes spécifiques' }).font = {
        bold: true,
        color: { argb: 'FF0E3460' },
      };
      for (const t of summary.customTaxDetails) {
        if (t.employeeTotal > 0)
          addDecl(`${t.name} — part salarié`, t.employeeTotal);
        if (t.employerTotal > 0)
          addDecl(`${t.name} — part patronale`, t.employerTotal);
      }
      ws2.addRow({});
    }

    ws2.addRow({});
    addDecl(
      'TOTAL RETENUES SALARIALES',
      summary.totalSalarialDeductions,
      'FCFA',
      true,
    );
    addDecl(
      'TOTAL CHARGES PATRONALES',
      summary.totalEmployerCharges,
      'FCFA',
      true,
    );
    addDecl('TOTAL À VERSER (État + CNSS)', summary.grandTotal, 'FCFA', true);

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }
}
