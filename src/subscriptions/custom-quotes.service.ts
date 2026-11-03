// ============================================================================
// src/subscriptions/custom-quotes.service.ts
// Paiement « sur devis » : montant négocié enregistré par le super admin.
// Au paiement, l'abonnement s'active avec le plan + la durée du devis.
// ============================================================================

import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PAID_PLANS } from './pricing.service';

@Injectable()
export class CustomQuotesService {
  private readonly logger = new Logger(CustomQuotesService.name);

  constructor(private prisma: PrismaService) {}

  /** Devis actif et non expiré de l'entreprise (le plus récent). */
  async findActiveForCompany(companyId: string) {
    return (this.prisma as any).customQuote.findFirst({
      where: {
        companyId,
        status: 'ACTIVE',
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Appelé quand le paiement est SUCCEEDED : un devis non récurrent est consommé. */
  async markPaid(quoteId: string) {
    const quote = await (this.prisma as any).customQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.isRecurring || quote.status !== 'ACTIVE') return;
    await (this.prisma as any).customQuote.update({
      where: { id: quoteId },
      data: { status: 'USED', usedAt: new Date() },
    });
  }

  // ─── Super admin ──────────────────────────────────────────────────────────

  async create(
    dto: {
      companyId: string;
      plan: string;
      amount: number;
      months?: number;
      isRecurring?: boolean;
      validUntil?: string;
      note?: string;
    },
    actorUserId: string,
  ) {
    if (!PAID_PLANS.includes(dto.plan as any)) {
      throw new BadRequestException('Le plan doit être BASIC, PRO ou ENTERPRISE');
    }
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId }, select: { id: true } });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    if (await this.findActiveForCompany(dto.companyId)) {
      throw new ConflictException('Un devis actif existe déjà pour cette entreprise — annulez-le d\'abord');
    }

    return (this.prisma as any).customQuote.create({
      data: {
        companyId: dto.companyId,
        plan: dto.plan,
        amount: dto.amount,
        months: dto.months ?? 1,
        isRecurring: dto.isRecurring ?? false,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        note: dto.note ?? null,
        createdByUserId: actorUserId,
      },
    });
  }

  async list(companyId?: string) {
    return (this.prisma as any).customQuote.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { company: { select: { id: true, legalName: true, tradeName: true } } },
    });
  }

  async cancel(id: string) {
    const quote = await (this.prisma as any).customQuote.findUnique({ where: { id } });
    if (!quote) throw new NotFoundException('Devis introuvable');
    if (quote.status !== 'ACTIVE') throw new BadRequestException('Seul un devis actif peut être annulé');
    return (this.prisma as any).customQuote.update({ where: { id }, data: { status: 'CANCELED' } });
  }
}
