// src/affiliate/affiliate.service.ts
import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import { AffiliateRegisterDto } from './dto/affiliate-register.dto';
import { AffiliateLoginDto } from './dto/affiliate-login.dto';
import { Decimal } from '@prisma/client/runtime/library';

const THRESHOLD_KEY = 'affiliate_withdrawal_threshold';

@Injectable()
export class AffiliateService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ─── INSCRIPTION ─────────────────────────────────────────────────────────

  async register(dto: AffiliateRegisterDto) {
    const existing = await this.prisma.affiliate.findUnique({
      where: { email: dto.email },
    });
    if (existing)
      throw new ConflictException(
        'Un compte affilié existe déjà avec cet email',
      );

    let referralCode: string;
    let codeExists = true;
    do {
      referralCode = nanoid(8).toUpperCase();
      const check = await this.prisma.affiliate.findUnique({
        where: { referralCode },
      });
      codeExists = !!check;
    } while (codeExists);

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const affiliate = await this.prisma.affiliate.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        password: hashedPassword,
        referralCode,
        phone: dto.phone,
        disbursementPhone: dto.disbursementPhone ?? dto.phone,
        commissionRate: new Decimal(10),
      } as any,
    });

    return {
      token: this.signToken(affiliate.id),
      affiliate: this.sanitize(affiliate),
    };
  }

  // ─── CONNEXION ────────────────────────────────────────────────────────────

  async login(dto: AffiliateLoginDto) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { email: dto.email },
    });
    if (!affiliate)
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    const valid = await bcrypt.compare(dto.password, affiliate.password);
    if (!valid)
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    if (!affiliate.isActive)
      throw new UnauthorizedException('Compte désactivé');
    return {
      token: this.signToken(affiliate.id),
      affiliate: this.sanitize(affiliate),
    };
  }

  // ─── DASHBOARD AFFILIÉ ───────────────────────────────────────────────────

  async getDashboard(affiliateId: string) {
    const threshold = await this.getThreshold();

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: {
        // PME
        mappings: {
          include: {
            company: {
              select: {
                id: true,
                legalName: true,
                tradeName: true,
                email: true,
                createdAt: true,
                subscription: { select: { plan: true, status: true } },
                payments: {
                  where: { status: 'SUCCEEDED' },
                  select: { id: true, amount: true, paidAt: true },
                  orderBy: { paidAt: 'desc' },
                  take: 3,
                },
              },
            },
          },
          orderBy: { linkedAt: 'desc' },
        },
        commissions: {
          where: { status: { not: 'CANCELLED' } },
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
        // Cabinets
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
          orderBy: { linkedAt: 'desc' },
        },
        cabinetCommissions: {
          where: { status: { not: 'CANCELLED' } },
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
        // Demande de retrait active
        withdrawalRequests: {
          where: { status: { in: ['PENDING', 'APPROVED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      } as any,
    });

    if (!affiliate) throw new NotFoundException('Affilié introuvable');

    const pendingCompany = (affiliate as any).commissions
      .filter((c: any) => c.status === 'PENDING')
      .reduce((s: number, c: any) => s + c.commissionAmount, 0);
    const paidCompany = (affiliate as any).commissions
      .filter((c: any) => c.status === 'PAID')
      .reduce((s: number, c: any) => s + c.commissionAmount, 0);
    const pendingCabinet = (affiliate as any).cabinetCommissions
      .filter((c: any) => c.status === 'PENDING')
      .reduce((s: number, c: any) => s + c.commissionAmount, 0);
    const paidCabinet = (affiliate as any).cabinetCommissions
      .filter((c: any) => c.status === 'PAID')
      .reduce((s: number, c: any) => s + c.commissionAmount, 0);
    const totalPending = pendingCompany + pendingCabinet;
    const totalPaid = paidCompany + paidCabinet;
    const activeWithdrawal =
      ((affiliate as any).withdrawalRequests ?? [])[0] ?? null;

    const baseUrl = process.env.FRONTEND_URL ?? 'https://app.konza-rh.com';

    // ✅ UN SEUL lien — l'utilisateur choisit lui-même PME ou Cabinet
    // sur la page d'inscription via accountType
    const referralLink = `${baseUrl}/auth/register?ref=${affiliate.referralCode}`;

    return {
      affiliate: this.sanitize(affiliate),
      referralLink, // un seul lien pour tout le monde
      kpis: {
        totalCompanies: (affiliate as any).mappings.length,
        pendingCompany,
        paidCompany,
        totalCabinets: (affiliate as any).cabinetMappings.length,
        pendingCabinet,
        paidCabinet,
        totalPending,
        totalPaid,
        totalEarned: totalPending + totalPaid,
        commissionRate: Number(affiliate.commissionRate),
        threshold,
        thresholdReached: totalPending >= threshold,
        canRequestWithdrawal: totalPending >= threshold && !activeWithdrawal,
        activeWithdrawal,
      },
      companies: (affiliate as any).mappings.map((m: any) => ({
        id: m.company.id,
        name: m.company.tradeName || m.company.legalName,
        email: m.company.email,
        linkedAt: m.linkedAt,
        subscription: m.company.subscription,
        recentPayments: m.company.payments,
      })),
      cabinets: (affiliate as any).cabinetMappings.map((m: any) => ({
        id: m.cabinet.id,
        name: m.cabinet.name,
        email: m.cabinet.email,
        linkedAt: m.linkedAt,
        subscription: m.cabinet.subscription,
      })),
      commissions: (affiliate as any).commissions.map((c: any) => ({
        id: c.id,
        type: 'COMPANY' as const,
        clientName: c.payment.company.legalName,
        paymentAmount: c.paymentAmount,
        commissionRate: Number(c.commissionRate),
        commissionAmount: c.commissionAmount,
        status: c.status,
        date: c.createdAt,
        paidAt: c.paidAt ?? null,
      })),
      cabinetCommissions: (affiliate as any).cabinetCommissions.map(
        (c: any) => ({
          id: c.id,
          type: 'CABINET' as const,
          clientName: c.cabinetPayment.subscription.cabinet.name,
          paymentAmount: c.paymentAmount,
          commissionRate: Number(c.commissionRate),
          commissionAmount: c.commissionAmount,
          status: c.status,
          date: c.createdAt,
          paidAt: c.paidAt ?? null,
        }),
      ),
      withdrawalHistory: await (
        this.prisma as any
      ).affiliateWithdrawalRequest.findMany({
        where: { affiliateId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    };
  }

  // ─── DEMANDE DE RETRAIT ───────────────────────────────────────────────────

  async requestWithdrawal(affiliateId: string) {
    const threshold = await this.getThreshold();

    const [companyComms, cabinetComms] = await Promise.all([
      this.prisma.affiliateCommission.findMany({
        where: { affiliateId, status: 'PENDING' },
        select: { commissionAmount: true },
      }),
      (this.prisma as any).affiliateCabinetCommission.findMany({
        where: { affiliateId, status: 'PENDING' },
        select: { commissionAmount: true },
      }),
    ]);

    const totalPending = [...companyComms, ...cabinetComms].reduce(
      (s: number, c: any) => s + c.commissionAmount,
      0,
    );

    if (totalPending < threshold) {
      throw new BadRequestException(
        `Seuil non atteint. Minimum : ${threshold.toLocaleString()} XAF (vous avez ${totalPending.toLocaleString()} XAF).`,
      );
    }

    const existing = await (
      this.prisma as any
    ).affiliateWithdrawalRequest.findFirst({
      where: { affiliateId, status: { in: ['PENDING', 'APPROVED'] } },
    });
    if (existing)
      throw new ConflictException('Une demande de retrait est déjà en cours.');

    const request = await (
      this.prisma as any
    ).affiliateWithdrawalRequest.create({
      data: { affiliateId, amount: totalPending, status: 'PENDING' },
    });

    return { id: request.id, amount: request.amount, status: request.status };
  }

  // ─── LIER UNE ENTREPRISE ─────────────────────────────────────────────────

  async linkCompany(referralCode: string, companyId: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { referralCode },
    });
    if (!affiliate || !affiliate.isActive) return;
    const existing = await this.prisma.affiliateCompany.findUnique({
      where: { companyId },
    });
    if (existing) return;
    await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        data: { affiliatedBy: affiliate.id },
      }),
      this.prisma.affiliateCompany.create({
        data: { affiliateId: affiliate.id, companyId },
      }),
    ]);
  }

  // ─── LIER UN CABINET ─────────────────────────────────────────────────────

  async linkCabinet(referralCode: string, cabinetId: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { referralCode },
    });
    if (!affiliate || !affiliate.isActive) return; // silencieux si code invalide

    const existing = await (this.prisma as any).affiliateCabinet.findUnique({
      where: { cabinetId },
    });
    if (existing) return;

    await this.prisma.$transaction([
      (this.prisma as any).cabinet.update({
        where: { id: cabinetId },
        data: { affiliatedBy: affiliate.id },
      }),
      (this.prisma as any).affiliateCabinet.create({
        data: { affiliateId: affiliate.id, cabinetId },
      }),
    ]);
  }

  // ─── COMMISSION paiement PME ──────────────────────────────────────────────

  async handleSuccessfulPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { company: true },
    });
    if (!payment || payment.status !== 'SUCCEEDED') return;
    if (!payment.company?.affiliatedBy) return;

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: payment.company.affiliatedBy },
    });
    if (!affiliate || !affiliate.isActive) return;

    const existing = await this.prisma.affiliateCommission.findUnique({
      where: { paymentId },
    });
    if (existing) return;

    const commissionAmount = Math.floor(
      (payment.amount * Number(affiliate.commissionRate)) / 100,
    );

    await this.prisma.affiliateCommission.create({
      data: {
        affiliateId: affiliate.id,
        paymentId,
        companyId: payment.companyId,
        paymentAmount: payment.amount,
        commissionRate: affiliate.commissionRate,
        commissionAmount,
        status: 'PENDING',
      },
    });
  }

  // ─── COMMISSION paiement CABINET ──────────────────────────────────────────

  async handleSuccessfulCabinetPayment(cabinetPaymentId: string) {
    const cabinetPayment = await (this.prisma as any).cabinetPayment.findUnique(
      {
        where: { id: cabinetPaymentId },
        include: {
          subscription: {
            include: { cabinet: { select: { id: true, affiliatedBy: true } } },
          },
        },
      },
    );

    if (!cabinetPayment || cabinetPayment.status !== 'SUCCEEDED') return;
    const cabinet = cabinetPayment.subscription?.cabinet;
    if (!cabinet?.affiliatedBy) return;

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: cabinet.affiliatedBy },
    });
    if (!affiliate || !affiliate.isActive) return;

    const existing = await (
      this.prisma as any
    ).affiliateCabinetCommission.findUnique({
      where: { cabinetPaymentId },
    });
    if (existing) return;

    const commissionAmount = Math.floor(
      (cabinetPayment.amount * Number(affiliate.commissionRate)) / 100,
    );

    await (this.prisma as any).affiliateCabinetCommission.create({
      data: {
        affiliateId: affiliate.id,
        cabinetPaymentId,
        cabinetId: cabinet.id,
        paymentAmount: cabinetPayment.amount,
        commissionRate: affiliate.commissionRate,
        commissionAmount,
        status: 'PENDING',
      },
    });
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  async getThreshold(): Promise<number> {
    try {
      const row = await (this.prisma as any).platformConfig.findUnique({
        where: { key: THRESHOLD_KEY },
      });
      return row ? parseInt(row.value, 10) : 15_000;
    } catch {
      return 15_000;
    }
  }

  private signToken(id: string) {
    return this.jwtService.sign(
      { affiliateId: id, type: 'AFFILIATE' },
      { expiresIn: '30d' },
    );
  }

  private sanitize(affiliate: any) {
    const { password, ...rest } = affiliate;
    return rest;
  }
}
