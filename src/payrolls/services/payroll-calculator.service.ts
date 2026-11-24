// ============================================================================
// 📁 src/payrolls/services/payroll-calculator.service.ts
// ✅ Taxes custom (CAMU, TOL, etc.) intégrées
//    employeeAmount → déduit du net salarié
//    employerAmount → ajouté au coût patronal
// ✅ leaveOptions : indemnité de congé payé / déduction congé sans solde
// ============================================================================

import { Injectable, Logger, Optional } from '@nestjs/common';
import { LegalParametersService } from '../../legal-parameters/legal-parameters.service';
import {
  DEFAULT_LEGAL_PARAMS,
  LegalParams,
  autoFiscalMode,
} from '../../legal-parameters/legal-parameters.core';
import { IrppCalculatorService } from '../../payroll/fiscal/irpp-calculator.service';
import { LEGAL_WORK_HOURS_PER_MONTH } from '../constants/payroll.constants';
import { FISCAL_MODE } from '../../payroll/fiscal/tax-brackets.constant';
import { computeCustomTaxes } from '../../company-taxes/custom-tax.calculator';
import type { CalculatedPayroll } from '../constants/payroll.constants';
import type { LeaveCalculationOptions } from './payroll-generator.service';

// ✅ Taux et plafonds CNSS / TUS : plus codés en dur ici — ils viennent du
// référentiel légal (super administrateur), à la date du bulletin. Valeurs par
// défaut identiques aux anciennes constantes : CNSS salarié 4 % (plafond
// 1 200 000), patronal 8 % / 10,03 % / 2,25 % (plafond famille+AT 600 000),
// TUS 2,025 % État + 5,475 % CNSS.

// ─── BNC taux (Consultants / Prestataires — CGI Congo art. 47 ter) ───────────
const BNC_RATE_CONGOLAIS = 0.1; // 10% — personne physique résidente congolaise
const BNC_RATE_ETRANGER = 0.2; // 20% — personne physique non domiciliée

// ─── Contrats qui génèrent un bulletin classique ────────────────────────────
const SALARIED_CONTRACTS = ['CDI', 'CDD', 'STAGE'];
// INTERIM  → pas de bulletin (géré par agence)
// CONSULTANT / PRESTATAIRE → facture + BNC, pas de bulletin classique

// ─── TOL : règle CDI/CDD uniquement → voir company-taxes/custom-tax.calculator.ts

@Injectable()
export class PayrollCalculatorService {
  private readonly logger = new Logger(PayrollCalculatorService.name);

  constructor(
    private irppCalculator: IrppCalculatorService,
    @Optional() private legalParameters?: LegalParametersService,
  ) {}

  /** Règles légales applicables au mois du bulletin (défauts si indisponible). */
  private resolveLegalParams(employee?: any): LegalParams {
    if (!this.legalParameters) return DEFAULT_LEGAL_PARAMS;
    const now = new Date();
    const year = employee?._payrollYear ?? now.getFullYear();
    const month =
      employee?._payrollMonth ?? (year === now.getFullYear() ? now.getMonth() + 1 : 1);
    return this.legalParameters.getAtPeriod(year, month);
  }

  calculate(
    baseSalary: number,
    overtime10Hours: number,
    overtime25Hours: number,
    overtime50Hours: number,
    overtime100Hours: number,
    calculatedBonuses: any[] = [],
    deductions: any[] = [],
    settings: any,
    daysToPay: number,
    expectedWorkDays: number,
    employee?: any,
    company?: any,
    companyTaxes: any[] = [], // ✅ taxes custom actives
    leaveOptions?: LeaveCalculationOptions, // 🆕 14e param optionnel
  ): CalculatedPayroll {
    this.logger.log(`\n${'═'.repeat(60)}`);
    this.logger.log(
      `💰 CALCUL — Base: ${baseSalary.toLocaleString('fr-FR')} FCFA`,
    );

    // 🆕 Référentiel légal à la date du bulletin (mêmes noms qu'avant, pour ne
    // pas toucher au reste du calcul).
    const legal = this.resolveLegalParams(employee);
    const CNSS_PENSION_CEILING = legal.cnss.pensionCeiling;
    const CNSS_SOCIAL_CEILING = legal.cnss.socialCeiling;
    const CNSS_SALARIAL_RATE = legal.cnss.salarialRate;
    const CNSS_EMPLOYER_PENSION_RATE = legal.cnss.employerPensionRate;
    const CNSS_EMPLOYER_FAMILY_RATE = legal.cnss.employerFamilyRate;
    const CNSS_EMPLOYER_ACCIDENT_RATE = legal.cnss.employerAccidentRate;
    const TUS_RATE_DGI = legal.tus.dgiRate;
    const TUS_RATE_CNSS = legal.tus.cnssRate;

    // 1. Absences
    // ✅ Arrondi au franc le plus proche (0,5 → supérieur), fait UNE seule fois
    // sur le salaire proratisé (base × jours payés ÷ jours théoriques).
    // Avant : la déduction était arrondie à l'inférieur (Math.floor), ce qui
    // faisait ressortir le salaire ajusté 1 F trop haut dès que la partie
    // décimale était < 0,5. La déduction = base − salaire ajusté (cohérent).
    const paidDays = Math.max(0, daysToPay);
    const absenceDays = Math.max(0, expectedWorkDays - paidDays);
    const adjustedBase =
      absenceDays > 0
        ? Math.round((baseSalary * paidDays) / expectedWorkDays + 1e-9)
        : baseSalary;
    const absenceDeduction = baseSalary - adjustedBase;

    // 2. Heures sup
    const hourlyRate = baseSalary / LEGAL_WORK_HOURS_PER_MONTH; // ✅ toujours sur salaire contractuel, pas l'ajusté
    const rate10 = Math.max(10, Number(settings.overtimeRate10 ?? 10)) / 100;
    const rate25 = Math.max(25, Number(settings.overtimeRate25 ?? 25)) / 100;
    const rate50 = Math.max(50, Number(settings.overtimeRate50 ?? 50)) / 100;
    const rate100 =
      Math.max(100, Number(settings.overtimeRate100 ?? 100)) / 100;
    const ot10Amount = Math.floor(overtime10Hours * hourlyRate * (1 + rate10));
    const ot25Amount = Math.floor(overtime25Hours * hourlyRate * (1 + rate25));
    const ot50Amount = Math.floor(overtime50Hours * hourlyRate * (1 + rate50));
    const ot100Amount = Math.floor(
      overtime100Hours * hourlyRate * (1 + rate100),
    );
    const totalOvertimeAmount =
      ot10Amount + ot25Amount + ot50Amount + ot100Amount;

    // 3. Primes — 3 catégories fiscales
    // Priorité : fiscalType explicite → fallback isTaxable/isCnss (rétrocompat.)
    const getTaxType = (b: any): string => {
      if (b.fiscalType === 'NON_TAXABLE') return 'NON_TAXABLE';
      if (b.fiscalType === 'TAXABLE_NO_CNSS') return 'TAXABLE_NO_CNSS';
      if (b.fiscalType === 'TAXABLE_CNSS') return 'TAXABLE_CNSS';
      if (b.isTaxable === false) return 'NON_TAXABLE';
      if (b.isCnss === false) return 'TAXABLE_NO_CNSS';
      return 'TAXABLE_CNSS';
    };
    const sumBonuses = (arr: any[]) =>
      arr.reduce((acc, b) => acc + (Number(b.amount) || 0), 0);

    // TAXABLE_CNSS     → entre dans brut ITS + brut CNSS (ancienneté, diplôme, responsabilité)
    const taxableAndCnssBonuses = sumBonuses(
      calculatedBonuses.filter((b) => getTaxType(b) === 'TAXABLE_CNSS'),
    );
    // TAXABLE_NO_CNSS  → entre dans brut ITS, pas CNSS (13e mois, rendement, risque)
    const taxableNotCnssBonuses = sumBonuses(
      calculatedBonuses.filter((b) => getTaxType(b) === 'TAXABLE_NO_CNSS'),
    );
    // NON_TAXABLE      → ni ITS ni CNSS (indemnités : transport, panier, logement)
    const nonTaxableBonuses = sumBonuses(
      calculatedBonuses.filter((b) => getTaxType(b) === 'NON_TAXABLE'),
    );
    const totalBonuses =
      taxableAndCnssBonuses + taxableNotCnssBonuses + nonTaxableBonuses;

    // 🆕 4. Indemnité / déduction congé
    // - Congé payé    → leaveIndemnity s'ajoute au brut (remplace le salaire absent)
    // - Congé non payé → absenceDeduction déjà calculée au step 1, rien à ajouter
    const leaveIndemnity = leaveOptions?.leaveIndemnity ?? 0;
    const isPaidLeave = leaveOptions?.isPaidLeave ?? false;
    const leaveBonus = isPaidLeave ? leaveIndemnity : 0; // ajout brut si congé payé

    if (leaveIndemnity > 0) {
      this.logger.log(
        `🏖️ Congé ${isPaidLeave ? 'payé' : 'non payé'} — indemnité: ${leaveIndemnity.toLocaleString('fr-FR')} F | ajout brut: ${leaveBonus.toLocaleString('fr-FR')} F`,
      );
    }

    // 5. Bruts (avec indemnité congé payé si applicable)
    const grossSalary =
      adjustedBase +
      totalOvertimeAmount +
      taxableAndCnssBonuses +
      taxableNotCnssBonuses +
      leaveBonus;
    const grossSalaryCnss =
      adjustedBase + totalOvertimeAmount + taxableAndCnssBonuses + leaveBonus;

    // ── Détermination du régime selon le type de contrat ─────────────────────
    const contractType = (employee?.contractType as string) ?? 'CDI';
    const isStagiaire = contractType === 'STAGE';
    const isBncWorker =
      contractType === 'CONSULTANT' || contractType === 'PRESTATAIRE';
    const isInterim = contractType === 'INTERIM';
    // Salariés classiques : CDI, CDD, STAGE
    const isSalaried = SALARIED_CONTRACTS.includes(contractType);

    this.logger.log(
      `📋 Contrat: ${contractType} | Salarié: ${isSalaried} | BNC: ${isBncWorker} | Intérim: ${isInterim}`,
    );

    // 6. CNSS salariale
    //    CDI/CDD → 4% (plafond pension 1 200 000)
    //    STAGE   → 0% (le stagiaire ne cotise pas — seul l'employeur cotise AT)
    //    CONSULTANT/PRESTATAIRE/INTERIM → 0%
    let cnssSalarial = 0;
    // CNSS non arrondie : utilisée uniquement pour le calcul de l'ITS (comme le
    // classeur Excel / le cours Gnanga : aucun arrondi avant l'arrondi final).
    let cnssSalarialExact = 0;
    if (isSalaried && !isStagiaire && employee?.isSubjectToCnss !== false) {
      const base = Math.min(Math.max(0, grossSalaryCnss), CNSS_PENSION_CEILING);
      cnssSalarialExact = base * CNSS_SALARIAL_RATE;
      cnssSalarial = Math.round(cnssSalarialExact); // montant retenu / affiché
    }

    // 7. CNSS patronale — 3 branches
    //    CDI/CDD → Pension 8% + Famille 10,03% + AT 2,25% = 20,28%
    //    STAGE   → AT 2,25% UNIQUEMENT (source: cnss.cg — obligation employeur stagiaires)
    //    CONSULTANT/PRESTATAIRE/INTERIM → 0%
    let cnssEmployerPension = 0,
      cnssEmployerFamily = 0,
      cnssEmployerAccident = 0,
      cnssEmployer = 0;
    if (isSalaried && company?.appliesCnssEmployer !== false) {
      const cnssBase = Math.max(0, grossSalaryCnss);
      const pensionBase = Math.min(cnssBase, CNSS_PENSION_CEILING);
      const socialBase = Math.min(cnssBase, CNSS_SOCIAL_CEILING);

      if (isStagiaire) {
        // STAGE : uniquement Accidents du Travail — source officielle cnss.cg
        // "les employeurs utilisant des stagiaires doivent cotiser à leur couverture
        //  en matière d'accident du travail soit 2,25% du montant de la rémunération"
        cnssEmployerAccident = Math.round(
          socialBase * CNSS_EMPLOYER_ACCIDENT_RATE,
        );
        cnssEmployer = cnssEmployerAccident;
        this.logger.log(
          `🎓 STAGE → CNSS AT uniquement: ${cnssEmployerAccident.toLocaleString('fr-FR')} F (2,25%)`,
        );
      } else {
        // CDI / CDD : 3 branches complètes
        cnssEmployerPension = Math.round(
          pensionBase * CNSS_EMPLOYER_PENSION_RATE,
        );
        cnssEmployerFamily = Math.round(socialBase * CNSS_EMPLOYER_FAMILY_RATE);
        cnssEmployerAccident = Math.round(
          socialBase * CNSS_EMPLOYER_ACCIDENT_RATE,
        );
        cnssEmployer =
          cnssEmployerPension + cnssEmployerFamily + cnssEmployerAccident;
      }
    }

    // 8. TUS — 100% patronal
    //    CDI/CDD → 7,5% (5,475% CNSS + 2,025% DGI)
    //    STAGE / CONSULTANT / PRESTATAIRE / INTERIM → 0%
    let tusDgiAmount = 0,
      tusCnssAmount = 0,
      tusTotal = 0;
    if (
      isSalaried &&
      !isStagiaire &&
      company?.isSubjectToTus !== false &&
      employee?.isSubjectToTus !== false
    ) {
      tusDgiAmount = Math.round(grossSalary * TUS_RATE_DGI);
      tusCnssAmount = Math.round(grossSalary * TUS_RATE_CNSS);
      tusTotal = tusDgiAmount + tusCnssAmount;
    }

    // 9. ITS / IRPP
    //    CDI/CDD → barème progressif ou forfait
    //    STAGE   → jamais d'ITS (le stagiaire ne cotise pas à l'ITS)
    //    CONSULTANT/PRESTATAIRE → BNC retenu à la source (pas d'ITS salarié)
    //    INTERIM → géré par l'agence
    let its = 0,
      irppResult: any = null;
    const canApplyIts =
      isSalaried &&
      !isStagiaire &&
      !isBncWorker &&
      !isInterim &&
      employee?.isSubjectToIrpp !== false;

    if (canApplyIts) {
      const forcedMode = settings?.fiscalMode as string | undefined;
      const payrollYear = employee?._payrollYear ?? new Date().getFullYear();
      let fiscalMode: string;
      if (forcedMode === 'FORFAIT') {
        fiscalMode = 'FORFAIT';
      } else if (forcedMode === 'IRPP_LEGACY') {
        fiscalMode = FISCAL_MODE.IRPP_LEGACY;
      } else if (forcedMode === 'ITS_2026') {
        fiscalMode = FISCAL_MODE.ITS_2026;
      } else {
        // Mode AUTO : année de bascule ITS lue dans le référentiel légal.
        fiscalMode =
          autoFiscalMode(legal, payrollYear) === 'IRPP_LEGACY'
            ? FISCAL_MODE.IRPP_LEGACY
            : FISCAL_MODE.ITS_2026;
      }

      if (fiscalMode === 'FORFAIT') {
        const forfaitRate = Number(settings?.forfaitItsRate ?? 0.08);
        its = Math.ceil(grossSalary * forfaitRate);
        irppResult = {
          mode: 'FORFAIT',
          fiscalMode: 'FORFAIT',
          forfaitRate,
          baseImposable: grossSalary,
          abattement: 0,
          revenuNetImposable: grossSalary,
          fiscalParts: 1,
          irppTotal: its,
          effectiveRate: Number((forfaitRate * 100).toFixed(2)),
        };
      } else {
        irppResult = this.irppCalculator.calculateIRPP(
          grossSalary,
          cnssSalarialExact,
          employee?.maritalStatus ?? 'SINGLE',
          employee?.numberOfChildren ?? 0,
          fiscalMode as any,
          { year: payrollYear, month: employee?._payrollMonth },
        );
        its = irppResult.irppTotal;
      }
    }

    // 9bis. BNC — Retenue à la source (Consultant / Prestataire uniquement)
    //   L'entreprise retient le BNC et le reverse à la DGI avant le 15 du mois suivant
    //   Base = montant HT (= grossSalary pour ces profils)
    //   10% pour personne physique résidente congolaise (CGI art. 47 ter)
    //   20% pour personne physique étrangère non domiciliée (CGI art. 44)
    let bncAmount = 0;
    let bncTaux = 0;
    let bncLabel = '';
    if (isBncWorker) {
      // isResident = true → congolais/résident → 10%
      // isResident = false → étranger non domicilié → 20%
      const isResident =
        employee?.isResident !== false && employee?.isResident !== 'false';
      bncTaux = isResident ? BNC_RATE_CONGOLAIS : BNC_RATE_ETRANGER;
      bncAmount = Math.round(grossSalary * bncTaux);
      bncLabel = `BNC ${bncTaux * 100}% retenu à la source`;
      // Le BNC remplace l'ITS pour ces profils (déjà à 0 grâce à canApplyIts)
      its = bncAmount;
      this.logger.log(
        `📋 BNC: ${bncTaux * 100}% × ${grossSalary.toLocaleString('fr-FR')} = ${bncAmount.toLocaleString('fr-FR')} FCFA (isResident=${isResident})`,
      );
    }

    // ── 10. TAXES CUSTOM (CAMU, TOL, taxe apprentissage, etc.) ──────────────
    //   Taxes custom : applicables selon `applicableContractTypes` de chaque taxe
    //   (défaut CDI + CDD ; modifiable par l'entreprise pour STAGE, CONSULTANT, etc.)
    // Calcul centralisé (même moteur que l'estimation de salaire et la génération
    // de contrat) : taxes configurées selon types de contrat / seuils / bases + TOL.
    const customTaxResult = computeCustomTaxes(
      companyTaxes,
      {
        contractType,
        grossSalary,
        cnssSalarial,
        revenuNetImposable: irppResult?.revenuNetImposable,
        isSubjectToIrpp: employee?.isSubjectToIrpp,
        isSubjectToCnss: employee?.isSubjectToCnss, // exonéré CNSS → pas de TOL
        tolZone: employee?.tolZone,
      },
      (msg) => this.logger.log(msg),
    );
    const employeeCustomTaxTotal = customTaxResult.employeeTotal;
    const employerCustomTaxTotal = customTaxResult.employerTotal;
    const customTaxDetails = customTaxResult.details;

    // 11. Déductions prêts/avances
    const totalOtherDeductions = deductions.reduce(
      (acc, curr) => acc + (Number(curr.amount) || 0),
      0,
    );

    // 12. Totaux finaux
    const totalDeductions =
      cnssSalarial + its + employeeCustomTaxTotal + totalOtherDeductions;
    const netSalary = Math.floor(
      grossSalary - totalDeductions + nonTaxableBonuses,
    );
    const totalEmployerCost =
      grossSalary + nonTaxableBonuses + cnssEmployer + tusTotal + employerCustomTaxTotal;

    this.logger.log(
      `📊 NET = ${netSalary.toLocaleString()} FCFA | COÛT EMP = ${totalEmployerCost.toLocaleString()} FCFA`,
    );

    return {
      grossSalary,
      netSalary,
      cnssSalarial,
      its,
      totalDeductions,
      cnssEmployer,
      totalEmployerCost,
      totalBonuses,
      totalOvertimeAmount,
      absenceDeduction,
      adjustedBaseSalary: adjustedBase,
      overtimeAmount10: ot10Amount,
      overtimeAmount25: ot25Amount,
      overtimeAmount50: ot50Amount,
      overtimeAmount100: ot100Amount,
      cnssEmployerPension,
      cnssEmployerFamily,
      cnssEmployerAccident,
      tusDgiAmount,
      tusCnssAmount,
      tusTotal,
      // ✅ Type de contrat et régime
      contractType,
      isSalaried,
      isStagiaire,
      isBncWorker,
      isInterim,
      bncAmount,
      bncTaux,
      bncLabel,
      // ✅ Taxes custom
      employeeCustomTaxTotal,
      employerCustomTaxTotal,
      customTaxDetails,
      irppDetails: {
        ...(irppResult ?? {}),
        cnssEmployerDetail: {
          pension: cnssEmployerPension,
          famille: cnssEmployerFamily,
          accident: cnssEmployerAccident,
          total: cnssEmployer,
        },
        tusDetail: { dgi: tusDgiAmount, cnss: tusCnssAmount, total: tusTotal },
        // Taux légaux réellement appliqués à ce bulletin (référentiel à sa date) :
        // le détail du bulletin affiche ces taux, pas des constantes.
        legalRates: {
          cnssSalarial: CNSS_SALARIAL_RATE,
          employerPension: CNSS_EMPLOYER_PENSION_RATE,
          employerFamily: CNSS_EMPLOYER_FAMILY_RATE,
          employerAccident: CNSS_EMPLOYER_ACCIDENT_RATE,
          tusDgi: TUS_RATE_DGI,
          tusCnss: TUS_RATE_CNSS,
        },
        bonusDetail: {
          taxableAndCnss: taxableAndCnssBonuses,
          taxableNoCnss: taxableNotCnssBonuses,
          nonTaxable: nonTaxableBonuses,
        },
        customTaxes: customTaxDetails,
      },
    };
  }
}
