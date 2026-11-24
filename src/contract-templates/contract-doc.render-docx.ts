// ============================================================================
// 📁 src/contract-templates/contract-doc.render-docx.ts
// JSON (variables déjà remplacées) → .docx, généré EN MÉMOIRE (rien sur disque).
// ============================================================================

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, Header, Footer,
  ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, PageNumber, PageBreak,
  LevelFormat, TabStopType,
} from 'docx';
import { DocNode, TemplateSettings, fetchLogo } from './contract-doc';

export interface LetterheadInfo {
  companyName: string;
  logo?: string | null;
  footerLines: string[];
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const HEADING: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

export async function renderDocx(
  doc: DocNode,
  settings: TemplateSettings,
  letterhead: LetterheadInfo,
): Promise<Buffer> {
  const font = settings.fontFamily;
  const size = Math.round(settings.fontSize * 2); // demi-points
  let olInstance = 0;

  const runs = (nodes: DocNode[] = [], extra: { bold?: boolean; size?: number; black?: boolean } = {}): (TextRun)[] => {
    const out: TextRun[] = [];
    for (const n of nodes) {
      if (n.type === 'hardBreak') {
        out.push(new TextRun({ break: 1, font, size }));
      } else if (n.type === 'text' && n.text) {
        const m = new Set((n.marks || []).map((x) => x.type));
        out.push(
          new TextRun({
            text: n.text,
            font,
            size: extra.size ?? size,
            bold: m.has('bold') || extra.bold || undefined,
            italics: m.has('italic') || undefined,
            underline: m.has('underline') ? {} : undefined,
            color: extra.black ? '000000' : undefined,
          }),
        );
      }
    }
    return out;
  };

  const block = (n: DocNode, listCtx?: { kind: 'ul' | 'ol'; level: number; instance: number }, forceBold = false): any[] => {
    switch (n.type) {
      case 'paragraph':
        return [
          new Paragraph({
            alignment: ALIGN[n.attrs?.textAlign || 'left'],
            spacing: { after: 100, line: 276 },
            children: runs(n.content, { bold: forceBold }),
            ...(listCtx
              ? listCtx.kind === 'ul'
                ? { bullet: { level: Math.min(listCtx.level, 2) } }
                : { numbering: { reference: 'ol', level: Math.min(listCtx.level, 2), instance: listCtx.instance } }
              : {}),
          }),
        ];
      case 'heading': {
        const lvl = Number(n.attrs?.level) || 2;
        const sizes: Record<number, number> = { 1: size + 8, 2: size + 4, 3: size + 2 };
        return [
          new Paragraph({
            heading: HEADING[lvl],
            keepNext: true, // garde le titre avec le paragraphe qui suit
            alignment: ALIGN[n.attrs?.textAlign || 'left'],
            spacing: { before: 160, after: 120 },
            children: runs(n.content, { bold: true, size: sizes[lvl], black: true }),
          }),
        ];
      }
      case 'bulletList':
      case 'orderedList': {
        const kind = n.type === 'bulletList' ? 'ul' : 'ol';
        const level = listCtx ? listCtx.level + 1 : 0;
        const instance = kind === 'ol' ? ++olInstance : 0;
        const out: any[] = [];
        for (const item of n.content || []) {
          for (const child of item.content || []) {
            if (child.type === 'paragraph') out.push(...block(child, { kind, level, instance }));
            else out.push(...block(child, { kind, level, instance }));
          }
        }
        return out;
      }
      case 'pageBreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      case 'table':
        return [tableNode(n)];
      default:
        return [];
    }
  };

  const tableNode = (t: DocNode): Table => {
    const rows = (t.content || []).filter((r) => r.type === 'tableRow');
    const cols = Math.max(
      1,
      ...rows.map((r) => (r.content || []).reduce((s, c) => s + (Number(c.attrs?.colspan) || 1), 0)),
    );
    const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: Array(cols).fill(Math.floor(9000 / cols)),
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: rows.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: (r.content || []).map((c) => {
              const kids = (c.content || []).flatMap((k) => block(k, undefined, c.type === 'tableHeader'));
              return new TableCell({
                columnSpan: Number(c.attrs?.colspan) || undefined,
                rowSpan: Number(c.attrs?.rowspan) || undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: kids.length ? kids : [new Paragraph({ children: [] })],
              });
            }),
          }),
      ),
    });
  };

  const children = (doc.content || []).flatMap((n) => block(n));

  // ── En-tête / pied de page (désactivable par modèle) ──────────────────────
  let header: Header | undefined;
  let footer: Footer | undefined;
  if (settings.letterhead) {
    const logo = await fetchLogo(letterhead.logo);
    header = new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: logo
            ? [new ImageRun({ data: logo.buffer, transformation: { width: 110, height: 62 }, type: logo.type } as any)]
            : [new TextRun({ text: letterhead.companyName, bold: true, font, size: 22 })],
        }),
      ],
    });
    footer = new Footer({
      children: [
        ...letterhead.footerLines.map(
          (l) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: l, font, size: 16, color: '666666' })] }),
        ),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ children: ['Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], font, size: 16, color: '666666' }),
          ],
        }),
      ],
    });
  }

  const document = new Document({
    creator: letterhead.companyName,
    styles: { default: { document: { run: { font, size } } } },
    numbering: {
      config: [
        {
          reference: 'ol',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
            { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1620, hanging: 270 } } } },
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1500, bottom: 1200, left: 1134, right: 1134 } } },
        headers: header ? { default: header } : undefined,
        footers: footer ? { default: footer } : undefined,
        children: children.length ? children : [new Paragraph({ children: [] })],
      },
    ],
  });

  return Packer.toBuffer(document);
}