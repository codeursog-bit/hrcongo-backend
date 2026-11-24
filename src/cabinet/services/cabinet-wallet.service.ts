import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const PRICING = {
  PAYG_UNIT: 2_500,
  PACK_50: 90_000,
  PACK_100: 170_000,
  PACK_200: 300_000,
  FORFAIT_MONTHLY: 45_000,
  TRIAL_BULLETINS: 50,
} as const;

@Injectable()
export class CabinetWalletService {
  constructor(private prisma: PrismaService) {}

  async createWalletWithTrial(cabinetId: string) {
    const trialExpires = new Date();
    trialExpires.setMonth(trialExpires.getMonth() + 3);

    const wallet = await this.prisma.cabinetWallet.create({
      data: {
        cabinetId,
        bulletinsBalance: PRICING.TRIAL_BULLETINS,
        trialActive: true,
        trialExpiresAt: trialExpires,
      },
    });

    await this.prisma.cabinetWalletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'TRIAL_CREDIT',
        amount: PRICING.TRIAL_BULLETINS,
        description: `Trial 3 mois — ${PRICING.TRIAL_BULLETINS} bulletins offerts`,
        balanceBefore: 0,
        balanceAfter: PRICING.TRIAL_BULLETINS,
      },
    });

    return wallet;
  }

  async getWallet(cabinetId: string) {
    const wallet = await this.prisma.cabinetWallet.findUnique({
      where: { cabinetId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!wallet) throw new NotFoundException('Wallet introuvable');

    const now = new Date();
    const forfaitActive =
      wallet.isForfait &&
      wallet.forfaitExpiresAt &&
      now <= wallet.forfaitExpiresAt;
    const trialExpired =
      wallet.trialActive &&
      wallet.trialExpiresAt &&
      now > wallet.trialExpiresAt;

    return {
      ...wallet,
      forfaitActive: !!forfaitActive,
      trialExpired: !!trialExpired,
      canGenerate: !!forfaitActive || wallet.bulletinsBalance > 0,
      effectiveBalance: forfaitActive ? null : wallet.bulletinsBalance,
      pricing: PRICING,
    };
  }

  async canGenerateBulletin(
    cabinetId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const wallet = await this.prisma.cabinetWallet.findUnique({
      where: { cabinetId },
    });
    if (!wallet) return { allowed: false, reason: 'Wallet introuvable' };

    const now = new Date();

    if (
      wallet.isForfait &&
      wallet.forfaitExpiresAt &&
      now <= wallet.forfaitExpiresAt
    ) {
      return { allowed: true };
    }

    if (
      wallet.trialActive &&
      wallet.trialExpiresAt &&
      now > wallet.trialExpiresAt &&
      wallet.bulletinsBalance <= 0
    ) {
      return {
        allowed: false,
        reason: "Période d'essai expirée. Rechargez votre compte.",
      };
    }

    if (wallet.bulletinsBalance <= 0) {
      return {
        allowed: false,
        reason: 'Solde insuffisant. Achetez un pack ou activez le forfait.',
      };
    }

    return { allowed: true };
  }

  async debitBulletin(cabinetId: string, companyId: string, payrollId: string) {
    const check = await this.canGenerateBulletin(cabinetId);
    if (!check.allowed) throw new ForbiddenException(check.reason);

    const wallet = await this.prisma.cabinetWallet.findUnique({
      where: { cabinetId },
    });
    if (!wallet) throw new NotFoundException('Wallet introuvable');

    const now = new Date();
    const forfaitActive =
      wallet.isForfait &&
      wallet.forfaitExpiresAt &&
      now <= wallet.forfaitExpiresAt;

    if (forfaitActive) {
      await this.prisma.cabinetWallet.update({
        where: { cabinetId },
        data: { bulletinsUsedThisMonth: { increment: 1 } },
      });
      await this.prisma.cabinetWalletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'BULLETIN_DEBIT',
          amount: 0,
          description: `Bulletin généré (forfait)`,
          companyId,
          payrollId,
          balanceBefore: wallet.bulletinsBalance,
          balanceAfter: wallet.bulletinsBalance,
        },
      });
      return;
    }

    const before = wallet.bulletinsBalance;
    const after = before - 1;

    await this.prisma.$transaction([
      this.prisma.cabinetWallet.update({
        where: { cabinetId },
        data: {
          bulletinsBalance: after,
          bulletinsUsedThisMonth: { increment: 1 },
        },
      }),
      this.prisma.cabinetWalletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'BULLETIN_DEBIT',
          amount: -1,
          description: `Bulletin généré`,
          companyId,
          payrollId,
          balanceBefore: before,
          balanceAfter: after,
        },
      }),
    ]);
  }

  async refundBulletin(cabinetId: string, payrollId: string) {
    const wallet = await this.prisma.cabinetWallet.findUnique({
      where: { cabinetId },
    });
    if (!wallet) return;

    const tx = await this.prisma.cabinetWalletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        payrollId,
        type: 'BULLETIN_DEBIT',
        amount: -1,
      },
    });
    if (!tx) return;

    const before = wallet.bulletinsBalance;
    const after = before + 1;

    await this.prisma.$transaction([
      this.prisma.cabinetWallet.update({
        where: { cabinetId },
        data: { bulletinsBalance: after },
      }),
      this.prisma.cabinetWalletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'BULLETIN_REFUND',
          amount: 1,
          description: 'Remboursement bulletin annulé',
          payrollId,
          balanceBefore: before,
          balanceAfter: after,
        },
      }),
    ]);
  }

  async purchasePack(
    cabinetId: string,
    pack: 'PACK_50' | 'PACK_100' | 'PACK_200',
    reference: string,
  ) {
    const qty = { PACK_50: 50, PACK_100: 100, PACK_200: 200 }[pack];
    const wallet = await this.prisma.cabinetWallet.findUnique({
      where: { cabinetId },
    });
    if (!wallet) throw new NotFoundException('Wallet introuvable');

    const before = wallet.bulletinsBalance;
    const after = before + qty;

    await this.prisma.$transaction([
      this.prisma.cabinetWallet.update({
        where: { cabinetId },
        data: { bulletinsBalance: after, trialActive: false },
      }),
      this.prisma.cabinetWalletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'PACK_PURCHASE',
          amount: qty,
          description: `Achat ${pack} — ${qty} bulletins`,
          reference,
          balanceBefore: before,
          balanceAfter: after,
        },
      }),
    ]);

    return { newBalance: after };
  }

  async activateForfait(cabinetId: string, reference: string) {
    const wallet = await this.prisma.cabinetWallet.findUnique({
      where: { cabinetId },
    });
    if (!wallet) throw new NotFoundException('Wallet introuvable');

    const expires = new Date();
    expires.setMonth(expires.getMonth() + 1);

    await this.prisma.$transaction([
      this.prisma.cabinetWallet.update({
        where: { cabinetId },
        data: {
          isForfait: true,
          forfaitExpiresAt: expires,
          trialActive: false,
          bulletinsUsedThisMonth: 0,
          lastResetAt: new Date(),
        },
      }),
      this.prisma.cabinetWalletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'FORFAIT_ACTIVATION',
          amount: 0,
          description: 'Activation forfait mensuel illimité',
          reference,
          balanceBefore: wallet.bulletinsBalance,
          balanceAfter: wallet.bulletinsBalance,
        },
      }),
    ]);

    return { forfaitExpiresAt: expires };
  }
}
