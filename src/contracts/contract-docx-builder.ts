// ============================================================================
// 📁 src/contracts/contract-docx-builder.ts
//
// Rend le contenu du contrat (contract-content.ts) au format .docx, avec
// logo dynamique de l'entreprise et pied de page dynamique. Aucun fichier
// .docx externe requis — l'app génère intégralement son propre document,
// avec la même charte typographique que le modèle réel de l'entreprise
// (Bookman Old Style, 12pt, texte justifié).
// ============================================================================

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Header,
  Footer,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageNumber,
  VerticalAlign,
} from 'docx';
import { ContractKind, ContractTemplateData, TextLine, buildContractContent } from './contract-content';

const FONT = 'Bookman Old Style';
const SIZE_BODY = 24; // 12pt (docx compte en demi-points)
const SIZE_TITLE = 48; // 24pt
const SIZE_ARTICLE = 24;
const COLOR_TITLE = '000000';
const COLOR_MUTED = '444444';

function title(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300, before: 100 },
    children: [new TextRun({ text, bold: true, size: SIZE_TITLE, font: FONT, color: COLOR_TITLE })],
  });
}

function articleHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, size: SIZE_ARTICLE, font: FONT, color: COLOR_TITLE })],
  });
}

function textLine(line: TextLine): Paragraph {
  const alignMap = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };
  return new Paragraph({
    spacing: { after: 120 },
    alignment: line.align ? alignMap[line.align] : AlignmentType.JUSTIFIED,
    children: [new TextRun({ text: line.text, size: SIZE_BODY, font: FONT, bold: line.bold })],
  });
}

function body(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160 },
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, size: SIZE_BODY, font: FONT })],
  });
}

function line(label: string, value: string, opts: { bold?: boolean; muted?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    tabStops: [{ type: 'right' as any, position: 9000 }],
    children: [
      new TextRun({ text: label, size: SIZE_BODY, font: FONT, bold: opts.bold, color: opts.muted ? COLOR_MUTED : undefined }),
      new TextRun({ text: '\t' }),
      new TextRun({ text: value, size: SIZE_BODY, font: FONT, bold: opts.bold, color: opts.muted ? COLOR_MUTED : undefined }),
    ],
  });
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

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

async function buildHeader(nomEntreprise: string, logoUrl?: string): Promise<Header> {
  const logoBuffer = await fetchLogoBuffer(logoUrl);
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: logoBuffer
          ? [new ImageRun({ data: logoBuffer, transformation: { width: 110, height: 62 }, type: 'png' } as any)]
          : [new TextRun({ text: nomEntreprise, bold: true, size: 24, font: FONT })],
      }),
    ],
  });
}

function buildFooter(piedDePage: string): Footer {
  const lines = (piedDePage || '').split('\n').filter(Boolean);
  return new Footer({
    children: lines.length
      ? lines.map(
          (l, i) =>
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: i === lines.length - 1 ? 0 : 20 },
              children: [new TextRun({ text: l, size: 16, font: FONT, color: COLOR_MUTED })],
            }),
        )
      : [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', size: 16, font: FONT, color: COLOR_MUTED }),
              new TextRun({ children: [PageNumber.CURRENT] as any, size: 16, font: FONT, color: COLOR_MUTED }),
            ],
          }),
        ],
  });
}

function signatureTable(sig: ReturnType<typeof buildContractContent>['signature']): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({ children: [new TextRun({ text: sig.leftLabel, bold: true, size: SIZE_BODY, font: FONT })] }),
              new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: sig.leftName, size: SIZE_BODY, font: FONT })] }),
              ...(sig.leftNote
                ? [new Paragraph({ children: [new TextRun({ text: sig.leftNote, size: 20, font: FONT, color: COLOR_MUTED })] })]
                : []),
            ],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({ children: [new TextRun({ text: sig.rightLabel, bold: true, size: SIZE_BODY, font: FONT })] }),
              new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: sig.rightName, size: SIZE_BODY, font: FONT })] }),
              ...(sig.rightNote
                ? [new Paragraph({ children: [new TextRun({ text: sig.rightNote, size: 20, font: FONT, color: COLOR_MUTED })] })]
                : []),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Génère le buffer .docx pour un type de contrat + des données données. */
export async function buildContractDocx(
  kind: ContractKind,
  data: ContractTemplateData,
  logoUrl?: string,
): Promise<Buffer> {
  const content = buildContractContent(kind, data);

  const children: (Paragraph | Table)[] = [title(content.title)];

  for (const l of content.preamble) children.push(textLine(l));
  children.push(spacer());

  for (const block of content.blocks) {
    if (block.type === 'article') {
      children.push(articleHeading(block.heading));
      for (const p of block.paragraphs) children.push(body(p));
    } else {
      children.push(body(block.intro));
      children.push(spacer());
      for (const row of block.rows) children.push(line(row.label, row.value, { bold: row.bold, muted: row.muted }));
      children.push(spacer());
    }
  }

  children.push(spacer());
  for (const l of content.closing) children.push(textLine(l));
  children.push(spacer());
  children.push(signatureTable(content.signature));

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 1100, right: 1100 } } },
        headers: { default: await buildHeader(data.nomEntreprise, logoUrl) },
        footers: { default: buildFooter(content.footer) },
        children,
      },
    ],
    styles: { default: { document: { run: { font: FONT, size: SIZE_BODY } } } },
  });

  return Packer.toBuffer(doc);
}