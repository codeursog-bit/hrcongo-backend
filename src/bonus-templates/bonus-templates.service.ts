// // 📁 src/bonus-templates/bonus-templates.service.ts
// import { Injectable, NotFoundException } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';

// export interface CreateBonusTemplateDto {
//   name:               string;
//   defaultAmount?:     number | null;
//   defaultPercentage?: number | null;
//   baseCalculation?:   string | null;
//   isRecurring?:       boolean;
//   isTaxable?:         boolean;
//   isCnss?:            boolean;
//   description?:       string | null;
// }

// export interface UpdateBonusTemplateDto extends Partial<CreateBonusTemplateDto> {
//   isActive?: boolean;
// }

// @Injectable()
// export class BonusTemplatesService {
//   constructor(private prisma: PrismaService) {}

//   create(companyId: string, dto: CreateBonusTemplateDto) {
//     return this.prisma.bonusTemplate.create({
//       data: {
//         companyId,
//         name:              dto.name,
//         defaultAmount:     dto.defaultAmount     ?? null,
//         defaultPercentage: dto.defaultPercentage ?? null,
//         baseCalculation:   dto.baseCalculation   ?? null,
//         isRecurring:       dto.isRecurring       ?? true,
//         isTaxable:         dto.isTaxable         ?? true,
//         isCnss:            dto.isCnss            ?? true,
//         description:       dto.description       ?? null,
//         isActive:          true,
//       },
//     });
//   }

//   findAll(companyId: string) {
//     return this.prisma.bonusTemplate.findMany({
//       where:   { companyId, isActive: true },
//       orderBy: { createdAt: 'asc' },
//     });
//   }

//   async findOne(id: string, companyId: string) {
//     const t = await this.prisma.bonusTemplate.findFirst({ where: { id, companyId } });
//     if (!t) throw new NotFoundException(`Template ${id} introuvable`);
//     return t;
//   }

//   async update(id: string, companyId: string, dto: UpdateBonusTemplateDto) {
//     await this.findOne(id, companyId);
//     return this.prisma.bonusTemplate.update({ where: { id }, data: dto as any });
//   }

//   async remove(id: string, companyId: string) {
//     await this.findOne(id, companyId);
//     return this.prisma.bonusTemplate.update({ where: { id }, data: { isActive: false } });
//   }
// }

// ============================================================================
// 📁 src/bonus-templates/bonus-templates.service.ts
// ✅ Ajout : bonusCategory + isProratized + isInLeaveBase
// ✅ Auto-remplissage des flags selon la catégorie choisie
// ✅ Presets conventionnels enrichis (conformes Congo)
// ============================================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getConventionBonusPresets } from './convention-bonus-presets';

// ─── Catégories avec comportements automatiques ───────────────────────────────

export type BonusCategory =
  'FRAIS' | 'POSTE' | 'PERFORMANCE' | 'EXCEPTIONNELLE';

export const CATEGORY_DEFAULTS: Record<
  BonusCategory,
  {
    isProratized: boolean;
    isInLeaveBase: boolean;
    isTaxable: boolean;
    isCnss: boolean;
    label: string;
    description: string;
  }
> = {
  FRAIS: {
    isProratized: true,
    isInLeaveBase: false,
    isTaxable: false,
    isCnss: false,
    label: 'Indemnité de frais',
    description:
      'Remboursement de dépenses réelles (transport, repas, logement). Exonérée ITS et CNSS. Réduite si absent.',
  },
  POSTE: {
    isProratized: false,
    isInLeaveBase: true,
    isTaxable: true,
    isCnss: true,
    label: 'Prime de poste',
    description:
      'Liée au poste, diplôme ou ancienneté. Maintenue à 100% même pendant les congés.',
  },
  PERFORMANCE: {
    isProratized: true,
    isInLeaveBase: true,
    isTaxable: true,
    isCnss: true,
    label: 'Prime de performance',
    description:
      'Liée à la présence ou aux résultats. Réduite proportionnellement aux absences.',
  },
  EXCEPTIONNELLE: {
    isProratized: false,
    isInLeaveBase: false,
    isTaxable: true,
    isCnss: true,
    label: 'Prime exceptionnelle',
    description:
      'Versée une seule fois (13e mois, résultat annuel). Non proratisée.',
  },
};

// ─── Presets conventionnels (conformes Congo Brazzaville) ────────────────────

export const CONVENTIONAL_PRESETS = [
  // FRAIS
  {
    name: 'Prime de transport',
    bonusCategory: 'FRAIS' as BonusCategory,
    defaultAmount: 15000,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: false,
    isCnss: false,
    isProratized: true,
    isInLeaveBase: false,
    description:
      'Remboursement frais de transport — exonérée ITS et CNSS — réduite si absent',
  },
  {
    name: 'Prime de panier repas',
    bonusCategory: 'FRAIS' as BonusCategory,
    defaultAmount: 5000,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: false,
    isCnss: false,
    isProratized: true,
    isInLeaveBase: false,
    description:
      'Indemnité repas journalière — exonérée ITS et CNSS — réduite si absent',
  },
  {
    name: 'Prime de logement',
    bonusCategory: 'FRAIS' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: 10,
    baseCalculation: 'BASE_SALARY',
    isRecurring: true,
    isTaxable: true,
    isCnss: false,
    isProratized: false,
    isInLeaveBase: true,
    description: '10% du salaire de base — imposable ITS, exonérée CNSS',
  },
  // POSTE
  {
    name: "Prime d'ancienneté",
    bonusCategory: 'POSTE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: 5,
    baseCalculation: 'BASE_SALARY',
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    isProratized: false,
    isInLeaveBase: true,
    description:
      '5% du salaire de base par tranche de 2 ans — maintenue pendant les congés',
  },
  {
    name: 'Prime de responsabilité',
    bonusCategory: 'POSTE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    isProratized: false,
    isInLeaveBase: true,
    description: 'Liée à la fonction managériale — maintenue même si absent',
  },
  {
    name: 'Prime de diplôme',
    bonusCategory: 'POSTE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    isProratized: false,
    isInLeaveBase: true,
    description: 'Liée au niveau de formation — maintenue pendant les congés',
  },
  // PERFORMANCE
  {
    name: 'Prime de rendement',
    bonusCategory: 'PERFORMANCE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    isProratized: true,
    isInLeaveBase: true,
    description:
      'Liée à la performance — réduite proportionnellement aux absences',
  },
  {
    name: "Prime d'assiduité",
    bonusCategory: 'PERFORMANCE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    isProratized: true,
    isInLeaveBase: true,
    description: 'Récompense la présence — réduite ou supprimée si absences',
  },
  {
    name: 'Prime de motivation',
    bonusCategory: 'PERFORMANCE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    isProratized: true,
    isInLeaveBase: true,
    description: 'Prime discrétionnaire — réduite selon la présence réelle',
  },
  {
    name: 'Prime de sujétion',
    bonusCategory: 'PERFORMANCE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: true,
    isTaxable: true,
    isCnss: false,
    isProratized: true,
    isInLeaveBase: true,
    description:
      'Conditions difficiles — imposable ITS, exonérée CNSS, réduite si absent',
  },
  // EXCEPTIONNELLE
  {
    name: "Prime de fin d'année (13e mois - mois complet)",
    bonusCategory: 'EXCEPTIONNELLE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: 100,
    baseCalculation: 'BASE_SALARY',
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    // ✅ Coché par défaut : réduit le montant au prorata des mois travaillés
    // dans l'année si l'employé n'a pas été présent toute l'année (mois
    // entamé = mois plein). Décochable si l'entreprise verse toujours le
    // montant plein peu importe la date d'embauche.
    isProratized: true,
    isInLeaveBase: false,
    description:
      "13e mois — 1 mois de salaire de base, versé en décembre. Réduit au prorata des mois travaillés si l'employé n'a pas fait l'année complète.",
  },
  {
    name: "Prime de fin d'année (13e mois - demi-mois)",
    bonusCategory: 'EXCEPTIONNELLE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: 50,
    baseCalculation: 'BASE_SALARY',
    isRecurring: true,
    isTaxable: true,
    isCnss: true,
    isProratized: true,
    isInLeaveBase: false,
    description:
      "Demi-13e mois — 50% du salaire de base, versé en décembre. Réduit au prorata des mois travaillés si l'employé n'a pas fait l'année complète.",
  },
  {
    name: "Prime de fin d'année (montant fixe)",
    bonusCategory: 'EXCEPTIONNELLE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: false,
    isTaxable: true,
    isCnss: true,
    isProratized: false,
    isInLeaveBase: false,
    description:
      "Montant que vous saisissez vous-même chaque année (ex: 100 000 FCFA), versé en décembre à chaque employé actif — sans formule automatique.",
  },
  {
    name: 'Prime de résultat annuel',
    bonusCategory: 'EXCEPTIONNELLE' as BonusCategory,
    defaultAmount: null,
    defaultPercentage: null,
    baseCalculation: null,
    isRecurring: false,
    isTaxable: true,
    isCnss: true,
    isProratized: false,
    isInLeaveBase: false,
    description: 'Prime discrétionnaire annuelle — versée en une seule fois',
  },
];

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateBonusTemplateDto {
  name: string;
  bonusCategory?: BonusCategory;
  defaultAmount?: number | null;
  defaultPercentage?: number | null;
  baseCalculation?: string | null;
  isRecurring?: boolean;
  isTaxable?: boolean;
  isCnss?: boolean;
  isProratized?: boolean;
  isInLeaveBase?: boolean;
  description?: string | null;
  // 🆕 Mode quantité libre (le seul conservé — voir bonus-quantity.controller.ts)
  fiscalType?: 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE' | null;
  quantityMode?: 'FREE' | null;
  unitAmount?: number | null;
  defaultQuantity?: number | null;
}

export interface UpdateBonusTemplateDto extends Partial<CreateBonusTemplateDto> {
  isActive?: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BonusTemplatesService {
  constructor(private prisma: PrismaService) {}

  // ── CREATE ─────────────────────────────────────────────────────────────────
  async create(companyId: string, dto: CreateBonusTemplateDto) {
    // Auto-remplissage des flags selon la catégorie si non fournis explicitement
    const category = dto.bonusCategory ?? 'PERFORMANCE';
    const defaults = CATEGORY_DEFAULTS[category];

    return this.prisma.bonusTemplate.create({
      data: {
        companyId,
        name: dto.name,
        bonusCategory: category,
        defaultAmount: dto.defaultAmount ?? null,
        defaultPercentage: dto.defaultPercentage ?? null,
        baseCalculation: dto.baseCalculation ?? null,
        isRecurring: dto.isRecurring ?? category !== 'EXCEPTIONNELLE',
        isTaxable: dto.isTaxable ?? defaults.isTaxable,
        isCnss: dto.isCnss ?? defaults.isCnss,
        isProratized: dto.isProratized ?? defaults.isProratized,
        isInLeaveBase: dto.isInLeaveBase ?? defaults.isInLeaveBase,
        description: dto.description ?? defaults.description,
        isActive: true,
        // ✅ FIX : ces champs étaient envoyés par le front mais jamais
        // persistés — un template créé en mode quantité libre perdait
        // silencieusement son quantityMode/unitAmount.
        fiscalType: dto.fiscalType ?? null,
        quantityMode: dto.quantityMode ?? null,
        unitAmount: dto.unitAmount ?? null,
        defaultQuantity: dto.defaultQuantity ?? null,
      },
    });
  }

  // ── FIND ALL ───────────────────────────────────────────────────────────────
  findAll(companyId: string) {
    return this.prisma.bonusTemplate.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ bonusCategory: 'asc' }, { name: 'asc' }],
    });
  }

  // ── FIND ONE ───────────────────────────────────────────────────────────────
  async findOne(id: string, companyId: string) {
    const t = await this.prisma.bonusTemplate.findFirst({
      where: { id, companyId },
    });
    if (!t) throw new NotFoundException(`Template ${id} introuvable`);
    return t;
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  async update(id: string, companyId: string, dto: UpdateBonusTemplateDto) {
    await this.findOne(id, companyId);

    // Si la catégorie change, on met à jour les flags automatiquement
    // sauf si l'utilisateur les a explicitement fournis.
    // ✅ FIX : on teste `=== undefined` (non fourni) et non la valeur en
    // elle-même — l'ancien test `!dto.isTaxable` écrasait silencieusement un
    // choix explicite de l'admin (ex: isTaxable: false) par les valeurs par
    // défaut de la catégorie, ce qui contredit le principe "l'admin reste
    // seul responsable, aucun écrasement silencieux".
    const data: any = { ...dto };
    if (
      dto.bonusCategory &&
      dto.isTaxable === undefined &&
      dto.isCnss === undefined
    ) {
      const defaults = CATEGORY_DEFAULTS[dto.bonusCategory];
      data.isTaxable = defaults.isTaxable;
      data.isCnss = defaults.isCnss;
      data.isProratized = defaults.isProratized;
      data.isInLeaveBase = defaults.isInLeaveBase;
    }

    return this.prisma.bonusTemplate.update({ where: { id }, data });
  }

  // ── REMOVE (soft delete) ───────────────────────────────────────────────────
  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.bonusTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── GET PRESETS ────────────────────────────────────────────────────────────
  getPresets(): typeof CONVENTIONAL_PRESETS {
    return CONVENTIONAL_PRESETS;
  }

  // ── IMPORT PRESETS ─────────────────────────────────────────────────────────
  async importPresets(companyId: string, presetNames: string[]) {
    const selected = CONVENTIONAL_PRESETS.filter(
      (p) => presetNames.length === 0 || presetNames.includes(p.name),
    );

    // ✅ FIX ERR 1 : type explicite pour éviter l'inférence 'never[]'
    const created: Awaited<
      ReturnType<typeof this.prisma.bonusTemplate.create>
    >[] = [];

    for (const preset of selected) {
      // Vérifier si déjà existant (même nom pour cette entreprise)
      const existing = await this.prisma.bonusTemplate.findFirst({
        where: { companyId, name: preset.name, isActive: true },
      });
      if (existing) continue;

      const t = await this.prisma.bonusTemplate.create({
        data: { companyId, ...preset, isActive: true },
      });
      created.push(t);
    }

    return {
      imported: created.length,
      skipped: selected.length - created.length,
      templates: created,
    };
  }

  // ── CATEGORY DEFAULTS (endpoint pour le front) ────────────────────────────
  getCategoryDefaults(): typeof CATEGORY_DEFAULTS {
    return CATEGORY_DEFAULTS;
  }

  // ── IMPORT DEPUIS UNE CONVENTION COLLECTIVE ────────────────────────────────
  // Appelée par ConventionsService.activateConventionForCompany() — génère
  // les BonusTemplate suggérés par la convention. Réutilise la même logique
  // anti-doublon que importPresets(). Aucune des primes créées n'est
  // marquée ou verrouillée : ce sont des BonusTemplate ordinaires, l'admin
  // peut tout modifier/supprimer ensuite sans restriction ni avertissement.
  async importConventionPresets(companyId: string, conventionCode: string) {
    const presets = getConventionBonusPresets(conventionCode);
    if (presets.length === 0) {
      return { imported: 0, skipped: 0, templates: [] };
    }

    const created: Awaited<
      ReturnType<typeof this.prisma.bonusTemplate.create>
    >[] = [];

    for (const preset of presets) {
      const existing = await this.prisma.bonusTemplate.findFirst({
        where: { companyId, name: preset.name, isActive: true },
      });
      if (existing) continue;

      const t = await this.prisma.bonusTemplate.create({
        data: { companyId, ...preset, isActive: true },
      });
      created.push(t);
    }

    return {
      imported: created.length,
      skipped: presets.length - created.length,
      templates: created,
    };
  }
}