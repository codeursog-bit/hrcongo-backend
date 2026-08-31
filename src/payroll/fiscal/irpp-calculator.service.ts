// ============================================================================
// 📁 src/payroll/fiscal/irpp-calculator.service.ts
// 🇨🇬 CALCUL ITS/IRPP CONGO — CONFORME ORDONNANCE 2025-44
// ============================================================================
//
// CORRECTIONS 2026 (source : PaySpace Congo Annual Amendments, 13 fév. 2026) :
//   ✅ ITS 2026 : parts fiscales MAINTENUES (pas supprimées comme annoncé)
//   ✅ ITS 2026 : nouveau barème (615k/1.5M/3.5M/5M — taux 1200F/10/15/20/30%)
//   ✅ IRPP Legacy : ancien barème (464k/1M/3M — taux 1/10/25/40%)
//   ✅ Abattement 20% identique pour les deux modes
//   ✅ Annualisation × 12 avant application du barème
//   ✅ Math.ceil sur ITS/IRPP mensuel (arrondi supérieur conforme)
//
// FORMULE COMMUNE ITS 2026 et IRPP LEGACY :
//   1. CNSS     = min(brut, 1 200 000) × 4%
//   2. SBT      = brut − CNSS
//   3. BI       = SBT × 80%  (abattement 20%)
//   4. QF       = BI × 12 / parts fiscales
//   5. ITS/part = barème(QF)  [selon le mode]
//   6. ITS      = ITS/part × parts / 12  → arrondi supérieur
//
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { FiscalPartsService, MaritalStatus } from './fiscal-parts.service';
import {
  IRPP_BRACKETS_CONGO,
  ITS_BRACKETS_CONGO_2026,
  TaxBracket,
  FISCAL_MODE,
  FiscalMode,
} from './tax-brackets.constant';

// ── Constante abattement ────────────────────────────────────────────────────
// ✅ 20% TOUJOURS — confirmé par Gnanga HEG-Brazza et bulletins réels Congo
const ABATTEMENT_RATE = 0.2;

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface IRPPCalculationResult {
  baseImposable: number;
  abattement: number;
  revenuNetImposable: number; // mensuel
  rniAnnuel: number; // RNI annualisé (pour audit)

  fiscalParts: number; // toujours 1 en mode ITS_2026
  revenuParPart: number; // rniAnnuel / fiscalParts

  irppBeforeMultiplier: number; // impôt annuel sur 1 part
  irppTotal: number; // ITS mensuel final
  effectiveRate: number; // taux effectif sur baseImposable

  fiscalMode: FiscalMode;

  details: Array<{
    tranche: string;
    base: number;
    taux: number;
    montant: number;
  }>;
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class IrppCalculatorService {
  private readonly logger = new Logger(IrppCalculatorService.name);

  constructor(private fiscalPartsService: FiscalPartsService) {}

  /**
   * Calcule l'ITS mensuel (ex-IRPP) conforme fiscalité Congo.
   *
   * @param grossSalary      Salaire brut mensuel (base ITS — sans primes non imposables)
   * @param cnssSalarial     CNSS salariale déjà calculée (4%, plafond 1 200 000)
   * @param maritalStatus    Statut marital (ignoré en mode ITS_2026)
   * @param numberOfChildren Nb d'enfants (ignoré en mode ITS_2026)
   * @param fiscalMode       'ITS_2026' (défaut) | 'IRPP_LEGACY' (avant 2026 avec parts)
   */
  calculateIRPP(
    grossSalary: number,
    cnssSalarial: number,
    maritalStatus: MaritalStatus = MaritalStatus.SINGLE,
    numberOfChildren: number = 0,
    fiscalMode: FiscalMode = FISCAL_MODE.ITS_2026,
  ): IRPPCalculationResult {
    this.validateInputs(grossSalary, cnssSalarial, numberOfChildren);

    // ── 1. Base imposable = Brut − CNSS salariale ───────────────────────────
    const baseImposable = grossSalary - cnssSalarial;

    // ── 2. Abattement 20% — IDENTIQUE pour ITS_2026 et IRPP_LEGACY ─────────
    //
    // ✅ Source officielle Congo (Gnanga HEG-Brazza / CGI Art. 41) :
    //    "L'abattement fiscal est fixé à 20% et appliqué sur le salaire brut taxable"
    //    Pas de plafond en FCFA — c'est un pourcentage pur.
    //
    // L'ancien code utilisait 30% plafonné 75k pour IRPP_LEGACY — C'ÉTAIT FAUX.
    //
    const abattement = Math.round(baseImposable * ABATTEMENT_RATE);
    const revenuNetImposable = baseImposable - abattement; // mensuel

    // ── 3. Annualisation ────────────────────────────────────────────────────
    // Les tranches du barème (464k / 1M / 3M) sont ANNUELLES (source Gnanga)
    const rniAnnuel = revenuNetImposable * 12;

    // ── 4. Parts fiscales ───────────────────────────────────────────────────
    // ✅ ITS 2026 : parts fiscales MAINTENUES (source : PaySpace Congo Annual Amendments 2026)
    //    "Family quotient system applies, based on marital status and dependants."
    //    "Family shares range from 1 part to a maximum of 6.5 parts"
    // ✅ IRPP_LEGACY : idem — parts calculées selon situation familiale
    // ⚠️  NE PAS forcer à 1 : les parts sont actives en ITS_2026 comme en IRPP_LEGACY
    const fiscalParts = this.fiscalPartsService.calculateFiscalParts(
      maritalStatus,
      numberOfChildren,
    );

    const revenuParPart = rniAnnuel / fiscalParts;

    // ── 5. Barème progressif sur revenu annuel par part ─────────────────────
    // ITS_2026    → nouveau barème officiel (615k/1.5M/3.5M/5M)
    // IRPP_LEGACY → ancien barème (464k/1M/3M)
    const brackets =
      fiscalMode === FISCAL_MODE.IRPP_LEGACY
        ? IRPP_BRACKETS_CONGO
        : ITS_BRACKETS_CONGO_2026;

    const { irppBeforeMultiplier, details } = this.calculateProgressiveTax(
      revenuParPart,
      brackets,
    );

    // ── 6. Remultiplier × parts → impôt annuel ──────────────────────────────
    const irppAnnuel = irppBeforeMultiplier * fiscalParts;

    // ── 7. Mensualiser avec arrondi supérieur ───────────────────────────────
    const irppTotal = Math.ceil(irppAnnuel / 12);

    // ── 8. Taux effectif sur baseImposable ──────────────────────────────────
    const effectiveRate =
      baseImposable > 0
        ? parseFloat(((irppTotal / baseImposable) * 100).toFixed(2))
        : 0;

    this.logCalculation({
      grossSalary,
      cnssSalarial,
      baseImposable,
      abattement,
      revenuNetImposable,
      rniAnnuel,
      fiscalParts,
      irppTotal,
      effectiveRate,
      fiscalMode,
    });

    return {
      baseImposable,
      abattement,
      revenuNetImposable,
      rniAnnuel,
      fiscalParts,
      revenuParPart: Math.floor(revenuParPart),
      irppBeforeMultiplier: Math.round(irppBeforeMultiplier),
      irppTotal,
      effectiveRate,
      fiscalMode,
      details,
    };
  }

  // ── Barème progressif ────────────────────────────────────────────────────

  private calculateProgressiveTax(
    revenuParPart: number,
    brackets: TaxBracket[],
  ): {
    irppBeforeMultiplier: number;
    details: Array<{
      tranche: string;
      base: number;
      taux: number;
      montant: number;
    }>;
  } {
    let irppBeforeMultiplier = 0;
    const details: Array<{
      tranche: string;
      base: number;
      taux: number;
      montant: number;
    }> = [];

    for (const bracket of brackets) {
      if (revenuParPart <= bracket.min) break;

      // Tranche 1 ITS 2026 : montant fixe de 1 200 FCFA si revenu > 0
      if (bracket.fixed > 0) {
        irppBeforeMultiplier += bracket.fixed;
        details.push({
          tranche: this.formatBracket(bracket),
          base: Math.round(Math.min(revenuParPart, bracket.max)),
          taux: 0,
          montant: bracket.fixed,
        });
        continue;
      }

      const taxableInBracket =
        Math.min(revenuParPart, bracket.max) - bracket.min;
      if (taxableInBracket <= 0) continue;

      const impotTranche = Math.round(taxableInBracket * bracket.rate);
      irppBeforeMultiplier += impotTranche;

      details.push({
        tranche: this.formatBracket(bracket),
        base: Math.round(taxableInBracket),
        taux: bracket.rate * 100,
        montant: impotTranche,
      });
    }

    return { irppBeforeMultiplier, details };
  }

  // ── Validation ───────────────────────────────────────────────────────────

  private validateInputs(
    grossSalary: number,
    cnssSalarial: number,
    numberOfChildren: number,
  ): void {
    if (grossSalary < 0)
      throw new Error('Salaire brut ne peut pas être négatif');
    if (cnssSalarial < 0)
      throw new Error('CNSS salariale ne peut pas être négative');
    if (cnssSalarial > grossSalary)
      throw new Error('CNSS salariale ne peut pas dépasser le salaire brut');
    this.fiscalPartsService.validateNumberOfChildren(numberOfChildren);
  }

  private formatBracket(bracket: TaxBracket): string {
    const maxStr =
      bracket.max === Infinity ? '∞' : bracket.max.toLocaleString('fr-FR');
    return `${bracket.min.toLocaleString('fr-FR')} – ${maxStr} FCFA`;
  }

  // ── Logs ─────────────────────────────────────────────────────────────────

  private logCalculation(data: any): void {
    const modeLabel =
      data.fiscalMode === FISCAL_MODE.IRPP_LEGACY
        ? 'IRPP LEGACY (abattement 20%, avec parts)'
        : 'ITS 2026    (abattement 20%, avec parts fiscales)';

    this.logger.log(`💸 CALCUL ITS [${modeLabel}]`);
    this.logger.log(
      `   Salaire brut       : ${data.grossSalary.toLocaleString('fr-FR')} FCFA`,
    );
    this.logger.log(
      `   − CNSS salariale   : ${data.cnssSalarial.toLocaleString('fr-FR')} FCFA`,
    );
    this.logger.log(
      `   = Base imposable   : ${data.baseImposable.toLocaleString('fr-FR')} FCFA`,
    );
    this.logger.log(
      `   − Abattement 20%   : ${data.abattement.toLocaleString('fr-FR')} FCFA`,
    );
    this.logger.log(
      `   = RNI mensuel      : ${data.revenuNetImposable.toLocaleString('fr-FR')} FCFA`,
    );
    this.logger.log(
      `   × 12 = RNI annuel  : ${data.rniAnnuel.toLocaleString('fr-FR')} FCFA`,
    );
    this.logger.log(`   Parts fiscales     : ${data.fiscalParts}`);
    this.logger.log(
      `   ✅ ITS mensuel     : ${data.irppTotal.toLocaleString('fr-FR')} FCFA`,
    );
    this.logger.log(
      `   Taux effectif      : ${data.effectiveRate}% (sur base imposable)`,
    );
  }
}
