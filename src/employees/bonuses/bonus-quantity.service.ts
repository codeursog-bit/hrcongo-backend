// ============================================================================
// 📁 src/employees/bonuses/bonus-quantity.service.ts
//
// Gère les quantités variables mois par mois pour les primes mode FREE.
// Utilisé AVANT et APRÈS la génération du bulletin (recalcul possible).
// ============================================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertQuantityDto {
  quantity: number; // ex: 7 (repas), 3 (déplacements)
  note?: string; // ex: "7 repas pris en avril"
}

export interface BonusQuantityResult {
  id: string;
  employeeBonusId: string;
  bonusType: string;
  month: number;
  year: number;
  unitAmount: number;
  quantity: number;
  computedAmount: number;
  note: string | null;
  updatedAt: Date;
}

@Injectable()
export class BonusQuantityService {
  private readonly logger = new Logger(BonusQuantityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Saisir / modifier la quantité d'une prime FREE pour un mois donné ──────

  async upsert(
    bonusId: string,
    month: number,
    year: number,
    dto: UpsertQuantityDto,
  ): Promise<BonusQuantityResult> {
    // 1. Vérifier que la prime existe et est bien en mode FREE
    const bonus = await this.prisma.employeeBonus.findUnique({
      where: { id: bonusId },
    });
    if (!bonus) throw new NotFoundException(`Prime ${bonusId} introuvable`);

    const quantityMode = (bonus as any).quantityMode as string | null;
    const unitAmount = Number((bonus as any).unitAmount ?? 0);

    if (quantityMode !== 'FREE') {
      throw new BadRequestException(
        `La prime "${bonus.bonusType}" n'est pas en mode quantité libre (mode actuel: ${quantityMode ?? 'FIXE'}).`,
      );
    }
    if (unitAmount <= 0) {
      throw new BadRequestException(
        `La prime "${bonus.bonusType}" n'a pas de montant unitaire défini.`,
      );
    }

    // 2. Calculer le montant
    const qty = Math.max(0, dto.quantity);
    const computedAmount = Math.round(unitAmount * qty);

    // 3. Créer ou mettre à jour (upsert)
    const record = await (this.prisma as any).bonusMonthlyQuantity.upsert({
      where: {
        employeeBonusId_month_year: {
          employeeBonusId: bonusId,
          month,
          year,
        },
      },
      update: {
        quantity: qty,
        computedAmount,
        note: dto.note ?? null,
        updatedAt: new Date(),
      },
      create: {
        employeeBonusId: bonusId,
        month,
        year,
        quantity: qty,
        computedAmount,
        note: dto.note ?? null,
      },
    });

    this.logger.log(
      `[Quantité] "${bonus.bonusType}" | ${month}/${year} | ` +
        `${unitAmount.toLocaleString('fr-FR')} × ${qty} = ${computedAmount.toLocaleString('fr-FR')} FCFA`,
    );

    return this._map(record, bonus.bonusType, unitAmount);
  }

  // ── Récupérer la quantité d'une prime pour un mois ─────────────────────────

  async findOne(
    bonusId: string,
    month: number,
    year: number,
  ): Promise<BonusQuantityResult | null> {
    const record = await (this.prisma as any).bonusMonthlyQuantity.findUnique({
      where: {
        employeeBonusId_month_year: { employeeBonusId: bonusId, month, year },
      },
      include: {
        employeeBonus: { select: { bonusType: true, unitAmount: true } },
      },
    });
    if (!record) return null;
    return this._map(
      record,
      record.employeeBonus.bonusType,
      Number(record.employeeBonus.unitAmount ?? 0),
    );
  }

  // ── Récupérer toutes les quantités FREE d'un employé pour un mois ──────────
  // Utilisé par le frontend pour afficher le formulaire de saisie pré-bulletin

  async findAllForEmployee(
    employeeId: string,
    month: number,
    year: number,
  ): Promise<{
    pending: BonusQuantityResult[]; // primes FREE sans quantité ce mois
    filled: BonusQuantityResult[]; // primes FREE avec quantité saisie
  }> {
    // Toutes les primes FREE actives de l'employé
    const bonuses = await this.prisma.employeeBonus.findMany({
      where: {
        employeeId,
        isActive: true,
        quantityMode: 'FREE',
      } as any,
    });

    const pending: BonusQuantityResult[] = [];
    const filled: BonusQuantityResult[] = [];

    for (const bonus of bonuses) {
      const unitAmount = Number((bonus as any).unitAmount ?? 0);
      const record = await (this.prisma as any).bonusMonthlyQuantity.findUnique(
        {
          where: {
            employeeBonusId_month_year: {
              employeeBonusId: bonus.id,
              month,
              year,
            },
          },
        },
      );

      if (record) {
        filled.push(this._map(record, bonus.bonusType, unitAmount));
      } else {
        // Pas encore saisie → on construit un résultat vide avec la quantité par défaut
        const defaultQty = Number((bonus as any).defaultQuantity ?? 0);
        pending.push({
          id: '',
          employeeBonusId: bonus.id,
          bonusType: bonus.bonusType,
          month,
          year,
          unitAmount,
          quantity: defaultQty,
          computedAmount: Math.round(unitAmount * defaultQty),
          note: null,
          updatedAt: new Date(),
        });
      }
    }

    return { pending, filled };
  }

  // ── Supprimer une quantité saisie (reset au défaut) ─────────────────────────

  async remove(bonusId: string, month: number, year: number): Promise<void> {
    await (this.prisma as any).bonusMonthlyQuantity.deleteMany({
      where: { employeeBonusId: bonusId, month, year },
    });
  }

  // ── Helper privé ─────────────────────────────────────────────────────────────

  private _map(
    record: any,
    bonusType: string,
    unitAmount: number,
  ): BonusQuantityResult {
    return {
      id: record.id,
      employeeBonusId: record.employeeBonusId,
      bonusType,
      month: record.month,
      year: record.year,
      unitAmount,
      quantity: Number(record.quantity),
      computedAmount: Number(record.computedAmount),
      note: record.note ?? null,
      updatedAt: record.updatedAt,
    };
  }
}
