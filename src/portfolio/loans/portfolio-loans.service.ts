import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoansService } from '../../loans/loans.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';
import { CreateLoanDto } from '../../loans/dto/create-loan.dto';
import { CreateAdvanceDto } from '../../loans/dto/create-advance.dto';
import { UpdateLoanDto } from '../../loans/dto/update-loan.dto';
import { UpdateAdvanceDto } from '../../loans/dto/update-advance.dto';

// 🆕 Vue transverse "portefeuille d'entreprises" pour les prêts/avances.
// Comme PortfolioEmployeesService : jamais d'écriture directe, toujours une
// délégation vers LoansService (mêmes règles métier qu'en mono-entreprise),
// après vérification que l'entreprise de l'employé ciblé appartient à l'admin.
@Injectable()
export class PortfolioLoansService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
    private loansService: LoansService,
  ) {}

  // Liste transverse (prêts + avances), filtrable par entreprise et par statut.
  async search(
    userId: string,
    filters: { companyId?: string; status?: string; type?: 'loan' | 'advance' },
  ) {
    await this.membership.assertCanUsePortfolio(userId);

    let companyIds: string[];
    if (filters.companyId) {
      await this.membership.assertCompanyMembership(userId, filters.companyId);
      companyIds = [filters.companyId];
    } else {
      companyIds = await this.membership.getLinkedCompanyIds(userId);
    }
    if (companyIds.length === 0) return { loans: [], advances: [] };

    const employeeWhere = { employee: { companyId: { in: companyIds } } };
    const statusWhere = filters.status ? { status: filters.status } : {};

    const [loans, advances] = await Promise.all([
      filters.type === 'advance'
        ? []
        : this.prisma.loan.findMany({
            where: { ...employeeWhere, ...statusWhere } as any,
            include: {
              employee: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  companyId: true,
                  company: { select: { id: true, legalName: true, tradeName: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
      filters.type === 'loan'
        ? []
        : this.prisma.advance.findMany({
            where: { ...employeeWhere, ...statusWhere } as any,
            include: {
              employee: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  companyId: true,
                  company: { select: { id: true, legalName: true, tradeName: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
    ]);

    return { loans, advances };
  }

  private async getEmployeeCompanyId(employeeId: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');
    return employee.companyId;
  }

  private async getLoanEmployeeCompanyId(loanId: string): Promise<string> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      select: { employee: { select: { companyId: true } } },
    });
    if (!loan) throw new NotFoundException('Prêt introuvable.');
    return loan.employee.companyId;
  }

  private async getAdvanceEmployeeCompanyId(advanceId: string): Promise<string> {
    const advance = await this.prisma.advance.findUnique({
      where: { id: advanceId },
      select: { employee: { select: { companyId: true } } },
    });
    if (!advance) throw new NotFoundException('Avance introuvable.');
    return advance.employee.companyId;
  }

  async createLoan(userId: string, dto: CreateLoanDto) {
    if (!dto.employeeId)
      throw new NotFoundException(
        'employeeId est requis pour créer un prêt depuis le portefeuille.',
      );
    const companyId = await this.getEmployeeCompanyId(dto.employeeId);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.createLoan(dto, userId, companyId);
  }

  async createAdvance(userId: string, dto: CreateAdvanceDto) {
    if (!dto.employeeId)
      throw new NotFoundException(
        'employeeId est requis pour créer une avance depuis le portefeuille.',
      );
    const companyId = await this.getEmployeeCompanyId(dto.employeeId);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.createAdvance(dto, userId, companyId);
  }

  async findOneLoan(userId: string, id: string) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.findOneLoan(id, userId, companyId);
  }

  async findOneAdvance(userId: string, id: string) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.findOneAdvance(id, userId, companyId);
  }

  async decideLoan(
    userId: string,
    id: string,
    decision: 'OUI' | 'NON',
    rejectionReason?: string,
    recoverViaPayroll = true,
  ) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.decideLoan(
      id,
      decision,
      userId,
      rejectionReason,
      recoverViaPayroll,
      companyId,
    );
  }

  async decideAdvance(
    userId: string,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
    recoverViaPayroll = true,
  ) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.decideAdvance(
      id,
      decision,
      userId,
      rejectionReason,
      recoverViaPayroll,
      companyId,
    );
  }

  // ── Prêts : édition / suppression / annulation ──────────────────────────
  async updateLoan(userId: string, id: string, dto: UpdateLoanDto) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.updateLoan(id, dto, userId, companyId);
  }

  async deleteLoan(userId: string, id: string) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.deleteLoan(id, userId, companyId);
  }

  async cancelLoan(userId: string, id: string) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.cancelLoan(id, userId, companyId);
  }

  // ── Avances : édition / suppression / annulation ────────────────────────
  async updateAdvance(userId: string, id: string, dto: UpdateAdvanceDto) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.updateAdvance(id, dto, userId, companyId);
  }

  async deleteAdvance(userId: string, id: string) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.deleteAdvance(id, userId, companyId);
  }

  async cancelAdvance(userId: string, id: string) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.cancelAdvance(id, userId, companyId);
  }

  // ── Remboursement / historique — prêts ──────────────────────────────────
  async recordCashRepayment(userId: string, id: string, amount: number) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.recordCashRepayment(id, amount, userId, companyId);
  }

  async deleteCashRepayment(userId: string, id: string, logId: string) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.deleteCashRepayment(id, logId, userId, companyId);
  }

  async getLoanHistory(userId: string, id: string) {
    const companyId = await this.getLoanEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.getLoanHistory(id, userId, companyId);
  }

  // ── Remboursement / historique — avances ────────────────────────────────
  async recordAdvanceCashRepayment(userId: string, id: string, amount: number) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.recordAdvanceCashRepayment(id, amount, userId, companyId);
  }

  async deleteAdvanceCashRepayment(userId: string, id: string, logId: string) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.deleteAdvanceCashRepayment(id, logId, userId, companyId);
  }

  async getAdvanceHistory(userId: string, id: string) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.getAdvanceHistory(id, userId, companyId);
  }

  async markAdvancePaidInCash(userId: string, id: string) {
    const companyId = await this.getAdvanceEmployeeCompanyId(id);
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.loansService.markAdvancePaidInCash(id, userId, companyId);
  }
}