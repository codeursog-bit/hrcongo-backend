// src/affiliate/affiliate-admin.service.ts
// ============================================================================
// Super-admin : gestion des affiliés, retraits, distribution
//
// Deux modes de versement coexistent :
//   1. distributeToAffiliate() → Yabetoo automatique (J+1, statut "processing")
//      La confirmation arrive via webhook disbursement.completed → commissions PAID
//   2. markAsPaid()            → Manuel (fallback si Yabetoo indisponible)
//      Marque immédiatement toutes les commissions PAID
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { YabetooPayService } from '../payments/yabetoopay.service';
import { Decimal } from '@prisma/client/runtime/library';

const THRESHOLD_KEY = 'affiliate_withdrawal_threshold';
const DEFAULT_THRESHOLD = 15_000;

@Injectable()
export class AffiliateAdminService {
  private readonly logger = new Logger(AffiliateAdminService.name);

  constructor(
    private prisma: PrismaService,
    private yabetoo: YabetooPayService,
  ) {}

  // ─── SEUIL ────────────────────────────────────────────────────────────────

  async getWithdrawalThreshold(): Promise<number> {
    try {
      const row = await (this.prisma as any).platformConfig.findUnique({
        where: { key: THRESHOLD_KEY },
      });
      return row ? parseInt(row.value, 10) : DEFAULT_THRESHOLD;
    } catch {
      return DEFAULT_THRESHOLD;
    }
  }

  async setWithdrawalThreshold(amount: number): Promise<{ threshold: number }> {
    if (amount < 1_000)
      throw new BadRequestException('Seuil minimum : 1 000 XAF');
    await (this.prisma as any).platformConfig.upsert({
      where: { key: THRESHOLD_KEY },
      update: { value: String(amount) },
      create: { key: THRESHOLD_KEY, value: String(amount) },
    });
    return { threshold: amount };
  }

  // ─── LISTE TOUS LES AFFILIÉS ──────────────────────────────────────────────

  async getAllAffiliates() {
    const threshold = await this.getWithdrawalThreshold();

    const affiliates = await this.prisma.affiliate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { mappings: true, commissions: true } },
        commissions: {
          where: { status: { in: ['PENDING', 'PAID'] } },
          select: { commissionAmount: true, status: true },
        },
        cabinetMappings: { select: { id: true } },
        cabinetCommissions: {
          where: { status: { in: ['PENDING', 'PAID'] } },
          select: { commissionAmount: true, status: true },
        },
        withdrawalRequests: {
          where: { status: { in: ['PENDING', 'APPROVED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, amount: true, status: true, createdAt: true },
        },
      } as any,
    });

    return affiliates.map((a: any) => {
      const pendingCompany = a.commissions
        .filter((c: any) => c.status === 'PENDING')
        .reduce((s: number, c: any) => s + c.commissionAmount, 0);
      const paidCompany = a.commissions
        .filter((c: any) => c.status === 'PAID')
        .reduce((s: number, c: any) => s + c.commissionAmount, 0);
      const pendingCabinet = (a.cabinetCommissions ?? [])
        .filter((c: any) => c.status === 'PENDING')
        .reduce((s: number, c: any) => s + c.commissionAmount, 0);
      const paidCabinet = (a.cabinetCommissions ?? [])
        .filter((c: any) => c.status === 'PAID')
        .reduce((s: number, c: any) => s + c.commissionAmount, 0);
      const totalPending = pendingCompany + pendingCabinet;
      const totalPaid = paidCompany + paidCabinet;

      return {
        id: a.id,
        firstName: a.firstName,
        lastName: a.lastName,
        email: a.email,
        phone: a.phone ?? null,
        disbursementPhone: a.disbursementPhone ?? null,
        referralCode: a.referralCode,
        commissionRate: Number(a.commissionRate),
        isActive: a.isActive,
        totalCompanies: a._count.mappings,
        totalCabinets: (a.cabinetMappings ?? []).length,
        pendingCompany,
        pendingCabinet,
        totalPending,
        paidCompany,
        paidCabinet,
        totalPaid,
        totalEarned: totalPending + totalPaid,
        threshold,
        thresholdReached: totalPending >= threshold,
        pendingWithdrawal: a.withdrawalRequests?.[0] ?? null,
        createdAt: a.createdAt,
      };
    });
  }

  // ─── DEMANDES EN ATTENTE ──────────────────────────────────────────────────

  async getPendingWithdrawals() {
    return (this.prisma as any).affiliateWithdrawalRequest.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        affiliate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            disbursementPhone: true,
            commissionRate: true,
          },
        },
      },
    });
  }

  // ─── 1. DISTRIBUTION AUTOMATIQUE VIA YABETOO ─────────────────────────────
  // POST /v1/disbursements — statut immédiat: "processing"
  // Exécution réelle: J+1
  // Confirmation: webhook disbursement.completed → webhooks.controller.ts marque PAID

  async distributeToAffiliate(withdrawalRequestId: string) {
    const request = await (
      this.prisma as any
    ).affiliateWithdrawalRequest.findUnique({
      where: { id: withdrawalRequestId },
      include: { affiliate: true },
    });

    if (!request) throw new NotFoundException('Demande introuvable');

    if (request.status === 'PAID') {
      throw new BadRequestException('Cette demande est déjà versée.');
    }
    if (request.status === 'REJECTED') {
      throw new BadRequestException('Cette demande a été rejetée.');
    }
    if (request.disbursementId) {
      throw new BadRequestException(
        `Un disbursement Yabetoo existe déjà pour cette demande (ID: ${request.disbursementId}). ` +
          'Attendez le webhook de confirmation ou utilisez "Marquer versé" manuellement.',
      );
    }

    const affiliate = request.affiliate;
    const phone = affiliate.disbursementPhone || affiliate.phone;

    if (!phone) {
      throw new BadRequestException(
        `L'affilié ${affiliate.firstName} ${affiliate.lastName} n'a pas de numéro Mobile Money enregistré. ` +
          'Ajoutez-le dans son profil ou utilisez le versement manuel.',
      );
    }

    // Récupérer toutes les commissions PENDING (PME + Cabinet)
    const [companyComms, cabinetComms] = await Promise.all([
      this.prisma.affiliateCommission.findMany({
        where: { affiliateId: affiliate.id, status: 'PENDING' },
        select: { id: true, commissionAmount: true },
      }),
      (this.prisma as any).affiliateCabinetCommission.findMany({
        where: { affiliateId: affiliate.id, status: 'PENDING' },
        select: { id: true, commissionAmount: true },
      }),
    ]);

    const totalAmount = [...companyComms, ...cabinetComms].reduce(
      (s: number, c: any) => s + c.commissionAmount,
      0,
    );

    if (totalAmount <= 0) {
      throw new BadRequestException('Aucune commission en attente à verser.');
    }

    const operator = this.detectOperator(phone);

    this.logger.log(
      `[Affiliate] Disbursement Yabetoo → ${affiliate.firstName} ${affiliate.lastName}` +
        ` — ${totalAmount} XAF via ${operator} → ${phone}`,
    );

    // Appel Yabetoo — POST /v1/disbursements
    const disbursement = await this.yabetoo.createDisbursement({
      amount: totalAmount,
      currency: 'XAF',
      firstName: affiliate.firstName,
      lastName: affiliate.lastName,
      phone,
      operator: operator,
      country: 'CG',
    });

    // Stocker disbursementId + passer en APPROVED
    // On NE marque PAS PAID ici — le webhook disbursement.completed le fera (J+1)
    await (this.prisma as any).affiliateWithdrawalRequest.update({
      where: { id: withdrawalRequestId },
      data: {
        status: 'APPROVED',
        disbursementId: disbursement.id,
        disbursementStatus: disbursement.status, // "processing"
        processedAt: new Date(),
      },
    });

    this.logger.log(
      `[Affiliate] Disbursement créé: ${disbursement.id} — status: ${disbursement.status}` +
        ` — exécution prévue: ${disbursement.shouldExecutedAt}`,
    );

    return {
      disbursementId: disbursement.id,
      status: disbursement.status, // "processing"
      amount: totalAmount,
      affiliateName: `${affiliate.firstName} ${affiliate.lastName}`,
      phone,
      operator,
      shouldExecutedAt: disbursement.shouldExecutedAt,
      companyCommissions: companyComms.length,
      cabinetCommissions: cabinetComms.length,
      message: `Versement planifié (J+1). Confirmation automatique via webhook Yabetoo.`,
    };
  }

  // ─── 2. VERSEMENT MANUEL (fallback) ──────────────────────────────────────
  // Utile si Yabetoo est indisponible ou pour corriger une erreur.
  // Marque immédiatement PAID sans passer par Yabetoo.

  async markAsPaid(withdrawalRequestId: string, paymentNote?: string) {
    const request = await (
      this.prisma as any
    ).affiliateWithdrawalRequest.findUnique({
      where: { id: withdrawalRequestId },
      include: {
        affiliate: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!request) throw new NotFoundException('Demande introuvable');

    if (request.status === 'PAID') {
      throw new BadRequestException('Déjà marqué comme versé.');
    }
    if (request.status === 'REJECTED') {
      throw new BadRequestException('Demande rejetée — impossible de valider.');
    }

    const affiliateId = request.affiliateId;
    const now = new Date();

    const [companyComms, cabinetComms] = await Promise.all([
      this.prisma.affiliateCommission.findMany({
        where: { affiliateId, status: 'PENDING' },
        select: { id: true, commissionAmount: true },
      }),
      (this.prisma as any).affiliateCabinetCommission.findMany({
        where: { affiliateId, status: 'PENDING' },
        select: { id: true, commissionAmount: true },
      }),
    ]);

    const totalAmount = [...companyComms, ...cabinetComms].reduce(
      (s: number, c: any) => s + c.commissionAmount,
      0,
    );

    this.logger.log(
      `[Affiliate] Versement MANUEL — ${request.affiliate.firstName} ${request.affiliate.lastName}` +
        ` — ${totalAmount} XAF — ref: ${paymentNote ?? '—'}`,
    );

    await this.prisma.$transaction(async (tx: any) => {
      if (companyComms.length > 0) {
        await tx.affiliateCommission.updateMany({
          where: { id: { in: companyComms.map((c: any) => c.id) } },
          data: {
            status: 'PAID',
            paidAt: now,
            paymentRef: paymentNote ?? null,
          },
        });
      }
      if (cabinetComms.length > 0) {
        await tx.affiliateCabinetCommission.updateMany({
          where: { id: { in: cabinetComms.map((c: any) => c.id) } },
          data: {
            status: 'PAID',
            paidAt: now,
            paymentRef: paymentNote ?? null,
          },
        });
      }
      await tx.affiliateWithdrawalRequest.update({
        where: { id: withdrawalRequestId },
        data: {
          status: 'PAID',
          paidAt: now,
          paymentNote: paymentNote ?? null,
          processedAt: now,
        },
      });
    });

    return {
      success: true,
      amount: totalAmount,
      affiliateName: `${request.affiliate.firstName} ${request.affiliate.lastName}`,
      companyCount: companyComms.length,
      cabinetCount: cabinetComms.length,
      paymentNote: paymentNote ?? null,
    };
  }

  // ─── REJETER ──────────────────────────────────────────────────────────────

  async rejectWithdrawal(withdrawalRequestId: string, reason?: string) {
    const request = await (
      this.prisma as any
    ).affiliateWithdrawalRequest.findUnique({
      where: { id: withdrawalRequestId },
    });
    if (!request) throw new NotFoundException('Demande introuvable');
    if (request.status !== 'PENDING')
      throw new BadRequestException('Demande déjà traitée.');

    await (this.prisma as any).affiliateWithdrawalRequest.update({
      where: { id: withdrawalRequestId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason ?? "Rejeté par l'administrateur",
        processedAt: new Date(),
      },
    });
  }

  // ─── MODIFIER TAUX ────────────────────────────────────────────────────────

  async updateCommissionRate(affiliateId: string, rate: number) {
    if (rate < 0 || rate > 50)
      throw new BadRequestException('Taux entre 0 et 50%');
    const aff = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
    });
    if (!aff) throw new NotFoundException('Affilié introuvable');
    return this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: { commissionRate: new Decimal(rate) },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        commissionRate: true,
      },
    });
  }

  // ─── TOGGLE ACTIF ─────────────────────────────────────────────────────────

  async toggleAffiliate(affiliateId: string, isActive: boolean) {
    const aff = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
    });
    if (!aff) throw new NotFoundException('Affilié introuvable');
    return this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: { isActive },
      select: { id: true, isActive: true },
    });
  }

  // ─── METTRE À JOUR LE NUMÉRO ──────────────────────────────────────────────

  async updatePhone(
    affiliateId: string,
    phone: string,
    disbursementPhone?: string,
  ) {
    const aff = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
    });
    if (!aff) throw new NotFoundException('Affilié introuvable');
    return this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: { phone, disbursementPhone: disbursementPhone ?? phone } as any,
      select: { id: true, phone: true, disbursementPhone: true } as any,
    });
  }

  // ─── DÉTAIL AFFILIÉ ───────────────────────────────────────────────────────

  async getAffiliateDetail(affiliateId: string) {
    const threshold = await this.getWithdrawalThreshold();
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: {
        mappings: {
          include: {
            company: {
              select: {
                id: true,
                legalName: true,
                email: true,
                createdAt: true,
                subscription: { select: { plan: true, status: true } },
              },
            },
          },
        },
        cabinetMappings: {
          include: {
            cabinet: {
              select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
                subscription: { select: { plan: true, status: true } },
              },
            },
          },
        },
        commissions: {
          orderBy: { createdAt: 'desc' },
          include: {
            payment: {
              select: {
                amount: true,
                paidAt: true,
                company: { select: { legalName: true } },
              },
            },
          },
        },
        cabinetCommissions: {
          orderBy: { createdAt: 'desc' },
          include: {
            cabinetPayment: {
              select: {
                amount: true,
                paidAt: true,
                subscription: {
                  select: { cabinet: { select: { name: true } } },
                },
              },
            },
          },
        },
        withdrawalRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
      } as any,
    });
    if (!affiliate) throw new NotFoundException('Affilié introuvable');
    const { password, ...rest } = affiliate as any;
    const pendingCompany = (rest.commissions ?? [])
      .filter((c: any) => c.status === 'PENDING')
      .reduce((s: number, c: any) => s + c.commissionAmount, 0);
    const pendingCabinet = (rest.cabinetCommissions ?? [])
      .filter((c: any) => c.status === 'PENDING')
      .reduce((s: number, c: any) => s + c.commissionAmount, 0);
    const totalPending = pendingCompany + pendingCabinet;
    return {
      ...rest,
      totalPending,
      thresholdReached: totalPending >= threshold,
      threshold,
    };
  }

  // ─── HELPER ───────────────────────────────────────────────────────────────

  private detectOperator(phone: string): 'MTN' | 'AIRTEL' | 'ORANGE' {
    const digits = phone.replace(/\D/g, '');
    // Numéro avec ou sans indicatif Congo (+242 ou 242)
    const local = digits.startsWith('242') ? digits.slice(3) : digits;
    if (local.startsWith('06')) return 'MTN';
    if (local.startsWith('05')) return 'AIRTEL';
    if (local.startsWith('04')) return 'ORANGE';
    return 'MTN'; // fallback
  }
}
