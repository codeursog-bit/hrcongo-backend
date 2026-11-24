import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import Joi from 'joi';

const key = Joi.string().pattern(/^[\w.:-]{1,120}$/);
const caption = Joi.string()
  .max(80)
  .pattern(/^[^<>]*$/);
const colors = Joi.string().pattern(/^#[a-f\d]{6}$/i);
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
    heightMm: Joi.alternatives().try(
      Joi.number().min(0).max(250),
      Joi.valid('auto', 'fill'),
    ),
    config: config.required(),
  }),
);

const margin = Joi.number().min(0).max(45).required();
const layoutSchema = Joi.object({
  schemaVersion: Joi.valid(2).required(),
  docType: Joi.valid('PAYSLIP').required(),
  basePreset: Joi.valid(
    'A_BLEU',
    'B_VERT',
    'C_ARDOISE',
    'D_BORDEAUX',
  ).required(),
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
      ink: colors.required(),
      muted: colors.required(),
      main: colors.required(),
      line: colors.required(),
      accent: colors,
      headFill: colors,
      headText: colors,
      soft: colors,
      thin: colors,
      netHeadFill: colors,
      netCellFill: colors,
      netCellText: colors,
    }).required(),
  }).required(),
  variants: Joi.object({
    header: Joi.valid('title-right-big').required(),
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

export function validateLayoutBody(body: unknown) {
  if (Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8') > 40 * 1024) {
    throw new BadRequestException('Le modèle dépasse 40 Ko.');
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
