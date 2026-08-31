// ============================================================================
// 📁 src/payrolls/services/payroll-seniority.service.ts
//
// Calcul de la prime d'ancienneté.
// Source de vérité : CollectiveAgreementRule (BDD) — alimentée par ConventionsService.
// Deux modes possibles par entreprise :
//   AUTO   → le système calcule la prime selon les règles de la convention
//   MANUAL → l'admin saisit lui-même la prime ; aucun calcul automatique
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SeniorityResult {
  yearsCompleted: number;
  monthsCompleted: number;
  rateApplied: number; // en %
  amount: number; // FCFA
  ruleLabel: string; // libellé lisible pour le bulletin
  isEligible: boolean;
  source: 'AUTOMATIC' | 'MANUAL';
  isTaxable: boolean;
  isCnss: boolean;
}

/**
 * Formule linéaire d'ancienneté — alternative aux paliers CollectiveAgreementRule.
 * rate(years) = startRate + (years - startYear) × ratePerYear, pour years ≥ startYear
 * Ex: { enabled:true, startYear:2, startRate:2, ratePerYear:1, capPercent:null }
 *   → 2 ans = 2%, 3 ans = 3%, 29 ans = 29%, 30 ans = 30%, etc. (pas de plafond)
 */
export interface SeniorityLinearConfig {
  enabled: boolean;
  startYear: number;
  startRate: number;
  ratePerYear: number;
  capPercent: number | null;
}

@Injectable()
export class PayrollSeniorityService {
  private readonly logger = new Logger(PayrollSeniorityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Calcul de l'ancienneté en années / mois ─────────────────────────────

  computeSeniority(
    hireDate: Date,
    payrollYear: number,
    payrollMonth: number, // 1-12
  ): { yearsCompleted: number; monthsCompleted: number } {
    // Référence = dernier jour du mois de paie
    const ref = new Date(payrollYear, payrollMonth, 0);
    const hire = new Date(hireDate);

    let months =
      (ref.getFullYear() - hire.getFullYear()) * 12 +
      (ref.getMonth() - hire.getMonth());

    if (ref.getDate() < hire.getDate()) months -= 1;
    months = Math.max(0, months);

    return {
      yearsCompleted: Math.floor(months / 12),
      monthsCompleted: months,
    };
  }

  // ─── Calcul principal (mode AUTO) ────────────────────────────────────────

  /**
   * Calcule la prime d'ancienneté en lisant les règles AUTOMATIC_BONUS
   * de la convention de l'entreprise (table collective_agreement_rules en BDD).
   *
   * Algorithme :
   *  1. Charge toutes les règles AUTOMATIC_BONUS actives de l'entreprise.
   *  2. Filtre celles dont bonusType contient "ancienneté" (insensible à la casse).
   *  3. Parmi ces règles, sélectionne celle dont minMonthsOfService ≤ ancienneté
   *     ET maxMonthsOfService est null ou > ancienneté — prend la plus haute.
   *  4. Calcule le montant : fixedAmount ou pourcentage × baseSalary.
   */
  async calculateFromConvention(
    companyId: string,
    employeeId: string,
    hireDate: Date,
    baseSalary: number,
    payrollYear: number,
    payrollMonth: number,
  ): Promise<SeniorityResult> {
    const { yearsCompleted, monthsCompleted } = this.computeSeniority(
      hireDate,
      payrollYear,
      payrollMonth,
    );

    // ── 0. Override personnel — prioritaire sur TOUT (même si enabled:false → exclusion explicite) ──
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { seniorityLinearOverride: true } as any,
    });
    const override = (employee as any)?.seniorityLinearOverride as
      SeniorityLinearConfig | null | undefined;
    if (override) {
      return this._computeLinear(
        yearsCompleted,
        monthsCompleted,
        baseSalary,
        override,
        true,
      );
    }

    // ── 0bis. Config entreprise — formule linéaire, si activée ──────────────
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { seniorityLinearConfig: true } as any,
    });
    const general = (company as any)?.seniorityLinearConfig as
      SeniorityLinearConfig | null | undefined;
    if (general?.enabled) {
      return this._computeLinear(
        yearsCompleted,
        monthsCompleted,
        baseSalary,
        general,
        false,
      );
    }

    // ── 1. Fallback : paliers CollectiveAgreementRule (comportement existant, inchangé) ──
    // 1. Règles d'ancienneté actives pour cette entreprise
    const rules = await this.prisma.collectiveAgreementRule.findMany({
      where: {
        companyId,
        isActive: true,
        ruleType: 'AUTOMATIC_BONUS',
        bonusType: { contains: 'anciennet', mode: 'insensitive' },
      },
      orderBy: { minMonthsOfService: 'desc' }, // du plus haut au plus bas
    });

    if (rules.length === 0) {
      this.logger.log(
        `[Ancienneté] Aucune règle AUTOMATIC_BONUS ancienneté trouvée pour companyId=${companyId}`,
      );
      return this._noEligible(yearsCompleted, monthsCompleted);
    }

    // 2. Trouver le palier applicable (le plus haut dont min ≤ ancienneté)
    const applicableRule = rules.find((r) => {
      const min = r.minMonthsOfService ?? 0;
      const max = r.maxMonthsOfService ?? null;
      return monthsCompleted >= min && (max === null || monthsCompleted <= max);
    });

    if (!applicableRule) {
      this.logger.log(
        `[Ancienneté] Aucun palier applicable — ${monthsCompleted} mois de présence`,
      );
      return this._noEligible(yearsCompleted, monthsCompleted);
    }

    // 3. Calcul du montant
    let amount = 0;
    let rateApplied = 0;

    if (
      applicableRule.bonusFixedAmount !== null &&
      Number(applicableRule.bonusFixedAmount) > 0
    ) {
      amount = Math.round(Number(applicableRule.bonusFixedAmount));
      rateApplied = 0; // montant fixe, pas de taux
    } else if (
      applicableRule.bonusPercentage !== null &&
      Number(applicableRule.bonusPercentage) > 0
    ) {
      rateApplied = Number(applicableRule.bonusPercentage);
      const base =
        applicableRule.bonusBaseCalculation === 'GROSS_SALARY'
          ? baseSalary // gross non disponible ici → on utilise base par sécurité
          : baseSalary; // BASE_SALARY (défaut)
      amount = Math.round((rateApplied / 100) * base);
    }

    if (amount <= 0) return this._noEligible(yearsCompleted, monthsCompleted);

    const minYears = Math.floor((applicableRule.minMonthsOfService ?? 0) / 12);
    const ruleLabel = applicableRule.bonusType
      ? `${applicableRule.bonusType} — ${rateApplied > 0 ? `${rateApplied}%` : `${amount.toLocaleString('fr-FR')} FCFA fixe`}`
      : `Prime d'ancienneté (${yearsCompleted} ans — ${rateApplied > 0 ? `${rateApplied}%` : amount.toLocaleString('fr-FR') + ' FCFA'})`;

    this.logger.log(
      `[Ancienneté] Palier trouvé : ${ruleLabel} | ` +
        `${yearsCompleted} ans (${monthsCompleted} mois) | ` +
        `Montant : ${amount.toLocaleString('fr-FR')} FCFA`,
    );

    return {
      yearsCompleted,
      monthsCompleted,
      rateApplied,
      amount,
      ruleLabel,
      isEligible: true,
      source: 'AUTOMATIC',
      isTaxable: true, // prime d'ancienneté = imposable ITS
      isCnss: true, // prime d'ancienneté = soumise CNSS
    };
  }

  // ─── Convertit SeniorityResult → CalculatedBonus ─────────────────────────

  toCalculatedBonus(result: SeniorityResult): any | null {
    if (!result.isEligible) return null;

    return {
      id: 'SENIORITY_AUTO',
      bonusType: "Prime d'ancienneté",
      amount: result.amount,
      isTaxable: result.isTaxable,
      isCnss: result.isCnss,
      fiscalType: 'TAXABLE_CNSS',
      source: result.source,
      isRecurring: true,
      description: result.ruleLabel,
      isProratized: false, // droit acquis — jamais proratisé
      isInLeaveBase: true,
      bonusCategory: 'POSTE',
      _seniorityYears: result.yearsCompleted,
      _seniorityRate: result.rateApplied,
    };
  }

  // ─── Formule linéaire — calcul du taux puis du résultat complet ──────────

  private computeLinearRate(years: number, cfg: SeniorityLinearConfig): number {
    if (years < cfg.startYear) return 0;
    let rate = cfg.startRate + (years - cfg.startYear) * cfg.ratePerYear;
    if (cfg.capPercent != null) rate = Math.min(rate, cfg.capPercent);
    return Math.round(rate * 100) / 100; // arrondi 2 décimales
  }

  private _computeLinear(
    years: number,
    months: number,
    baseSalary: number,
    cfg: SeniorityLinearConfig,
    isPersonalOverride: boolean,
  ): SeniorityResult {
    if (!cfg.enabled) {
      return {
        ...this._noEligible(years, months),
        ruleLabel: isPersonalOverride
          ? 'Ancienneté — exclue (configuration personnelle)'
          : 'Ancienneté linéaire désactivée',
      };
    }

    const rate = this.computeLinearRate(years, cfg);
    if (rate <= 0) {
      return {
        ...this._noEligible(years, months),
        ruleLabel: `Non éligible — seuil ${cfg.startYear} an${cfg.startYear > 1 ? 's' : ''} (${years} an${years > 1 ? 's' : ''} de présence)`,
      };
    }

    const amount = Math.round((rate / 100) * baseSalary);
    const label = isPersonalOverride
      ? `Ancienneté (config. personnelle) — ${rate}% (${years} ans)`
      : `Ancienneté — ${rate}% (${years} ans)`;

    this.logger.log(
      `[Ancienneté linéaire${isPersonalOverride ? ' — perso' : ''}] ${years} ans → ${rate}% → ` +
        `${amount.toLocaleString('fr-FR')} FCFA`,
    );

    return {
      yearsCompleted: years,
      monthsCompleted: months,
      rateApplied: rate,
      amount,
      ruleLabel: label,
      isEligible: true,
      source: 'AUTOMATIC',
      isTaxable: true,
      isCnss: true,
    };
  }

  // ─── Helper ──────────────────────────────────────────────────────────────

  private _noEligible(years: number, months: number): SeniorityResult {
    return {
      yearsCompleted: years,
      monthsCompleted: months,
      rateApplied: 0,
      amount: 0,
      ruleLabel: `Non éligible (${years} an${years > 1 ? 's' : ''} de présence)`,
      isEligible: false,
      source: 'AUTOMATIC',
      isTaxable: true,
      isCnss: true,
    };
  }
}
