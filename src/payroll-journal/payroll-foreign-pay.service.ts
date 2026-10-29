// ============================================================================
// 📁 src/payroll-journal/payroll-foreign-pay.service.ts
// ✅ Paie des expatriés — V1 : saisie manuelle du brut et du net perçus
//    à l'étranger (FCFA). Le Congo reste calculé par le moteur de paie
//    habituel ; ici on ne stocke QUE la part étrangère.
//    1 ligne = 1 employé × 1 mois × 1 pays → un même expatrié peut avoir
//    2 ou 3 rémunérations (France, USA...) dans le même mois.
//    Enregistrer deux fois le même (employé, mois, pays) ÉCRASE la ligne
//    existante (jamais de doublon).
// ============================================================================
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import { UpsertForeignPayDto } from './dto/foreign-pay.dto';

export interface ForeignPayView {
  id: string;
  employeeId: string;
  month: number;
  year: number;
  countryCode: string;
  countryName: string;
  payerName: string | null;
  grossAmount: number;
  netAmount: number;
  note: string | null;
}

export function toForeignPayView(r: any): ForeignPayView {
  return {
    id: r.id,
    employeeId: r.employeeId,
    month: r.month,
    year: r.year,
    countryCode: r.countryCode,
    countryName: r.countryName,
    payerName: r.payerName ?? null,
    grossAmount: Number(r.grossAmount),
    netAmount: Number(r.netAmount),
    note: r.note ?? null,
  };
}

@Injectable()
export class PayrollForeignPayService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCompanyId(
    userId: string,
    overrideCompanyId?: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        companyId: true,
        role: true,
        manageMultipleCompanies: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const companyId = await resolveVerifiedCompanyId(
      this.prisma,
      user,
      overrideCompanyId,
    );
    if (!companyId) throw new BadRequestException('Entreprise introuvable.');
    return companyId;
  }

  /** Liste des paies étrangères d'un mois (toute l'entreprise). */
  async list(
    userId: string,
    month: number,
    year: number,
    overrideCompanyId?: string,
  ): Promise<ForeignPayView[]> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    const rows = await this.prisma.payrollForeignPay.findMany({
      where: { companyId, month, year },
      orderBy: [{ employeeId: 'asc' }, { countryCode: 'asc' }],
    });
    return rows.map(toForeignPayView);
  }

  /** Crée ou remplace la ligne (employé, mois, année, pays). */
  async upsert(
    userId: string,
    dto: UpsertForeignPayDto,
    overrideCompanyId?: string,
  ): Promise<ForeignPayView> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);

    // 🔒 L'employé doit appartenir à l'entreprise vérifiée
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('Employé introuvable dans cette entreprise.');
    }

    const countryCode = dto.countryCode.trim().toUpperCase();
    if (countryCode === 'CG') {
      throw new BadRequestException(
        'La paie du Congo est calculée par la paie normale : saisissez ici uniquement la rémunération perçue à l\'étranger.',
      );
    }

    const data = {
      countryName: dto.countryName.trim(),
      payerName: dto.payerName?.trim() || null,
      grossAmount: Math.round(dto.grossAmount),
      netAmount: Math.round(dto.netAmount),
      note: dto.note?.trim() || null,
      updatedBy: userId,
    };

    const row = await this.prisma.payrollForeignPay.upsert({
      where: {
        employeeId_year_month_countryCode: {
          employeeId: dto.employeeId,
          year: dto.year,
          month: dto.month,
          countryCode,
        },
      },
      create: {
        ...data,
        companyId,
        employeeId: dto.employeeId,
        month: dto.month,
        year: dto.year,
        countryCode,
        createdBy: userId,
      },
      update: data,
    });
    return toForeignPayView(row);
  }

  /** Supprime une ligne (vérifie qu'elle appartient à l'entreprise). */
  async remove(
    userId: string,
    id: string,
    overrideCompanyId?: string,
  ): Promise<{ deleted: true }> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    const existing = await this.prisma.payrollForeignPay.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Ligne introuvable.');
    await this.prisma.payrollForeignPay.delete({ where: { id } });
    return { deleted: true };
  }
}