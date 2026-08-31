// ============================================================================
// 📁 src/contracts/contract-pdf-builder.ts
//
// Rend le contenu du contrat (contract-content.ts) au format PDF, avec logo
// dynamique en en-tête et pied de page dynamique répétés sur chaque page.
// Génération 100% native (bibliothèque `pdfkit`, aucun binaire externe type
// LibreOffice requis).
//
// Note police : "Bookman Old Style" (utilisée dans le Word) n'est pas une
// police PDF standard intégrable sans fournir un fichier de police — pdfkit
// n'a que 14 polices "core" (Helvetica, Times, Courier + variantes). "Times"
// est la plus proche visuellement (police à empattements, esprit "acte
// officiel"), donc utilisée ici pour rester cohérent avec le Word.
// ============================================================================

import PDFDocument from 'pdfkit';
import { ContractKind, ContractTemplateData, TextLine, buildContractContent, ContractContent } from './contract-content';

const FONT_REGULAR = 'Times-Roman';
const FONT_BOLD = 'Times-Bold';
const COLOR_TITLE = '#000000';
const COLOR_BODY = '#000000';
const COLOR_MUTED = '#444444';

const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 56;
const MARGIN_TOP = 100; // laisse la place au logo/en-tête
const MARGIN_BOTTOM = 70; // laisse la place au pied de page

async function fetchLogoBuffer(logoUrl?: string): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function drawHeader(doc: PDFKit.PDFDocument, nomEntreprise: string, logo: Buffer | null) {
  const pageWidth = doc.page.width;
  const y = 30;
  if (logo) {
    try {
      doc.image(logo, pageWidth / 2 - 45, y, { fit: [90, 50], align: 'center' });
    } catch {
      doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_TITLE).text(nomEntreprise, 0, y + 15, { align: 'center' });
    }
  } else {
    doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_TITLE).text(nomEntreprise, 0, y + 15, { align: 'center' });
  }
}

function drawFooter(doc: PDFKit.PDFDocument, footerText: string) {
  const pageHeight = doc.page.height;
  const lines = (footerText || '').split('\n').filter(Boolean);
  const y = pageHeight - MARGIN_BOTTOM + 15;
  doc.font(FONT_REGULAR).fontSize(7).fillColor(COLOR_MUTED);
  lines.forEach((l, i) => {
    doc.text(l, MARGIN_LEFT, y + i * 10, { width: doc.page.width - MARGIN_LEFT - MARGIN_RIGHT, align: 'center' });
  });
}

function textLine(doc: PDFKit.PDFDocument, l: TextLine) {
  doc
    .font(l.bold ? FONT_BOLD : FONT_REGULAR)
    .fontSize(11)
    .fillColor(COLOR_BODY)
    .text(l.text, { align: l.align || 'justify', lineGap: 2 });
  doc.moveDown(0.35);
}

function paragraph(doc: PDFKit.PDFDocument, text: string, opts: { bold?: boolean; size?: number } = {}) {
  doc
    .font(opts.bold ? FONT_BOLD : FONT_REGULAR)
    .fontSize(opts.size || 11)
    .fillColor(COLOR_BODY)
    .text(text, { align: 'justify', lineGap: 2 });
  doc.moveDown(0.6);
}

function articleHeading(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.4);
  doc.font(FONT_BOLD).fontSize(12).fillColor(COLOR_TITLE).text(text, { align: 'left' });
  doc.moveDown(0.3);
}

function salaryLine(doc: PDFKit.PDFDocument, label: string, value: string, opts: { bold?: boolean; muted?: boolean } = {}) {
  const usableWidth = doc.page.width - MARGIN_LEFT - MARGIN_RIGHT;
  const y = doc.y;
  doc
    .font(opts.bold ? FONT_BOLD : FONT_REGULAR)
    .fontSize(11)
    .fillColor(opts.muted ? COLOR_MUTED : COLOR_BODY)
    .text(label, MARGIN_LEFT, y, { continued: false, width: usableWidth * 0.65 });
  doc
    .font(opts.bold ? FONT_BOLD : FONT_REGULAR)
    .fontSize(11)
    .fillColor(opts.muted ? COLOR_MUTED : COLOR_BODY)
    .text(value, MARGIN_LEFT, y, { width: usableWidth, align: 'right' });
  doc.moveDown(0.25);
}

function signatureBlock(doc: PDFKit.PDFDocument, sig: ContractContent['signature']) {
  doc.moveDown(1);

  const usableWidth = doc.page.width - MARGIN_LEFT - MARGIN_RIGHT;
  const colWidth = usableWidth / 2 - 10;
  const y = doc.y;

  doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_BODY).text(sig.leftLabel, MARGIN_LEFT, y, { width: colWidth });
  doc.font(FONT_REGULAR).fontSize(11).text(sig.leftName, MARGIN_LEFT, doc.y + 4, { width: colWidth });
  if (sig.leftNote) {
    doc.font(FONT_REGULAR).fontSize(9).fillColor(COLOR_MUTED).text(sig.leftNote, MARGIN_LEFT, doc.y + 2, { width: colWidth });
  }

  const col2X = MARGIN_LEFT + colWidth + 20;
  doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_BODY).text(sig.rightLabel, col2X, y, { width: colWidth });
  doc.font(FONT_REGULAR).fontSize(11).text(sig.rightName, col2X, y + 16, { width: colWidth });
  if (sig.rightNote) {
    doc.font(FONT_REGULAR).fontSize(9).fillColor(COLOR_MUTED).text(sig.rightNote, col2X, y + 32, { width: colWidth });
  }
}

/** Génère le buffer PDF pour un type de contrat + des données données. */
export async function buildContractPdf(
  kind: ContractKind,
  data: ContractTemplateData,
  logoUrl?: string,
): Promise<Buffer> {
  const content = buildContractContent(kind, data);
  const logo = await fetchLogoBuffer(logoUrl);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.on('pageAdded', () => drawHeader(doc, data.nomEntreprise, logo));
    drawHeader(doc, data.nomEntreprise, logo);

    doc.font(FONT_BOLD).fontSize(16).fillColor(COLOR_TITLE).text(content.title, { align: 'center' });
    doc.moveDown(1.2);

    for (const l of content.preamble) textLine(doc, l);
    doc.moveDown(0.4);

    for (const block of content.blocks) {
      if (block.type === 'article') {
        articleHeading(doc, block.heading);
        for (const p of block.paragraphs) paragraph(doc, p);
      } else {
        paragraph(doc, block.intro);
        doc.moveDown(0.2);
        for (const row of block.rows) salaryLine(doc, row.label, row.value, { bold: row.bold, muted: row.muted });
        doc.moveDown(0.4);
      }
    }

    doc.moveDown(0.6);
    for (const l of content.closing) textLine(doc, l);
    doc.moveDown(1);
    signatureBlock(doc, content.signature);

    // Pied de page sur TOUTES les pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, content.footer);
    }

    doc.end();
  });
}