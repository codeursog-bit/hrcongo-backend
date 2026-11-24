// ============================================================================
// src/invoices/invoice-pdf.builder.ts
// Génère la facture PDF (pdfkit, 100 % natif — même approche que les contrats).
// Mise en page reprise du modèle fourni, aux couleurs du logo KonzaRH.
// ============================================================================

import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { join } from 'path';
import { INVOICE_COLORS as C, INVOICE_ISSUER } from './invoice.config';

export interface InvoiceLine {
  description: string;
  unitPrice: number;
  quantity: number;
  total: number;
}

export interface InvoicePdfData {
  number: string;
  issuedAt: Date;
  customer: {
    name: string;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
    taxNumber?: string | null;
  };
  lines: InvoiceLine[]; // la ligne de réduction éventuelle a un total négatif
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  payment: {
    methodLabel: string; // ex. « Mobile Money MTN »
    providerLabel: string; // ex. « YabetoPay »
    reference?: string | null;
    paidAt: Date;
  };
}

const W = 595.28;
const H = 841.89;
const MX = 48;

export const fmtMoney = (n: number) =>
  `${n < 0 ? '-' : ''}${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;

const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function resolveLogo(): string | null {
  const candidates = [
    process.env.INVOICE_LOGO_PATH,
    join(__dirname, 'assets', 'konza_logo_h_color.png'),
    join(__dirname, '..', 'assets', 'konza_logo_h_color.png'),
    join(process.cwd(), 'src', 'invoices', 'assets', 'konza_logo_h_color.png'),
    join(process.cwd(), 'src', 'assets', 'konza_logo_h_color.png'),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function drawHeader(doc: PDFKit.PDFDocument, d: InvoicePdfData) {
  // Bande orange (légèrement décalée) puis bande verte par-dessus → effet « vague » du modèle
  doc.save().fillColor(C.accent)
    .moveTo(0, 0).lineTo(W, 0).lineTo(W, 66)
    .bezierCurveTo(520, 4, 330, 150, 0, 208)
    .closePath().fill().restore();
  doc.save().fillColor(C.primary)
    .moveTo(0, 0).lineTo(W, 0).lineTo(W, 54)
    .bezierCurveTo(520, -8, 330, 138, 0, 194)
    .closePath().fill().restore();

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20)
    .text(`Facture n° ${d.number}`, MX, 92, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor('#D1FAE5')
    .text(`Émise le ${fmtDate(d.issuedAt)}`, MX, 122, { lineBreak: false });

  // Logo (droite) + coordonnées émetteur
  const logo = resolveLogo();
  const logoW = 170;
  const logoX = W - MX - logoW;
  if (logo) {
    doc.image(logo, logoX, 92, { width: logoW });
  } else {
    doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(24)
      .text('KONZA RH', logoX, 96, { width: logoW, align: 'right' });
  }
  const lines = [INVOICE_ISSUER.address, INVOICE_ISSUER.phone, INVOICE_ISSUER.email, INVOICE_ISSUER.website,
    INVOICE_ISSUER.taxId && `NIU/RCCM : ${INVOICE_ISSUER.taxId}`].filter(Boolean) as string[];
  doc.font('Helvetica').fontSize(9.5).fillColor(C.text);
  let y = 142;
  for (const l of lines) {
    doc.text(l, W - MX - 260, y, { width: 260, align: 'right', lineBreak: false });
    y += 13;
  }
}

export function buildInvoicePdf(d: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Facture ${d.number}`, Author: INVOICE_ISSUER.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, d);

    // ── Client ────────────────────────────────────────────────────────────
    let y = 232;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.text).text(`Client : ${d.customer.name}`, MX, y, { width: 330 });
    y = doc.y + 4;
    doc.font('Helvetica').fontSize(10).fillColor(C.muted);
    for (const l of [
      [d.customer.address, d.customer.city].filter(Boolean).join(', '),
      d.customer.phone,
      d.customer.email,
      d.customer.taxNumber && `NIU : ${d.customer.taxNumber}`,
    ].filter(Boolean) as string[]) {
      doc.text(l, MX, y, { width: 330 });
      y = doc.y + 1;
    }

    // ── Tableau ───────────────────────────────────────────────────────────
    const tx = MX;
    const tw = W - MX * 2;
    const col = { desc: tx + 16, price: tx + 255, qty: tx + 345, total: tx + tw - 16 };
    let ty = Math.max(y + 26, 320);
    doc.save().roundedRect(tx, ty, tw, 28, 14).lineWidth(1.5).strokeColor(C.primary).stroke().restore();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text);
    doc.text('Description', col.desc, ty + 9, { lineBreak: false });
    doc.text('Prix unitaire', col.price, ty + 9, { width: 90, align: 'center', lineBreak: false });
    doc.text('Qté', col.qty, ty + 9, { width: 40, align: 'center', lineBreak: false });
    doc.text('Total', col.total - 80, ty + 9, { width: 80, align: 'right', lineBreak: false });

    ty += 44;
    doc.font('Helvetica').fontSize(10);
    for (const l of d.lines) {
      const neg = l.total < 0;
      doc.fillColor(neg ? C.primary : C.text);
      const h = doc.heightOfString(l.description, { width: 232 });
      doc.text(l.description, col.desc, ty, { width: 232 });
      doc.text(fmtMoney(l.unitPrice), col.price, ty, { width: 90, align: 'center', lineBreak: false });
      doc.text(String(l.quantity), col.qty, ty, { width: 40, align: 'center', lineBreak: false });
      doc.text(fmtMoney(l.total), col.total - 90, ty, { width: 90, align: 'right', lineBreak: false });
      ty += Math.max(h, 12) + 16;
    }

    // ── Totaux ────────────────────────────────────────────────────────────
    ty = Math.max(ty + 24, 560);
    doc.font('Helvetica').fontSize(11).fillColor(C.muted);
    const lx = tx + tw - 270;
    doc.text('Sous-total', lx, ty, { lineBreak: false });
    doc.fillColor(C.text).text(fmtMoney(d.subtotal), col.total - 110, ty, { width: 110, align: 'right', lineBreak: false });
    ty += 24;
    doc.fillColor(C.muted).text(d.vatRate > 0 ? `dont TVA (${d.vatRate} %)` : 'TVA (0 %)', lx, ty, { lineBreak: false });
    doc.fillColor(C.text).text(fmtMoney(d.vatAmount), col.total - 110, ty, { width: 110, align: 'right', lineBreak: false });
    ty += 30;

    doc.save().roundedRect(tx, ty, tw, 34, 12).fill(C.primary).restore();
    doc.save().roundedRect(tx + tw - 8, ty + 6, 3, 22, 1.5).fill(C.accent).restore();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF');
    doc.text('Total payé', tx + 18, ty + 10, { lineBreak: false });
    doc.text(fmtMoney(d.total), col.total - 160, ty + 10, { width: 160, align: 'right', lineBreak: false });

    // ── Pied : paiement / conditions + cadre « Payée » ────────────────────
    const by = ty + 64;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.text).text('Informations de paiement', MX, by, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(C.muted);
    doc.text(`Payé par ${d.payment.methodLabel}`, MX, by + 18, { width: 270 });
    doc.text(`Via ${d.payment.providerLabel}`, MX, doc.y + 1, { width: 270 });
    if (d.payment.reference) doc.text(`Réf. : ${d.payment.reference}`, MX, doc.y + 1, { width: 270 });

    const cy = Math.max(doc.y + 22, by + 82);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.text).text('Termes & conditions', MX, cy, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor(C.muted)
      .text('Facture acquittée. Elle atteste du paiement de votre abonnement KonzaRH pour la période indiquée.', MX, cy + 18, { width: 270 });

    const bx = W - MX - 215;
    doc.save().roundedRect(bx, by - 4, 215, 128, 16).lineWidth(1.5).strokeColor(C.accent).stroke().restore();
    doc.font('Helvetica-Bold').fontSize(24).fillColor(C.primary).text('PAYÉE', bx, by + 14, { width: 215, align: 'center', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text).text('Date :', bx + 18, by + 62, { lineBreak: false });
    doc.font('Helvetica').fillColor(C.muted).text(fmtDate(d.payment.paidAt), bx + 58, by + 62, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor(C.text).text('Facture :', bx + 18, by + 84, { lineBreak: false });
    doc.font('Helvetica').fillColor(C.muted).text(d.number, bx + 72, by + 84, { lineBreak: false });

    // ── Pied de page ──────────────────────────────────────────────────────
    doc.save().rect(0, H - 8, W, 8).fill(C.primary).restore();
    doc.save().rect(W - 120, H - 8, 120, 8).fill(C.accent).restore();

    doc.end();
  });
}
