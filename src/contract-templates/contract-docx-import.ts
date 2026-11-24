// ============================================================================
// 📁 src/contract-templates/contract-docx-import.ts
//
// Lecture d'un fichier Word (.docx) → document JSON du module contrats.
//
// ✅ Tout se passe EN MÉMOIRE : le fichier n'est jamais écrit sur le disque ni
//    stocké. On lit son XML, on en sort du JSON, le fichier est jeté.
// ✅ On lit le XML Word directement (et pas un convertisseur HTML) pour garder
//    ce qui compte dans un contrat : alignement (centré/justifié), gras,
//    italique, souligné, listes à puces/numérotées imbriquées, tableaux
//    (colonnes/lignes fusionnées), sauts de page, titres.
//
// Non repris (signalé à l'utilisateur dans `warnings`) : images, zones de
// texte, en-têtes/pieds de page du fichier, retraits, couleurs, interlignes.
// ============================================================================

import PizZip from 'pizzip';
import { DOMParser } from '@xmldom/xmldom';
import { BadRequestException } from '@nestjs/common';
import { DocNode, TemplateSettings, DEFAULT_SETTINGS, sanitizeDoc, sanitizeSettings } from './contract-doc';

export interface ImportResult {
  content: DocNode;
  settings: TemplateSettings;
  warnings: string[];
  stats: { paragraphs: number; tables: number; lists: number; gaps: number };
}

const NBSP4 = '\u00A0\u00A0\u00A0\u00A0';
const GAP_RE = /(?:[….]){4,}|_{4,}/g;

// ── Petits utilitaires XML (xmldom) ──────────────────────────────────────────
const kids = (el: any, name: string): any[] => {
  const out: any[] = [];
  for (let n = el?.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.nodeName === name) out.push(n);
  return out;
};
const kid = (el: any, name: string): any | null => {
  for (let n = el?.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.nodeName === name) return n;
  return null;
};
const attr = (el: any, name = 'w:val'): string | null => (el && el.hasAttribute?.(name) ? el.getAttribute(name) : null);
/** <w:b/> = actif ; <w:b w:val="0|false|off"/> = désactivé */
const isOn = (el: any): boolean => !!el && !['0', 'false', 'off', 'none'].includes((attr(el) ?? '').toLowerCase());

interface RunFmt { b?: boolean; i?: boolean; u?: boolean; sz?: number; font?: string }

function readRPr(rPr: any): RunFmt {
  const f: RunFmt = {};
  if (!rPr) return f;
  const b = kid(rPr, 'w:b'); if (b) f.b = isOn(b);
  const i = kid(rPr, 'w:i'); if (i) f.i = isOn(i);
  const u = kid(rPr, 'w:u'); if (u) f.u = (attr(u) ?? 'single') !== 'none';
  const sz = kid(rPr, 'w:sz'); if (sz && attr(sz)) f.sz = Number(attr(sz));
  const fonts = kid(rPr, 'w:rFonts'); if (fonts) f.font = attr(fonts, 'w:ascii') || attr(fonts, 'w:hAnsi') || undefined;
  return f;
}
const mergeFmt = (base: RunFmt, over: RunFmt): RunFmt => ({ ...base, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) });

interface StyleDef { id: string; name: string; basedOn?: string; jc?: string; numId?: string; ilvl?: number; outline?: number; r: RunFmt }

export function importDocx(buffer: Buffer): ImportResult {
  // ── 1. Ouverture sécurisée du zip (en mémoire) ─────────────────────────────
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new BadRequestException('Fichier invalide : ce n\'est pas un document Word (.docx). Les anciens .doc doivent être réenregistrés en .docx.');
  }
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw new BadRequestException('Fichier Word illisible ou corrompu.');
  }
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new BadRequestException('Ce fichier n\'est pas un document Word (.docx) valide.');
  // Protection contre les « zip bombs » : taille décompressée plafonnée
  const unc = (f: any) => Number(f?._data?.uncompressedSize ?? 0);
  if (unc(docFile) > 15 * 1024 * 1024) throw new BadRequestException('Document trop volumineux.');

  const parse = (name: string): any | null => {
    const f = zip.file(name);
    if (!f || unc(f) > 15 * 1024 * 1024) return null;
    try {
      return new DOMParser({ onError: () => {} } as any).parseFromString(f.asText(), 'text/xml').documentElement;
    } catch {
      return null;
    }
  };

  const docEl = parse('word/document.xml');
  const body = kid(docEl, 'w:body');
  if (!body) throw new BadRequestException('Document Word vide ou illisible.');

  const warnings: string[] = [];
  const counters = { images: 0, textboxes: 0, borderless: 0, nestedTables: 0, indents: 0, paragraphs: 0, tables: 0, lists: 0 };

  // ── 2. Styles (alignement, gras… hérités) ──────────────────────────────────
  const stylesEl = parse('word/styles.xml');
  const styles = new Map<string, StyleDef>();
  let defaultRun: RunFmt = {};
  if (stylesEl) {
    const dd = kid(stylesEl, 'w:docDefaults');
    defaultRun = readRPr(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'));
    for (const s of kids(stylesEl, 'w:style')) {
      const id = attr(s, 'w:styleId');
      if (!id) continue;
      const pPr = kid(s, 'w:pPr');
      const numPr = kid(pPr, 'w:numPr');
      const out = kid(pPr, 'w:outlineLvl');
      styles.set(id, {
        id,
        name: (attr(kid(s, 'w:name')) || id).toLowerCase(),
        basedOn: attr(kid(s, 'w:basedOn')) || undefined,
        jc: attr(kid(pPr, 'w:jc')) || undefined,
        numId: attr(kid(numPr, 'w:numId')) || undefined,
        ilvl: attr(kid(numPr, 'w:ilvl')) !== null ? Number(attr(kid(numPr, 'w:ilvl'))) : undefined,
        outline: out && attr(out) !== null ? Number(attr(out)) : undefined,
        r: readRPr(kid(s, 'w:rPr')),
      });
    }
  }
  const styleChain = (id?: string | null): StyleDef[] => {
    const chain: StyleDef[] = [];
    let cur = id ? styles.get(id) : undefined;
    for (let d = 0; cur && d < 8; d++) { chain.unshift(cur); cur = cur.basedOn ? styles.get(cur.basedOn) : undefined; }
    return chain; // du plus ancien parent au style lui-même
  };

  // Police / taille de base du document
  let docFont = defaultRun.font;
  const normal = [...styles.values()].find((s) => s.name === 'normal' || s.name === 'normal (web)' || s.id === 'Normal');
  const normalFmt = mergeFmt(defaultRun, normal?.r || {});
  docFont = normalFmt.font || docFont;
  if (!docFont) {
    const fontsEl = kid(kid(stylesEl, 'w:docDefaults'), 'w:rPrDefault');
    const theme = parse('word/theme/theme1.xml');
    const hasThemeFont = !!kid(kid(fontsEl, 'w:rPr'), 'w:rFonts')?.hasAttribute?.('w:asciiTheme');
    if (hasThemeFont && theme) {
      const m = /<a:minorFont>\s*<a:latin typeface="([^"]+)"/.exec(new (require('@xmldom/xmldom').XMLSerializer)().serializeToString(theme));
      if (m) docFont = m[1];
    }
  }
  const bodyHalfPts = normalFmt.sz || 22;

  // ── 3. Numérotation (liste à puces ou numérotée ?) ─────────────────────────
  const numberingEl = parse('word/numbering.xml');
  const abstractOf = new Map<string, any>();
  const numToAbstract = new Map<string, string>();
  if (numberingEl) {
    for (const a of kids(numberingEl, 'w:abstractNum')) abstractOf.set(attr(a, 'w:abstractNumId') || '', a);
    for (const n of kids(numberingEl, 'w:num')) {
      const aid = attr(kid(n, 'w:abstractNumId'));
      if (aid !== null) numToAbstract.set(attr(n, 'w:numId') || '', aid);
    }
  }
  const isOrdered = (numId: string, ilvl: number): boolean => {
    const abs = abstractOf.get(numToAbstract.get(numId) || '');
    if (!abs) return false;
    const lvl = kids(abs, 'w:lvl').find((l) => Number(attr(l, 'w:ilvl')) === ilvl) || kids(abs, 'w:lvl')[0];
    const fmt = (attr(kid(lvl, 'w:numFmt')) || 'bullet').toLowerCase();
    return fmt !== 'bullet' && fmt !== 'none';
  };

  // ── 4. Conversion ──────────────────────────────────────────────────────────
  interface Inline { node: DocNode; sz?: number; bold?: boolean }
  interface Entry { node: DocNode; list?: { numId: string; ilvl: number; ordered: boolean } }

  const marksOf = (f: RunFmt) => {
    const m: any[] = [];
    if (f.b) m.push({ type: 'bold' });
    if (f.i) m.push({ type: 'italic' });
    if (f.u) m.push({ type: 'underline' });
    return m.length ? m : undefined;
  };

  const convertParagraph = (p: any): Entry[] => {
    counters.paragraphs++;
    const pPr = kid(p, 'w:pPr');
    const styleId = attr(kid(pPr, 'w:pStyle'));
    const chain = styleChain(styleId);

    // Alignement : style puis format direct
    let jc: string | undefined;
    let numId: string | undefined;
    let ilvl: number | undefined;
    let styleFmt: RunFmt = {};
    let styleOutline: number | undefined;
    for (const s of chain) {
      if (s.jc) jc = s.jc;
      if (s.numId !== undefined) numId = s.numId;
      if (s.ilvl !== undefined) ilvl = s.ilvl;
      if (s.outline !== undefined) styleOutline = s.outline;
      styleFmt = mergeFmt(styleFmt, s.r);
    }
    const directJc = attr(kid(pPr, 'w:jc')); if (directJc) jc = directJc;
    const numPr = kid(pPr, 'w:numPr');
    if (numPr) {
      if (kid(numPr, 'w:numId')) numId = attr(kid(numPr, 'w:numId')) || undefined;
      if (kid(numPr, 'w:ilvl')) ilvl = Number(attr(kid(numPr, 'w:ilvl')));
    }
    const align = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : undefined;

    const ind = kid(pPr, 'w:ind');
    if (ind && Number(attr(ind, 'w:left') || attr(ind, 'w:start') || 0) >= 360) counters.indents++;

    // Titre : style Heading/Titre N, plan hiérarchique, ou titre détecté par la taille
    let level = 0;
    for (const s of chain) {
      const m = /^(?:heading|titre)\s*(\d)$/.exec(s.name);
      if (m) level = Math.min(3, Number(m[1]));
      else if (s.name === 'title' || s.name === 'titre') level = 1;
    }
    const outlineEl = kid(pPr, 'w:outlineLvl');
    const outline = outlineEl ? Number(attr(outlineEl)) : styleOutline;
    if (!level && outline !== undefined && outline >= 0 && outline <= 2) level = outline + 1;

    // Contenu en ligne, avec découpage aux sauts de page
    const segments: Inline[][] = [[]];
    const push = (n: Inline) => segments[segments.length - 1].push(n);

    const pRunBase = mergeFmt(normalFmt, styleFmt);

    const walkRun = (r: any, fmt: RunFmt) => {
      for (let n = r.firstChild; n; n = n.nextSibling) {
        if (n.nodeType !== 1) continue;
        switch (n.nodeName) {
          case 'w:t': {
            const t = n.textContent || '';
            if (t) push({ node: { type: 'text', text: t, ...(marksOf(fmt) && { marks: marksOf(fmt) }) }, sz: fmt.sz, bold: !!fmt.b });
            break;
          }
          case 'w:tab':
            push({ node: { type: 'text', text: NBSP4, ...(marksOf(fmt) && { marks: marksOf(fmt) }) }, sz: fmt.sz, bold: !!fmt.b });
            break;
          case 'w:noBreakHyphen':
            push({ node: { type: 'text', text: '-', ...(marksOf(fmt) && { marks: marksOf(fmt) }) }, sz: fmt.sz, bold: !!fmt.b });
            break;
          case 'w:br': {
            const type = attr(n, 'w:type');
            if (type === 'page') segments.push([]);
            else if (type !== 'column') push({ node: { type: 'hardBreak' } });
            break;
          }
          case 'w:cr':
            push({ node: { type: 'hardBreak' } });
            break;
          case 'w:drawing':
          case 'w:pict':
          case 'w:object':
            if (/txbxContent/.test(n.toString?.() || '')) counters.textboxes++;
            else counters.images++;
            break;
          case 'mc:AlternateContent':
            counters.textboxes++;
            break;
        }
      }
    };

    const walkInline = (parent: any) => {
      for (let n = parent.firstChild; n; n = n.nextSibling) {
        if (n.nodeType !== 1) continue;
        switch (n.nodeName) {
          case 'w:r': {
            const rStyleId = attr(kid(kid(n, 'w:rPr'), 'w:rStyle'));
            let fmt = pRunBase;
            if (rStyleId) for (const s of styleChain(rStyleId)) fmt = mergeFmt(fmt, s.r);
            fmt = mergeFmt(fmt, readRPr(kid(n, 'w:rPr')));
            walkRun(n, fmt);
            break;
          }
          case 'w:hyperlink':
          case 'w:ins':
          case 'w:smartTag':
          case 'w:fldSimple':
          case 'w:sdt':
          case 'w:sdtContent':
          case 'w:customXml':
            walkInline(n);
            break;
          // w:del (suppression suivie), w:bookmarkStart… : ignorés
        }
      }
    };
    walkInline(p);

    const entries: Entry[] = [];
    const pageBreakBefore = isOn(kid(pPr, 'w:pageBreakBefore'));
    if (pageBreakBefore) entries.push({ node: { type: 'pageBreak' } });

    segments.forEach((seg, idx) => {
      // fusionne les textes voisins de même mise en forme
      const content: DocNode[] = [];
      for (const it of seg) {
        const last = content[content.length - 1];
        if (
          it.node.type === 'text' && last?.type === 'text' &&
          JSON.stringify(last.marks || null) === JSON.stringify(it.node.marks || null)
        ) last.text = (last.text || '') + (it.node.text || '');
        else content.push({ ...it.node });
      }
      const isEmpty = content.length === 0;
      const fromBreak = segments.length > 1;
      if (idx > 0) entries.push({ node: { type: 'pageBreak' } });
      if (isEmpty && fromBreak) return; // pas de paragraphe vide autour d'un saut de page

      let node: DocNode;
      const sizes = seg.filter((s) => s.node.type === 'text' && (s.node.text || '').trim()).map((s) => s.sz);
      const allBold = seg.filter((s) => s.node.type === 'text' && (s.node.text || '').trim()).every((s) => s.bold);
      let lvl = level;
      // Heuristique « titre » : tout le texte en gras ET nettement plus grand que le corps
      if (!lvl && !numId && sizes.length && sizes.every((s) => s !== undefined) && allBold) {
        const minSz = Math.min(...(sizes as number[]));
        if (minSz >= bodyHalfPts + 8) lvl = 1;
        else if (minSz >= bodyHalfPts + 4) lvl = 2;
      }
      if (lvl && !isEmpty) {
        node = { type: 'heading', attrs: { level: lvl, ...(align && { textAlign: align }) }, content };
      } else {
        node = { type: 'paragraph', ...(align && { attrs: { textAlign: align } }), content };
      }

      const listed = idx === segments.length - 1 && numId && numId !== '0' && !isEmpty;
      if (listed) {
        const lv = ilvl ?? 0;
        entries.push({ node, list: { numId: numId!, ilvl: lv, ordered: isOrdered(numId!, lv) } });
      } else {
        entries.push({ node });
      }
    });
    return entries;
  };

  /** Regroupe les paragraphes de liste consécutifs en listes imbriquées. */
  const buildBlocks = (entries: Entry[]): DocNode[] => {
    const out: DocNode[] = [];
    let i = 0;
    while (i < entries.length) {
      const e = entries[i];
      if (!e.list) { out.push(e.node); i++; continue; }
      let j = i;
      while (j < entries.length && entries[j].list && entries[j].list!.numId === e.list.numId) j++;
      const group = entries.slice(i, j);
      const base = Math.min(...group.map((g) => g.list!.ilvl));
      const mk = (ordered: boolean): DocNode => ({ type: ordered ? 'orderedList' : 'bulletList', content: [] });
      const root = mk(group[0].list!.ordered);
      const stack: { list: DocNode; level: number }[] = [{ list: root, level: base }];
      for (const g of group) {
        const level = Math.max(g.list!.ilvl, base);
        while (stack.length > 1 && stack[stack.length - 1].level > level) stack.pop();
        if (stack[stack.length - 1].level < level) {
          const top = stack[stack.length - 1].list;
          if (!top.content!.length) top.content!.push({ type: 'listItem', content: [{ type: 'paragraph', content: [] }] });
          const parentItem = top.content![top.content!.length - 1];
          const nl = mk(g.list!.ordered);
          parentItem.content!.push(nl);
          stack.push({ list: nl, level });
        }
        const node = g.node.type === 'heading' ? { type: 'paragraph', content: g.node.content } : g.node;
        stack[stack.length - 1].list.content!.push({ type: 'listItem', content: [node as DocNode] });
      }
      counters.lists++;
      out.push(root);
      i = j;
    }
    return out;
  };

  const convertContainer = (parent: any): Entry[] => {
    const entries: Entry[] = [];
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (n.nodeName === 'w:p') entries.push(...convertParagraph(n));
      else if (n.nodeName === 'w:tbl') entries.push({ node: convertTable(n) });
      else if (n.nodeName === 'w:sdt') {
        const c = kid(n, 'w:sdtContent');
        if (c) entries.push(...convertContainer(c));
      }
    }
    return entries;
  };

  const convertTable = (tbl: any): DocNode => {
    counters.tables++;
    const tblBorders = kid(kid(tbl, 'w:tblPr'), 'w:tblBorders');
    if (tblBorders) {
      const sides = ['w:top', 'w:left', 'w:bottom', 'w:right', 'w:insideH', 'w:insideV'].map((s) => (attr(kid(tblBorders, s)) || '').toLowerCase());
      if (sides.every((v) => v === 'nil' || v === 'none' || v === '')) counters.borderless++;
    }
    const rows: DocNode[] = [];
    const open = new Map<number, DocNode>(); // fusions verticales en cours, par colonne
    for (const tr of kids(tbl, 'w:tr')) {
      const isHeader = !!kid(kid(tr, 'w:trPr'), 'w:tblHeader');
      const cells: DocNode[] = [];
      let col = Number(attr(kid(kid(tr, 'w:trPr'), 'w:gridBefore'))) || 0;
      for (const tc of kids(tr, 'w:tc')) {
        const tcPr = kid(tc, 'w:tcPr');
        const span = Number(attr(kid(tcPr, 'w:gridSpan'))) || 1;
        const vm = kid(tcPr, 'w:vMerge');
        if (vm && (attr(vm) ?? 'continue') !== 'restart') {
          const origin = open.get(col);
          if (origin) origin.attrs = { ...(origin.attrs || {}), rowspan: Number(origin.attrs?.rowspan || 1) + 1 };
          col += span;
          continue;
        }
        const inner = convertContainer(tc);
        if (tc.getElementsByTagName?.('w:tbl')?.length) counters.nestedTables++;
        const blocks = buildBlocks(inner.filter((e) => e.node.type !== 'table'));
        const cell: DocNode = {
          type: isHeader ? 'tableHeader' : 'tableCell',
          ...(span > 1 && { attrs: { colspan: span } }),
          content: blocks.length ? blocks : [{ type: 'paragraph', content: [] }],
        };
        cells.push(cell);
        if (vm) open.set(col, cell); else open.delete(col);
        col += span;
      }
      if (!cells.length) cells.push({ type: 'tableCell', content: [{ type: 'paragraph', content: [] }] });
      rows.push({ type: 'tableRow', content: cells });
    }
    return { type: 'table', content: rows };
  };

  const entries = convertContainer(body);
  let blocks = buildBlocks(entries);

  // Pas plus de 2 paragraphes vides à la suite (les contrats Word en abusent pour espacer)
  const isEmptyP = (n: DocNode) => n.type === 'paragraph' && !(n.content || []).length;
  const squeezed: DocNode[] = [];
  let emptyRun = 0;
  for (const b of blocks) {
    emptyRun = isEmptyP(b) ? emptyRun + 1 : 0;
    if (emptyRun <= 2) squeezed.push(b);
  }
  // retire les vides en tête et en queue
  while (squeezed.length && isEmptyP(squeezed[0])) squeezed.shift();
  while (squeezed.length && isEmptyP(squeezed[squeezed.length - 1])) squeezed.pop();
  blocks = squeezed;

  // ── 5. Paramètres (police, taille, en-tête) ────────────────────────────────
  const settings: TemplateSettings = sanitizeSettings({
    fontFamily: docFont || DEFAULT_SETTINGS.fontFamily,
    fontSize: Math.min(16, Math.max(8, Math.round((bodyHalfPts / 2) * 2) / 2)),
    letterhead: DEFAULT_SETTINGS.letterhead,
  });

  const hasText = (name: string) => {
    const f = zip.file(name);
    return !!f && unc(f) < 5 * 1024 * 1024 && /<w:t[ >][^<]*[^<\s][^<]*<\/w:t>/.test(f.asText());
  };
  const hasHeaderFooter = Object.keys(zip.files).some((n) => /^word\/(header|footer)\d*\.xml$/.test(n) && hasText(n));
  if (hasHeaderFooter) {
    settings.letterhead = false; // on ne reproduit pas leur en-tête : on évite d'en ajouter un deuxième
    warnings.push('L\'en-tête / pied de page de votre fichier n\'est pas repris. Le logo et les coordonnées de l\'entreprise ne seront donc pas ajoutés automatiquement (réglable dans les paramètres du modèle).');
  }
  if (counters.images) warnings.push(`${counters.images} image(s) non reprise(s) (logo, cachet…). Le logo de l'entreprise peut être ajouté en en-tête via les paramètres du modèle.`);
  if (counters.textboxes) warnings.push(`${counters.textboxes} zone(s) de texte non reprise(s) : le texte qu'elles contiennent est à recopier dans le contrat.`);
  if (counters.nestedTables) warnings.push('Des tableaux imbriqués dans un tableau ont été ignorés.');
  if (counters.borderless) warnings.push(`${counters.borderless} tableau(x) sans bordures dans l'original : ils s'affichent ici avec des bordures.`);
  if (counters.indents) warnings.push('Les retraits (paragraphes décalés vers la droite) ne sont pas repris.');

  const content = sanitizeDoc({ type: 'doc', content: blocks });
  const gaps = (JSON.stringify(content).match(GAP_RE) || []).length;

  return { content, settings, warnings, stats: { paragraphs: counters.paragraphs, tables: counters.tables, lists: counters.lists, gaps } };
}