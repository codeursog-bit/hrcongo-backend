// ============================================================================
// 📁 src/payrolls/services/payroll-calculator.service.ts
// ✅ Taxes custom (CAMU, TOL, etc.) intégrées
//    employeeAmount → déduit du net salarié
//    employerAmount → ajouté au coût patronal
// ✅ leaveOptions : indemnité de congé payé / déduction congé sans solde
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { IrppCalculatorService } from '../../payroll/fiscal/irpp-calculator.service';
import { LEGAL_WORK_HOURS_PER_MONTH } from '../constants/payroll.constants';
import { FISCAL_MODE } from '../../payroll/fiscal/tax-brackets.constant';
import type { CalculatedPayroll } from '../constants/payroll.constants';
import type { LeaveCalculationOptions } from './payroll-generator.service';

const CNSS_PENSION_CEILING = 1_200_000;
const CNSS_SALARIAL_RATE = 0.04;
const CNSS_SOCIAL_CEILING = 600_000;
const CNSS_EMPLOYER_PENSION_RATE = 0.08;
const CNSS_EMPLOYER_FAMILY_RATE = 0.1003;
const CNSS_EMPLOYER_ACCIDENT_RATE = 0.0225;
const TUS_RATE_DGI = 0.02025; // 2,025% → État (révisé 2026 : 27% × 7,5%)
const TUS_RATE_CNSS = 0.05475; // 5,475% → CNSS (révisé 2026 : 73% × 7,5%)

// ─── BNC taux (Consultants / Prestataires — CGI Congo art. 47 ter) ───────────
const BNC_RATE_CONGOLAIS = 0.1; // 10% — personne physique résidente congolaise
const BNC_RATE_ETRANGER = 0.2; // 20% — personne physique non domiciliée

// ─── Contrats qui génèrent un bulletin classique ────────────────────────────
const SALARIED_CONTRACTS = ['CDI', 'CDD', 'STAGE'];
// INTERIM  → pas de bulletin (géré par agence)
// CONSULTANT / PRESTATAIRE → facture + BNC, pas de bulletin classique

// ─── TOL : uniquement CDI/CDD ────────────────────────────────────────────────
// Consultant, Prestataire, Stagiaire, Intérim → jamais de TOL, même si "salarié"
const TOL_CONTRACTS = ['CDI', 'CDD'];

@Injectable()
export class PayrollCalculatorService {
  private readonly logger = new Logger(PayrollCalculatorService.name);

  constructor(private irppCalculator: IrppCalculatorService) {}

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

    // 1. Absences
    const absenceDays = Math.max(0, expectedWorkDays - daysToPay);
    const dailyRate = baseSalary / expectedWorkDays;
    const absenceDeduction = Math.floor(absenceDays * dailyRate);
    const adjustedBase = baseSalary - absenceDeduction;

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
    if (isSalaried && !isStagiaire && employee?.isSubjectToCnss !== false) {
      const base = Math.min(Math.max(0, grossSalaryCnss), CNSS_PENSION_CEILING);
      cnssSalarial = Math.round(base * CNSS_SALARIAL_RATE);
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
    //    STAGE   → seulement si gratification > SMIG (50 400 FCFA/mois)
    //    CONSULTANT/PRESTATAIRE → BNC retenu à la source (pas d'ITS salarié)
    //    INTERIM → géré par l'agence
    let its = 0,
      irppResult: any = null;
    const smigCongo = 50_400; // SMIG Congo Brazzaville
    const canApplyIts =
      isSalaried &&
      !isBncWorker &&
      !isInterim &&
      employee?.isSubjectToIrpp !== false &&
      (!isStagiaire || grossSalary > smigCongo); // STAGE : ITS seulement si > SMIG

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
        fiscalMode =
          payrollYear < 2026 ? FISCAL_MODE.IRPP_LEGACY : FISCAL_MODE.ITS_2026;
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
          cnssSalarial,
          employee?.maritalStatus ?? 'SINGLE',
          employee?.numberOfChildren ?? 0,
          fiscalMode as any,
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
      bncLabel = `BNC ${bncTaux * 100}% retenu à la source (${isResident ? 'résident/congolais — CGI art. 47 ter' : 'non-résident/étranger — CGI art. 44'})`;
      // Le BNC remplace l'ITS pour ces profils (déjà à 0 grâce à canApplyIts)
      its = bncAmount;
      this.logger.log(
        `📋 BNC: ${bncTaux * 100}% × ${grossSalary.toLocaleString('fr-FR')} = ${bncAmount.toLocaleString('fr-FR')} FCFA (isResident=${isResident})`,
      );
    }

    // ── 10. TAXES CUSTOM (CAMU, TOL, taxe apprentissage, etc.) ──────────────
    //   Taxes custom : non applicables aux consultants/prestataires/intérim
    //   Pour les stagiaires : on applique les taxes si elles sont configurées
    let employeeCustomTaxTotal = 0;
    let employerCustomTaxTotal = 0;
    const customTaxDetails: Array<{
      id: string;
      name: string;
      code: string;
      employeeAmount: number;
      employerAmount: number;
      base: number;
    }> = [];

    for (const tax of companyTaxes) {
      // Taxes custom non applicables aux non-salariés (consultant/prestataire/intérim)
      if (!isSalaried) {
        this.logger.log(
          `⏭️ ${tax.code} ignorée — contrat ${contractType} non salarié`,
        );
        continue;
      }
      // ✅ TOL : réservée aux CDI/CDD — jamais pour stagiaire (même si "salarié"),
      //    consultant, prestataire ou intérim.
      if (tax.code === 'TOL' && !TOL_CONTRACTS.includes(contractType)) {
        this.logger.log(
          `⏭️ TOL ignorée — contrat ${contractType} non éligible (CDI/CDD uniquement)`,
        );
        continue;
      }
      // Seuil minimum de salaire
      if (
        tax.minSalaryThreshold &&
        grossSalary < Number(tax.minSalaryThreshold)
      ) {
        this.logger.log(
          `⏭️ ${tax.code} ignorée — brut ${grossSalary} < seuil ${tax.minSalaryThreshold}`,
        );
        continue;
      }

      // ── Respect des exonérations individuelles ──────────────────────────
      // Si la base de la taxe est TAXABLE (brut-CNSS) ou NET_IMPOSABLE,
      // elle dépend de l'ITS → si l'employé est exonéré ITS, on ignore ces taxes.
      // Exception : TOL et taxes FIXED sont toujours applicables aux salariés.
      const isExemptIts = employee?.isSubjectToIrpp === false;
      const isExemptCnss = employee?.isSubjectToCnss === false;

      if (tax.baseType === 'TAXABLE' && isExemptCnss) {
        // Base = brut - CNSS, mais si pas de CNSS → base = brut (on calcule quand même)
        // Laisser passer, la base sera simplement grossSalary
      }
      if (tax.baseType === 'NET_IMPOSABLE' && isExemptIts) {
        // Cette taxe est calculée sur le revenu net imposable (après ITS)
        // Si exonéré ITS → pas de revenu net imposable → on ignore la taxe
        this.logger.log(
          `⏭️ ${tax.code} ignorée — employé exonéré ITS (base NET_IMPOSABLE)`,
        );
        continue;
      }

      const taxableBase = grossSalary - cnssSalarial;
      const netImposable = irppResult?.revenuNetImposable ?? grossSalary;

      let base = 0;
      if (tax.baseType === 'GROSS') base = grossSalary;
      else if (tax.baseType === 'TAXABLE') base = taxableBase;
      else if (tax.baseType === 'NET_IMPOSABLE') base = netImposable;
      // FIXED → on utilise directement fixedEmployee / fixedEmployer

      // ── EXCESS_ONLY : taxe sur l'excédent au-dessus du seuil ──────────
      // ex: CAMU solidarité → (BI − 500 000) × 0,5%
      // ELIGIBILITY (défaut) = filtre binaire déjà appliqué ci-dessus
      if (tax.thresholdType === 'EXCESS_ONLY' && tax.minSalaryThreshold) {
        base = Math.max(0, base - Number(tax.minSalaryThreshold));
        this.logger.log(
          `📐 ${tax.code} EXCESS_ONLY : base excédent = ${base.toLocaleString('fr-FR')} F (seuil ${Number(tax.minSalaryThreshold).toLocaleString('fr-FR')} F)`,
        );
      }

      if (tax.hasCeiling && tax.ceiling)
        base = Math.min(base, Number(tax.ceiling));

      let employeeAmount = 0;
      let employerAmount = 0;

      if (tax.baseType === 'FIXED') {
        // ✅ TOL : montant selon la zone de l'employé (VILLE=5000, PERIPHERIE=1000)
        if (tax.code === 'TOL') {
          const zone = employee?.tolZone ?? 'VILLE';
          employeeAmount = zone === 'PERIPHERIE' ? 1000 : 5000;
          this.logger.log(`📍 TOL zone=${zone} → ${employeeAmount} F`);
        } else {
          employeeAmount = Number(tax.fixedEmployee ?? 0);
        }
        employerAmount = Number(tax.fixedEmployer ?? 0);
      } else {
        // ✅ Les taux sont stockés en décimal dans la BDD (ex: 0.0227 = 2,27%) — conforme au DTO @Max(1)
        employeeAmount =
          Math.round(base * Number(tax.employeeRate ?? 0)) +
          Number(tax.fixedEmployee ?? 0);
        employerAmount =
          Math.round(base * Number(tax.employerRate ?? 0)) +
          Number(tax.fixedEmployer ?? 0);
      }

      employeeCustomTaxTotal += employeeAmount;
      employerCustomTaxTotal += employerAmount;
      customTaxDetails.push({
        id: tax.id,
        name: tax.name,
        code: tax.code,
        employeeAmount,
        employerAmount,
        base,
      });

      this.logger.log(
        `💼 ${tax.code} : sal=${employeeAmount} F | pat=${employerAmount} F`,
      );
    }

    // ✅ TOL NATIVE — taxe fixe obligatoire indépendante des taxes configurables
    // Skip si TOL déjà dans companyTaxes pour éviter doublon
    // ✅ Réservée aux CDI/CDD uniquement — jamais pour stagiaire/consultant/prestataire/intérim
    const hasTolInCompanyTaxes = companyTaxes.some(
      (t: any) => t.code === 'TOL',
    );
    if (!hasTolInCompanyTaxes && TOL_CONTRACTS.includes(contractType)) {
      const tolZone = employee?.tolZone ?? 'VILLE';
      const tolAmount = tolZone === 'PERIPHERIE' ? 1000 : 5000;
      employeeCustomTaxTotal += tolAmount;
      customTaxDetails.push({
        id: 'TOL_NATIVE',
        name: "Taxe d'Occupation des Locaux (TOL)",
        code: 'TOL',
        employeeAmount: tolAmount,
        employerAmount: 0,
        base: tolAmount,
      });
      this.logger.log(`📍 TOL NATIVE zone=${tolZone} → ${tolAmount} F`);
    }

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
      grossSalary + cnssEmployer + tusTotal + employerCustomTaxTotal;

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

// // ============================================================================
// // 📁 src/payrolls/services/payroll-calculator.service.ts
// // 🇨🇬 MOTEUR DE CALCUL PAIE — CONGO-BRAZZAVILLE
// //
// // ✅ CNSS PATRONALE : 3 branches séparées — Décret n°99-284
// //    Pension    8,00% plafond 1 200 000 FCFA
// //    Famille   10,03% plafond   600 000 FCFA
// //    Accident   2,25% plafond   600 000 FCFA
// //
// // ✅ TUS : 4,13% DGI + 3,38% CNSS = 7,51% total (100% patronal, déplafonné)
// //    Validé sur bulletin réel PEN & PROCESS
// //
// // ✅ Tous les champs remontés au niveau RACINE du retour
// //    → Zéro calcul côté frontend
// // ============================================================================

// import { Injectable, Logger } from '@nestjs/common';
// import { IrppCalculatorService } from '../../payroll/fiscal/irpp-calculator.service';
// import { LEGAL_WORK_HOURS_PER_MONTH } from '../constants/payroll.constants';
// import { FISCAL_MODE } from '../../payroll/fiscal/tax-brackets.constant';
// import type { CalculatedPayroll } from '../constants/payroll.constants';

// // ── CNSS Salariale ──────────────────────────────────────────────────────────
// const CNSS_PENSION_CEILING = 1_200_000;  // plafond branche pension
// const CNSS_SALARIAL_RATE   = 0.04;       // 4% — retenue salarié

// // ── CNSS Patronale — 3 branches (Décret n°99-284) ──────────────────────────
// const CNSS_SOCIAL_CEILING          = 600_000;   // plafond famille + accidents
// const CNSS_EMPLOYER_PENSION_RATE   = 0.08;      // 8,00%  — pensions
// const CNSS_EMPLOYER_FAMILY_RATE    = 0.1003;    // 10,03% — prestations familiales
// const CNSS_EMPLOYER_ACCIDENT_RATE  = 0.0225;    // 2,25%  — accidents du travail

// // ── TUS — Taxe Unique sur les Salaires (100% patronal, déplafonné) ───────────
// // ✅ Validé sur bulletin réel PEN & PROCESS
// // Part DGI  : 4,13% sur brut total → versé à la DGI
// // Part CNSS : 3,38% sur brut total → versé à la CNSS
// // Total TUS : 7,51%
// const TUS_RATE_DGI  = 0.0413;  // 4,13% → DGI
// const TUS_RATE_CNSS = 0.0338;  // 3,38% → CNSS

// @Injectable()
// export class PayrollCalculatorService {
//   private readonly logger = new Logger(PayrollCalculatorService.name);

//   constructor(private irppCalculator: IrppCalculatorService) {}

//   calculate(
//     baseSalary:        number,
//     overtime10Hours:   number,
//     overtime25Hours:   number,
//     overtime50Hours:   number,
//     overtime100Hours:  number,
//     calculatedBonuses: any[]  = [],
//     deductions:        any[]  = [],
//     settings:          any,
//     daysToPay:         number,
//     expectedWorkDays:  number,
//     employee?:         any,
//     company?:          any,
//   ): CalculatedPayroll {

//     this.logger.log(`\n${'═'.repeat(60)}`);
//     this.logger.log(`💰 CALCUL — Base: ${baseSalary.toLocaleString('fr-FR')} FCFA`);

//     // ── 1. ABSENCES ─────────────────────────────────────────────────────────
//     const absenceDays      = Math.max(0, expectedWorkDays - daysToPay);
//     const dailyRate        = baseSalary / expectedWorkDays;
//     const absenceDeduction = Math.floor(absenceDays * dailyRate);
//     const adjustedBase     = baseSalary - absenceDeduction;

//     // ── 2. HEURES SUPPLÉMENTAIRES ────────────────────────────────────────────
//     const hourlyRate = baseSalary / LEGAL_WORK_HOURS_PER_MONTH; // ✅ toujours sur salaire contractuel, pas l'ajusté
//     const rate10  = Math.max(10,  Number(settings.overtimeRate10  ?? 10))  / 100;
//     const rate25  = Math.max(25,  Number(settings.overtimeRate25  ?? 25))  / 100;
//     const rate50  = Math.max(50,  Number(settings.overtimeRate50  ?? 50))  / 100;
//     const rate100 = Math.max(100, Number(settings.overtimeRate100 ?? 100)) / 100;

//     const ot10Amount  = Math.floor(overtime10Hours  * hourlyRate * (1 + rate10));
//     const ot25Amount  = Math.floor(overtime25Hours  * hourlyRate * (1 + rate25));
//     const ot50Amount  = Math.floor(overtime50Hours  * hourlyRate * (1 + rate50));
//     const ot100Amount = Math.floor(overtime100Hours * hourlyRate * (1 + rate100));
//     const totalOvertimeAmount = ot10Amount + ot25Amount + ot50Amount + ot100Amount;

//     // ── 3. PRIMES ────────────────────────────────────────────────────────────
//     const taxableAndCnssBonuses = calculatedBonuses
//       .filter(b => b.isTaxable !== false && b.isCnss !== false)
//       .reduce((acc, b) => acc + (Number(b.amount) || 0), 0);
//     const taxableNotCnssBonuses = calculatedBonuses
//       .filter(b => b.isTaxable !== false && b.isCnss === false)
//       .reduce((acc, b) => acc + (Number(b.amount) || 0), 0);
//     const nonTaxableBonuses = calculatedBonuses
//       .filter(b => b.isTaxable === false)
//       .reduce((acc, b) => acc + (Number(b.amount) || 0), 0);
//     const totalBonuses = taxableAndCnssBonuses + taxableNotCnssBonuses + nonTaxableBonuses;

//     // ── 4. BRUTS ─────────────────────────────────────────────────────────────
//     const grossSalary     = adjustedBase + totalOvertimeAmount + taxableAndCnssBonuses + taxableNotCnssBonuses;
//     const grossSalaryCnss = adjustedBase + totalOvertimeAmount + taxableAndCnssBonuses;

//     // ── 5. CNSS SALARIALE ────────────────────────────────────────────────────
//     let cnssSalarial = 0;
//     if (employee?.isSubjectToCnss !== false) {
//       const base = Math.min(Math.max(0, grossSalaryCnss), CNSS_PENSION_CEILING);
//       cnssSalarial = Math.round(base * CNSS_SALARIAL_RATE);
//     }

//     // ── 6. CNSS PATRONALE — 3 BRANCHES ──────────────────────────────────────
//     let cnssEmployerPension  = 0;
//     let cnssEmployerFamily   = 0;
//     let cnssEmployerAccident = 0;
//     let cnssEmployer         = 0;

//     if (company?.appliesCnssEmployer !== false) {
//       const cnssBase    = Math.max(0, grossSalaryCnss);
//       const pensionBase = Math.min(cnssBase, CNSS_PENSION_CEILING);
//       const socialBase  = Math.min(cnssBase, CNSS_SOCIAL_CEILING);

//       cnssEmployerPension  = Math.round(pensionBase * CNSS_EMPLOYER_PENSION_RATE);
//       cnssEmployerFamily   = Math.round(socialBase  * CNSS_EMPLOYER_FAMILY_RATE);
//       cnssEmployerAccident = Math.round(socialBase  * CNSS_EMPLOYER_ACCIDENT_RATE);
//       cnssEmployer         = cnssEmployerPension + cnssEmployerFamily + cnssEmployerAccident;

//       this.logger.log(`🏥 CNSS Patronale :`);
//       this.logger.log(`   Pension  (8,00%  × min(${grossSalaryCnss.toLocaleString()}, 1 200 000)) = ${cnssEmployerPension.toLocaleString()} FCFA`);
//       this.logger.log(`   Famille  (10,03% × min(${grossSalaryCnss.toLocaleString()},   600 000)) = ${cnssEmployerFamily.toLocaleString()} FCFA`);
//       this.logger.log(`   Accident (2,25%  × min(${grossSalaryCnss.toLocaleString()},   600 000)) = ${cnssEmployerAccident.toLocaleString()} FCFA`);
//       this.logger.log(`   TOTAL = ${cnssEmployer.toLocaleString()} FCFA`);
//     }

//     // ── 7. TUS — 100% patronal, déplafonné ──────────────────────────────────
//     // ✅ Validé bulletin PEN & PROCESS : 4,13% DGI + 3,38% CNSS = 7,51%
//     // Toggle : employee.isSubjectToTus (override individuel)
//     // ou company.isSubjectToTus (désactiver pour toute l'entreprise)
//     let tusDgiAmount  = 0;
//     let tusCnssAmount = 0;
//     let tusTotal      = 0;

//     const tusEnabled =
//       company?.isSubjectToTus !== false &&
//       employee?.isSubjectToTus !== false;

//     if (tusEnabled) {
//       tusDgiAmount  = Math.round(grossSalary * TUS_RATE_DGI);   // 4,13%
//       tusCnssAmount = Math.round(grossSalary * TUS_RATE_CNSS);  // 3,38%
//       tusTotal      = tusDgiAmount + tusCnssAmount;             // 7,51%

//       this.logger.log(
//         `🏭 TUS : DGI ${tusDgiAmount.toLocaleString()} + CNSS ${tusCnssAmount.toLocaleString()} = ${tusTotal.toLocaleString()} FCFA`
//       );
//     }

//     // ── 8. ITS / IRPP ────────────────────────────────────────────────────────
//     let its        = 0;
//     let irppResult: any = null;

//     if (employee?.isSubjectToIrpp !== false) {
//       const forcedMode  = settings?.fiscalMode as string | undefined;
//       const payrollYear = employee?._payrollYear ?? new Date().getFullYear();

//       let fiscalMode: string;
//       if (forcedMode === 'FORFAIT')          { fiscalMode = 'FORFAIT'; }
//       else if (forcedMode === 'IRPP_LEGACY') { fiscalMode = FISCAL_MODE.IRPP_LEGACY; }
//       else if (forcedMode === 'ITS_2026')    { fiscalMode = FISCAL_MODE.ITS_2026; }
//       else { fiscalMode = payrollYear < 2026 ? FISCAL_MODE.IRPP_LEGACY : FISCAL_MODE.ITS_2026; }

//       if (fiscalMode === 'FORFAIT') {
//         const forfaitRate = Number(settings?.forfaitItsRate ?? 0.08);
//         its = Math.ceil(grossSalary * forfaitRate);
//         irppResult = {
//           mode: 'FORFAIT', fiscalMode: 'FORFAIT', forfaitRate,
//           baseImposable: grossSalary, abattement: 0,
//           revenuNetImposable: grossSalary, fiscalParts: 1,
//           irppTotal: its,
//           effectiveRate: Number((forfaitRate * 100).toFixed(2)),
//         };
//         this.logger.log(`💸 ITS FORFAIT (${(forfaitRate * 100).toFixed(0)}%) = ${its.toLocaleString()} FCFA`);
//       } else {
//         irppResult = this.irppCalculator.calculateIRPP(
//           grossSalary, cnssSalarial,
//           employee?.maritalStatus    ?? 'SINGLE',
//           employee?.numberOfChildren ?? 0,
//           fiscalMode as any,
//         );
//         its = irppResult.irppTotal;
//         this.logger.log(`💸 ITS ${fiscalMode} = ${its.toLocaleString()} FCFA (taux ${irppResult.effectiveRate}%)`);
//       }
//     }

//     // ── 9. DÉDUCTIONS SUPPLÉMENTAIRES ────────────────────────────────────────
//     const totalOtherDeductions = deductions.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

//     // ── 10. TOTAUX ───────────────────────────────────────────────────────────
//     const totalDeductions   = cnssSalarial + its + totalOtherDeductions;
//     const netSalary         = Math.floor(grossSalary - totalDeductions + nonTaxableBonuses);
//     const totalEmployerCost = grossSalary + cnssEmployer + tusTotal;

//     this.logger.log(`📊 NET = ${netSalary.toLocaleString()} FCFA | COÛT EMP = ${totalEmployerCost.toLocaleString()} FCFA`);

//     // ── 11. RETOUR ───────────────────────────────────────────────────────────
//     return {
//       grossSalary,
//       netSalary,
//       cnssSalarial,
//       its,
//       totalDeductions,
//       cnssEmployer,
//       totalEmployerCost,
//       totalBonuses,
//       totalOvertimeAmount,
//       absenceDeduction,
//       adjustedBaseSalary: adjustedBase,
//       overtimeAmount10:   ot10Amount,
//       overtimeAmount25:   ot25Amount,
//       overtimeAmount50:   ot50Amount,
//       overtimeAmount100:  ot100Amount,

//       // ✅ CNSS Patronale détaillée
//       cnssEmployerPension,
//       cnssEmployerFamily,
//       cnssEmployerAccident,

//       // ✅ TUS détaillé (3 champs conformes schema BDD)
//       tusDgiAmount,
//       tusCnssAmount,
//       tusTotal,

//       irppDetails: {
//         ...(irppResult ?? {}),
//         cnssEmployerDetail: {
//           pension:  cnssEmployerPension,
//           famille:  cnssEmployerFamily,
//           accident: cnssEmployerAccident,
//           total:    cnssEmployer,
//         },
//         tusDetail: {
//           dgi:   tusDgiAmount,
//           cnss:  tusCnssAmount,
//           total: tusTotal,
//         },
//         bonusDetail: {
//           taxableAndCnss: taxableAndCnssBonuses,
//           taxableNoCnss:  taxableNotCnssBonuses,
//           nonTaxable:     nonTaxableBonuses,
//         },
//       },
//     };
//   }
// }