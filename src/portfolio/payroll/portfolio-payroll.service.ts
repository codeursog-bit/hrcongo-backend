import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollsService } from '../../payrolls/payrolls.service';
import { ManualPayrollService } from '../../payrolls/services/manual-payroll.service';
import type { CreateManualPayrollDto } from '../../payrolls/services/manual-payroll.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';
import { CreatePayrollDto } from '../../payrolls/dto/create-payroll.dto';

// 🆕 Nombre max d'employés traités par appel à la génération en masse — le
// front (page "Paie en masse") découpe automatiquement en lots de cette
// taille et boucle jusqu'à traiter tout le monde, pour ne jamais surcharger
// une seule requête ni "oublier" d'employés au-delà d'un lot.
export const MASS_PAYROLL_BATCH_SIZE = 60;

// 🆕 Vue transverse "portefeuille d'entreprises" pour la paie.
// Même principe que PortfolioEmployeesService/PortfolioLoansService : jamais
// d'écriture directe, toujours une délégation vers PayrollsService (mêmes
// règles métier qu'en mono-entreprise), après vérification que l'entreprise
// ciblée appartient bien à l'admin.
//
// Volontairement laissé hors de ce premier périmètre (comme convenu pour
// prêts/avances) : modification/suppression de bulletin, recalcul,
// simulation, journal comptable, récap déclarations, exports. Le cœur du
// cycle (générer, consulter, lister) est couvert ici.
@Injectable()
export class PortfolioPayrollService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
    private payrollsService: PayrollsService,
    private manualPayrollService: ManualPayrollService,
  ) {}

  // Liste transverse des bulletins, filtrable par entreprise/mois/année.
  async search(
    userId: string,
    filters: { companyId?: string; month?: number; year?: number },
  ) {
    await this.membership.assertCanUsePortfolio(userId);

    let companyIds: string[];
    if (filters.companyId) {
      await this.membership.assertCompanyMembership(userId, filters.companyId);
      companyIds = [filters.companyId];
    } else {
      companyIds = await this.membership.getLinkedCompanyIds(userId);
    }
    if (companyIds.length === 0) return [];

    return this.prisma.payroll.findMany({
      where: {
        companyId: { in: companyIds },
        ...(filters.month ? { month: filters.month } : {}),
        ...(filters.year ? { year: filters.year } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            position: true,
          },
        },
        company: { select: { id: true, legalName: true, tradeName: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async findOne(userId: string, id: string) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!payroll) throw new NotFoundException('Bulletin introuvable.');
    await this.membership.assertCompanyMembership(userId, payroll.companyId);
    return this.payrollsService.findOne(id, userId, payroll.companyId);
  }

  private async resolveCompanyIdFromEmployee(
    providedCompanyId: string | undefined,
    employeeId: string | undefined,
  ): Promise<string> {
    if (providedCompanyId) return providedCompanyId;
    if (!employeeId) throw new NotFoundException('employeeId est requis.');
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');
    return employee.companyId;
  }

  // Création d'un bulletin unique pour un employé — companyId déduit de
  // l'employé ciblé si non fourni.
  async create(userId: string, dto: CreatePayrollDto) {
    const companyId = await this.resolveCompanyIdFromEmployee(
      (dto as any).companyId,
      (dto as any).employeeId,
    );
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.payrollsService.create(
      { ...dto, companyId } as CreatePayrollDto,
      userId,
    );
  }

  // ── Paie manuelle (sans pointeuse) ──────────────────────────────────────
  async simulateManual(userId: string, dto: CreateManualPayrollDto) {
    const companyId = await this.resolveCompanyIdFromEmployee(
      dto.companyId,
      dto.employeeId,
    );
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.manualPayrollService.simulate(
      { ...dto, companyId },
      userId,
    );
  }

  async saveManual(userId: string, dto: CreateManualPayrollDto) {
    const companyId = await this.resolveCompanyIdFromEmployee(
      dto.companyId,
      dto.employeeId,
    );
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.manualPayrollService.save({ ...dto, companyId }, userId);
  }

  // Génération du lot mensuel pour UNE entreprise du portefeuille (pas de
  // génération multi-entreprises en un seul appel — on choisit l'entreprise
  // cible, comme on le ferait en entrant dans son interface).
  async generateMonthlyPayrolls(
    userId: string,
    companyId: string,
    month: number,
    year: number,
    employeeIds?: string[],
    customWorkDays?: number,
  ) {
    await this.membership.assertCompanyMembership(userId, companyId);
    // 🆕 Garde-fou serveur : même si le front est censé découper en lots de
    // MASS_PAYROLL_BATCH_SIZE, on refuse un appel surdimensionné plutôt que
    // de risquer de surcharger le calcul de paie en une seule requête.
    if (employeeIds && employeeIds.length > MASS_PAYROLL_BATCH_SIZE) {
      throw new BadRequestException(
        `Trop d'employés pour un seul appel (max ${MASS_PAYROLL_BATCH_SIZE}). Découpez en plusieurs lots.`,
      );
    }
    return this.payrollsService.generateMonthlyPayrolls(
      userId,
      month,
      year,
      employeeIds,
      customWorkDays,
      undefined,
      companyId,
    );
  }

  // ── Gestion des bulletins déjà générés (liste de paie) ──────────────────
  async updateStatus(userId: string, id: string, status: 'PAID' | 'VALIDATED' | 'CANCELLED') {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!payroll) throw new NotFoundException('Bulletin introuvable.');
    await this.membership.assertCompanyMembership(userId, payroll.companyId);
    return this.payrollsService.update(id, { status } as any, userId, payroll.companyId);
  }

  async remove(userId: string, id: string) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!payroll) throw new NotFoundException('Bulletin introuvable.');
    await this.membership.assertCompanyMembership(userId, payroll.companyId);
    return this.payrollsService.remove(id);
  }
}