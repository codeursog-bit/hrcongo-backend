// ============================================================================
// src/subscriptions/custom-quotes.service.ts
// Paiement « sur devis » : montant négocié enregistré par le super admin.
// Au paiement, l'abonnement s'active avec le plan + la durée du devis.
//
// Devis « portefeuille » (coversPortfolio = true) : réservé aux comptes
// multi-entreprises. UN seul paiement active l'abonnement de TOUTES les
// entreprises liées au propriétaire du portefeuille (portfolioOwnerId).
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

  /**
   * Entreprises couvertes par un devis « portefeuille » : celles liées au
   * propriétaire (UserCompany) + l'entreprise du devis, hors entreprises
   * désactivées/archivées. Retourne [] pour un devis classique.
   * Lève une erreur claire si le devis n'est plus valide (le compte n'est plus
   * multi-entreprises, a été désactivé, ou détaché de l'entreprise du devis).
   */
  async resolveCoveredCompanies(quote: {
    companyId: string;
    coversPortfolio?: boolean;
    portfolioOwnerId?: string | null;
  }): Promise<{ id: string; name: string }[]> {
    if (!quote.coversPortfolio) return [];
    if (!quote.portfolioOwnerId) {
      throw new BadRequestException('Devis portefeuille sans propriétaire — contactez le support.');
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: quote.portfolioOwnerId },
      select: { id: true, isActive: true, manageMultipleCompanies: true, companyId: true },
    });
    if (!owner || !owner.isActive || !owner.manageMultipleCompanies) {
      throw new BadRequestException(
        "Ce devis ne peut plus être utilisé : le compte multi-entreprises associé n'est plus actif. Contactez le support.",
      );
    }

    const links = await this.prisma.userCompany.findMany({
      where: { userId: owner.id },
      select: {
        company: {
          select: { id: true, legalName: true, tradeName: true, isActive: true, archivedAt: true },
        },
      },
    });

    const linkedIds = new Set(links.map((l) => l.company.id));
    if (!linkedIds.has(quote.companyId) && owner.companyId !== quote.companyId) {
      throw new BadRequestException(
        "Ce devis ne peut plus être utilisé : le compte n'est plus lié à l'entreprise du devis. Contactez le support.",
      );
    }

    const result = new Map<string, string>();
    for (const { company } of links) {
      if (!company.isActive || company.archivedAt) continue;
      result.set(company.id, company.tradeName || company.legalName);
    }

    // L'entreprise du devis est toujours incluse (c'est celle qui paie)
    if (!result.has(quote.companyId)) {
      const own = await this.prisma.company.findUnique({
        where: { id: quote.companyId },
        select: { legalName: true, tradeName: true },
      });
      if (own) result.set(quote.companyId, own.tradeName || own.legalName);
    }

    return [...result.entries()].map(([id, name]) => ({ id, name }));
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
      coversPortfolio?: boolean;
      portfolioOwnerId?: string;
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

    // ── Devis portefeuille : le propriétaire doit être un compte multi-entreprises lié à l'entreprise ──
    if (dto.coversPortfolio) {
      if (!dto.portfolioOwnerId) {
        throw new BadRequestException('Choisissez le compte multi-entreprises concerné');
      }
      const owner = await this.prisma.user.findUnique({
        where: { id: dto.portfolioOwnerId },
        select: { id: true, isActive: true, manageMultipleCompanies: true, companyId: true },
      });
      if (!owner || !owner.isActive) throw new NotFoundException('Compte introuvable ou désactivé');
      if (!owner.manageMultipleCompanies) {
        throw new BadRequestException("Ce compte n'est pas un compte multi-entreprises");
      }
      const link = await this.prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: owner.id, companyId: dto.companyId } },
        select: { id: true },
      });
      if (!link && owner.companyId !== dto.companyId) {
        throw new BadRequestException("Ce compte n'est pas lié à l'entreprise du devis");
      }
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
        coversPortfolio: dto.coversPortfolio ?? false,
        portfolioOwnerId: dto.coversPortfolio ? dto.portfolioOwnerId : null,
        createdByUserId: actorUserId,
      },
    });
  }

  async list(companyId?: string) {
    const quotes: any[] = await (this.prisma as any).customQuote.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { company: { select: { id: true, legalName: true, tradeName: true } } },
    });

    // Pour les devis portefeuille : propriétaire + entreprises couvertes (aperçu live)
    return Promise.all(
      quotes.map(async (q) => {
        if (!q.coversPortfolio) return { ...q, portfolioOwner: null, coveredCompanies: [] };
        const owner = q.portfolioOwnerId
          ? await this.prisma.user.findUnique({
              where: { id: q.portfolioOwnerId },
              select: { id: true, email: true, firstName: true, lastName: true },
            })
          : null;
        let coveredCompanies: { id: string; name: string }[] = [];
        let invalidReason: string | null = null;
        try {
          coveredCompanies = await this.resolveCoveredCompanies(q);
        } catch (e: any) {
          invalidReason = e?.message ?? 'Devis invalide';
        }
        return { ...q, portfolioOwner: owner, coveredCompanies, invalidReason };
      }),
    );
  }

  async cancel(id: string) {
    const quote = await (this.prisma as any).customQuote.findUnique({ where: { id } });
    if (!quote) throw new NotFoundException('Devis introuvable');
    if (quote.status !== 'ACTIVE') throw new BadRequestException('Seul un devis actif peut être annulé');
    return (this.prisma as any).customQuote.update({ where: { id }, data: { status: 'CANCELED' } });
  }
}