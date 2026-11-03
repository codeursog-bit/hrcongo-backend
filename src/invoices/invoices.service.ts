// ============================================================================
// src/invoices/invoices.service.ts
// Émission (idempotente) de la facture d'un paiement réussi, génération du PDF
// et envoi par email. Appelée depuis handlePaymentSuccess (Yabetoo) — et plus
// tard depuis les handlers Moteki / Chariow.
// ============================================================================

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PLANS } from '../subscriptions/config/plans.config';
import { buildInvoicePdf, fmtMoney, InvoiceLine, InvoicePdfData } from './invoice-pdf.builder';
import { INVOICE_VAT_RATE } from './invoice.config';

const METHOD_LABEL: Record<string, string> = {
  MTN: 'Mobile Money MTN',
  AIRTEL: 'Airtel Money',
  ORANGE: 'Orange Money',
};
const PROVIDER_LABEL: Record<string, string> = {
  YABETOOPAY: 'YabetoPay',
  MOTEKI: 'Moteki',
  CHARIOW: 'Chariow',
};

const dFr = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  /** Crée la facture si elle n'existe pas, puis l'envoie. Ne lève jamais d'erreur bloquante pour l'appelant si on l'appelle en `void`. */
  async issueForPayment(paymentId: string) {
    const existing = await (this.prisma as any).invoice.findUnique({ where: { paymentId } });
    if (existing) return existing;

    const payment: any = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { company: true, discountCode: true } as any,
    });
    if (!payment || payment.status !== 'SUCCEEDED') return null;

    const subscription = await this.prisma.subscription.findUnique({ where: { companyId: payment.companyId } });
    const meta = (payment.metadata ?? {}) as any;
    const planName = PLANS[meta.plan]?.name ?? meta.plan ?? 'Abonnement';

    // ── Lignes ────────────────────────────────────────────────────────────
    const cycle = meta.months
      ? `tarif négocié, ${meta.months} mois`
      : meta.billingPeriod === 'yearly' ? 'annuel' : 'mensuel';
    const periodTxt = subscription
      ? `\nPériode : ${dFr(subscription.currentPeriodStart)} au ${dFr(subscription.currentPeriodEnd)}`
      : '';
    // Remise : champs propres (Yabetoo) ou, pour Chariow, valeurs renvoyées par la vente (metadata)
    const listPriceRaw = payment.originalAmount ?? meta.originalAmount ?? payment.amount;
    const discountRaw = payment.discountAmount ?? meta.discountAmount ?? 0;
    const hasDiscount = discountRaw > 0 && listPriceRaw - discountRaw === payment.amount; // cohérence : sinon une seule ligne
    const listPrice = hasDiscount ? listPriceRaw : payment.amount;

    const lines: InvoiceLine[] = [
      { description: `Abonnement KonzaRH — Plan ${planName} (${cycle})${periodTxt}`, unitPrice: listPrice, quantity: 1, total: listPrice },
    ];
    if (hasDiscount) {
      const code = payment.discountCode?.code ?? payment.chariowDiscountCode ?? '';
      const pct = payment.discountCode?.percentOff;
      lines.push({
        description: `Réduction${code ? ` — code ${code}` : ''}${pct ? ` (-${pct} %)` : ''}`,
        unitPrice: -discountRaw,
        quantity: 1,
        total: -discountRaw,
      });
    }

    const total = payment.amount;
    const vatAmount = INVOICE_VAT_RATE > 0 ? Math.round(total - total / (1 + INVOICE_VAT_RATE / 100)) : 0;
    const c = payment.company;
    const customer = {
      name: c.tradeName || c.legalName,
      address: c.address,
      city: c.city,
      phone: c.phone,
      email: c.email,
      taxNumber: c.taxNumber,
    };
    const paymentInfo = {
      methodLabel: METHOD_LABEL[payment.paymentMethod] ?? 'Mobile Money',
      providerLabel: PROVIDER_LABEL[payment.provider] ?? 'YabetoPay',
      reference:
        payment.yabetooIntentId ??
        payment.motekiPaymentReference ??
        meta.chariowTransactionId ??
        payment.chariowSaleId ??
        payment.id,
      paidAt: (payment.paidAt ?? new Date()).toISOString(),
    };

    // ── Numéro séquentiel + création, dans une transaction ────────────────
    let invoice: any;
    try {
      invoice = await this.prisma.$transaction(async (tx: any) => {
        const year = new Date().getFullYear();
        const counter = await tx.invoiceCounter.upsert({
          where: { year },
          create: { year, lastSeq: 1 },
          update: { lastSeq: { increment: 1 } },
        });
        return tx.invoice.create({
          data: {
            number: `FAC-${year}-${String(counter.lastSeq).padStart(6, '0')}`,
            paymentId,
            companyId: payment.companyId,
            customer,
            lines,
            paymentInfo,
            subtotal: total,
            vatRate: INVOICE_VAT_RATE,
            vatAmount,
            total,
            currency: payment.currency ?? 'XAF',
          },
        });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // émise en parallèle (webhook + polling) : on renvoie celle qui existe
        return (this.prisma as any).invoice.findUnique({ where: { paymentId } });
      }
      throw e;
    }

    this.logger.log(`🧾 Facture ${invoice.number} émise (${fmtMoney(total)}) pour la société ${payment.companyId}`);
    await this.sendByEmail(invoice, meta.userId).catch((err) =>
      this.logger.error(`❌ Envoi facture ${invoice.number} : ${err?.message}`),
    );
    return invoice;
  }

  private toPdfData(invoice: any): InvoicePdfData {
    const info = invoice.paymentInfo as any;
    return {
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      customer: invoice.customer as any,
      lines: invoice.lines as InvoiceLine[],
      subtotal: invoice.subtotal,
      vatRate: invoice.vatRate,
      vatAmount: invoice.vatAmount,
      total: invoice.total,
      payment: { ...info, paidAt: new Date(info.paidAt) },
    };
  }

  async buildPdf(invoice: any): Promise<Buffer> {
    return buildInvoicePdf(this.toPdfData(invoice));
  }

  /** Destinataires : email de l'entreprise + celui qui a payé (s'il diffère) */
  async sendByEmail(invoice: any, payerUserId?: string) {
    const recipients = new Set<string>();
    const customer = invoice.customer as any;
    if (customer?.email) recipients.add(String(customer.email).toLowerCase());
    if (payerUserId) {
      const u = await this.prisma.user.findUnique({ where: { id: payerUserId }, select: { email: true } });
      if (u?.email) recipients.add(u.email.toLowerCase());
    }
    if (recipients.size === 0) return;

    const pdf = await this.buildPdf(invoice);
    const subscription = await this.prisma.subscription.findUnique({ where: { companyId: invoice.companyId } });
    const sent: string[] = [];
    for (const to of recipients) {
      const ok = await this.mailService.sendInvoice({
        to,
        companyName: customer?.name ?? '',
        invoiceNumber: invoice.number,
        amountLabel: fmtMoney(invoice.total),
        periodEnd: subscription?.currentPeriodEnd,
        pdf,
      });
      if (ok) sent.push(to);
    }
    if (sent.length) {
      await (this.prisma as any).invoice.update({
        where: { id: invoice.id },
        data: { sentTo: sent, emailSentAt: new Date() },
      });
    }
  }

  // ─── Accès côté entreprise ───────────────────────────────────────────────

  async listForCompany(companyId: string) {
    return (this.prisma as any).invoice.findMany({
      where: { companyId },
      orderBy: { issuedAt: 'desc' },
      select: { id: true, number: true, paymentId: true, issuedAt: true, total: true, currency: true, emailSentAt: true },
    });
  }

  async getOwned(invoiceId: string, companyId: string) {
    const inv = await (this.prisma as any).invoice.findFirst({ where: { id: invoiceId, companyId } });
    if (!inv) throw new NotFoundException('Facture introuvable');
    return inv;
  }

  async resend(invoiceId: string, companyId: string, userId?: string) {
    const inv = await this.getOwned(invoiceId, companyId);
    await this.sendByEmail(inv, userId);
    return { success: true };
  }

  // ─── Super admin : toutes les factures ───────────────────────────────────

  async listAll(opts: { search?: string; companyId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const search = opts.search?.trim();

    const where: any = {
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { company: { legalName: { contains: search, mode: 'insensitive' } } },
              { company: { tradeName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total, agg] = await Promise.all([
      (this.prisma as any).invoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, number: true, issuedAt: true, total: true, currency: true,
          emailSentAt: true, sentTo: true, customer: true,
          company: { select: { id: true, legalName: true, tradeName: true } },
        },
      }),
      (this.prisma as any).invoice.count({ where }),
      (this.prisma as any).invoice.aggregate({ where, _sum: { total: true } }),
    ]);

    return { items, total, page, pageSize, totalAmount: agg._sum.total ?? 0 };
  }

  async getById(invoiceId: string) {
    const inv = await (this.prisma as any).invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Facture introuvable');
    return inv;
  }

  async resendById(invoiceId: string) {
    const inv = await this.getById(invoiceId);
    await this.sendByEmail(inv);
    return { success: true };
  }
}
