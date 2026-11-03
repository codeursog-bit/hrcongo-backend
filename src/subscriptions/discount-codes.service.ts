// ============================================================================
// src/subscriptions/discount-codes.service.ts
// Codes de réduction (pourcentage). Le calcul est TOUJOURS fait côté serveur ;
// le montant final obtenu est celui envoyé à l'agrégateur.
// ============================================================================

import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DiscountApplication {
  discountCodeId: string;
  code: string;
  percentOff: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

@Injectable()
export class DiscountCodesService {
  private readonly logger = new Logger(DiscountCodesService.name);

  constructor(private prisma: PrismaService) {}

  private normalize(code: string) {
    return code.trim().toUpperCase();
  }

  // ─── Application d'un code à un montant (utilisé par le checkout) ─────────

  async apply(rawCode: string, companyId: string, baseAmount: number): Promise<DiscountApplication> {
    const code = this.normalize(rawCode);
    const dc = await (this.prisma as any).discountCode.findUnique({ where: { code } });

    // Message volontairement identique pour inconnu / inactif / autre entreprise :
    // on ne révèle pas l'existence d'un code réservé à quelqu'un d'autre.
    const invalid = new BadRequestException('Code de réduction invalide');
    if (!dc || !dc.isActive) throw invalid;
    if (dc.companyId && dc.companyId !== companyId) throw invalid;

    const now = new Date();
    if (dc.validFrom && dc.validFrom > now) throw new BadRequestException("Ce code n'est pas encore valable");
    if (dc.validUntil && dc.validUntil < now) throw new BadRequestException('Ce code a expiré');

    if (dc.maxUses != null) {
      const used = await (this.prisma as any).discountRedemption.count({ where: { discountCodeId: dc.id } });
      if (used >= dc.maxUses) throw new BadRequestException("Ce code a atteint son nombre maximum d'utilisations");
    }
    if (dc.maxUsesPerCompany != null) {
      const usedByCompany = await (this.prisma as any).discountRedemption.count({
        where: { discountCodeId: dc.id, companyId },
      });
      if (usedByCompany >= dc.maxUsesPerCompany) {
        throw new BadRequestException("Vous avez déjà utilisé ce code le nombre de fois autorisé");
      }
    }

    const discountAmount = Math.round((baseAmount * dc.percentOff) / 100);
    const finalAmount = baseAmount - discountAmount;
    if (finalAmount <= 0) throw new BadRequestException('Montant final invalide pour ce code');

    return {
      discountCodeId: dc.id,
      code: dc.code,
      percentOff: dc.percentOff,
      originalAmount: baseAmount,
      discountAmount,
      finalAmount,
    };
  }

  /** Appelé quand le paiement est SUCCEEDED. Idempotent (paymentId unique). */
  async recordRedemption(payment: {
    id: string;
    companyId: string;
    discountCodeId?: string | null;
    originalAmount?: number | null;
    discountAmount?: number | null;
    amount: number;
  }) {
    if (!payment.discountCodeId) return;
    try {
      await (this.prisma as any).discountRedemption.create({
        data: {
          discountCodeId: payment.discountCodeId,
          companyId: payment.companyId,
          paymentId: payment.id,
          originalAmount: payment.originalAmount ?? payment.amount,
          discountAmount: payment.discountAmount ?? 0,
          finalAmount: payment.amount,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return; // déjà enregistré (webhook + polling)
      throw e;
    }
  }

  // ─── Super admin ──────────────────────────────────────────────────────────

  async create(
    dto: {
      code: string;
      percentOff: number;
      companyId?: string;
      maxUses?: number;
      maxUsesPerCompany?: number;
      validFrom?: string;
      validUntil?: string;
      note?: string;
    },
    actorUserId: string,
  ) {
    const code = this.normalize(dto.code);
    if (await (this.prisma as any).discountCode.findUnique({ where: { code } })) {
      throw new ConflictException('Ce code existe déjà');
    }
    if (dto.companyId) {
      const c = await this.prisma.company.findUnique({ where: { id: dto.companyId }, select: { id: true } });
      if (!c) throw new NotFoundException('Entreprise introuvable');
    }
    return (this.prisma as any).discountCode.create({
      data: {
        code,
        percentOff: dto.percentOff,
        companyId: dto.companyId ?? null,
        maxUses: dto.maxUses ?? null,
        maxUsesPerCompany: dto.maxUsesPerCompany ?? null,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        note: dto.note ?? null,
        createdByUserId: actorUserId,
      },
    });
  }

  async list() {
    const rows = await (this.prisma as any).discountCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, legalName: true, tradeName: true } },
        _count: { select: { redemptions: true } },
      },
    });
    return rows.map((r: any) => ({ ...r, usesCount: r._count.redemptions, _count: undefined }));
  }

  async update(
    id: string,
    dto: {
      percentOff?: number;
      maxUses?: number | null;
      maxUsesPerCompany?: number | null;
      validFrom?: string | null;
      validUntil?: string | null;
      isActive?: boolean;
      note?: string | null;
    },
  ) {
    const existing = await (this.prisma as any).discountCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code introuvable');

    const data: any = { ...dto };
    if ('validFrom' in dto) data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if ('validUntil' in dto) data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    return (this.prisma as any).discountCode.update({ where: { id }, data });
  }
}
