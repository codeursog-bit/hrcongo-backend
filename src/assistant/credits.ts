import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient;
export type CreditReason = 'TRIAL' | 'GRANT' | 'PURCHASE' | 'USAGE' | 'ADJUST';

/** Ajoute (delta > 0) ou retire (delta < 0) des crédits et écrit la ligne de journal. Renvoie le nouveau solde. */
export async function addCredits(
  tx: Db,
  a: {
    companyId: string;
    delta: number;
    reason: CreditReason;
    note?: string | null;
    refId?: string | null;
    createdBy?: string | null;
  },
): Promise<number> {
  if (!Number.isInteger(a.delta) || a.delta === 0)
    throw new BadRequestException('Quantité de crédits invalide.');
  const current = await tx.assistantCreditWallet.findUnique({
    where: { companyId: a.companyId },
    select: { balance: true },
  });
  if ((current?.balance ?? 0) + a.delta < 0)
    throw new BadRequestException('Le solde ne peut pas devenir négatif.');
  const wallet = await tx.assistantCreditWallet.upsert({
    where: { companyId: a.companyId },
    create: { companyId: a.companyId, balance: a.delta },
    update: { balance: { increment: a.delta } },
  });
  await tx.assistantCreditLedger.create({
    data: {
      companyId: a.companyId,
      delta: a.delta,
      balanceAfter: wallet.balance,
      reason: a.reason,
      note: a.note?.slice(0, 200) || null,
      refId: a.refId || null,
      createdBy: a.createdBy || null,
    },
  });
  return wallet.balance;
}

/** Crédits d'essai : accordés une seule fois par entreprise (mise à jour conditionnelle atomique). */
export async function grantTrialIfDue(
  prisma: PrismaService,
  companyId: string,
  trialCredits: number,
) {
  await prisma.$transaction(async (tx) => {
    await tx.assistantCreditWallet.upsert({
      where: { companyId },
      create: { companyId },
      update: {},
    });
    const claimed = await tx.assistantCreditWallet.updateMany({
      where: { companyId, trialGrantedAt: null },
      data: { trialGrantedAt: new Date() },
    });
    if (claimed.count === 1 && trialCredits > 0)
      await addCredits(tx, {
        companyId,
        delta: trialCredits,
        reason: 'TRIAL',
        note: 'Crédits d’essai',
        refId: 'trial',
      });
  });
}