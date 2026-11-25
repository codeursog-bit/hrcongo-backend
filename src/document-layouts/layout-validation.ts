import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import Joi from 'joi';

const key = Joi.string().pattern(/^[\w.:-]{1,120}$/);
const caption = Joi.string()
  .max(80)
  .pattern(/^[^<>]*$/);
const colors = Joi.string().pattern(/^#[a-f\d]{6}$/i);
const separator = Joi.object({
  style: Joi.valid('solid', 'dashed', 'thick').required(),
  color: colors,
  word: caption,
});
const optionalColors = {
  ink: colors,
  muted: colors,
  main: colors,
  line: colors,
  accent: colors,
  headFill: colors,
  headText: colors,
  soft: colors,
  thin: colors,
  netHeadFill: colors,
  netHeadText: colors,
  netCellFill: colors,
  netCellText: colors,
  background: colors,
  companyText: colors,
  fieldLabel: colors,
  fieldValue: colors,
  totalsText: colors,
};
const font = Joi.string().valid('carlito', 'caladea', 'liberation-sans');
const names = Joi.object().pattern(key, caption).max(250);
const width = Joi.number().greater(0).max(100).required();
const groups = Joi.array()
  .items(Joi.array().items(key).max(40))
  .min(1)
  .max(12)
  .required();
const fields = Joi.object({
  groups,
  labels: names,
  hidden: Joi.array().items(key.invalid('employee.fullName')).unique().max(40),
});
const rows = Joi.array().items(key).unique().max(300).required();
const totalsColumns = Joi.array()
  .items(
    Joi.object({
      key: key.required(),
      label: caption.required(),
      widthPct: width,
    }),
  )
  .unique('key')
  .min(2)
  .max(12)
  .required();

const table = Joi.object({
  columns: Joi.array()
    .items(
      Joi.object({
        key: key.required(),
        widthPct: width,
        label: caption,
        visible: Joi.boolean().required(),
        align: Joi.string().valid('left', 'center', 'right').required(),
        group: key,
        strong: Joi.boolean(),
      }),
    )
    .unique('key')
    .min(1)
    .max(16)
    .required(),
  groups: names,
  rows: Joi.object({
    order: rows,
    hidden: rows,
    autoAppendUnknown: Joi.valid(true).required(),
  }).required(),
  fill: Joi.string().valid('content', 'page').required(),
  totalsStyle: Joi.string().valid('fill', 'rules').required(),
});

const blockConfigs = {
  header: Joi.object({ title: caption.required() }),
  meta: fields,
  fieldGroup: fields,
  table,
  cumuls: Joi.object({
    columns: totalsColumns,
    separator,
    highlight: Joi.object({
      column: key.required(),
      valueKey: key.required(),
    }).required(),
  }),
  signatures: Joi.object({
    captions: Joi.array().items(caption).min(1).max(6).required(),
  }),
  freeText: Joi.object({
    text: Joi.string()
      .max(500)
      .pattern(/^[^<>]*$/)
      .allow('')
      .required(),
  }),
  divider: Joi.object({}),
  spacer: Joi.object({}),
  leaveBalance: Joi.object({}),
} as const;

const blocks = Object.entries(blockConfigs).map(([type, config]) =>
  Joi.object({
    id: key.required(),
    type: Joi.valid(type).required(),
    row: Joi.number().integer().min(1).max(60).required(),
    col: Joi.number().integer().min(1).max(12).required(),
    span: Joi.number().integer().min(1).max(12).required(),
    visible: Joi.boolean().required(),
    locked: Joi.boolean(),
    colors: Joi.object(optionalColors),
    separator,
    sectionSeparators: Joi.object().pattern(key, separator).max(100),
    sectionColors: Joi.object()
      .pattern(key, Joi.object({ ink: colors, background: colors }).min(1))
      .max(80),
    heightMm: Joi.alternatives().try(
      Joi.number().min(0).max(250),
      Joi.valid('auto', 'fill'),
    ),
    config: config.required(),
  }),
);

const margin = Joi.number().min(0).max(45).required();
const layoutSchema = Joi.object({
  shapes: Joi.array()
    .items(
      Joi.object({
        id: key.required(),
        anchor: key.required(),
        x: Joi.number().min(0).max(100).required(),
        y: Joi.number().min(0).max(100).required(),
        width: Joi.number().min(0.5).max(100).required(),
        thickness: Joi.number().min(0.25).max(12).required(),
        color: colors.required(),
        style: Joi.valid('solid', 'dashed').required(),
      }),
    )
    .unique('id')
    .max(60),
  schemaVersion: Joi.valid(2).required(),
  independent: Joi.valid(true),
  docType: Joi.valid('PAYSLIP').required(),
  basePreset: Joi.valid(
    'A_BLEU',
    'B_VERT',
    'C_ARDOISE',
    'D_BORDEAUX',
    'REFERENCE',
    'LEGACY_DEFAULT',
    'LEGACY_CLARIFIE',
    'LEGACY_CLASSIQUE',
    'LEGACY_INF',
    'BLANK',
  ).required(),
  useOriginal: Joi.when('basePreset', {
    is: Joi.valid(
      'LEGACY_DEFAULT',
      'LEGACY_CLARIFIE',
      'LEGACY_CLASSIQUE',
      'LEGACY_INF',
    ),
    then: Joi.valid(true),
    otherwise: Joi.forbidden(),
  }),
  page: Joi.object({
    size: Joi.valid('A4').required(),
    orientation: Joi.valid('portrait', 'landscape').required(),
    marginsMm: Joi.object({
      top: margin,
      left: margin,
      right: margin,
      bottom: margin,
    }).required(),
  }).required(),
  tokens: Joi.object({
    fonts: Joi.object({
      title: font.required(),
      body: font.required(),
    }).required(),
    sizeBasePt: Joi.number().min(8).max(11).required(),
    lineWidthPt: Joi.number().min(0.25).max(1.5).required(),
    colors: Joi.object({
      ...optionalColors,
      ink: colors.required(),
      muted: colors.required(),
      main: colors.required(),
      line: colors.required(),
    }).required(),
  }).required(),
  variants: Joi.object({
    header: Joi.valid('title-right-big', 'centered', 'stacked').required(),
    title: Joi.valid('uppercase').required(),
    section: Joi.valid('single', 'double').required(),
    field: Joi.valid('label-value').required(),
    table: Joi.valid('grid', 'grouped').required(),
    signature: Joi.valid('empty-box').required(),
    footer: Joi.valid('centered').required(),
  }).required(),
  blocks: Joi.array()
    .items(Joi.alternatives().try(...blocks))
    .unique('id')
    .min(4)
    .max(60)
    .required(),
  labels: names.required(),
  logo: Joi.object({
    assetUrl: Joi.string()
      .max(450)
      .uri({ scheme: ['https'] })
      .allow('')
      .required(),
    align: Joi.valid('left', 'center', 'right').required(),
    widthMm: Joi.number().min(8).max(75).required(),
    hideNameWhenLogo: Joi.boolean().required(),
  }),
  footer: Joi.object({
    text: Joi.string()
      .max(500)
      .pattern(/^[^<>]*$/)
      .allow(''),
    showPageNumber: Joi.boolean().required(),
    colors: Joi.object({ ink: colors, background: colors }),
    separator,
  }).required(),
});

type ValidatedConfig = Prisma.InputJsonObject & {
  basePreset: string;
  logo?: { assetUrl: string };
  blocks: {
    type: string;
    col: number;
    span: number;
    visible: boolean;
    locked?: boolean;
    config: {
      groups?: string[][];
      columns?: { key: string; widthPct: number; visible?: boolean }[];
      highlight?: { column: string; valueKey: string };
    };
  }[];
};

const adminText = Joi.string()
  .max(600)
  .pattern(/^[^<>]*$/);
const adminList = Joi.array().items(adminText).max(35);
const adminBlock = Joi.object({
  id: key.required(),
  type: Joi.valid(
    'header',
    'fieldGroup',
    'table',
    'checklist',
    'textLines',
    'declaration',
    'dateSignature',
    'decision',
    'reviewTable',
    'signatures',
    'note',
    'divider',
  ).required(),
  row: Joi.number().integer().min(1).max(60).required(),
  col: Joi.number().integer().min(1).max(12).required(),
  span: Joi.number().integer().min(1).max(12).required(),
  visible: Joi.boolean().required(),
  locked: Joi.boolean(),
  colors: Joi.object(optionalColors),
  separator,
  sectionSeparators: Joi.object().pattern(key, separator).max(100),
  sectionColors: Joi.object()
    .pattern(key, Joi.object({ ink: colors, background: colors }).min(1))
    .max(80),
  config: Joi.object({
    type: Joi.valid(
      'fieldGroup',
      'motifTable',
      'invoiceTable',
      'checklist',
      'textLines',
      'declaration',
      'dateSignature',
      'decision',
      'reviewTable',
      'signatures',
      'note',
      'divider',
    ),
    title: adminText,
    subtitle: adminText,
    intro: adminText,
    titre: adminText,
    label: adminText,
    texte: adminText,
    date: adminText,
    signature: adminText,
    commentaire: adminText,
    ligneFinale: adminText,
    hauteurRelative: adminText,
    valueKey: key,
    champs: Joi.array()
      .items(Joi.array().ordered(key.required(), caption.required()).length(2))
      .max(40),
    colonnes: Joi.alternatives().try(
      Joi.number().integer().min(1).max(6),
      adminList,
    ),
    items: adminList,
    options: adminList,
    optionKeys: Joi.array().items(key.allow('')).max(20),
    lignes: Joi.alternatives().try(
      Joi.number().integer().min(1).max(10),
      Joi.array()
        .items(
          adminText,
          Joi.object({
            key: key.required(),
            label: adminText.required(),
            jours: Joi.number().min(0).max(365).allow(null).required(),
          }),
        )
        .max(40),
    ),
  }).required(),
});
const adminSchema = layoutSchema.keys({
  docType: Joi.valid(
    'LEAVE',
    'ABSENCE',
    'EXIT_PERMISSION',
    'LOAN',
    'ADVANCE',
  ).required(),
  basePreset: Joi.valid(
    'A_CLASSIQUE',
    'B_MODERNE',
    'C_INSTITUTIONNEL',
    'D_CARTOUCHE',
    'HIST_ORCA',
    'HIST_STANDARD',
    'HIST_MODERN',
    'HIST_TICKET',
    'STANDARD_TICKET_A4',
    'BLANK',
  ).required(),
  useOriginal: Joi.when('basePreset', {
    is: Joi.valid('HIST_ORCA', 'HIST_STANDARD', 'HIST_MODERN', 'HIST_TICKET'),
    then: Joi.valid(true),
    otherwise: Joi.forbidden(),
  }),
  variants: Joi.object({
    header: Joi.valid(
      'wordmark-rules',
      'bar-wordmark',
      'dark-band',
      'cartouche-3-cells',
    ).required(),
    title: Joi.valid(
      'center-serif-caps-spaced',
      'left-bold-sans',
      'center-bold-sans',
      'inside-cartouche',
    ).required(),
    section: Joi.valid(
      'roman-hairline',
      'number-left-bar',
      'grey-band-left-bar',
      'pale-band-centered',
    ).required(),
    field: Joi.valid(
      'leader-dots',
      'stacked-label-over-line',
      'boxed-label-top',
      'label-cell-left',
    ).required(),
    table: Joi.valid(
      'rules',
      'minimal-rules',
      'grid',
      'grid-filled-header',
    ).required(),
    signature: Joi.valid(
      'box-pale-header',
      'line-caption',
      'dark-header-box',
      'pale-header-box',
    ).required(),
    footer: Joi.valid(
      'centered-hairline',
      'left-colored-rule',
      'centered-slate-rule',
      'centered-double-rule',
    ).required(),
  }).required(),
  blocks: Joi.array().items(adminBlock).unique('id').min(2).max(60).required(),
});
const invoiceSchema = adminSchema.keys({
  docType: Joi.valid('CONTRACTOR_INVOICE').required(),
  basePreset: Joi.valid(
    'INVOICE_FORFAIT',
    'INVOICE_DETAILED',
    'INVOICE_PRO',
    'BLANK',
  ).required(),
  useOriginal: Joi.when('basePreset', {
    is: 'BLANK',
    then: Joi.forbidden(),
    otherwise: Joi.valid(true),
  }),
});
type AdministrativeConfig = Prisma.InputJsonObject & {
  docType: string;
  basePreset: string;
  logo?: { assetUrl: string };
  blocks: {
    type: string;
    col: number;
    span: number;
    visible: boolean;
    locked?: boolean;
  }[];
};
const administrativeNames: Record<string, string> = {
  A_CLASSIQUE: 'Classique',
  B_MODERNE: 'Moderne',
  C_INSTITUTIONNEL: 'Institutionnel',
  D_CARTOUCHE: 'Cartouche',
  HIST_ORCA: 'Modèle 1 · Orca',
  HIST_STANDARD: 'Modèle 2 · Standard',
  HIST_MODERN: 'Modèle 3 · Moderne',
  HIST_TICKET: 'Ticket historique',
  STANDARD_TICKET_A4: 'Fiche Standard A4',
  INVOICE_FORFAIT: 'Facture forfait',
  INVOICE_DETAILED: 'Facture détaillée',
  INVOICE_PRO: 'Facture professionnelle',
  BLANK: 'Mon modèle',
};

function validateShapes(config: { shapes?: unknown; blocks: unknown }) {
  const blocks = config.blocks as { id: string }[];
  const shapes = (config.shapes ?? []) as {
    anchor: string;
    x: number;
    width: number;
  }[];
  if (
    shapes.some(
      (shape) =>
        shape.x + shape.width > 100.000001 ||
        (shape.anchor !== 'page' &&
          !blocks.some((block) => block.id === shape.anchor)),
    )
  ) {
    throw new BadRequestException('La position du séparateur dépasse sa zone.');
  }
}

export function validateLayoutBody(body: unknown, docType = 'PAYSLIP') {
  if (Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8') > 40 * 1024) {
    throw new BadRequestException('Le modèle dépasse 40 Ko.');
  }
  if (docType !== 'PAYSLIP') {
    const result = Joi.object<{ config: AdministrativeConfig; name?: string }>({
      config: (docType === 'CONTRACTOR_INVOICE'
        ? invoiceSchema
        : adminSchema
      ).required(),
      name: caption.trim(),
    })
      .required()
      .validate(body, { convert: false });
    if (result.error)
      throw new BadRequestException(
        `Design administratif invalide (${result.error.details[0].path.join('.')}).`,
      );
    const { config } = result.value;
    validateShapes(config);
    if (docType === 'CONTRACTOR_INVOICE') {
      const invoiceBlocks = config.blocks as unknown as {
        type: string;
        visible: boolean;
        locked?: boolean;
        config: { type?: string; champs?: string[][] };
      }[];
      const fields = invoiceBlocks
        .filter((block) => block.visible && block.locked)
        .flatMap((block) => block.config.champs ?? [])
        .map(([key]) => key);
      if (
        !['employee.fullName', 'pay.grossSalary', 'pay.netSalary'].every(
          (key) => fields.includes(key),
        ) ||
        !invoiceBlocks.some(
          (block) =>
            block.visible &&
            block.locked &&
            block.type === 'table' &&
            block.config.type === 'invoiceTable',
        )
      ) {
        throw new BadRequestException(
          'Les informations et montants obligatoires de la facture sont manquants.',
        );
      }
    }
    if (
      config.docType !== docType ||
      (['HIST_TICKET', 'STANDARD_TICKET_A4'].includes(config.basePreset) &&
        docType !== 'EXIT_PERMISSION') ||
      (docType === 'EXIT_PERMISSION' &&
        ['HIST_ORCA', 'HIST_STANDARD', 'HIST_MODERN'].includes(
          config.basePreset,
        )) ||
      config.blocks.some((block) => block.locked && !block.visible) ||
      config.blocks.some((block) => block.col + block.span > 13) ||
      !config.blocks.some(
        (block) => block.type === 'header' && block.visible && block.locked,
      )
    ) {
      throw new BadRequestException('La disposition du document est invalide.');
    }
    return {
      name: result.value.name ?? administrativeNames[config.basePreset],
      basePreset: config.basePreset,
      config,
    };
  }
  const validation = Joi.object<{
    name: string;
    config: ValidatedConfig;
  }>({
    name: caption.trim().default('Mon modèle'),
    config: layoutSchema.required(),
  })
    .required()
    .validate(body, { convert: false });
  if (validation.error)
    throw new BadRequestException(
      `Modèle invalide (${validation.error.details[0].path.join('.')}).`,
    );
  const { value } = validation;
  const config = value.config;
  validateShapes(config);
  const byType = new Map(config.blocks.map((block) => [block.type, block]));
  const repeatable = new Set(['freeText', 'divider', 'spacer']);
  const single = config.blocks.filter((block) => !repeatable.has(block.type));
  for (const type of ['header', 'fieldGroup', 'table', 'cumuls']) {
    const block = byType.get(type);
    if (!block?.locked || !block.visible)
      throw new BadRequestException('Un bloc obligatoire est manquant.');
  }
  const tableBlock = byType.get('table')!.config;
  const cumuls = byType.get('cumuls')!.config;
  const validColumns = (columns: { widthPct: number; visible?: boolean }[]) =>
    Math.abs(
      columns
        .filter((column) => column.visible !== false)
        .reduce((sum, column) => sum + column.widthPct, 0) - 100,
    ) < 0.01;
  if (
    single.length !== new Set(single.map((block) => block.type)).size ||
    config.blocks.some((block) => block.col + block.span > 13) ||
    !byType
      .get('fieldGroup')!
      .config.groups!.flat()
      .includes('employee.fullName') ||
    !validColumns(tableBlock.columns!) ||
    !validColumns(cumuls.columns!) ||
    !['label', 'gain', 'deduction'].every((key) =>
      tableBlock.columns!.some(
        (column) => column.key === key && column.visible,
      ),
    ) ||
    cumuls.highlight?.valueKey !== 'pay.netSalary' ||
    cumuls.columns![0].key !== 'period' ||
    !cumuls
      .columns!.slice(1)
      .some((column) => column.key === cumuls.highlight?.column)
  ) {
    throw new BadRequestException('La disposition du bulletin est invalide.');
  }
  return { name: value.name, config, basePreset: config.basePreset };
}
