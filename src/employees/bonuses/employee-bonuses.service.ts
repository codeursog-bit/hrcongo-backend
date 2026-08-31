// // ============================================================================
// // 📁 src/employees/bonuses/employee-bonuses.service.ts
// // ✅ Fix mapping : findAll() retourne les champs que le front attend
// //   - frequency → isRecurring (MONTHLY/ANNUAL → true, ONE_TIME → false)
// //   - fixedAmount → amount
// //   - isAutomatic → source ('MANUAL' | 'AUTOMATIC')
// //   - startDate → targetMonth + targetYear (pour primes ONE_TIME)
// //   - notes → description
// // ============================================================================

// import {
//   Injectable, NotFoundException, BadRequestException, Logger,
// } from '@nestjs/common';
// import { PrismaService } from '../../prisma/prisma.service';

// export interface CreateEmployeeBonusDto {
//   employeeId:       string;
//   bonusType:        string;
//   amount?:          number | null;
//   fixedAmount?:     number | null;
//   percentage?:      number | null;
//   baseCalculation?: 'BASE_SALARY' | 'GROSS_SALARY' | null;
//   frequency?:       'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
//   // ✅ Champs front (convertis en frequency + startDate)
//   isRecurring?:     boolean;
//   targetMonth?:     number;
//   targetYear?:      number;
//   startDate?:       string;
//   endDate?:         string | null;
//   notes?:           string | null;
//   description?:     string | null; // alias de notes
//   isTaxable?:       boolean;
//   isCnss?:          boolean;
//   bonusTemplateId?: string | null;
// }

// export interface UpdateBonusTemplateDto {
//   amount?:          number | null;
//   fixedAmount?:     number | null;
//   percentage?:      number | null;
//   baseCalculation?: 'BASE_SALARY' | 'GROSS_SALARY' | null;
//   frequency?:       'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
//   endDate?:         string | null;
//   notes?:           string | null;
//   isTaxable?:       boolean;
//   isCnss?:          boolean;
//   isActive?:        boolean;
// }

// // ── Mapper BDD → Front ───────────────────────────────────────────────────────
// // Convertit un objet Prisma EmployeeBonus en objet attendu par le front
// function mapBonusToFront(b: any) {
//   const isRecurring  = b.frequency !== 'ONE_TIME';
//   const source       = b.isAutomatic ? 'AUTOMATIC' : 'MANUAL';
//   const amount       = b.fixedAmount !== null && b.fixedAmount !== undefined
//     ? Number(b.fixedAmount) : null;
//   const percentage   = b.percentage !== null && b.percentage !== undefined
//     ? Number(b.percentage) : null;
//   const description  = b.notes ?? null;

//   // Pour les primes ponctuelles, extraire mois/année depuis startDate
//   let targetMonth: number | undefined;
//   let targetYear:  number | undefined;
//   if (!isRecurring && b.startDate) {
//     const d    = new Date(b.startDate);
//     targetMonth = d.getMonth() + 1;
//     targetYear  = d.getFullYear();
//   }

//   return {
//     id:              b.id,
//     employeeId:      b.employeeId,
//     bonusType:       b.bonusType,
//     // ✅ Champs "front"
//     amount,
//     percentage,
//     baseCalculation: b.baseCalculation ?? null,
//     isRecurring,
//     source,
//     description,
//     targetMonth,
//     targetYear,
//     isTaxable:       b.isTaxable ?? true,
//     isCnss:          b.isCnss    ?? true,
//     isActive:        b.isActive  ?? true,
//     // Champs bruts (utiles pour edit-payroll)
//     frequency:       b.frequency,
//     fixedAmount:     amount,
//     calculationType: b.calculationType,
//     bonusTemplateId: b.bonusTemplateId ?? null,
//     bonusTemplate:   b.bonusTemplate   ?? null,
//     createdAt:       b.createdAt,
//     updatedAt:       b.updatedAt,
//   };
// }

// @Injectable()
// export class EmployeeBonusesService {
//   private readonly logger = new Logger(EmployeeBonusesService.name);

//   constructor(private prisma: PrismaService) {}

//   // ── CREATE ─────────────────────────────────────────────────────────────────
//   async create(dto: CreateEmployeeBonusDto) {
//     let resolvedIsTaxable = dto.isTaxable ?? true;
//     let resolvedIsCnss    = dto.isCnss    ?? true;
//     let resolvedAmount    = dto.amount ?? dto.fixedAmount ?? null;
//     let resolvedPct       = dto.percentage ?? null;
//     let resolvedBase      = dto.baseCalculation ?? null;

//     if (dto.bonusTemplateId) {
//       const template = await this.prisma.bonusTemplate.findUnique({
//         where: { id: dto.bonusTemplateId },
//       }).catch(() => null);
//       if (!template) throw new NotFoundException(`Template ${dto.bonusTemplateId} introuvable`);
//       if (dto.isTaxable === undefined) resolvedIsTaxable = template.isTaxable;
//       if (dto.isCnss    === undefined) resolvedIsCnss    = template.isCnss;
//       if (resolvedAmount === null && template.defaultAmount !== null)
//         resolvedAmount = Number(template.defaultAmount);
//       if (resolvedPct === null && template.defaultPercentage !== null) {
//         resolvedPct  = Number(template.defaultPercentage);
//         resolvedBase = (template.baseCalculation as any) ?? null;
//       }
//     }

//     const hasAmount = resolvedAmount !== null && resolvedAmount! > 0;
//     const hasPct    = resolvedPct    !== null && resolvedPct!    > 0;
//     if (!hasAmount && !hasPct)
//       throw new BadRequestException('Un montant (fixe ou pourcentage) est requis.');

//     // ✅ Convertir isRecurring + targetMonth/Year → frequency + startDate
//     let frequency: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME' = 'MONTHLY';
//     let startDate  = new Date();

//     if (dto.frequency) {
//       // Si frequency explicite, on l'utilise
//       frequency = dto.frequency;
//     } else if (dto.isRecurring === false) {
//       frequency = 'ONE_TIME';
//     }

//     if (frequency === 'ONE_TIME' && dto.targetMonth && dto.targetYear) {
//       // Date = premier jour du mois cible
//       startDate = new Date(dto.targetYear, dto.targetMonth - 1, 1);
//     } else if (dto.startDate) {
//       startDate = new Date(dto.startDate);
//     }

//     const notes = dto.notes ?? dto.description ?? null;

//     const bonus = await this.prisma.employeeBonus.create({
//       data: {
//         employeeId: dto.employeeId,
//         bonusType:  dto.bonusType,
//         frequency,
//         startDate,
//         endDate:    dto.endDate ? new Date(dto.endDate) : null,
//         notes,
//         isActive:   true,
//         isAutomatic: false,
//         ...(hasAmount ? {
//           calculationType: 'FIXED_AMOUNT' as const,
//           fixedAmount:     resolvedAmount,
//         } : {
//           calculationType: 'PERCENTAGE' as const,
//           percentage:      resolvedPct,
//           baseCalculation: (resolvedBase ?? 'BASE_SALARY') as any,
//         }),
//         isTaxable: resolvedIsTaxable,
//         isCnss:    resolvedIsCnss,
//         ...(dto.bonusTemplateId ? { bonusTemplateId: dto.bonusTemplateId } : {}),
//       },
//     });

//     this.logger.log(`Prime créée — ${dto.employeeId} | ${dto.bonusType} | frequency=${frequency}`);
//     return mapBonusToFront(bonus);
//   }

//   // ── FIND ALL ───────────────────────────────────────────────────────────────
//   async findAll(employeeId?: string) {
//     const where: any = {};
//     if (employeeId) where.employeeId = employeeId;
//     const bonuses = await this.prisma.employeeBonus.findMany({
//       where,
//       orderBy: { createdAt: 'desc' },
//       include: { bonusTemplate: true },
//     });
//     // ✅ Mapper tous les résultats vers le format attendu par le front
//     return bonuses.map(mapBonusToFront);
//   }

//   async findAllByEmployee(employeeId: string, _userId?: string) {
//     return this.findAll(employeeId);
//   }

//   // ── FIND ONE ───────────────────────────────────────────────────────────────
//   async findOne(id: string) {
//     const bonus = await this.prisma.employeeBonus.findUnique({
//       where: { id },
//       include: { bonusTemplate: true },
//     });
//     if (!bonus) throw new NotFoundException(`Prime ${id} introuvable`);
//     return mapBonusToFront(bonus);
//   }

//   // ── UPDATE ─────────────────────────────────────────────────────────────────
//   async update(id: string, dto: UpdateBonusTemplateDto, _userId?: string) {
//     // Vérifier existence (findOne mappe, on vérifie juste)
//     await this.prisma.employeeBonus.findUnique({ where: { id } })
//       .then(b => { if (!b) throw new NotFoundException(`Prime ${id} introuvable`); });

//     const data: any = {};
//     if (dto.isTaxable  !== undefined) data.isTaxable  = dto.isTaxable;
//     if (dto.isCnss     !== undefined) data.isCnss     = dto.isCnss;
//     if (dto.isActive   !== undefined) data.isActive   = dto.isActive;
//     if (dto.frequency  !== undefined) data.frequency  = dto.frequency;
//     if (dto.notes      !== undefined) data.notes      = dto.notes;
//     if (dto.endDate    !== undefined) data.endDate     = dto.endDate ? new Date(dto.endDate) : null;
//     if (dto.baseCalculation !== undefined) data.baseCalculation = dto.baseCalculation;

//     // ✅ Accepte "amount" OU "fixedAmount"
//     const amountValue = dto.fixedAmount ?? dto.amount;
//     if (amountValue !== undefined && amountValue !== null) {
//       data.calculationType = 'FIXED_AMOUNT';
//       data.fixedAmount     = amountValue;
//     }
//     if (dto.percentage !== undefined) {
//       data.calculationType = 'PERCENTAGE';
//       data.percentage      = dto.percentage;
//     }

//     const updated = await this.prisma.employeeBonus.update({ where: { id }, data });
//     this.logger.log(`Prime ${id} modifiée`);
//     return mapBonusToFront(updated);
//   }

//   // ── DELETE ─────────────────────────────────────────────────────────────────
//   async remove(id: string, _userId?: string) {
//     await this.prisma.employeeBonus.findUnique({ where: { id } })
//       .then(b => { if (!b) throw new NotFoundException(`Prime ${id} introuvable`); });
//     await this.prisma.employeeBonus.delete({ where: { id } });
//     this.logger.log(`Prime ${id} supprimée`);
//     return { deleted: true };
//   }

//   async findActiveByEmployee(employeeId: string) {
//     const bonuses = await this.prisma.employeeBonus.findMany({
//       where: { employeeId, isActive: true, isAutomatic: false },
//       orderBy: { createdAt: 'asc' },
//     });
//     return bonuses.map(mapBonusToFront);
//   }
// }

// ============================================================================
// 📁 src/employees/bonuses/employee-bonuses.service.ts
// ✅ Ajout : isProratized, isInLeaveBase, bonusCategory dans le mapper
// ✅ Auto-remplissage depuis le template et la catégorie
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CATEGORY_DEFAULTS,
  type BonusCategory,
} from '../../bonus-templates/bonus-templates.service';

export interface CreateEmployeeBonusDto {
  employeeId: string;
  bonusType: string;
  bonusCategory?: BonusCategory;
  amount?: number | null;
  fixedAmount?: number | null;
  percentage?: number | null;
  baseCalculation?: 'BASE_SALARY' | 'GROSS_SALARY' | null;
  frequency?: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
  isRecurring?: boolean;
  targetMonth?: number;
  targetYear?: number;
  startDate?: string;
  endDate?: string | null;
  notes?: string | null;
  description?: string | null;
  isTaxable?: boolean;
  isCnss?: boolean;
  isProratized?: boolean;
  isInLeaveBase?: boolean;
  bonusTemplateId?: string | null;
  // 🆕 Système quantité
  fiscalType?: 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE' | null;
  unitAmount?: number | null;
  quantityMode?: 'FREE' | null; // seul mode quantité conservé
  defaultQuantity?: number | null;
}

export interface UpdateBonusDto {
  amount?: number | null;
  fixedAmount?: number | null;
  percentage?: number | null;
  baseCalculation?: 'BASE_SALARY' | 'GROSS_SALARY' | null;
  frequency?: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
  endDate?: string | null;
  notes?: string | null;
  isTaxable?: boolean;
  isCnss?: boolean;
  isProratized?: boolean; // 🆕
  isInLeaveBase?: boolean;
  bonusCategory?: BonusCategory;
  isActive?: boolean;
  // 🆕 Système quantité
  fiscalType?: 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE' | null;
  unitAmount?: number | null;
  quantityMode?: 'FREE' | null; // seul mode quantité conservé
  defaultQuantity?: number | null;
}

// ── Mapper BDD → Front ────────────────────────────────────────────────────────

function mapBonusToFront(b: any) {
  const isRecurring = b.frequency !== 'ONE_TIME';
  const source = b.isAutomatic ? 'AUTOMATIC' : 'MANUAL';
  const amount = b.fixedAmount != null ? Number(b.fixedAmount) : null;
  const percentage = b.percentage != null ? Number(b.percentage) : null;

  let targetMonth: number | undefined;
  let targetYear: number | undefined;
  // ✅ FIX : calculé pour ONE_TIME ET ANNUAL (le 13e mois a lui aussi un
  // mois de versement précis à afficher/éditer, pas seulement les primes
  // ponctuelles) — seul MONTHLY n'a pas de mois cible (chaque mois).
  if (b.frequency !== 'MONTHLY' && b.startDate) {
    const d = new Date(b.startDate);
    targetMonth = d.getMonth() + 1;
    targetYear = d.getFullYear();
  }

  return {
    id: b.id,
    employeeId: b.employeeId,
    bonusType: b.bonusType,
    amount,
    percentage,
    baseCalculation: b.baseCalculation ?? null,
    isRecurring,
    source,
    description: b.notes ?? null,
    targetMonth,
    targetYear,
    isTaxable: b.isTaxable ?? true,
    isCnss: b.isCnss ?? true,
    // 🆕 Nouveaux champs
    isProratized: b.isProratized ?? false,
    isInLeaveBase: b.isInLeaveBase ?? true,
    bonusCategory: b.bonusCategory ?? 'PERFORMANCE',
    // Champs bruts
    isActive: b.isActive ?? true,
    frequency: b.frequency,
    fixedAmount: amount,
    calculationType: b.calculationType,
    bonusTemplateId: b.bonusTemplateId ?? null,
    bonusTemplate: b.bonusTemplate ?? null,
    startDate: b.startDate,
    endDate: b.endDate,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    // 🆕 Système quantité
    fiscalType: b.fiscalType ?? null,
    unitAmount: b.unitAmount != null ? Number(b.unitAmount) : null,
    quantityMode: b.quantityMode ?? null,
    defaultQuantity:
      b.defaultQuantity != null ? Number(b.defaultQuantity) : null,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class EmployeeBonusesService {
  private readonly logger = new Logger(EmployeeBonusesService.name);

  constructor(private prisma: PrismaService) {}

  // ── CREATE ─────────────────────────────────────────────────────────────────
  async create(dto: CreateEmployeeBonusDto) {
    // 1. Résoudre les valeurs depuis le template si fourni
    let resolvedIsTaxable = dto.isTaxable ?? true;
    let resolvedIsCnss = dto.isCnss ?? true;
    let resolvedIsProratized = dto.isProratized ?? false;
    let resolvedIsInLeaveBase = dto.isInLeaveBase ?? true;
    let resolvedCategory = dto.bonusCategory ?? 'PERFORMANCE';
    let resolvedAmount = dto.amount ?? dto.fixedAmount ?? null;
    let resolvedPct = dto.percentage ?? null;
    let resolvedBase = dto.baseCalculation ?? null;

    if (dto.bonusTemplateId) {
      const template = await this.prisma.bonusTemplate
        .findUnique({
          where: { id: dto.bonusTemplateId },
        })
        .catch(() => null);

      if (!template)
        throw new NotFoundException(
          `Template ${dto.bonusTemplateId} introuvable`,
        );

      // Les valeurs du template sont les défauts — le DTO peut les overrider
      if (dto.isTaxable === undefined) resolvedIsTaxable = template.isTaxable;
      if (dto.isCnss === undefined) resolvedIsCnss = template.isCnss;
      if (dto.isProratized === undefined)
        resolvedIsProratized = (template as any).isProratized ?? false;
      if (dto.isInLeaveBase === undefined)
        resolvedIsInLeaveBase = (template as any).isInLeaveBase ?? true;
      if (dto.bonusCategory === undefined)
        resolvedCategory = ((template as any).bonusCategory ??
          'PERFORMANCE') as BonusCategory;

      if (resolvedAmount === null && template.defaultAmount !== null)
        resolvedAmount = Number(template.defaultAmount);
      if (resolvedPct === null && template.defaultPercentage !== null) {
        resolvedPct = Number(template.defaultPercentage);
        resolvedBase = (template.baseCalculation as any) ?? null;
      }
      // ✅ Filet de sécurité : reprendre le mode quantité du template si le
      // front ne l'a pas explicitement envoyé (le front actuel l'envoie déjà,
      // mais on ne veut pas dépendre uniquement de ça)
      if (dto.quantityMode === undefined && (template as any).quantityMode) {
        dto.quantityMode = (template as any).quantityMode;
      }
      if (dto.unitAmount == null && (template as any).unitAmount != null) {
        dto.unitAmount = Number((template as any).unitAmount);
      }
      if (
        dto.defaultQuantity == null &&
        (template as any).defaultQuantity != null
      ) {
        dto.defaultQuantity = Number((template as any).defaultQuantity);
      }
    } else {
      // Sans template : appliquer les défauts de la catégorie
      const catDefaults = CATEGORY_DEFAULTS[resolvedCategory];
      if (dto.isTaxable === undefined)
        resolvedIsTaxable = catDefaults.isTaxable;
      if (dto.isCnss === undefined) resolvedIsCnss = catDefaults.isCnss;
      if (dto.isProratized === undefined)
        resolvedIsProratized = catDefaults.isProratized;
      if (dto.isInLeaveBase === undefined)
        resolvedIsInLeaveBase = catDefaults.isInLeaveBase;
    }

    // 2. Valider montant
    const hasAmount = resolvedAmount !== null && resolvedAmount > 0;
    const hasPct = resolvedPct !== null && resolvedPct > 0;
    // 🆕 mode quantité libre : seul quantityMode === 'FREE' + unitAmount valide
    // remplace fixedAmount/percentage — le montant réel vient de la saisie
    // mensuelle (BonusMonthlyQuantity), résolue par le moteur de paie.
    const hasUnitAmt =
      dto.quantityMode === 'FREE' &&
      dto.unitAmount != null &&
      dto.unitAmount > 0;
    if (!hasAmount && !hasPct && !hasUnitAmt)
      throw new BadRequestException(
        'Un montant (fixe, pourcentage ou unitaire) est requis.',
      );

    // 3. Résoudre fréquence + date
    let frequency: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME' = 'MONTHLY';
    let startDate = new Date();

    if (dto.frequency) {
      frequency = dto.frequency;
    } else if (
      resolvedCategory === 'EXCEPTIONNELLE' ||
      dto.isRecurring === false
    ) {
      frequency = 'ONE_TIME';
    }

    if (frequency === 'ONE_TIME' && dto.targetMonth && dto.targetYear) {
      startDate = new Date(dto.targetYear, dto.targetMonth - 1, 1);
    } else if (dto.startDate) {
      startDate = new Date(dto.startDate);
    }

    const notes = dto.notes ?? dto.description ?? null;

    const bonus = await this.prisma.employeeBonus.create({
      data: {
        employeeId: dto.employeeId,
        bonusType: dto.bonusType,
        frequency,
        startDate,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        notes,
        isActive: true,
        isAutomatic: false,
        bonusCategory: resolvedCategory,
        isTaxable: resolvedIsTaxable,
        isCnss: resolvedIsCnss,
        isProratized: resolvedIsProratized,
        isInLeaveBase: resolvedIsInLeaveBase,
        // 🆕 Système quantité + fiscal
        ...(dto.fiscalType != null ? { fiscalType: dto.fiscalType } : {}),
        ...(dto.unitAmount != null ? { unitAmount: dto.unitAmount } : {}),
        ...(dto.quantityMode != null ? { quantityMode: dto.quantityMode } : {}),
        ...(dto.defaultQuantity != null
          ? { defaultQuantity: dto.defaultQuantity }
          : {}),
        // ✅ FIXED_AMOUNT / PERCENTAGE / mode quantité (FREE) sont mutuellement
        // exclusifs — on ne force plus PERCENTAGE avec percentage=null quand
        // seul unitAmount est fourni (bug corrigé : la prime disparaissait
        // silencieusement en paie car amount restait à 0)
        ...(hasAmount
          ? {
              calculationType: 'FIXED_AMOUNT' as const,
              fixedAmount: resolvedAmount,
            }
          : hasPct
            ? {
                calculationType: 'PERCENTAGE' as const,
                percentage: resolvedPct,
                baseCalculation: (resolvedBase ?? 'BASE_SALARY') as any,
              }
            : {
                // Mode quantité libre pur : calculationType par défaut du
                // schema (FIXED_AMOUNT) mais sans fixedAmount ni percentage —
                // le montant réel vient de BonusMonthlyQuantity chaque mois.
              }),
        ...(dto.bonusTemplateId
          ? { bonusTemplateId: dto.bonusTemplateId }
          : {}),
      },
    });

    this.logger.log(
      `Prime créée — ${dto.employeeId} | ${dto.bonusType} | cat=${resolvedCategory} | prorata=${resolvedIsProratized}`,
    );
    return mapBonusToFront(bonus);
  }

  // ── FIND ALL ───────────────────────────────────────────────────────────────
  async findAll(employeeId?: string) {
    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    const bonuses = await this.prisma.employeeBonus.findMany({
      where,
      orderBy: [{ bonusCategory: 'asc' }, { createdAt: 'desc' }],
      include: { bonusTemplate: true },
    });
    return bonuses.map(mapBonusToFront);
  }

  async findAllByEmployee(employeeId: string, _userId?: string) {
    return this.findAll(employeeId);
  }

  // ── FIND ONE ───────────────────────────────────────────────────────────────
  async findOne(id: string) {
    const bonus = await this.prisma.employeeBonus.findUnique({
      where: { id },
      include: { bonusTemplate: true },
    });
    if (!bonus) throw new NotFoundException(`Prime ${id} introuvable`);
    return mapBonusToFront(bonus);
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  async update(id: string, dto: UpdateBonusDto, _userId?: string) {
    await this.prisma.employeeBonus.findUnique({ where: { id } }).then((b) => {
      if (!b) throw new NotFoundException(`Prime ${id} introuvable`);
    });

    const data: any = {};
    if (dto.isTaxable !== undefined) data.isTaxable = dto.isTaxable;
    if (dto.isCnss !== undefined) data.isCnss = dto.isCnss;
    if (dto.isProratized !== undefined) data.isProratized = dto.isProratized; // 🆕
    if (dto.isInLeaveBase !== undefined) data.isInLeaveBase = dto.isInLeaveBase; // 🆕
    if (dto.bonusCategory !== undefined) data.bonusCategory = dto.bonusCategory; // 🆕
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.endDate !== undefined)
      data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.baseCalculation !== undefined)
      data.baseCalculation = dto.baseCalculation;

    // 🆕 Système quantité + fiscal
    if (dto.fiscalType !== undefined) data.fiscalType = dto.fiscalType;
    if (dto.unitAmount !== undefined) data.unitAmount = dto.unitAmount;
    if (dto.quantityMode !== undefined) data.quantityMode = dto.quantityMode;
    if (dto.defaultQuantity !== undefined)
      data.defaultQuantity = dto.defaultQuantity;

    const amountValue = dto.fixedAmount ?? dto.amount;
    if (amountValue !== undefined && amountValue !== null) {
      data.calculationType = 'FIXED_AMOUNT';
      data.fixedAmount = amountValue;
    }
    if (dto.percentage !== undefined) {
      data.calculationType = 'PERCENTAGE';
      data.percentage = dto.percentage;
    }

    // Si la catégorie change → mise à jour automatique des flags (si non fournis)
    if (
      dto.bonusCategory &&
      dto.isProratized === undefined &&
      dto.isTaxable === undefined
    ) {
      const defaults = CATEGORY_DEFAULTS[dto.bonusCategory];
      data.isTaxable = defaults.isTaxable;
      data.isCnss = defaults.isCnss;
      data.isProratized = defaults.isProratized;
      data.isInLeaveBase = defaults.isInLeaveBase;
    }

    const updated = await this.prisma.employeeBonus.update({
      where: { id },
      data,
    });
    this.logger.log(`Prime ${id} modifiée`);
    return mapBonusToFront(updated);
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  async remove(id: string, _userId?: string) {
    await this.prisma.employeeBonus.findUnique({ where: { id } }).then((b) => {
      if (!b) throw new NotFoundException(`Prime ${id} introuvable`);
    });
    await this.prisma.employeeBonus.delete({ where: { id } });
    return { deleted: true };
  }

  async findActiveByEmployee(employeeId: string) {
    const bonuses = await this.prisma.employeeBonus.findMany({
      where: { employeeId, isActive: true, isAutomatic: false },
      orderBy: [{ bonusCategory: 'asc' }, { createdAt: 'asc' }],
    });
    return bonuses.map(mapBonusToFront);
  }
}