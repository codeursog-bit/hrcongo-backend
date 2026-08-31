// ============================================================================
// 📁 src/company-taxes/company-tax.service.ts
// ✅ CRUD complet — isolé par companyId (chaque entreprise voit uniquement les siennes)
// ✅ Utilisé par payroll-calculator pour appliquer les taxes custom au calcul
// ============================================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCompanyTaxDto,
  UpdateCompanyTaxDto,
} from './dto/company-tax.dto';

@Injectable()
export class CompanyTaxService {
  private readonly logger = new Logger(CompanyTaxService.name);

  constructor(private prisma: PrismaService) {}

  // ── Récupérer le companyId de l'utilisateur ─────────────────────────────
  private async getCompanyId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });

    if (!user?.companyId)
      throw new ForbiddenException('Aucune entreprise associée');
    return user.companyId;
  }

  // ── Vérifier que la taxe appartient bien à l'entreprise ─────────────────
  private async assertOwnership(taxId: string, companyId: string) {
    const tax = await this.prisma.companyTax.findUnique({
      where: { id: taxId },
    });
    if (!tax) throw new NotFoundException(`Taxe ${taxId} introuvable`);
    if (tax.companyId !== companyId)
      throw new ForbiddenException('Accès refusé');
    return tax;
  }

  // ============================================================================
  // CREATE — POST /company-taxes
  // ============================================================================
  async create(userId: string, dto: CreateCompanyTaxDto) {
    const companyId = await this.getCompanyId(userId);

    // Vérifier unicité du code dans l'entreprise
    const existing = await this.prisma.companyTax.findFirst({
      where: { companyId, code: dto.code.toUpperCase() },
    });
    if (existing) {
      throw new ConflictException(
        `Une taxe avec le code "${dto.code}" existe déjà pour votre entreprise`,
      );
    }

    const tax = await this.prisma.companyTax.create({
      data: {
        companyId,
        name: dto.name,
        code: dto.code.toUpperCase(),
        description: dto.description ?? null,
        employeeRate: dto.employeeRate ?? 0,
        fixedEmployee: dto.fixedEmployee ?? 0,
        employerRate: dto.employerRate ?? 0,
        fixedEmployer: dto.fixedEmployer ?? 0,
        baseType: dto.baseType ?? 'GROSS',
        hasCeiling: dto.hasCeiling ?? false,
        ceiling: dto.ceiling ?? null,
        isActive: dto.isActive ?? true,
        minSalaryThreshold: dto.minSalaryThreshold ?? null,
        thresholdType: dto.thresholdType ?? 'ELIGIBILITY',
      },
    });

    this.logger.log(
      `✅ Taxe créée : ${tax.code} (${tax.name}) pour company ${companyId}`,
    );
    return tax;
  }

  // ============================================================================
  // FIND ALL — GET /company-taxes
  // ============================================================================
  async findAll(userId: string) {
    const companyId = await this.getCompanyId(userId);

    return this.prisma.companyTax.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  // ============================================================================
  // FIND ACTIVE — pour le calculateur de paie
  // ============================================================================
  async findActive(companyId: string) {
    return this.prisma.companyTax.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // ============================================================================
  // FIND ONE — GET /company-taxes/:id
  // ============================================================================
  async findOne(userId: string, taxId: string) {
    const companyId = await this.getCompanyId(userId);
    return this.assertOwnership(taxId, companyId);
  }

  // ============================================================================
  // UPDATE — PATCH /company-taxes/:id
  // ============================================================================
  async update(userId: string, taxId: string, dto: UpdateCompanyTaxDto) {
    const companyId = await this.getCompanyId(userId);
    await this.assertOwnership(taxId, companyId);

    const updated = await this.prisma.companyTax.update({
      where: { id: taxId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.employeeRate !== undefined && {
          employeeRate: dto.employeeRate,
        }),
        ...(dto.fixedEmployee !== undefined && {
          fixedEmployee: dto.fixedEmployee,
        }),
        ...(dto.employerRate !== undefined && {
          employerRate: dto.employerRate,
        }),
        ...(dto.fixedEmployer !== undefined && {
          fixedEmployer: dto.fixedEmployer,
        }),
        ...(dto.baseType !== undefined && { baseType: dto.baseType }),
        ...(dto.hasCeiling !== undefined && { hasCeiling: dto.hasCeiling }),
        ...(dto.ceiling !== undefined && { ceiling: dto.ceiling }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.minSalaryThreshold !== undefined && {
          minSalaryThreshold: dto.minSalaryThreshold,
        }),
        ...(dto.thresholdType !== undefined && {
          thresholdType: dto.thresholdType,
        }),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`✅ Taxe mise à jour : ${updated.code} (${updated.name})`);
    return updated;
  }

  // ============================================================================
  // TOGGLE — PATCH /company-taxes/:id/toggle
  // ============================================================================
  async toggle(userId: string, taxId: string) {
    const companyId = await this.getCompanyId(userId);
    const tax = await this.assertOwnership(taxId, companyId);

    const updated = await this.prisma.companyTax.update({
      where: { id: taxId },
      data: { isActive: !tax.isActive, updatedAt: new Date() },
    });

    this.logger.log(
      `🔄 Taxe ${updated.code} : ${updated.isActive ? 'activée' : 'désactivée'}`,
    );
    return updated;
  }

  // ============================================================================
  // DELETE — DELETE /company-taxes/:id
  // ============================================================================
  async remove(userId: string, taxId: string) {
    const companyId = await this.getCompanyId(userId);
    await this.assertOwnership(taxId, companyId);

    await this.prisma.companyTax.delete({ where: { id: taxId } });
    this.logger.log(`🗑️ Taxe ${taxId} supprimée`);
    return { success: true, message: 'Taxe supprimée avec succès' };
  }

  // ============================================================================
  // CALCULER LES TAXES CUSTOM — appelé par payroll-calculator
  // ============================================================================
  calculateCustomTaxes(
    taxes: any[],
    grossSalary: number,
    taxableSalary: number, // brut − CNSS
    netImposable: number, // après abattement
  ): {
    employeeTotal: number;
    employerTotal: number;
    details: Array<{
      id: string;
      name: string;
      code: string;
      employeeAmount: number;
      employerAmount: number;
      base: number;
      rate: number;
    }>;
  } {
    let employeeTotal = 0;
    let employerTotal = 0;
    const details: any[] = [];

    for (const tax of taxes) {
      // Déterminer la base
      let base = 0;
      if (tax.baseType === 'GROSS') base = grossSalary;
      else if (tax.baseType === 'TAXABLE') base = taxableSalary;
      else if (tax.baseType === 'NET_IMPOSABLE') base = netImposable;
      else if (tax.baseType === 'FIXED') base = 1; // montant fixe direct

      // Appliquer le plafond
      if (tax.hasCeiling && tax.ceiling) {
        base = Math.min(base, Number(tax.ceiling));
      }

      // Calculer les montants
      let employeeAmount = 0;
      let employerAmount = 0;

      if (tax.baseType === 'FIXED') {
        // Montant fixe : ignorer les taux, utiliser directement fixedEmployee/fixedEmployer
        employeeAmount = Number(tax.fixedEmployee ?? 0);
        employerAmount = Number(tax.fixedEmployer ?? 0);
      } else {
        // Taux en % + éventuels montants fixes additionnels
        employeeAmount =
          Math.round(base * Number(tax.employeeRate ?? 0)) +
          Number(tax.fixedEmployee ?? 0);
        employerAmount =
          Math.round(base * Number(tax.employerRate ?? 0)) +
          Number(tax.fixedEmployer ?? 0);
      }

      employeeTotal += employeeAmount;
      employerTotal += employerAmount;

      details.push({
        id: tax.id,
        name: tax.name,
        code: tax.code,
        employeeAmount,
        employerAmount,
        base,
        rate: Number(tax.employeeRate ?? 0) + Number(tax.employerRate ?? 0),
      });
    }

    return { employeeTotal, employerTotal, details };
  }
}
