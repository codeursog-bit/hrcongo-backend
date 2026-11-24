// ============================================================================
// 📁 src/finance/finance.service.ts
// Suivi de trésorerie simple : une caisse, des sorties/entrées, des budgets
// mensuels par catégorie. Module INDÉPENDANT (aucun lien avec Asset).
//
// Sécurité :
//   - Réservé au rôle ADMIN de l'entreprise (companyId = celui de l'utilisateur,
//     jamais fourni par le client).
//   - Activé uniquement si FinanceSettings.enabled = true.
// ============================================================================

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinanceFlow, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  CreateFinanceCategoryDto,
  CreateFinanceTransactionDto,
  ExportFinanceTransactionsDto,
  FinanceBudgetsQueryDto,
  FinanceDashboardQueryDto,
  ListFinanceCategoriesDto,
  ListFinanceTransactionsDto,
  UpdateFinanceCategoryDto,
  UpdateFinanceSettingsDto,
  UpdateFinanceTransactionDto,
  UpsertFinanceBudgetDto,
} from './dto/finance.dto';

const MAX_AMOUNT = 9_999_999_999_999; // limite Decimal(15,2)
const MAX_RANGE_MONTHS = 36;
const EXPORT_MAX_ROWS = 5000;

const DEFAULT_CATEGORIES: { name: string; type: FinanceFlow; color: string }[] =
  [
    { name: 'Matériel', type: 'EXPENSE', color: '#0EA5E9' },
    { name: 'Loyer', type: 'EXPENSE', color: '#8B5CF6' },
    { name: 'Transport', type: 'EXPENSE', color: '#F59E0B' },
    { name: 'Salaires', type: 'EXPENSE', color: '#EF4444' },
    { name: 'Autres dépenses', type: 'EXPENSE', color: '#64748B' },
    { name: 'Ventes', type: 'INCOME', color: '#10B981' },
    { name: 'Autres entrées', type: 'INCOME', color: '#14B8A6' },
  ];

// ── Helpers purs ────────────────────────────────────────────────────────────
const num = (d: Prisma.Decimal | number | null | undefined): number =>
  d === null || d === undefined ? 0 : Number(d);

const round2 = (n: number): number => Math.round(n * 100) / 100;

const toDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

// Date du jour au Congo (UTC+1, pas d'heure d'été)
const todayCongo = (): string =>
  new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

const monthKey = (y: number, m: number): string =>
  `${y}-${String(m).padStart(2, '0')}`;

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ==========================================================================
  // 🔒 CONTEXTE / GARDES
  // ==========================================================================

  /** Utilisateur ADMIN rattaché à une entreprise. */
  private async ctx(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true },
    });
    if (!user || !user.companyId) {
      throw new ForbiddenException(
        'Utilisateur non rattaché à une entreprise.',
      );
    }
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException(
        "Le module Finances est réservé à l'administrateur de l'entreprise.",
      );
    }
    return { userId: user.id, companyId: user.companyId };
  }

  /** Idem + module activé. Renvoie aussi les paramètres. */
  private async ctxEnabled(userId: string) {
    const c = await this.ctx(userId);
    const settings = await this.prisma.financeSettings.findUnique({
      where: { companyId: c.companyId },
    });
    if (!settings || !settings.enabled) {
      throw new ForbiddenException(
        "Le module Finances n'est pas activé pour votre entreprise.",
      );
    }
    return { ...c, settings };
  }

  private parseDate(ymd: string, field: string): Date {
    const d = toDate(ymd);
    if (Number.isNaN(d.getTime()) || fmtDate(d) !== ymd) {
      throw new BadRequestException(`Date invalide (${field}).`);
    }
    return d;
  }

  private computeAmount(quantity: number, unitPrice: number): number {
    const amount = round2(quantity * unitPrice);
    if (amount > MAX_AMOUNT) {
      throw new BadRequestException('Le montant total dépasse la limite autorisée.');
    }
    return amount;
  }

  // ==========================================================================
  // 🟢 ACTIVATION / STATUT / PARAMÈTRES
  // ==========================================================================

  /** Pour le menu : { enabled } (ADMIN uniquement). */
  async getStatus(userId: string) {
    const c = await this.ctx(userId);
    const s = await this.prisma.financeSettings.findUnique({
      where: { companyId: c.companyId },
      select: { enabled: true },
    });
    return { enabled: !!s?.enabled };
  }

  /** SUPER_ADMIN : active / désactive le module pour une entreprise. */
  async setActivation(companyId: string, enabled: boolean) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, legalName: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable.');

    const s = await this.prisma.financeSettings.upsert({
      where: { companyId },
      create: { companyId, enabled },
      update: { enabled },
    });
    return {
      companyId,
      companyName: company.legalName,
      enabled: s.enabled,
    };
  }

  async getSettings(userId: string) {
    const { settings } = await this.ctxEnabled(userId);
    return {
      enabled: settings.enabled,
      openingBalance: num(settings.openingBalance),
      openingDate: fmtDate(settings.openingDate),
      currency: settings.currency,
    };
  }

  async updateSettings(userId: string, dto: UpdateFinanceSettingsDto) {
    const { companyId, settings } = await this.ctxEnabled(userId);

    const data: Prisma.FinanceSettingsUpdateInput = {};
    if (dto.openingBalance !== undefined) {
      data.openingBalance = dto.openingBalance;
    }
    if (dto.openingDate !== undefined) {
      const newDate = this.parseDate(dto.openingDate, 'date de départ');
      // Interdit de repousser la date de départ après des opérations existantes
      const before = await this.prisma.financeTransaction.count({
        where: { companyId, date: { lt: newDate } },
      });
      if (before > 0) {
        throw new BadRequestException(
          `${before} opération(s) sont antérieures à cette date. Supprimez-les ou choisissez une date plus ancienne.`,
        );
      }
      data.openingDate = newDate;
    }

    const updated = await this.prisma.financeSettings.update({
      where: { id: settings.id },
      data,
    });
    return {
      enabled: updated.enabled,
      openingBalance: num(updated.openingBalance),
      openingDate: fmtDate(updated.openingDate),
      currency: updated.currency,
    };
  }

  // ==========================================================================
  // 🏷️ CATÉGORIES
  // ==========================================================================

  async listCategories(userId: string, q: ListFinanceCategoriesDto) {
    const { companyId } = await this.ctxEnabled(userId);

    // Première utilisation : catégories par défaut
    const count = await this.prisma.financeCategory.count({
      where: { companyId },
    });
    if (count === 0) {
      await this.prisma.financeCategory.createMany({
        data: DEFAULT_CATEGORIES.map((c) => ({ ...c, companyId })),
        skipDuplicates: true,
      });
    }

    const includeInactive = q.includeInactive === 'true';
    const items = await this.prisma.financeCategory.findMany({
      where: {
        companyId,
        ...(q.type ? { type: q.type } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return items.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      color: c.color,
      isActive: c.isActive,
    }));
  }

  async createCategory(userId: string, dto: CreateFinanceCategoryDto) {
    const { companyId } = await this.ctxEnabled(userId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Le nom est obligatoire.');

    const existing = await this.prisma.financeCategory.findUnique({
      where: { companyId_type_name: { companyId, type: dto.type, name } },
    });
    if (existing) {
      if (existing.isActive) {
        throw new ConflictException('Cette catégorie existe déjà.');
      }
      // Archivée → on la réactive
      return this.prisma.financeCategory.update({
        where: { id: existing.id },
        data: { isActive: true, ...(dto.color ? { color: dto.color } : {}) },
      });
    }

    return this.prisma.financeCategory.create({
      data: { companyId, name, type: dto.type, color: dto.color ?? null },
    });
  }

  async updateCategory(
    userId: string,
    id: string,
    dto: UpdateFinanceCategoryDto,
  ) {
    const { companyId } = await this.ctxEnabled(userId);
    const cat = await this.prisma.financeCategory.findFirst({
      where: { id, companyId },
    });
    if (!cat) throw new NotFoundException('Catégorie introuvable.');

    const data: Prisma.FinanceCategoryUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Le nom est obligatoire.');
      if (name !== cat.name) {
        const dup = await this.prisma.financeCategory.findUnique({
          where: { companyId_type_name: { companyId, type: cat.type, name } },
        });
        if (dup) throw new ConflictException('Cette catégorie existe déjà.');
      }
      data.name = name;
    }
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.financeCategory.update({ where: { id }, data });
  }

  /** Supprime si aucune opération, sinon archive. */
  async removeCategory(userId: string, id: string) {
    const { companyId } = await this.ctxEnabled(userId);
    const cat = await this.prisma.financeCategory.findFirst({
      where: { id, companyId },
    });
    if (!cat) throw new NotFoundException('Catégorie introuvable.');

    const used = await this.prisma.financeTransaction.count({
      where: { categoryId: id },
    });
    if (used > 0) {
      await this.prisma.financeCategory.update({
        where: { id },
        data: { isActive: false },
      });
      return { archived: true, deleted: false };
    }
    await this.prisma.financeCategory.delete({ where: { id } });
    return { archived: false, deleted: true };
  }

  private async getCategoryOrFail(
    companyId: string,
    categoryId: string,
    type?: FinanceFlow,
  ) {
    const cat = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, companyId },
    });
    if (!cat) throw new NotFoundException('Catégorie introuvable.');
    if (type && cat.type !== type) {
      throw new BadRequestException(
        type === 'EXPENSE'
          ? "Cette catégorie n'est pas une catégorie de dépenses."
          : "Cette catégorie n'est pas une catégorie d'entrées.",
      );
    }
    return cat;
  }

  // ==========================================================================
  // 💸 TRANSACTIONS
  // ==========================================================================

  private serializeTx(t: {
    id: string;
    type: FinanceFlow;
    categoryId: string;
    category?: { id: string; name: string; color: string | null } | null;
    label: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    amount: Prisma.Decimal;
    date: Date;
    counterparty: string | null;
    note: string | null;
    receiptUrl: string | null;
    createdAt: Date;
  }) {
    return {
      id: t.id,
      type: t.type,
      categoryId: t.categoryId,
      category: t.category
        ? { id: t.category.id, name: t.category.name, color: t.category.color }
        : null,
      label: t.label,
      quantity: num(t.quantity),
      unitPrice: num(t.unitPrice),
      amount: num(t.amount),
      date: fmtDate(t.date),
      counterparty: t.counterparty,
      note: t.note,
      receiptUrl: t.receiptUrl,
      createdAt: t.createdAt,
    };
  }

  private buildTxWhere(
    companyId: string,
    q: {
      from?: string;
      to?: string;
      type?: FinanceFlow;
      categoryId?: string;
      search?: string;
    },
  ): Prisma.FinanceTransactionWhereInput {
    const where: Prisma.FinanceTransactionWhereInput = { companyId };
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: this.parseDate(q.from, 'début') } : {}),
        ...(q.to ? { lte: this.parseDate(q.to, 'fin') } : {}),
      };
    }
    if (q.type) where.type = q.type;
    if (q.categoryId) where.categoryId = q.categoryId;
    const search = q.search?.trim();
    if (search) {
      where.OR = [
        { label: { contains: search, mode: 'insensitive' } },
        { counterparty: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async listTransactions(userId: string, q: ListFinanceTransactionsDto) {
    const { companyId } = await this.ctxEnabled(userId);
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where = this.buildTxWhere(companyId, q);

    const [items, total, sums] = await Promise.all([
      this.prisma.financeTransaction.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, color: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.financeTransaction.count({ where }),
      this.prisma.financeTransaction.groupBy({
        by: ['type'],
        where,
        _sum: { amount: true },
      }),
    ]);

    const income = sums.find((s) => s.type === 'INCOME');
    const expense = sums.find((s) => s.type === 'EXPENSE');

    return {
      items: items.map((t) => this.serializeTx(t)),
      total,
      page,
      limit,
      totals: {
        income: round2(num(income?._sum.amount)),
        expense: round2(num(expense?._sum.amount)),
      },
    };
  }

  async exportTransactions(userId: string, q: ExportFinanceTransactionsDto) {
    const { companyId } = await this.ctxEnabled(userId);
    const where = this.buildTxWhere(companyId, q);
    const items = await this.prisma.financeTransaction.findMany({
      where,
      include: { category: { select: { id: true, name: true, color: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_MAX_ROWS,
    });
    return { items: items.map((t) => this.serializeTx(t)) };
  }

  private assertDateAllowed(date: Date, openingDate: Date) {
    if (date < openingDate) {
      throw new BadRequestException(
        `Cette date est antérieure au début du suivi (${fmtDate(openingDate)}). Modifiez la date de départ dans les paramètres si nécessaire.`,
      );
    }
    if (fmtDate(date) > todayCongo()) {
      throw new BadRequestException(
        "La date ne peut pas être dans le futur.",
      );
    }
  }

  async createTransaction(userId: string, dto: CreateFinanceTransactionDto) {
    const { companyId, settings } = await this.ctxEnabled(userId);

    await this.getCategoryOrFail(companyId, dto.categoryId, dto.type);
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Le libellé est obligatoire.');

    const date = this.parseDate(dto.date, 'date');
    this.assertDateAllowed(date, settings.openingDate);

    const quantity = dto.quantity ?? 1;
    const amount = this.computeAmount(quantity, dto.unitPrice);

    const created = await this.prisma.financeTransaction.create({
      data: {
        companyId,
        type: dto.type,
        categoryId: dto.categoryId,
        label,
        quantity,
        unitPrice: dto.unitPrice,
        amount,
        date,
        counterparty: dto.counterparty?.trim() || null,
        note: dto.note?.trim() || null,
        createdBy: userId,
      },
      include: { category: { select: { id: true, name: true, color: true } } },
    });
    return this.serializeTx(created);
  }

  async updateTransaction(
    userId: string,
    id: string,
    dto: UpdateFinanceTransactionDto,
  ) {
    const { companyId, settings } = await this.ctxEnabled(userId);
    const tx = await this.prisma.financeTransaction.findFirst({
      where: { id, companyId },
    });
    if (!tx) throw new NotFoundException('Opération introuvable.');

    const data: Prisma.FinanceTransactionUncheckedUpdateInput = {};

    if (dto.categoryId !== undefined) {
      await this.getCategoryOrFail(companyId, dto.categoryId, tx.type);
      data.categoryId = dto.categoryId;
    }
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Le libellé est obligatoire.');
      data.label = label;
    }
    if (dto.date !== undefined) {
      const date = this.parseDate(dto.date, 'date');
      this.assertDateAllowed(date, settings.openingDate);
      data.date = date;
    }
    if (dto.counterparty !== undefined) {
      data.counterparty = dto.counterparty.trim() || null;
    }
    if (dto.note !== undefined) data.note = dto.note.trim() || null;

    if (dto.quantity !== undefined || dto.unitPrice !== undefined) {
      const quantity = dto.quantity ?? num(tx.quantity);
      const unitPrice = dto.unitPrice ?? num(tx.unitPrice);
      data.quantity = quantity;
      data.unitPrice = unitPrice;
      data.amount = this.computeAmount(quantity, unitPrice);
    }

    const updated = await this.prisma.financeTransaction.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true, color: true } } },
    });
    return this.serializeTx(updated);
  }

  async removeTransaction(userId: string, id: string) {
    const { companyId } = await this.ctxEnabled(userId);
    const tx = await this.prisma.financeTransaction.findFirst({
      where: { id, companyId },
    });
    if (!tx) throw new NotFoundException('Opération introuvable.');

    await this.prisma.financeTransaction.delete({ where: { id } });
    await this.deleteReceiptFile(tx.receiptUrl);
    return { deleted: true };
  }

  // ── Justificatif (photo / PDF) ──────────────────────────────────────────────
  async uploadReceipt(userId: string, id: string, file: Express.Multer.File) {
    const { companyId } = await this.ctxEnabled(userId);
    if (!file) throw new BadRequestException('Aucun fichier fourni.');

    const tx = await this.prisma.financeTransaction.findFirst({
      where: { id, companyId },
    });
    if (!tx) throw new NotFoundException('Opération introuvable.');

    // Upload d'abord (valide type + taille), suppression de l'ancien ensuite
    const url = await this.cloudinary.uploadPublicFile(
      file,
      `finance-receipts/${companyId}`,
    );

    const updated = await this.prisma.financeTransaction.update({
      where: { id },
      data: { receiptUrl: url },
      include: { category: { select: { id: true, name: true, color: true } } },
    });
    await this.deleteReceiptFile(tx.receiptUrl);
    return this.serializeTx(updated);
  }

  async removeReceipt(userId: string, id: string) {
    const { companyId } = await this.ctxEnabled(userId);
    const tx = await this.prisma.financeTransaction.findFirst({
      where: { id, companyId },
    });
    if (!tx) throw new NotFoundException('Opération introuvable.');

    const updated = await this.prisma.financeTransaction.update({
      where: { id },
      data: { receiptUrl: null },
      include: { category: { select: { id: true, name: true, color: true } } },
    });
    await this.deleteReceiptFile(tx.receiptUrl);
    return this.serializeTx(updated);
  }

  /** Suppression Cloudinary « best effort » : n'échoue jamais l'opération. */
  private async deleteReceiptFile(url: string | null) {
    if (!url) return;
    try {
      const publicId = this.cloudinary.extractPublicId(url);
      if (!publicId) return;
      const isPdf = /\.pdf($|\?)/i.test(url);
      // Les fichiers « raw » (PDF) gardent l'extension dans leur public_id
      await this.cloudinary.deleteFile(
        isPdf ? `${publicId}.pdf` : publicId,
        isPdf ? 'raw' : 'image',
      );
    } catch {
      /* orphelin Cloudinary toléré */
    }
  }

  // ==========================================================================
  // 🎯 BUDGETS (par catégorie de dépenses, par mois)
  // ==========================================================================

  async getBudgets(userId: string, q: FinanceBudgetsQueryDto) {
    const { companyId } = await this.ctxEnabled(userId);

    const start = new Date(Date.UTC(q.year, q.month - 1, 1));
    const end = new Date(Date.UTC(q.year, q.month, 0));

    const [categories, budgets, spent] = await Promise.all([
      this.prisma.financeCategory.findMany({
        where: { companyId, type: 'EXPENSE', isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.financeBudget.findMany({
        where: { companyId, year: q.year, month: q.month },
      }),
      this.prisma.financeTransaction.groupBy({
        by: ['categoryId'],
        where: {
          companyId,
          type: 'EXPENSE',
          date: { gte: start, lte: end },
        },
        _sum: { amount: true },
      }),
    ]);

    const budgetByCat = new Map(budgets.map((b) => [b.categoryId, num(b.amount)]));
    const spentByCat = new Map(
      spent.map((s) => [s.categoryId, round2(num(s._sum.amount))]),
    );

    const rows = categories.map((c) => {
      const budget = budgetByCat.get(c.id) ?? 0;
      const sp = spentByCat.get(c.id) ?? 0;
      return {
        categoryId: c.id,
        name: c.name,
        color: c.color,
        budget,
        spent: sp,
        remaining: round2(budget - sp),
        percent: budget > 0 ? Math.round((sp / budget) * 100) : null,
      };
    });

    const totalBudget = round2(rows.reduce((a, r) => a + r.budget, 0));
    const totalSpent = round2(rows.reduce((a, r) => a + r.spent, 0));

    return {
      year: q.year,
      month: q.month,
      rows,
      totals: { budget: totalBudget, spent: totalSpent },
    };
  }

  async upsertBudget(userId: string, dto: UpsertFinanceBudgetDto) {
    const { companyId } = await this.ctxEnabled(userId);
    await this.getCategoryOrFail(companyId, dto.categoryId, 'EXPENSE');

    if (dto.amount === 0) {
      await this.prisma.financeBudget.deleteMany({
        where: {
          companyId,
          categoryId: dto.categoryId,
          year: dto.year,
          month: dto.month,
        },
      });
      return { categoryId: dto.categoryId, year: dto.year, month: dto.month, amount: 0 };
    }

    const b = await this.prisma.financeBudget.upsert({
      where: {
        companyId_categoryId_year_month: {
          companyId,
          categoryId: dto.categoryId,
          year: dto.year,
          month: dto.month,
        },
      },
      create: {
        companyId,
        categoryId: dto.categoryId,
        year: dto.year,
        month: dto.month,
        amount: dto.amount,
      },
      update: { amount: dto.amount },
    });
    return {
      categoryId: b.categoryId,
      year: b.year,
      month: b.month,
      amount: num(b.amount),
    };
  }

  // ==========================================================================
  // 📊 DASHBOARD
  // ==========================================================================

  async getDashboard(userId: string, q: FinanceDashboardQueryDto) {
    const { companyId, settings } = await this.ctxEnabled(userId);

    // Période par défaut : mois courant
    const today = todayCongo();
    const [ty, tm] = today.split('-').map(Number);
    const defFrom = `${ty}-${String(tm).padStart(2, '0')}-01`;
    const defTo = fmtDate(new Date(Date.UTC(ty, tm, 0)));

    const fromStr = q.from ?? defFrom;
    const toStr = q.to ?? defTo;
    const from = this.parseDate(fromStr, 'début');
    const to = this.parseDate(toStr, 'fin');
    if (from > to) {
      throw new BadRequestException('La date de début est après la date de fin.');
    }

    const y1 = from.getUTCFullYear();
    const m1 = from.getUTCMonth() + 1;
    const y2 = to.getUTCFullYear();
    const m2 = to.getUTCMonth() + 1;
    const monthsCount = (y2 - y1) * 12 + (m2 - m1) + 1;
    if (monthsCount > MAX_RANGE_MONTHS) {
      throw new BadRequestException(
        `La période ne peut pas dépasser ${MAX_RANGE_MONTHS} mois.`,
      );
    }

    const openingDate = settings.openingDate;
    const opening = num(settings.openingBalance);

    const [rangeRows, beforeSums, allSums, categories, budgets] =
      await Promise.all([
        // Mouvements de la période, par jour / type / catégorie
        this.prisma.financeTransaction.groupBy({
          by: ['date', 'type', 'categoryId'],
          where: { companyId, date: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
        // Net avant la période (depuis le début du suivi)
        this.prisma.financeTransaction.groupBy({
          by: ['type'],
          where: { companyId, date: { gte: openingDate, lt: from } },
          _sum: { amount: true },
        }),
        // Net total (solde actuel)
        this.prisma.financeTransaction.groupBy({
          by: ['type'],
          where: { companyId, date: { gte: openingDate } },
          _sum: { amount: true },
        }),
        this.prisma.financeCategory.findMany({ where: { companyId } }),
        this.prisma.financeBudget.findMany({
          where: { companyId, year: { gte: y1, lte: y2 } },
        }),
      ]);

    const sumOf = (
      rows: { type: FinanceFlow; _sum: { amount: Prisma.Decimal | null } }[],
      type: FinanceFlow,
    ) => num(rows.find((r) => r.type === type)?._sum.amount);

    const balanceBefore = round2(
      opening + sumOf(beforeSums, 'INCOME') - sumOf(beforeSums, 'EXPENSE'),
    );
    const balanceNow = round2(
      opening + sumOf(allSums, 'INCOME') - sumOf(allSums, 'EXPENSE'),
    );

    // ── Agrégations de la période ────────────────────────────────────────────
    const catById = new Map(categories.map((c) => [c.id, c]));
    const monthly = new Map<string, { income: number; expense: number }>();
    const expenseByCat = new Map<string, number>();
    const incomeByCat = new Map<string, number>();
    let totalIncome = 0;
    let totalExpense = 0;

    for (const r of rangeRows) {
      const amount = num(r._sum.amount);
      const ym = fmtDate(r.date).slice(0, 7);
      const bucket = monthly.get(ym) ?? { income: 0, expense: 0 };
      if (r.type === 'INCOME') {
        bucket.income += amount;
        totalIncome += amount;
        incomeByCat.set(r.categoryId, (incomeByCat.get(r.categoryId) ?? 0) + amount);
      } else {
        bucket.expense += amount;
        totalExpense += amount;
        expenseByCat.set(r.categoryId, (expenseByCat.get(r.categoryId) ?? 0) + amount);
      }
      monthly.set(ym, bucket);
    }

    totalIncome = round2(totalIncome);
    totalExpense = round2(totalExpense);

    const toCategoryList = (m: Map<string, number>, total: number) =>
      [...m.entries()]
        .map(([categoryId, t]) => {
          const c = catById.get(categoryId);
          return {
            categoryId,
            name: c?.name ?? 'Catégorie supprimée',
            color: c?.color ?? null,
            total: round2(t),
            percent: total > 0 ? Math.round((t / total) * 100) : 0,
          };
        })
        .sort((a, b) => b.total - a.total);

    // ── Série mensuelle avec solde de clôture ────────────────────────────────
    const monthlySeries: {
      month: string;
      income: number;
      expense: number;
      net: number;
      closingBalance: number;
    }[] = [];
    let running = balanceBefore;
    for (let i = 0; i < monthsCount; i++) {
      const d = new Date(Date.UTC(y1, m1 - 1 + i, 1));
      const key = monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
      const b = monthly.get(key) ?? { income: 0, expense: 0 };
      const income = round2(b.income);
      const expense = round2(b.expense);
      const net = round2(income - expense);
      running = round2(running + net);
      monthlySeries.push({ month: key, income, expense, net, closingBalance: running });
    }

    // ── Budget vs réel (somme des budgets des mois de la période) ────────────
    const monthKeys = new Set(monthlySeries.map((m) => m.month));
    const budgetByCat = new Map<string, number>();
    for (const b of budgets) {
      if (!monthKeys.has(monthKey(b.year, b.month))) continue;
      budgetByCat.set(b.categoryId, (budgetByCat.get(b.categoryId) ?? 0) + num(b.amount));
    }

    const budgetCatIds = new Set([...budgetByCat.keys(), ...expenseByCat.keys()]);
    const budgetComparison = [...budgetCatIds]
      .map((categoryId) => {
        const c = catById.get(categoryId);
        const budget = round2(budgetByCat.get(categoryId) ?? 0);
        const spent = round2(expenseByCat.get(categoryId) ?? 0);
        return {
          categoryId,
          name: c?.name ?? 'Catégorie supprimée',
          color: c?.color ?? null,
          budget,
          spent,
          remaining: round2(budget - spent),
          percent: budget > 0 ? Math.round((spent / budget) * 100) : null,
        };
      })
      .filter((r) => r.budget > 0 || r.spent > 0)
      .sort((a, b) => b.spent - a.spent);

    const budgetTotal = round2([...budgetByCat.values()].reduce((a, b) => a + b, 0));

    return {
      period: { from: fromStr, to: toStr },
      currency: settings.currency,
      balance: {
        current: balanceNow,
        openingBalance: opening,
        openingDate: fmtDate(openingDate),
        atPeriodStart: balanceBefore,
        atPeriodEnd: round2(balanceBefore + totalIncome - totalExpense),
      },
      totals: {
        income: totalIncome,
        expense: totalExpense,
        net: round2(totalIncome - totalExpense),
      },
      expenseByCategory: toCategoryList(expenseByCat, totalExpense),
      incomeByCategory: toCategoryList(incomeByCat, totalIncome),
      monthly: monthlySeries,
      budgetComparison,
      budgetTotals: { budget: budgetTotal, spent: totalExpense },
    };
  }
}