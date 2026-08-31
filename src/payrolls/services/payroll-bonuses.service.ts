// ============================================================================
// 📁 src/payrolls/services/payroll-bonuses.service.ts
//
// Résolution de toutes les primes d'un employé pour un bulletin.
// Trois catégories fiscales (Congo Brazzaville) :
//   TAXABLE_CNSS     → imposable ITS + soumis CNSS  (ancienneté, diplôme, responsabilité…)
//   TAXABLE_NO_CNSS  → imposable ITS + exonéré CNSS (13e mois, rendement, risque…)
//   NON_TAXABLE      → exonéré ITS + exonéré CNSS   (indemnités : transport, panier, logement…)
//
// Prorata : calculé ici selon daysToPay / workDaysTotal (ex: 20/26 pour transport)
// Ancienneté : AUTO (lit les règles BDD de la convention) ou MANUAL (saisie admin)
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollSeniorityService } from './payroll-seniority.service';
import { calculateMonthsWorkedInYear } from '../../common/months-worked.util';

// ─── Type fiscal ─────────────────────────────────────────────────────────────

export type BonusFiscalType =
  'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE';

// ─── Interface principale ─────────────────────────────────────────────────────

export interface CalculatedBonus {
  id: string;
  bonusType: string;
  amount: number;
  isTaxable: boolean;
  isCnss: boolean;
  fiscalType: BonusFiscalType;
  source: 'MANUAL' | 'AUTOMATIC';
  isRecurring: boolean;
  description?: string | null;
  isProratized: boolean;
  isInLeaveBase: boolean;
  bonusCategory: string;
  // ✅ base et rate — pour affichage bulletin (base journalière/salariale, taux %)
  base?: number | null;
  rate?: number | null;
  // ✅ Mode quantité libre (FREE) — pour affichage "unitAmount × quantité"
  quantityMode?: string | null;
  unitAmount?: number | null;
  quantity?: number | null;
  // internes — affichage bulletin
  _proratized?: boolean;
  _originalAmount?: number;
  _seniorityYears?: number;
  _seniorityRate?: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PayrollBonusesService {
  private readonly logger = new Logger(PayrollBonusesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seniority: PayrollSeniorityService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTHODE PRINCIPALE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Résout TOUTES les primes d'un employé pour le mois de paie.
   *
   * @param employeeId     ID de l'employé
   * @param companyId      ID de l'entreprise (pour lire la convention en BDD)
   * @param baseSalary     Salaire de base brut (FCFA)
   * @param month          Mois du bulletin (1-12)
   * @param year           Année du bulletin
   * @param daysToPay      Jours réellement travaillés ce mois (ex: 20)
   * @param workDaysTotal  Jours théoriques du mois (ex: 26)
   * @param hireDate       Date d'embauche (pour calcul ancienneté AUTO)
   * @param seniorityMode  'AUTO' = convention BDD | 'MANUAL' = saisie admin
   */
  async resolveForPayroll(
    employeeId: string,
    companyId: string,
    baseSalary: number,
    month: number,
    year: number,
    daysToPay: number = 26,
    workDaysTotal: number = 26,
    hireDate?: Date | null,
    seniorityMode: 'AUTO' | 'MANUAL' = 'AUTO',
  ): Promise<CalculatedBonus[]> {
    // ── 1. Primes saisies en BDD (manuelles ou templates) ─────────────────
    const dbBonuses = await this.prisma.employeeBonus.findMany({
      where: { employeeId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const resolved: CalculatedBonus[] = [];

    for (const b of dbBonuses) {
      // Filtrer ONE_TIME hors du bon mois/année
      if (b.frequency === 'ONE_TIME') {
        const d = new Date(b.startDate);
        if (d.getMonth() + 1 !== month || d.getFullYear() !== year) continue;
      }
      // Filtrer ANNUAL hors du mois anniversaire (ex: 13e mois démarré en
      // décembre → ne se déclenche qu'en décembre chaque année, jamais les
      // autres mois)
      if (b.frequency === 'ANNUAL') {
        const d = new Date(b.startDate);
        if (d.getMonth() + 1 !== month) continue;
      }
      // Filtrer prime pas encore démarrée (MONTHLY/ANNUAL récurrentes) —
      // ex: prime créée aujourd'hui pour démarrer le mois prochain ne doit
      // pas apparaître sur le bulletin du mois en cours
      const startD = new Date(b.startDate);
      const monthEnd = new Date(year, month, 0); // dernier jour du mois de paie
      if (startD > monthEnd) continue;
      // Filtrer prime expirée
      if (b.endDate && new Date(b.endDate) < new Date(year, month - 1, 1))
        continue;

      // ── Type fiscal (priorité : champ dédié > booléens legacy) ──────────
      const fiscalType = this._resolveFiscalType(
        (b as any).fiscalType ?? null,
        b.isTaxable ?? true,
        b.isCnss ?? true,
      );

      // ── Calcul montant brut ──────────────────────────────────────────────
      const quantityModeField = (b as any).quantityMode as string | null;
      let amount = 0;
      let quantityUsed: number | null = null;

      if (quantityModeField === 'FREE') {
        // Prime à quantité libre : le montant vient de la saisie mensuelle
        // (BonusMonthlyQuantity), jamais de fixedAmount/percentage.
        const monthlyQty = await this.prisma.bonusMonthlyQuantity.findUnique({
          where: {
            employeeBonusId_month_year: {
              employeeBonusId: b.id,
              month,
              year,
            },
          },
        });
        if (monthlyQty) {
          amount = Number(monthlyQty.computedAmount);
          quantityUsed = Number(monthlyQty.quantity);
        } else {
          // Pas de quantité saisie pour ce mois → rien à payer, on ignore
          // silencieusement (comportement volontaire, pas une erreur)
          continue;
        }
      } else if (b.calculationType === 'FIXED_AMOUNT' && b.fixedAmount !== null) {
        amount = Number(b.fixedAmount);
      } else if (b.calculationType === 'PERCENTAGE' && b.percentage !== null) {
        amount = Math.round((Number(b.percentage) / 100) * baseSalary);
      }
      if (amount <= 0) continue;

      // ── Ancienneté manuelle : exclure si mode AUTO pour éviter doublons ──
      const isSeniorityBonus = b.bonusType.toLowerCase().includes('anciennet');
      if (isSeniorityBonus && seniorityMode === 'AUTO') {
        this.logger.log(
          `[Ancienneté] Prime manuelle "${b.bonusType}" ignorée — mode AUTO actif`,
        );
        continue;
      }

      // ── Prorata selon jours travaillés (ou mois travaillés pour le 13e mois) ──
      // (jamais appliqué en mode FREE : le montant saisi ce mois-là reflète
      // déjà la réalité — ex. quantité réduite si l'employé n'a fait qu'une
      // semaine — le proratiser en plus serait une double déduction)
      const isProratized =
        quantityModeField !== 'FREE' && ((b as any).isProratized ?? false);
      let finalAmount = amount;
      let _proratized = false;

      if (isProratized && b.frequency === 'ANNUAL') {
        // ── 13e mois / prime de fin d'année : prorata MOIS travaillés / 12 ──
        // (pas le prorata jours du mois utilisé pour transport/panier — un
        // employé embauché en mars n'a pas fait 10/12e du mois de décembre,
        // il a fait 10/12e de l'année)
        if (hireDate) {
          const refDate = new Date(year, month - 1, new Date(year, month, 0).getDate());
          const monthsWorked = calculateMonthsWorkedInYear(hireDate, refDate, year);
          const ratio = monthsWorked / 12;
          finalAmount = Math.round(amount * ratio);
          _proratized = true;
          this.logger.log(
            `📊 "${b.bonusType}" (13e mois) proratisée : ${monthsWorked}/12 mois travaillés × ` +
              `${amount.toLocaleString('fr-FR')} = ${finalAmount.toLocaleString('fr-FR')} FCFA`,
          );
        }
        // Sans hireDate connue, on ne peut pas calculer le prorata → montant plein (fallback prudent)
      } else if (isProratized && workDaysTotal > 0 && daysToPay < workDaysTotal) {
        const ratio = daysToPay / workDaysTotal;
        finalAmount = Math.round(amount * ratio);
        _proratized = true;
        this.logger.log(
          `📊 "${b.bonusType}" proratisée : ${amount.toLocaleString('fr-FR')} × ` +
            `(${daysToPay}/${workDaysTotal}) = ${finalAmount.toLocaleString('fr-FR')} FCFA`,
        );
      }

      // ✅ Calculer base et rate pour affichage bulletin
      // PERCENTAGE → base = salaire de base, rate = % (ex: 0.06 pour 6%)
      // FIXED_AMOUNT → base = null, rate = null (montant fixe, pas de calcul)
      const bonusBase =
        b.calculationType === 'PERCENTAGE' && b.percentage !== null
          ? baseSalary
          : null;
      const bonusRate =
        b.calculationType === 'PERCENTAGE' && b.percentage !== null
          ? Number(b.percentage) / 100
          : null;

      resolved.push({
        id: b.id,
        bonusType: b.bonusType,
        amount: finalAmount,
        isTaxable: fiscalType !== 'NON_TAXABLE',
        isCnss: fiscalType === 'TAXABLE_CNSS',
        fiscalType,
        source: b.isAutomatic ? 'AUTOMATIC' : 'MANUAL',
        isRecurring: b.frequency !== 'ONE_TIME',
        description: b.notes,
        isProratized,
        isInLeaveBase: (b as any).isInLeaveBase ?? true,
        bonusCategory: (b as any).bonusCategory ?? 'PERFORMANCE',
        // ✅ Mode quantité libre — pour affichage "unitAmount × quantité" sur le bulletin
        quantityMode: quantityModeField,
        unitAmount:
          quantityModeField === 'FREE' && (b as any).unitAmount != null
            ? Number((b as any).unitAmount)
            : null,
        quantity: quantityUsed,
        base: bonusBase, // ✅ salaire de base si % sinon null
        rate: bonusRate, // ✅ taux décimal si % sinon null
        _proratized,
        _originalAmount: _proratized ? amount : undefined,
      });
    }

    // ── 2. Prime d'ancienneté AUTOMATIQUE ───────────────────────────────────
    if (seniorityMode === 'AUTO' && hireDate) {
      const result = await this.seniority.calculateFromConvention(
        companyId,
        employeeId,
        hireDate,
        baseSalary,
        year,
        month,
      );
      const seniorityBonus = this.seniority.toCalculatedBonus(result);
      if (seniorityBonus) {
        resolved.push(seniorityBonus as CalculatedBonus);
      }
    }

    return resolved;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPER FISCAL
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Résout le type fiscal d'une prime.
   * Priorité : champ `fiscalType` explicite → puis booléens legacy isTaxable/isCnss.
   */
  _resolveFiscalType(
    fiscalTypeField: string | null,
    isTaxable: boolean,
    isCnss: boolean,
  ): BonusFiscalType {
    if (fiscalTypeField === 'NON_TAXABLE') return 'NON_TAXABLE';
    if (fiscalTypeField === 'TAXABLE_NO_CNSS') return 'TAXABLE_NO_CNSS';
    if (fiscalTypeField === 'TAXABLE_CNSS') return 'TAXABLE_CNSS';
    // Fallback booléens legacy
    if (!isTaxable) return 'NON_TAXABLE';
    if (isTaxable && !isCnss) return 'TAXABLE_NO_CNSS';
    return 'TAXABLE_CNSS';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTHODES DE COMPATIBILITÉ — signature inchangée pour le reste du code
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Appelé par payrolls.service.ts (create / recalculate / simulate).
   * Accepte companyId en 3e paramètre optionnel pour rétrocompatibilité.
   */
  async calculateEmployeeBonuses(
    employeeId: string,
    baseSalary: number,
    month: number,
    year: number,
    companyId?: string,
    daysToPay?: number,
    workDaysTotal?: number,
    hireDate?: Date | null,
    seniorityMode?: 'AUTO' | 'MANUAL',
  ): Promise<CalculatedBonus[]> {
    // Si companyId absent (anciens appels), on ne fait pas l'ancienneté auto
    if (!companyId) {
      return this.resolveForPayroll(
        employeeId,
        '',
        baseSalary,
        month,
        year,
        daysToPay,
        workDaysTotal,
        null,
        'MANUAL',
      );
    }
    return this.resolveForPayroll(
      employeeId,
      companyId,
      baseSalary,
      month,
      year,
      daysToPay,
      workDaysTotal,
      hireDate,
      seniorityMode ?? 'AUTO',
    );
  }

  /**
   * Appelé par payroll-generator.service.ts (paie en masse).
   */
  async getBonusesByEmployees(
    employeeIds: string[],
    baseSalaryMap: Record<string, number> | Map<string, number>,
    month?: number,
    year?: number,
    companyId?: string,
    daysToPay?: number,
    workDaysTotal?: number,
    hireDateMap?: Record<string, Date | null>,
    seniorityMode?: 'AUTO' | 'MANUAL',
  ): Promise<Record<string, CalculatedBonus[]>> {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();

    const result: Record<string, CalculatedBonus[]> = {};

    await Promise.all(
      employeeIds.map(async (empId) => {
        const base =
          baseSalaryMap instanceof Map
            ? (baseSalaryMap.get(empId) ?? 0)
            : (baseSalaryMap[empId] ?? 0);
        const hire = hireDateMap?.[empId] ?? null;

        result[empId] = await this.resolveForPayroll(
          empId,
          companyId ?? '',
          base,
          m,
          y,
          daysToPay,
          workDaysTotal,
          hire,
          seniorityMode ?? 'AUTO',
        );
      }),
    );

    return result;
  }

  async resolveManualBonuses(
    employeeId: string,
    baseSalary: number,
    month: number,
    year: number,
  ): Promise<CalculatedBonus[]> {
    return (
      await this.resolveForPayroll(employeeId, '', baseSalary, month, year)
    ).filter((b) => b.source === 'MANUAL');
  }

  async resolveAutomaticBonuses(
    employeeId: string,
    baseSalary: number,
    month: number,
    year: number,
  ): Promise<CalculatedBonus[]> {
    return (
      await this.resolveForPayroll(employeeId, '', baseSalary, month, year)
    ).filter((b) => b.source === 'AUTOMATIC');
  }
}