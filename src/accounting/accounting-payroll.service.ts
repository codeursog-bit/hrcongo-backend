// ============================================================================
// 📁 src/accounting/accounting-payroll.service.ts
// Règlements de paie et provision de congés (entreprise connectée).
// ============================================================================
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { LegalParametersService } from '../legal-parameters/legal-parameters.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { ACCOUNTABLE_STATUSES } from '../compta-connector/payroll-contract';
import { buildSettlementEntries } from './payroll-settlements';
import { leaveProvisionEntries } from './leave-provision';

@Injectable()
export class AccountingPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legal: LegalParametersService,
    private readonly discovery: DiscoveryService,
    private readonly subscriptionGuard: SubscriptionGuard,
  ) {}

  private async company(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
    if (!user?.companyId) throw new NotFoundException('Entreprise introuvable.');
    await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasPayrollAccountingExport');
    return user.companyId;
  }

  private async mappings(companyId: string): Promise<Record<string, string> | null> {
    try {
      const link = await (this.prisma as any).comptaConnector?.findUnique({ where: { companyId } });
      return (link?.mappings as Record<string, string>) ?? null;
    } catch { return null; }
  }

  async settlements(userId: string, month: number, year: number, netPaidOnly = true) {
    const companyId = await this.company(userId);
    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year, status: { in: [...ACCOUNTABLE_STATUSES] } } as any,
      include: { items: { orderBy: [{ order: 'asc' }, { id: 'asc' }] }, employee: { select: { id: true, firstName: true, lastName: true, nationality: true } } },
    });
    const { entries, issues } = buildSettlementEntries(payrolls as any, await this.mappings(companyId), { year, month, netPaidOnly });
    return { month, year, netPaidOnly, totalEntries: entries.length, entries, issues };
  }

  /**
   * Stock de congés à payer (XAF) calculé par le module Congés. Le service est retrouvé
   * par son nom dans l'application (aucun import de chemin : indépendant de l'organisation des dossiers).
   */
  private async loadLeaveProvision(companyId: string): Promise<{ totalProvision: number }> {
    const holder = this.discovery
      .getProviders()
      .find((w) => w.metatype?.name === 'LeavesService' && typeof (w.instance as any)?.getLeaveProvision === 'function');
    if (!holder) throw new BadRequestException('Service Congés introuvable (LeavesService.getLeaveProvision).');
    try {
      return await (holder.instance as any).getLeaveProvision(companyId);
    } catch (e) {
      throw new BadRequestException('Calcul des congés indisponible : ' + (e as Error).message);
    }
  }

  /** `previous` = stock de congés à payer déjà comptabilisé (XAF) ; 0 pour une première comptabilisation. */
  async leaveProvision(userId: string, dateKey: string, previous: number) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new BadRequestException('date=AAAA-MM-JJ requis');
    const companyId = await this.company(userId);
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    const provision = await this.loadLeaveProvision(companyId);
    const stock = Math.round(Number(provision.totalProvision) || 0);
    const c = this.legal.getAt(date).cnss;
    const rate = c.employerPensionRate + c.employerFamilyRate + c.employerAccidentRate;
    const entries = leaveProvisionEntries({ stock, previousStock: previous, employerSocialRate: rate, date, mappings: await this.mappings(companyId) });
    return { date: dateKey, stock, previousStock: previous, employerSocialRate: rate, entries };
  }
}