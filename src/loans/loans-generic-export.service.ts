// ============================================================================
// 📁 loans-generic-export.service.ts
// ✅ Export Excel GÉNÉRIQUE du suivi des dettes — indépendant du format
//    Orca (celui-ci n'est qu'un modèle spécifique à un client). Construit
//    un classeur de zéro (pas de template), une ligne par dette validée,
//    avec les mêmes filtres que la page Suivi des dettes (mois/année/
//    département/type).
// ============================================================================

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { LoansCommonService } from './loans-common.service';

export type DebtTrackingFilters = {
  month?: number;
  year: number;
  department?: string;
  type?: string;
};

@Injectable()
export class LoansGenericExportService {
  constructor(
    private prisma: PrismaService,
    private common: LoansCommonService,
  ) {}

  private async getValidatedDebts(
    userId: string,
    filters: DebtTrackingFilters,
  ) {
    const user = await this.common.getVerifiedUser(userId);
    this.common.requireFinanceAccess(user.role);

    const { month, year, department, type } = filters;
    const dateRange = month
      ? { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) }
      : { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };

    const loans =
      type === 'AVANCE'
        ? []
        : await this.prisma.loan.findMany({
            where: {
              employee: {
                companyId: user.companyId,
                ...(department ? { department: { name: department } } : {}),
              },
              status: { in: ['ACTIVE', 'PAID'] },
              createdAt: dateRange,
              ...(type ? { type: type as any } : {}),
            },
            include: { employee: { select: this.common.employeeSelect } },
            orderBy: { createdAt: 'desc' },
          });

    const advances =
      type && type !== 'AVANCE'
        ? []
        : await this.prisma.advance.findMany({
            where: {
              employee: {
                companyId: user.companyId,
                ...(department ? { department: { name: department } } : {}),
              },
              status: { in: ['APPROVED', 'DEDUCTED', 'PAID'] },
              createdAt: dateRange,
            },
            include: { employee: { select: this.common.employeeSelect } },
            orderBy: { createdAt: 'desc' },
          });

    return { loans, advances };
  }

  async exportDebtTrackingXlsx(
    userId: string,
    filters: DebtTrackingFilters,
  ): Promise<Buffer> {
    const { loans, advances } = await this.getValidatedDebts(userId, filters);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Suivi des dettes');

    ws.columns = [
      { header: 'Employé', key: 'employe', width: 26 },
      { header: 'Matricule', key: 'matricule', width: 14 },
      { header: 'Département', key: 'departement', width: 20 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Montant', key: 'montant', width: 16 },
      { header: 'Mensualité', key: 'mensualite', width: 16 },
      { header: 'Reste à payer', key: 'reste', width: 16 },
      { header: 'Statut', key: 'statut', width: 14 },
      { header: 'Date', key: 'date', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };

    const STATUS_LABEL: Record<string, string> = {
      ACTIVE: 'Actif',
      PAID: 'Soldé',
      APPROVED: 'Approuvée',
      DEDUCTED: 'Déduite',
    };
    const TYPE_LABEL: Record<string, string> = {
      ARGENT: 'Prêt argent',
      MARCHANDISE: 'Marchandise',
      AUTRE: 'Autre prêt',
    };

    loans.forEach((l) => {
      ws.addRow({
        employe: `${l.employee.firstName} ${l.employee.lastName}`,
        matricule: l.employee.employeeNumber ?? '',
        departement: l.employee.department?.name ?? '',
        type: TYPE_LABEL[l.type] ?? l.type,
        montant: Number(l.amount),
        mensualite: Number(l.monthlyRepayment),
        reste: Number(l.remainingBalance),
        statut: STATUS_LABEL[l.status] ?? l.status,
        date: new Date(l.createdAt).toLocaleDateString('fr-FR'),
      });
    });
    advances.forEach((a) => {
      ws.addRow({
        employe: `${a.employee.firstName} ${a.employee.lastName}`,
        matricule: a.employee.employeeNumber ?? '',
        departement: a.employee.department?.name ?? '',
        type: 'Avance sur salaire',
        montant: Number(a.amount),
        mensualite: '',
        reste: ['APPROVED'].includes(a.status) ? Number(a.amount) : 0,
        statut: STATUS_LABEL[a.status] ?? a.status,
        date: new Date(a.createdAt).toLocaleDateString('fr-FR'),
      });
    });

    ['montant', 'mensualite', 'reste'].forEach((key) => {
      ws.getColumn(key).numFmt = '#,##0 "FCFA"';
    });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }
}
