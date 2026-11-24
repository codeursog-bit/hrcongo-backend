// ============================================================================
// 📁 src/contract-templates/contract-doc.ts
//
// Format SOURCE UNIQUE d'un modèle de contrat : un document JSON de type
// TipTap/ProseMirror. Le Word (docx) et le PDF (pdfkit) sont tous deux générés
// à partir de CE JSON — donc toujours identiques entre eux.
//
// Rien ici n'est stocké sous forme de fichier : le JSON vit dans Postgres
// (quelques Ko par modèle).
//
// Nœuds autorisés (liste blanche — tout le reste est supprimé à l'enregistrement,
// ce qui protège aussi contre du HTML/JS collé depuis Word ou le web) :
//   doc, paragraph, heading, bulletList, orderedList, listItem, table,
//   tableRow, tableCell, tableHeader, hardBreak, text, variable, pageBreak
// Marques : bold, italic, underline
// ============================================================================

import { BadRequestException } from '@nestjs/common';

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface DocMark { type: 'bold' | 'italic' | 'underline' }

export interface DocNode {
  type: string;
  attrs?: Record<string, any>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

export interface TemplateSettings {
  fontFamily: string; // ex. 'Times New Roman'
  fontSize: number; // en points, ex. 11
  letterhead: boolean; // logo en en-tête + pied de page de l'entreprise (désactivable)
  /** Modèle copié depuis un modèle Konza (id du modèle système d'origine) */
  fromSystemTemplate?: string;
  /** L'entreprise confirme avoir adapté ce modèle et l'avoir fait relire par un juriste */
  legalReviewed?: boolean;
}

export const DEFAULT_SETTINGS: TemplateSettings = {
  fontFamily: 'Times New Roman',
  fontSize: 11,
  letterhead: true,
};

const BLOCK_CHILDREN: Record<string, string[]> = {
  doc: ['paragraph', 'heading', 'bulletList', 'orderedList', 'table', 'pageBreak'],
  paragraph: ['text', 'variable', 'hardBreak'],
  heading: ['text', 'variable', 'hardBreak'],
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  listItem: ['paragraph', 'bulletList', 'orderedList'],
  table: ['tableRow'],
  tableRow: ['tableCell', 'tableHeader'],
  tableCell: ['paragraph', 'heading', 'bulletList', 'orderedList'],
  tableHeader: ['paragraph', 'heading', 'bulletList', 'orderedList'],
};

const MARKS = new Set(['bold', 'italic', 'underline']);
const ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const VAR_KEY = /^[a-z0-9_]{1,60}$/;

const MAX_NODES = 30000;
const MAX_DEPTH = 12;
const MAX_TEXT = 5000;

/** Nettoie un document venant du client : liste blanche stricte. */
export function sanitizeDoc(input: any): DocNode {
  if (!input || typeof input !== 'object' || input.type !== 'doc') {
    throw new BadRequestException('Contenu du modèle invalide (document attendu)');
  }
  let count = 0;

  const cleanMarks = (marks: any): DocMark[] | undefined => {
    if (!Array.isArray(marks)) return undefined;
    const out: DocMark[] = [];
    for (const m of marks) {
      if (m && MARKS.has(m.type) && !out.some((x) => x.type === m.type)) out.push({ type: m.type });
    }
    return out.length ? out : undefined;
  };

  const clean = (node: any, parentType: string, depth: number): DocNode | null => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return null;
    if (depth > MAX_DEPTH) return null;
    if (++count > MAX_NODES) throw new BadRequestException('Modèle trop volumineux');

    const allowed = BLOCK_CHILDREN[parentType];
    if (!allowed || !allowed.includes(node.type)) return null;

    switch (node.type) {
      case 'text': {
        if (typeof node.text !== 'string' || node.text.length === 0) return null;
        const out: DocNode = { type: 'text', text: node.text.slice(0, MAX_TEXT) };
        const marks = cleanMarks(node.marks);
        if (marks) out.marks = marks;
        return out;
      }
      case 'variable': {
        const key = String(node.attrs?.key ?? '');
        if (!VAR_KEY.test(key)) return null;
        const out: DocNode = { type: 'variable', attrs: { key } };
        const marks = cleanMarks(node.marks);
        if (marks) out.marks = marks;
        return out;
      }
      case 'hardBreak':
        return { type: 'hardBreak' };
      case 'pageBreak':
        return { type: 'pageBreak' };
      case 'paragraph':
      case 'heading': {
        const out: DocNode = { type: node.type };
        const attrs: Record<string, any> = {};
        if (ALIGNS.has(node.attrs?.textAlign)) attrs.textAlign = node.attrs.textAlign;
        if (node.type === 'heading') {
          const lvl = Number(node.attrs?.level);
          attrs.level = lvl >= 1 && lvl <= 3 ? lvl : 2;
        }
        if (Object.keys(attrs).length) out.attrs = attrs;
        out.content = cleanChildren(node.content, node.type, depth);
        return out;
      }
      case 'tableCell':
      case 'tableHeader': {
        const out: DocNode = { type: node.type };
        const colspan = Number(node.attrs?.colspan);
        const rowspan = Number(node.attrs?.rowspan);
        const attrs: Record<string, any> = {};
        if (colspan > 1 && colspan <= 12) attrs.colspan = colspan;
        if (rowspan > 1 && rowspan <= 50) attrs.rowspan = rowspan;
        if (Object.keys(attrs).length) out.attrs = attrs;
        out.content = cleanChildren(node.content, node.type, depth);
        if (!out.content.length) out.content = [{ type: 'paragraph', content: [] }];
        return out;
      }
      default: {
        const out: DocNode = { type: node.type };
        out.content = cleanChildren(node.content, node.type, depth);
        return out;
      }
    }
  };

  const cleanChildren = (children: any, parentType: string, depth: number): DocNode[] => {
    if (!Array.isArray(children)) return [];
    const out: DocNode[] = [];
    for (const c of children) {
      const n = clean(c, parentType, depth + 1);
      if (n) out.push(n);
    }
    return out;
  };

  const doc: DocNode = { type: 'doc', content: cleanChildren(input.content, 'doc', 0) };
  if (!doc.content!.length) doc.content = [{ type: 'paragraph', content: [] }];
  return doc;
}

export function sanitizeSettings(input: any): TemplateSettings {
  const font = typeof input?.fontFamily === 'string' ? input.fontFamily.replace(/[^\w \-]/g, '').slice(0, 60) : '';
  const size = Number(input?.fontSize);
  const from = typeof input?.fromSystemTemplate === 'string' && /^[0-9a-f-]{36}$/i.test(input.fromSystemTemplate)
    ? input.fromSystemTemplate : undefined;
  return {
    ...(from && { fromSystemTemplate: from }),
    ...(typeof input?.legalReviewed === 'boolean' && { legalReviewed: input.legalReviewed }),
    fontFamily: font || DEFAULT_SETTINGS.fontFamily,
    fontSize: size >= 8 && size <= 16 ? size : DEFAULT_SETTINGS.fontSize,
    letterhead: typeof input?.letterhead === 'boolean' ? input.letterhead : DEFAULT_SETTINGS.letterhead,
  };
}

/** Toutes les variables {cle} utilisées dans un document. */
export function extractVariableKeys(doc: DocNode): string[] {
  const keys = new Set<string>();
  const walk = (n: DocNode) => {
    if (n.type === 'variable' && n.attrs?.key) keys.add(String(n.attrs.key));
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...keys];
}

/**
 * Remplace chaque nœud `variable` par un nœud texte (en gardant ses marques
 * gras/italique/souligné). Les renderers ne voient donc que du texte.
 */
export function applyValues(doc: DocNode, values: Record<string, string>): DocNode {
  const sameMarks = (a?: DocMark[], b?: DocMark[]) => JSON.stringify(a || []) === JSON.stringify(b || []);
  const walk = (n: DocNode): DocNode => {
    if (n.type === 'variable') {
      const v = values[String(n.attrs?.key)] ?? '';
      const out: DocNode = { type: 'text', text: v };
      if (n.marks) out.marks = n.marks;
      return out;
    }
    if (!n.content) return n;
    const content: DocNode[] = [];
    for (const c of n.content) {
      const r = walk(c);
      if (r.type === 'text' && !r.text) continue;
      const last = content[content.length - 1];
      // fusionne les textes voisins de même mise en forme : une phrase = un seul bloc
      // (sinon la justification du PDF étire les espaces à chaque frontière de variable)
      if (r.type === 'text' && last?.type === 'text' && sameMarks(last.marks, r.marks)) {
        content[content.length - 1] = { ...last, text: (last.text || '') + (r.text || '') };
      } else {
        content.push(r);
      }
    }
    return { ...n, content };
  };
  return walk(doc);
}

export const fmtMoney = (n: number) =>
  Math.round(n || 0).toLocaleString('fr-FR').replace(/\u202F|\u00A0/g, ' ');

export const fmtDateFr = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

/** Récupère un logo (URL http ou data:URI base64). */
export async function fetchLogo(logo?: string | null): Promise<{ buffer: Buffer; type: 'png' | 'jpg' } | null> {
  if (!logo) return null;
  try {
    let buffer: Buffer;
    if (logo.startsWith('data:')) {
      const b64 = logo.split(',')[1] || '';
      buffer = Buffer.from(b64, 'base64');
    } else {
      const res = await fetch(logo);
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
    }
    const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50;
    const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
    if (!isPng && !isJpg) return null; // svg/webp : non supportés → pas de logo plutôt qu'un crash
    return { buffer, type: isPng ? 'png' : 'jpg' };
  } catch {
    return null;
  }
}