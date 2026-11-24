// ============================================================================
// 📁 src/workforce-dashboard/xlsx-chart-injector.ts
// ✅ Injecte de VRAIS graphiques Excel (natifs, liés aux cellules) dans un
// classeur généré par ExcelJS — ExcelJS ne sait pas créer de graphiques.
//
// Principe : on laisse ExcelJS écrire les cellules/formules/styles, puis on
// rouvre le .xlsx (c'est un zip) et on ajoute les parties OOXML manquantes
// (drawing + chart + relations + content-types). 100 % Node (jszip est déjà
// une dépendance d'exceljs), aucun processus externe.
//
// Les graphiques référencent des plages de cellules (ex. 'TB'!$D$16:$D$17) :
// quand l'utilisateur modifie une valeur dans Excel, le graphique bouge. Le
// cache (numCache/strCache) est rempli pour les visionneuses qui ne
// recalculent pas (aperçu téléphone, etc.).
// ============================================================================

import JSZip = require('jszip');

export type ChartKind =
  | 'col' // histogramme groupé
  | 'colStacked' // histogramme empilé (1 série = comme "Effectif par contrat")
  | 'col3d' // histogramme 3D groupé (genre, nationalité)
  | 'bar' // barres horizontales
  | 'pie'
  | 'line';

export interface ChartSeries {
  name: string; // nom affiché (cache)
  nameRef?: string; // ex. 'TB'!$D$15
  valuesRef: string; // ex. 'TB'!$D$16:$D$17
  vals: number[]; // cache des valeurs
  color?: string; // 'RRGGBB' — couleur de la série
  pointColors?: string[]; // couleur par barre/part (si varyColors)
  labelColor?: string; // couleur des étiquettes de données
}

export interface ChartSpec {
  sheet: string; // nom EXACT de l'onglet
  from: { col: number; row: number }; // 0-based, coin haut-gauche
  to: { col: number; row: number }; // 0-based, coin bas-droit
  kind: ChartKind;
  title?: string;
  titleColor?: string;
  catsRef: string; // ex. 'TB'!$C$16:$C$17
  cats: string[]; // cache des catégories
  series: ChartSeries[];
  showLegend?: boolean;
  dataLabels?: boolean; // défaut true
  gapWidth?: number;
  background?: string; // fond de la zone graphique 'RRGGBB'
  fontSize?: number; // taille des libellés d'axe (1/100 pt) — défaut 900
}

const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';

const esc = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (n: number) => (Number.isFinite(n) ? String(n) : '0');

/** Référence de plage avec nom d'onglet correctement quoté. */
export function sheetRef(sheet: string, range: string): string {
  const q = `'${sheet.replace(/'/g, "''")}'`;
  return `${q}!${range}`;
}

// ───────────────────────────── XML d'un graphique ─────────────────────────────

function txPr(size: number, color = '333333', bold = false): string {
  return (
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}">` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
    `<a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="fr-FR"/></a:p></c:txPr>`
  );
}

function strCache(vals: string[]): string {
  return (
    `<c:strCache><c:ptCount val="${vals.length}"/>` +
    vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('') +
    `</c:strCache>`
  );
}
function numCache(vals: number[]): string {
  return (
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>` +
    vals.map((v, i) => `<c:pt idx="${i}"><c:v>${num(v)}</c:v></c:pt>`).join('') +
    `</c:numCache>`
  );
}

function fill(color: string): string {
  return `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
}

function dLbls(show: boolean, color: string, size: number, pos?: string, percent = false): string {
  if (!show) return `<c:dLbls><c:delete val="1"/></c:dLbls>`;
  return (
    `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(size, color, true)}` +
    (pos ? `<c:dLblPos val="${pos}"/>` : '') +
    `<c:showLegendKey val="0"/><c:showVal val="${percent ? 0 : 1}"/><c:showCatName val="0"/>` +
    `<c:showSerName val="0"/><c:showPercent val="${percent ? 1 : 0}"/><c:showBubbleSize val="0"/>` +
    (percent ? `<c:showLeaderLines val="1"/>` : '') +
    `</c:dLbls>`
  );
}

function serXml(spec: ChartSpec, s: ChartSeries, idx: number): string {
  const kind = spec.kind;
  const showLabels = spec.dataLabels !== false;
  const labelColor = s.labelColor ?? (kind === 'pie' ? 'FFFFFF' : '333333');
  const tx = s.nameRef
    ? `<c:tx><c:strRef><c:f>${esc(s.nameRef)}</c:f>${strCache([s.name])}</c:strRef></c:tx>`
    : `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;

  let sp = '';
  if (kind === 'line') {
    sp = `<c:spPr><a:ln w="31750" cap="rnd">${fill(s.color ?? '4472C4')}<a:round/></a:ln></c:spPr>` +
      `<c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr>${fill(s.color ?? '4472C4')}<a:ln><a:noFill/></a:ln></c:spPr></c:marker>`;
  } else if (kind !== 'pie') {
    sp = `<c:spPr>${fill(s.color ?? '4472C4')}</c:spPr><c:invertIfNegative val="0"/>`;
  }

  let dpts = '';
  if (s.pointColors && kind !== 'line') {
    dpts = s.pointColors
      .map(
        (c, i) =>
          `<c:dPt><c:idx val="${i}"/>${kind === 'pie' ? '' : '<c:invertIfNegative val="0"/>'}<c:bubble3D val="0"/><c:spPr>${fill(c)}${
            kind === 'pie' ? '<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>' : ''
          }</c:spPr></c:dPt>`,
      )
      .join('');
  }

  const pos =
    kind === 'pie' ? 'bestFit' : kind === 'line' ? 't' : kind === 'colStacked' ? 'ctr' : kind === 'col3d' ? undefined : 'outEnd';
  const lbl = dLbls(showLabels, labelColor, 900, pos, kind === 'pie');

  const cat = `<c:cat><c:strRef><c:f>${esc(spec.catsRef)}</c:f>${strCache(spec.cats)}</c:strRef></c:cat>`;
  const val = `<c:val><c:numRef><c:f>${esc(s.valuesRef)}</c:f>${numCache(s.vals)}</c:numRef></c:val>`;
  const tail = kind === 'line' ? '<c:smooth val="0"/>' : '';
  return `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>${tx}${sp}${dpts}${lbl}${cat}${val}${tail}</c:ser>`;
}

function axesXml(spec: ChartSpec, horizontal: boolean): string {
  const size = spec.fontSize ?? 900;
  const axLine = `<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>`;
  const cat =
    `<c:catAx><c:axId val="111111"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axLine}${txPr(size, '404040')}` +
    `<c:crossAx val="222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const val =
    `<c:valAx><c:axId val="222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${horizontal ? 't' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E5E5"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>` +
    `<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(size, '595959')}<c:crossAx val="111111"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  return cat + val;
}

export function buildChartXml(spec: ChartSpec): string {
  const kind = spec.kind;
  const sers = spec.series.map((s, i) => serXml(spec, s, i)).join('');
  const gap = spec.gapWidth ?? 80;
  let plot = '';

  if (kind === 'pie') {
    plot = `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>`;
  } else if (kind === 'line') {
    plot =
      `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>` +
      `<c:axId val="111111"/><c:axId val="222222"/></c:lineChart>${axesXml(spec, false)}`;
  } else if (kind === 'col3d') {
    plot =
      `<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}` +
      `<c:gapWidth val="${gap}"/><c:shape val="box"/><c:axId val="111111"/><c:axId val="222222"/><c:axId val="0"/></c:bar3DChart>` +
      axesXml(spec, false);
  } else {
    const horizontal = kind === 'bar';
    const grouping = kind === 'colStacked' ? 'stacked' : 'clustered';
    plot =
      `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}` +
      `<c:gapWidth val="${gap}"/>${kind === 'colStacked' ? '<c:overlap val="100"/>' : ''}` +
      `<c:axId val="111111"/><c:axId val="222222"/></c:barChart>${axesXml(spec, horizontal)}`;
  }

  const view3d =
    kind === 'col3d'
      ? `<c:view3D><c:rotX val="10"/><c:rotY val="15"/><c:depthPercent val="60"/><c:rAngAx val="1"/></c:view3D>` +
        `<c:floor><c:thickness val="0"/></c:floor><c:sideWall><c:thickness val="0"/></c:sideWall><c:backWall><c:thickness val="0"/></c:backWall>`
      : '';

  const title = spec.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"><a:solidFill><a:srgbClr val="${spec.titleColor ?? '1F3864'}"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr>` +
      `<a:r><a:rPr lang="fr-FR" sz="1100" b="1"><a:solidFill><a:srgbClr val="${spec.titleColor ?? '1F3864'}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`;

  const legend = spec.showLegend
    ? `<c:legend><c:legendPos val="${kind === 'pie' ? 'r' : 'b'}"/><c:overlay val="0"/>${txPr(900, '404040')}</c:legend>`
    : '';

  const bg = spec.background ?? 'FFFFFF';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>` +
    `<c:chart>${title}${view3d}<c:plotArea><c:layout/>${plot}<c:spPr><a:noFill/></c:spPr></c:plotArea>${legend}` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${fill(bg)}<a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="fr-FR"/></a:p></c:txPr>` +
    `</c:chartSpace>`
  );
}

// ─────────────────────────────── Injection ZIP ────────────────────────────────

function anchorXml(spec: ChartSpec, relId: string, shapeId: number, name: string): string {
  return (
    `<xdr:twoCellAnchor editAs="oneCell">` +
    `<xdr:from><xdr:col>${spec.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${spec.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${spec.to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${spec.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic>` +
    `<a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${relId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  );
}

const decodeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function nextIndex(zip: JSZip, dir: string, prefix: string): number {
  let max = 0;
  const re = new RegExp(`^${dir.replace(/\//g, '\\/')}${prefix}(\\d+)\\.xml$`);
  zip.forEach((p) => {
    const m = p.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max + 1;
}

export async function injectCharts(xlsx: Buffer, charts: ChartSpec[]): Promise<Buffer> {
  if (charts.length === 0) return xlsx;
  const zip = await JSZip.loadAsync(xlsx);

  // 1) nom d'onglet → fichier de feuille
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const relTarget = new Map<string, string>();
  for (const m of wbRels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relTarget.set(id, target);
  }
  const sheetFile = new Map<string, string>();
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = m[0].match(/\bname="([^"]*)"/)?.[1];
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    if (!name || !rid) continue;
    let t = relTarget.get(rid) ?? '';
    t = t.replace(/^\//, '');
    sheetFile.set(decodeXml(name), t.startsWith('xl/') ? t : `xl/${t}`);
  }

  // 2) groupe par onglet
  const bySheet = new Map<string, ChartSpec[]>();
  for (const c of charts) {
    if (!sheetFile.has(c.sheet)) throw new Error(`injectCharts: onglet introuvable "${c.sheet}"`);
    if (!bySheet.has(c.sheet)) bySheet.set(c.sheet, []);
    bySheet.get(c.sheet)!.push(c);
  }

  let ct = await zip.file('[Content_Types].xml')!.async('string');
  const addOverride = (part: string, type: string) => {
    if (!ct.includes(`PartName="${part}"`)) {
      ct = ct.replace('</Types>', `<Override PartName="${part}" ContentType="${type}"/></Types>`);
    }
  };

  let chartIdx = nextIndex(zip, 'xl/charts/', 'chart');

  for (const [sheet, specs] of bySheet) {
    const sheetPath = sheetFile.get(sheet)!;
    const sheetName = sheetPath.split('/').pop()!;
    const relsPath = `xl/worksheets/_rels/${sheetName}.rels`;
    let sheetXml = await zip.file(sheetPath)!.async('string');
    let sheetRels = zip.file(relsPath)
      ? await zip.file(relsPath)!.async('string')
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

    // drawing existant (ex. logo ajouté par ExcelJS) ?
    let drawingPath: string | null = null;
    const existing = sheetXml.match(/<drawing\b[^>]*r:id="([^"]+)"[^>]*\/>/);
    if (existing) {
      const relMatch = [...sheetRels.matchAll(/<Relationship\b[^>]*>/g)].find((m) => m[0].includes(`Id="${existing[1]}"`));
      const target = relMatch?.[0].match(/\bTarget="([^"]+)"/)?.[1];
      if (target) {
        drawingPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\.\//, '')}`;
      }
    }

    let drawingXml: string;
    let drawingRels: string;
    let drawingRelsPath: string;
    if (drawingPath && zip.file(drawingPath)) {
      drawingXml = await zip.file(drawingPath)!.async('string');
      drawingRelsPath = `xl/drawings/_rels/${drawingPath.split('/').pop()}.rels`;
      drawingRels = zip.file(drawingRelsPath)
        ? await zip.file(drawingRelsPath)!.async('string')
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    } else {
      const di = nextIndex(zip, 'xl/drawings/', 'drawing');
      drawingPath = `xl/drawings/drawing${di}.xml`;
      drawingRelsPath = `xl/drawings/_rels/drawing${di}.xml.rels`;
      drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}"></xdr:wsDr>`;
      drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
      addOverride(`/${drawingPath}`, CT_DRAWING);

      // relation feuille → drawing
      const rid = `rIdWfDrawing${di}`;
      sheetRels = sheetRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_DRAWING}" Target="../drawings/drawing${di}.xml"/></Relationships>`);
      if (!/xmlns:r=/.test(sheetXml.slice(0, 800))) {
        sheetXml = sheetXml.replace('<worksheet ', `<worksheet xmlns:r="${NS_R}" `);
      }
      const tag = `<drawing r:id="${rid}"/>`;
      const after = sheetXml.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
      sheetXml = after >= 0 ? sheetXml.slice(0, after) + tag + sheetXml.slice(after) : sheetXml.replace('</worksheet>', `${tag}</worksheet>`);
    }

    let shapeId = 1000;
    const anchors: string[] = [];
    let relXml = '';
    for (const spec of specs) {
      const n = chartIdx++;
      zip.file(`xl/charts/chart${n}.xml`, buildChartXml(spec));
      addOverride(`/xl/charts/chart${n}.xml`, CT_CHART);
      const rId = `rIdWfChart${n}`;
      relXml += `<Relationship Id="${rId}" Type="${REL_CHART}" Target="../charts/chart${n}.xml"/>`;
      anchors.push(anchorXml(spec, rId, shapeId++, `Graphique ${n}`));
    }
    drawingRels = drawingRels.replace('</Relationships>', `${relXml}</Relationships>`);
    drawingXml = drawingXml.replace('</xdr:wsDr>', `${anchors.join('')}</xdr:wsDr>`);

    zip.file(drawingPath, drawingXml);
    zip.file(drawingRelsPath, drawingRels);
    zip.file(sheetPath, sheetXml);
    zip.file(relsPath, sheetRels);
  }

  zip.file('[Content_Types].xml', ct);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}