// ============================================================================
// 📁 src/contract-templates/contract-doc.render-pdf.ts
// JSON (variables déjà remplacées) → PDF via pdfkit (déjà installé), EN MÉMOIRE.
// Polices PDF standard (Times) : gras / italique / souligné / alignement /
// listes / tableaux / saut de page. Même source que le Word → même contenu.
// ============================================================================

import PDFDocument from 'pdfkit';
import { DocNode, TemplateSettings, fetchLogo } from './contract-doc';
import { LetterheadInfo } from './contract-doc.render-docx';

const MARGIN_L = 56;
const MARGIN_R = 56;
const MARGIN_T = 100;
const MARGIN_B = 70;

interface Run { text: string; bold?: boolean; italic?: boolean; underline?: boolean }

const fontName = (bold?: boolean, italic?: boolean) =>
  bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';

function collectRuns(nodes: DocNode[] = [], forceBold = false): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') out.push({ text: '\n' });
    else if (n.type === 'text' && n.text) {
      const m = new Set((n.marks || []).map((x) => x.type));
      out.push({ text: n.text, bold: forceBold || m.has('bold'), italic: m.has('italic'), underline: m.has('underline') });
    }
  }
  return out;
}

export async function renderPdf(
  docJson: DocNode,
  settings: TemplateSettings,
  letterhead: LetterheadInfo,
): Promise<Buffer> {
  const logo = settings.letterhead ? await fetchLogo(letterhead.logo) : null;
  const baseSize = settings.fontSize;

  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: settings.letterhead ? MARGIN_T : 56, bottom: settings.letterhead ? MARGIN_B : 56, left: MARGIN_L, right: MARGIN_R },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const usable = () => pdf.page.width - MARGIN_L - MARGIN_R;
    const bottom = () => pdf.page.height - (settings.letterhead ? MARGIN_B : 56);

    const drawHeader = () => {
      if (!settings.letterhead) return;
      const w = usable();
      if (logo) {
        try {
          pdf.image(logo.buffer, MARGIN_L + w / 2 - 50, 28, { fit: [100, 56], align: 'center' });
        } catch {
          pdf.font('Times-Bold').fontSize(12).text(letterhead.companyName, MARGIN_L, 40, { width: w, align: 'center' });
        }
      } else {
        pdf.font('Times-Bold').fontSize(12).text(letterhead.companyName, MARGIN_L, 40, { width: w, align: 'center' });
      }
      pdf.x = MARGIN_L;
      pdf.y = MARGIN_T;
    };
    pdf.on('pageAdded', drawHeader);
    drawHeader();

    /** Écrit une suite de runs (gras/italique mêlés) dans un bloc de largeur donnée. */
    const writeRuns = (runs: Run[], x: number, y: number | undefined, width: number, align: string, size = baseSize) => {
      // pdfkit supprime l'espace qui OUVRE un morceau de texte enchaîné (« **Poste** (catégorie… » → « Poste(catégorie »).
      // On déplace donc cet espace à la FIN du morceau précédent, où il est conservé.
      const list: Run[] = [];
      for (const r of runs.length ? runs : [{ text: ' ' } as Run]) {
        const prev = list[list.length - 1];
        const lead = /^[ \u00A0]+/.exec(r.text)?.[0] ?? '';
        if (prev && lead && prev.text !== '\n' && r.text !== '\n') {
          prev.text += lead;
          list.push({ ...r, text: r.text.slice(lead.length) });
        } else {
          list.push({ ...r });
        }
      }
      list.forEach((r, i) => {
        pdf.font(fontName(r.bold, r.italic)).fontSize(size).fillColor('#111111');
        const opts: any = { width, align, continued: i < list.length - 1, underline: !!r.underline, lineGap: 2 };
        if (i === 0 && y !== undefined) pdf.text(r.text, x, y, opts);
        else if (i === 0) pdf.text(r.text, x, pdf.y, opts);
        else pdf.text(r.text, opts);
      });
    };

    const plain = (runs: Run[]) => runs.map((r) => r.text).join('');

    const measure = (runs: Run[], width: number, size = baseSize) => {
      pdf.font('Times-Roman').fontSize(size);
      return pdf.heightOfString(plain(runs) || ' ', { width, lineGap: 2 }) + 3;
    };

    const ensureSpace = (h: number) => {
      if (pdf.y + h > bottom()) pdf.addPage();
    };

    const paragraph = (n: DocNode, x: number, width: number, opts: { bullet?: string; forceBold?: boolean; size?: number } = {}) => {
      const runs = collectRuns(n.content, opts.forceBold);
      const size = opts.size ?? baseSize;
      const h = measure(runs, width - (opts.bullet ? 16 : 0), size);
      ensureSpace(Math.min(h, 80));
      const startY = pdf.y;
      if (opts.bullet) {
        pdf.font('Times-Roman').fontSize(size).text(opts.bullet, x, startY, { width: 14, lineBreak: false });
        writeRuns(runs, x + 16, startY, width - 16, n.attrs?.textAlign || 'left', size);
      } else {
        writeRuns(runs, x, startY, width, n.attrs?.textAlign || 'left', size);
      }
      pdf.x = MARGIN_L;
      pdf.moveDown(0.35);
    };

    const list = (n: DocNode, x: number, width: number, depth: number) => {
      let i = 0;
      for (const item of n.content || []) {
        i++;
        const marker = n.type === 'bulletList' ? (depth === 0 ? '•' : '–') : `${i}.`;
        let first = true;
        for (const child of item.content || []) {
          if (child.type === 'paragraph') {
            paragraph(child, x + 8, width - 8, { bullet: first ? marker : undefined });
            if (!first) { /* paragraphes suivants de l'item : sans puce */ }
            first = false;
          } else if (child.type === 'bulletList' || child.type === 'orderedList') {
            list(child, x + 18, width - 18, depth + 1);
          }
        }
      }
    };

    const table = (t: DocNode) => {
      const rows = (t.content || []).filter((r) => r.type === 'tableRow');
      const cols = Math.max(1, ...rows.map((r) => (r.content || []).reduce((s, c) => s + (Number(c.attrs?.colspan) || 1), 0)));
      const colW = usable() / cols;
      const pad = 4;
      const layout = (row: DocNode) => {
        const cells = (row.content || []).map((c) => {
          const span = Number(c.attrs?.colspan) || 1;
          const paras = (c.content || []).filter((k) => k.type === 'paragraph' || k.type === 'heading');
          const bold = c.type === 'tableHeader';
          const runsList = paras.map((p) => collectRuns(p.content, bold || p.type === 'heading'));
          const w = colW * span;
          const h = runsList.reduce((s, r) => s + measure(r, w - pad * 2) + 2, 0) + pad * 2;
          return { span, w, runsList, paras, h };
        });
        return { cells, rowH: Math.max(18, ...cells.map((c) => c.h)) };
      };
      // Tableau qui tient sur une page : on ne le coupe pas (pas d'en-tête orphelin, pas de bloc de signature scindé)
      const total = rows.reduce((sum, r) => sum + layout(r).rowH, 0);
      const pageRoom = pdf.page.height - (settings.letterhead ? MARGIN_T + MARGIN_B : 112);
      if (total <= pageRoom && pdf.y + total > bottom()) pdf.addPage();
      for (const row of rows) {
        const { cells, rowH } = layout(row);
        ensureSpace(rowH);
        const y0 = pdf.y;
        let x = MARGIN_L;
        for (const c of cells) {
          pdf.rect(x, y0, c.w, rowH).strokeColor('#808080').lineWidth(0.5).stroke();
          let cy = y0 + pad;
          c.runsList.forEach((runs, idx) => {
            writeRuns(runs, x + pad, cy, c.w - pad * 2, c.paras[idx].attrs?.textAlign || 'left');
            cy += measure(runs, c.w - pad * 2) + 2;
          });
          x += c.w;
        }
        pdf.x = MARGIN_L;
        pdf.y = y0 + rowH;
      }
      pdf.moveDown(0.6);
    };

    const sizes: Record<number, number> = { 1: baseSize + 5, 2: baseSize + 2, 3: baseSize + 1 };

    for (const n of docJson.content || []) {
      switch (n.type) {
        case 'paragraph':
          paragraph(n, MARGIN_L, usable());
          break;
        case 'heading':
          ensureSpace(72); // un titre n'est jamais seul en bas de page : il suit son paragraphe
          pdf.moveDown(0.3);
          paragraph(n, MARGIN_L, usable(), { forceBold: true, size: sizes[Number(n.attrs?.level) || 2] });
          break;
        case 'bulletList':
        case 'orderedList':
          list(n, MARGIN_L, usable(), 0);
          pdf.moveDown(0.2);
          break;
        case 'table':
          table(n);
          break;
        case 'pageBreak':
          pdf.addPage();
          break;
      }
    }

    // Pied de page + numéros sur TOUTES les pages
    if (settings.letterhead) {
      const range = pdf.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        pdf.switchToPage(i);
        const w = pdf.page.width - MARGIN_L - MARGIN_R;
        const lines = [...letterhead.footerLines, `Page ${i - range.start + 1} / ${range.count}`];
        const y = pdf.page.height - 56;
        // pdfkit ajouterait une page si on écrit sous la marge basse : on la neutralise le temps du pied de page
        const oldBottom = pdf.page.margins.bottom;
        pdf.page.margins.bottom = 0;
        lines.forEach((l, k) => {
          pdf.font('Times-Roman').fontSize(8).fillColor('#666666').text(l, MARGIN_L, y - (lines.length - 1 - k) * 10 + 10, { width: w, align: 'center', lineBreak: false });
        });
        pdf.page.margins.bottom = oldBottom;
      }
    }

    pdf.end();
  });
}