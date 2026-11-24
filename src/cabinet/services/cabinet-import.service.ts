import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

export const KONZA_TEMPLATE_COLUMNS = [
  { key: 'employeeNumber', label: 'Matricule', required: true, type: 'string' },
  { key: 'lastName', label: 'Nom', required: true, type: 'string' },
  { key: 'firstName', label: 'Prénom', required: true, type: 'string' },
  {
    key: 'baseSalary',
    label: 'Salaire de base',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'workedDays',
    label: 'Jours travaillés',
    required: true,
    type: 'number',
    default: 26,
  },
  {
    key: 'absentDays',
    label: 'Jours absents',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'overtime10',
    label: 'H.Sup ×1.10',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'overtime25',
    label: 'H.Sup ×1.25',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'overtime50',
    label: 'H.Sup ×1.50',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'overtime100',
    label: 'H.Sup ×2.00',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'prime1Label',
    label: 'Prime 1 — Libellé',
    required: false,
    type: 'string',
  },
  {
    key: 'prime1Amount',
    label: 'Prime 1 — Montant',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'prime2Label',
    label: 'Prime 2 — Libellé',
    required: false,
    type: 'string',
  },
  {
    key: 'prime2Amount',
    label: 'Prime 2 — Montant',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'advance',
    label: 'Avance (FCFA)',
    required: false,
    type: 'number',
    default: 0,
  },
  {
    key: 'loanDeduction',
    label: 'Remb. prêt (FCFA)',
    required: false,
    type: 'number',
    default: 0,
  },
  { key: 'notes', label: 'Notes', required: false, type: 'string' },
] as const;

export type KonzaColumnKey = (typeof KONZA_TEMPLATE_COLUMNS)[number]['key'];

export interface ParsedEmployee {
  employeeNumber?: string;
  lastName: string;
  firstName: string;
  workedDays: number;
  absentDays: number;
  overtime10: number;
  overtime25: number;
  overtime50: number;
  overtime100: number;
  bonuses: Array<{ label: string; amount: number }>;
  advance: number;
  loanDeduction: number;
  baseSalary: number;
  notes?: string;
  rowIndex: number;
  matchedEmployeeId?: string;
  matchError?: string;
}

export interface ImportPreview {
  rows: ParsedEmployee[];
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  warnings: string[];
}

@Injectable()
export class CabinetImportService {
  constructor(private prisma: PrismaService) {}

  async generateTemplate(companyId: string): Promise<Buffer> {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        employeeNumber: true,
        firstName: true,
        lastName: true,
        position: true,
        baseSalary: true,
      },
      orderBy: { lastName: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Konza RH';
    const ws = wb.addWorksheet('Variables paie');

    const headers = KONZA_TEMPLATE_COLUMNS.map((c) => c.label);
    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell, colNum) => {
      const col = KONZA_TEMPLATE_COLUMNS[colNum - 1];
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: col.required ? 'FF0E3460' : 'FF2D5A8E' },
      } as any;
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    });
    ws.getRow(1).height = 32;

    ws.columns = KONZA_TEMPLATE_COLUMNS.map((c) => ({
      key: c.key,
      width: [
        'lastName',
        'firstName',
        'prime1Label',
        'prime2Label',
        'notes',
      ].includes(c.key)
        ? 20
        : 14,
    }));

    const infoRow = ws.addRow([
      '← Obligatoire',
      '← Obligatoire',
      '← Obligatoire',
      'Pré-rempli',
      'Défaut: 26',
      'Défaut: 0',
      'Défaut: 0',
      'Défaut: 0',
      'Défaut: 0',
      'Défaut: 0',
      'Ex: Prime transport',
      'En FCFA',
      'Ex: Prime ancienneté',
      'En FCFA',
      'En FCFA',
      'En FCFA',
      '',
    ]);
    infoRow.eachCell((cell) => {
      cell.font = { italic: true, size: 9, color: { argb: 'FF888888' } };
    });

    for (const emp of employees) {
      const row = ws.addRow({
        employeeNumber: emp.employeeNumber ?? '',
        lastName: emp.lastName,
        firstName: emp.firstName,
        baseSalary: (emp as any).baseSalary ?? 0,
        workedDays: 26,
        absentDays: 0,
        overtime10: 0,
        overtime25: 0,
        overtime50: 0,
        overtime100: 0,
        prime1Label: '',
        prime1Amount: 0,
        prime2Label: '',
        prime2Amount: 0,
        advance: 0,
        loanDeduction: 0,
        notes: '',
      });

      if (row.number % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF5F8FF' },
          } as any;
        });
      }

      [
        'workedDays',
        'absentDays',
        'overtime10',
        'overtime25',
        'overtime50',
        'overtime100',
        'prime1Amount',
        'prime2Amount',
        'advance',
        'loanDeduction',
      ].forEach((key) => {
        const colIdx =
          KONZA_TEMPLATE_COLUMNS.findIndex((c) => c.key === key) + 1;
        if (colIdx > 0) row.getCell(colIdx).numFmt = '#,##0';
      });
    }

    const wsInfo = wb.addWorksheet('Instructions');
    wsInfo.addRow(['INSTRUCTIONS — Template variables de paie Konza RH']);
    wsInfo.addRow([]);
    wsInfo.addRow(['Colonnes OBLIGATOIRES (fond bleu foncé) :']);
    wsInfo.addRow(['  Matricule, Nom, Prénom, Jours travaillés']);
    wsInfo.addRow([]);
    wsInfo.addRow(['Heures supplémentaires (Décret N°78-360) :']);
    wsInfo.addRow(['  H.Sup ×1.10 = 5 premières heures sup (jours normaux)']);
    wsInfo.addRow(['  H.Sup ×1.25 = heures suivantes (jours normaux)']);
    wsInfo.addRow(['  H.Sup ×1.50 = nuit, repos hebdo, jour férié']);
    wsInfo.addRow(['  H.Sup ×2.00 = nuit de dimanche ou jour férié']);
    wsInfo.addRow([]);
    wsInfo.addRow(['Primes :']);
    wsInfo.addRow([
      '  Renseignez le libellé ET le montant. Max 2 primes via ce template.',
    ]);
    wsInfo.addRow([
      '  Pour plus de primes, utilisez la saisie manuelle dans Konza.',
    ]);
    wsInfo.addRow([]);
    wsInfo.addRow(['NE PAS modifier les colonnes ni leur ordre.']);
    wsInfo.addRow(['Retournez ce fichier rempli à votre cabinet RH.']);

    return wb.xlsx.writeBuffer() as any;
  }

  async parseFile(
    buffer: Buffer,
    filename: string,
    mapping?: Record<string, string>,
  ): Promise<{ headers: string[]; rows: any[] }> {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') return this.parseCSV(buffer, mapping);
    if (['xlsx', 'xls'].includes(ext ?? ''))
      return this.parseExcel(buffer, mapping);
    throw new BadRequestException(
      'Format non supporté. Utilisez .xlsx, .xls ou .csv',
    );
  }

  private async parseExcel(
    buffer: Buffer,
    mapping?: Record<string, string>,
  ): Promise<{ headers: string[]; rows: any[] }> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);

    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Fichier Excel vide');

    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => headers.push(String(cell.value ?? '')));

    const rows: any[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum <= 2) return;
      const obj: any = { _rowIndex: rowNum };
      row.eachCell((cell, colNum) => {
        const header = headers[colNum - 1];
        if (!header) return;
        const mappedKey = mapping?.[header] ?? header;
        obj[mappedKey] = cell.value;
      });
      rows.push(obj);
    });

    return { headers, rows };
  }

  private async parseCSV(
    buffer: Buffer,
    mapping?: Record<string, string>,
  ): Promise<{ headers: string[]; rows: any[] }> {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV vide ou invalide');

    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0]
      .split(sep)
      .map((h) => h.trim().replace(/^"|"$/g, ''));

    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i]
        .split(sep)
        .map((v) => v.trim().replace(/^"|"$/g, ''));
      const obj: any = { _rowIndex: i + 1 };
      headers.forEach((h, idx) => {
        const mappedKey = mapping?.[h] ?? h;
        obj[mappedKey] = values[idx] ?? '';
      });
      rows.push(obj);
    }

    return { headers, rows };
  }

  async matchAndPreview(
    companyId: string,
    parsedRows: any[],
    appliedMapping: Record<string, string>,
  ): Promise<ImportPreview> {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
      },
    });

    const warnings: string[] = [];
    const results: ParsedEmployee[] = [];
    let matchedCount = 0;

    for (const row of parsedRows) {
      const parsed = this.rowToEmployee(row, appliedMapping);

      let matched = employees.find(
        (e) =>
          parsed.employeeNumber &&
          e.employeeNumber?.toLowerCase() ===
            parsed.employeeNumber.toLowerCase(),
      );

      if (!matched && parsed.lastName) {
        matched = employees.find(
          (e) =>
            e.lastName.toLowerCase() === parsed.lastName.toLowerCase() &&
            (!parsed.firstName ||
              e.firstName
                .toLowerCase()
                .startsWith(parsed.firstName.toLowerCase().slice(0, 3))),
        );
      }

      if (matched) {
        parsed.matchedEmployeeId = matched.id;
        matchedCount++;
      } else {
        parsed.matchError = `Employé "${parsed.firstName} ${parsed.lastName}" introuvable dans cette PME`;
        warnings.push(parsed.matchError);
      }

      results.push(parsed);
    }

    return {
      rows: results,
      totalRows: results.length,
      matchedCount,
      unmatchedCount: results.length - matchedCount,
      warnings,
    };
  }

  private rowToEmployee(
    row: any,
    mapping: Record<string, string>,
  ): ParsedEmployee {
    const get = (key: string): any => {
      const mappedKey = Object.entries(mapping).find(([, v]) => v === key)?.[0];
      return row[key] ?? (mappedKey ? row[mappedKey] : undefined);
    };
    const num = (key: string, def = 0) => {
      const v = get(key);
      return v !== undefined && v !== '' ? Math.max(0, Number(v) || 0) : def;
    };
    const str = (key: string) => String(get(key) ?? '').trim();

    const bonuses: Array<{ label: string; amount: number }> = [];
    const p1Label = str('prime1Label');
    const p1Amount = num('prime1Amount');
    if (p1Label && p1Amount > 0)
      bonuses.push({ label: p1Label, amount: p1Amount });
    const p2Label = str('prime2Label');
    const p2Amount = num('prime2Amount');
    if (p2Label && p2Amount > 0)
      bonuses.push({ label: p2Label, amount: p2Amount });

    return {
      employeeNumber: str('employeeNumber') || undefined,
      lastName: str('lastName'),
      firstName: str('firstName'),
      workedDays: num('workedDays', 26),
      absentDays: num('absentDays', 0),
      overtime10: num('overtime10', 0),
      overtime25: num('overtime25', 0),
      overtime50: num('overtime50', 0),
      overtime100: num('overtime100', 0),
      baseSalary: num('baseSalary', 0),
      bonuses,
      advance: num('advance', 0),
      loanDeduction: num('loanDeduction', 0),
      notes: str('notes') || undefined,
      rowIndex: row._rowIndex ?? 0,
    };
  }

  async applyImport(
    cabinetId: string,
    companyId: string,
    month: number,
    year: number,
    preview: ImportPreview,
  ): Promise<{ applied: number; skipped: number; created: number }> {
    let applied = 0;
    let skipped = 0;
    let created = 0;

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);

    for (const row of preview.rows) {
      // ── Cas PME hors-ligne : employé inconnu → créer avec données minimales ──
      if (!row.matchedEmployeeId && row.firstName && row.lastName) {
        // Tenter une dernière correspondance par nom/prénom exact (insensible à la casse)
        const found = await this.prisma.employee.findFirst({
          where: {
            companyId,
            firstName: { equals: row.firstName, mode: 'insensitive' },
            lastName: { equals: row.lastName, mode: 'insensitive' },
          },
        });
        if (found) {
          row.matchedEmployeeId = found.id;
        } else if (row.baseSalary > 0) {
          // Créer l'employé avec les données minimales du fichier
          const emp = await this.prisma.employee.create({
            data: {
              companyId,
              firstName: row.firstName,
              lastName: row.lastName,
              employeeNumber: row.employeeNumber ?? `IMP-${Date.now()}`,
              baseSalary: row.baseSalary,
              status: 'ACTIVE',
              contractType: 'CDI',
              isSubjectToCnss: true,
              isSubjectToIrpp: true,
              isSubjectToTus: true,
              maritalStatus: 'SINGLE',
              numberOfChildren: 0,
            } as any,
          });
          row.matchedEmployeeId = emp.id;
          created++;
        }
      }

      if (!row.matchedEmployeeId) {
        skipped++;
        continue;
      }

      // ── Mettre à jour le salaire de base de l'employé si fourni dans le fichier ──
      if (row.baseSalary > 0) {
        await this.prisma.employee.update({
          where: { id: row.matchedEmployeeId },
          data: { baseSalary: row.baseSalary },
        });
      }

      const existing = await this.prisma.payroll.findFirst({
        where: { employeeId: row.matchedEmployeeId, companyId, month, year },
      });

      const dataPayload = {
        workedDays: row.workedDays,
        absenceDays: row.absentDays,
        overtimeHours10: row.overtime10,
        overtimeHours25: row.overtime25,
        overtimeHours50: row.overtime50,
        overtimeHours100: row.overtime100,
        baseSalary: row.baseSalary || 0,
      };

      if (existing) {
        await this.prisma.payroll.update({
          where: { id: existing.id },
          data: dataPayload,
        });
      } else {
        await this.prisma.payroll.create({
          data: {
            ...dataPayload,
            employeeId: row.matchedEmployeeId,
            companyId,
            month,
            year,
            status: 'DRAFT',
            createdById: cabinetId,
            periodStart: periodStart,
            periodEnd: periodEnd,
            workDays: 26,
            grossSalary: 0,
            netSalary: 0,
            totalDeductions: 0,
            totalEmployerCost: 0,
          },
        });
      }
      applied++;
    }
    return { applied, skipped, created };
  }

  // --- LES MÉTHODES MANQUANTES ---
  async saveMapping(
    cabinetId: string,
    companyId: string,
    name: string,
    mapping: Record<string, string>,
  ) {
    return this.prisma.cabinetImportMapping.upsert({
      where: { cabinetId_companyId_name: { cabinetId, companyId, name } },
      create: { cabinetId, companyId, name, mapping, lastUsedAt: new Date() },
      update: { mapping, lastUsedAt: new Date() },
    });
  }

  async getMappings(cabinetId: string, companyId: string) {
    return this.prisma.cabinetImportMapping.findMany({
      where: { cabinetId, companyId },
      orderBy: { lastUsedAt: 'desc' },
    });
  }
}
