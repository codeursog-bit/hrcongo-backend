import { Injectable } from '@nestjs/common';
import { AbsenceTrackingService } from '../../absence-tracking/absence-tracking.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';

// 🆕 Vue transverse "portefeuille d'entreprises" pour le tableau de bord
// absences (grille mensuelle, dashboard, journal, vue annuelle).
// Ces tableaux sont déjà agrégés par entreprise — on choisit l'entreprise
// du portefeuille à consulter, comme un onglet, plutôt que de tout mélanger.
@Injectable()
export class PortfolioAbsenceTrackingService {
  constructor(
    private membership: PortfolioMembershipService,
    private tracking: AbsenceTrackingService,
  ) {}

  async getMonthlyGrid(
    userId: string,
    companyId: string,
    year: number,
    month: number,
    departmentId?: string,
  ) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.tracking.getMonthlyGrid(userId, year, month, departmentId, 'all', companyId);
  }

  async getMonthlyDashboard(userId: string, companyId: string, year: number, month: number) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.tracking.getMonthlyDashboard(userId, year, month, 'all', companyId);
  }

  async getMonthJournal(userId: string, companyId: string, year: number, month: number) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.tracking.getMonthJournal(userId, year, month, 'all', companyId);
  }

  async getYearlyOverview(userId: string, companyId: string, year: number) {
    await this.membership.assertCompanyMembership(userId, companyId);
    return this.tracking.getYearlyOverview(userId, year, 'all', companyId);
  }
}