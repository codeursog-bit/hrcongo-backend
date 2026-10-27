// ============================================================================
// 📁 src/payrolls/services/payroll-items.service.ts
//
// ✅ CONFORME DÉCRET 78-360 : labels et taux 10/25/50/100
// ✅ TUS : 2 lignes séparées DGI (2,025%) + CNSS (5,475%)
// ✅ Taxes custom (CompanyTax) : part salarié DEDUCTION + part patronale EMPLOYER_COST
// ✅ Lignes congé sur le bulletin (indemnité + déduction)
// ✅ Affichage prorata des primes sur le bulletin
// ✅ Taxes custom (CTAX_*) visibles ligne par ligne dans le bulletin
//
// ✅ Affichage « Nombre × Base = Gain » sur tout ce qui dépend du temps :
//    quantity = nb de jours (ou d'unités), base = valeur d'UNE unité
//    (ex. 26 × 1 000 = 26 000). Calculé ICI — le front ne recalcule rien.
//    Base arrondie à 2 décimales (colonne Decimal(15,2)) pour que
//    Nombre × Base retombe sur le montant à moins d'1 FCFA.
//
// ✅ NOUVEAU : base + quantity + empRate + empAmount sur chaque item
//    → le front affiche sans aucun calcul
//    base     = base journalière ou taux horaire (selon le type)
//    quantity = nb jours travaillés / nb heures supp / nb unités prime
//    empRate  = taux patronal affiché (ex: "8%", "2,025%")
//    empAmount= montant patronal de cette ligne
// ============================================================================

import { Injectable } from '@nestjs/common';
import { LEGAL_WORK_HOURS_PER_MONTH } from '../constants/payroll.constants';

@Injectable()
export class PayrollItemsService {
  async create(
    tx: any,
    payrollId: string,
    emp: any,
    calc: any,
    summary: any,
    loans: any[],
    advances: any[],
    settings: any,
    calculatedBonuses: any[] = [],
    leaveData?: {
      leaveIndemnity: number;
      leaveIndemnityBase?: number;
      leaveIndemnitySeniority?: number;
      absenceDeduction: number;
      isPaidLeave: boolean;
      leaveDays: number;
      leaveLabel: string;
      indemnifiedDays?: number;
      indemnifiedSeniorityDays?: number;
    },
    leaveSnapshot?: {
      droits: number; // annualEntitled au moment de la génération
      pris: number; // annualTaken
      solde: number; // annualRemaining
    },
    // ✅ NOUVEAU — paramètre optionnel en toute fin de signature (rétrocompatible
    // avec tous les appels existants qui ne le passent pas). Retenues diverses
    // (pharmacie, cantine, casse matériel...) déjà résolues au montant à
    // déduire CE mois — voir PayrollDeductionsService.prepareCompanyDeductionsForCalc.
    companyDeductionEntries: { id: string; amount: number; label: string }[] = [],
    // ✅ NOUVEAU — jours théoriques du mois quand ils diffèrent de
    // settings.workDaysPerMonth (paie en masse avec « jours pour tous »,
    // customWorkDays). Optionnel : sans lui, on retombe sur les réglages.
    workDaysOverride?: number,
  ) {
    const items: any[] = [];
    let order = 0;

    const contractType = emp?.contractType ?? 'CDI';
    const isStagiaire = contractType === 'STAGE';
    const isBncWorker =
      contractType === 'CONSULTANT' || contractType === 'PRESTATAIRE';

    // ── Affichage Nombre × Base (bulletins salariés uniquement) ──────────
    // Les contrats facturés (stage, consultant, prestataire, intérim) ont
    // leurs propres gabarits « facture » : on n'y touche pas.
    const isDaySplitContract =
      !isStagiaire && !isBncWorker && contractType !== 'INTERIM';
    const theoWorkDays =
      Number(workDaysOverride) > 0
        ? Number(workDaysOverride)
        : Number(settings?.workDaysPerMonth) || 26;
    const paidDays = Math.max(0, Number(summary?.daysToPay) || 0);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    // ✅ Chaque ligne basée sur le temps expose maintenant quantity (nombre)
    // et base (valeur d'une unité) : SAL_BASE, ABS_DEDUCT, ABS_CONGE,
    // INDEM_CONGE, CONGE_SUPP, primes proratisées, heures sup. Le montant
    // reste TOUJOURS celui du vrai moteur — base et quantity ne servent
    // qu'à l'affichage, jamais à recalculer.

    // ─── 1. Salaire de base ───────────────────────────────────────────────────
    // ✅ On affiche TOUJOURS le salaire plein (jours théoriques) avec base journalière.
    // Si absence → la déduction apparaît sur ABS_DEDUCT juste en dessous.
    // L'employé voit : "j'aurais eu 26 000 si 26/26, mais on me déduit 2j = 2 000"
    const salaryLabel = isStagiaire
      ? 'Gratification de stage'
      : isBncWorker
        ? 'Honoraires / Prestation '
        : 'Salaire de base';

    // ✅ Le montant affiché est TOUJOURS le vrai salaire de base stocké
    // (emp.baseSalary), tel quel — jamais recalculé en base×nombre.
    // ✅ Affichage : Nombre = jours théoriques du mois, Base = valeur d'un
    // jour (salaire ÷ jours), Gain = salaire plein. Ex. 26 × 1 000 = 26 000.
    // La base garde 2 décimales quand la division n'est pas ronde
    // (473 470 ÷ 26 = 18 210,38) pour que 26 × base retombe sur le gain.
    // Si absence → la déduction apparaît sur ABS_DEDUCT juste en dessous,
    // avec la MÊME base journalière.
    const fullBaseSalary = Number(emp.baseSalary);
    const dailyBase =
      isDaySplitContract && theoWorkDays > 0
        ? round2(fullBaseSalary / theoWorkDays)
        : null;

    items.push({
      payrollId,
      code: 'SAL_BASE',
      label: salaryLabel,
      type: 'GAIN',
      base: dailyBase,
      rate: null,
      quantity: dailyBase != null ? theoWorkDays : null,
      amount: Math.round(fullBaseSalary), // ✅ TOUJOURS le salaire plein
      isTaxable: true,
      isCnss: !isStagiaire && !isBncWorker,
      order: ++order,
    });

    // ─── 2. Déduction absence — JUSTE APRÈS SAL_BASE si absence ─────────────
    // ✅ Nombre = jours d'absence, Base = valeur d'un jour (identique à
    // SAL_BASE), Retenue = déduction réelle du moteur. Ex. 6 × 1 000.
    // Ne s'affiche PAS si c'est un congé (géré plus bas par ABS_CONGE).
    if (
      calc.absenceDeduction > 0 &&
      (!leaveData || leaveData.leaveDays === 0)
    ) {
      const absenceDays = round2(theoWorkDays - paidDays);
      if (absenceDays > 0) {
        items.push({
          payrollId,
          code: 'ABS_DEDUCT',
          label: 'Déduction absences',
          type: 'DEDUCTION',
          base: dailyBase, // ✅ même valeur d'un jour que SAL_BASE
          rate: null,
          // ✅ Le nombre de jours reste visible — via la colonne Nombre,
          // plus besoin de le répéter entre parenthèses dans le libellé.
          quantity: absenceDays,
          amount: calc.absenceDeduction,
          isTaxable: false,
          isCnss: false,
          order: ++order,
        });
      }
    }

    // ─── 3. Congés ────────────────────────────────────────────────────────────
    // ✅ Ligne "Absence congé" (déduction jours physiques) : uniquement si
    // des jours d'absence réels tombent CE mois (ex: congé anticipé
    // concomitant, ou congé classique aux dates réelles).
    if (leaveData && leaveData.leaveDays > 0) {
      items.push({
        payrollId,
        code: 'ABS_CONGE',
        label: `Absence ${leaveData.isPaidLeave ? 'congé payé' : 'congé sans solde'}`,
        type: 'DEDUCTION',
        base: round2(leaveData.absenceDeduction / leaveData.leaveDays),
        rate: null,
        // ✅ Nombre de jours visible via la colonne Nombre plutôt qu'entre
        // parenthèses dans le libellé.
        quantity: leaveData.leaveDays,
        amount: leaveData.absenceDeduction,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }

    // ✅ Ligne "Indemnité de congé" : indépendante de leaveDays — le mois
    // où l'indemnité ANNUAL est payée (mois précédent le départ) n'a
    // souvent AUCUNE absence physique (leaveDays = 0), l'employé travaille
    // normalement ce mois-là. Ne pas la faire dépendre de leaveDays,
    // sinon elle disparaît du bulletin précisément quand elle est due.
    if (leaveData && leaveData.isPaidLeave && leaveData.leaveIndemnity > 0) {
      const totalDaysForLabel = leaveData.indemnifiedDays ?? leaveData.leaveDays;
      const seniorityDaysForLabel = leaveData.indemnifiedSeniorityDays ?? 0;
      const baseDaysForLabel = Math.max(0, totalDaysForLabel - seniorityDaysForLabel);
      const seniorityAmount = leaveData.leaveIndemnitySeniority ?? 0;
      const baseAmount = leaveData.leaveIndemnityBase ?? leaveData.leaveIndemnity;

      items.push({
        payrollId,
        code: 'INDEM_CONGE',
        label: leaveData.leaveLabel, // ✅ "Indemnité de congé" — la base/taux suffit, pas besoin d'un "Xj" en plus
        type: 'GAIN',
        base: baseDaysForLabel > 0 ? round2(baseAmount / baseDaysForLabel) : null,
        rate: null,
        quantity: baseDaysForLabel,
        amount: baseAmount,
        isTaxable: true,
        isCnss: true,
        order: ++order,
      });

      // ✅ Ligne "Congé supplémentaire" juste après — jours d'ancienneté
      // (convention collective), au même taux journalier. Seulement si
      // l'employé en a réellement (sinon pas de ligne à 0 F inutile).
      if (seniorityAmount > 0) {
        items.push({
          payrollId,
          code: 'CONGE_SUPP',
          label: 'Congé supplémentaire',
          type: 'GAIN',
          base:
            seniorityDaysForLabel > 0
              ? round2(seniorityAmount / seniorityDaysForLabel)
              : null,
          rate: null,
          quantity: seniorityDaysForLabel,
          amount: seniorityAmount,
          isTaxable: true,
          isCnss: true,
          order: ++order,
        });
      }
    }

    // ─── 3. Primes & avantages ────────────────────────────────────────────────
    const getBonusFiscalType = (bonus: any): string => {
      if (bonus.fiscalType === 'NON_TAXABLE') return 'NON_TAXABLE';
      if (bonus.fiscalType === 'TAXABLE_NO_CNSS') return 'TAXABLE_NO_CNSS';
      if (bonus.fiscalType === 'TAXABLE_CNSS') return 'TAXABLE_CNSS';
      if (bonus.isTaxable === false) return 'NON_TAXABLE';
      if (bonus.isCnss === false) return 'TAXABLE_NO_CNSS';
      return 'TAXABLE_CNSS';
    };

    for (const bonus of calculatedBonuses) {
      const fiscalType = getBonusFiscalType(bonus);
      const bonusId = bonus.id ?? `bonus-${order}`;

      // quantity : nb unités pour les primes à quantité, null sinon
      let bonusQuantity: number | null = null;
      if (bonus.quantityMode && bonus.unitAmount && bonus.quantity) {
        bonusQuantity = Number(bonus.quantity);
      }

      // ✅ base et rate viennent directement de CalculatedBonus (calculés dans payroll-bonuses.service.ts)
      // PERCENTAGE → base = salaire contractuel, rate = % décimal (ex: 0.06)
      // FIXED_AMOUNT → base = null, rate = null
      // Ancienneté AUTO → base = salaire contractuel, rate = _seniorityRate/100
      // Paie manuelle → base et rate transmis tels quels depuis le front
      let bonusBase: number | null = null;
      let bonusRate: number | null = null;

      if (bonus.unitAmount && Number(bonus.unitAmount) > 0) {
        // Prime à quantité (ex: transport × jours)
        bonusBase = Math.round(Number(bonus.unitAmount));
        bonusRate = null;
      } else if (bonus._seniorityRate && bonus._seniorityRate > 0) {
        // Ancienneté AUTO — base = salaire contractuel, rate = % décimal
        bonusBase = Number(emp.baseSalary);
        bonusRate = bonus._seniorityRate / 100;
      } else if (
        isDaySplitContract &&
        theoWorkDays > 0 &&
        bonus.isProratized &&
        bonus.frequency !== 'ANNUAL' && // 13e mois = prorata en MOIS, pas en jours
        bonus.rate == null &&
        bonus.base == null
      ) {
        // ✅ Prime à montant fixe proratisée selon les jours travaillés :
        // Nombre = jours payés, Base = valeur d'un jour (montant plein ÷
        // jours théoriques), Gain = montant réel du moteur.
        // Ex. 25 000 sur 26 j, 20 j payés → 20 × 961,54 = 19 231.
        const fullAmount = Number(bonus._originalAmount ?? bonus.amount);
        if (fullAmount > 0) {
          bonusBase = round2(fullAmount / theoWorkDays);
          bonusQuantity = Math.min(paidDays, theoWorkDays);
          bonusRate = null;
        }
      } else {
        // Toutes les autres primes — lire directement depuis CalculatedBonus
        bonusBase = bonus.base != null ? Number(bonus.base) : null;
        bonusRate = bonus.rate != null ? Number(bonus.rate) : null;
      }

      items.push({
        payrollId,
        code:
          bonus.source === 'AUTOMATIC'
            ? `AUTO_BONUS_${bonusId.toString().substring(0, 8)}`
            : `BONUS_${bonusId.toString().substring(0, 8)}`,
        label: bonus.bonusType,
        type: 'GAIN',
        base: bonusBase, // ✅ base reconstruite correctement
        rate: bonusRate, // ✅ taux reconstruit correctement
        quantity: bonusQuantity,
        amount: bonus.amount,
        isTaxable: fiscalType !== 'NON_TAXABLE',
        isCnss: fiscalType === 'TAXABLE_CNSS',
        order: ++order,
      });
    }

    // ─── 4. Heures supplémentaires ────────────────────────────────────────────
    if (calc.overtimeAmount10 > 0) {
      const hourlyRate = Number(emp.baseSalary) / LEGAL_WORK_HOURS_PER_MONTH; // ✅ taux contractuel brut
      items.push({
        payrollId,
        code: 'HS_10',
        label: 'Heures supplémentaires +10%',
        type: 'GAIN',
        base: Math.round(hourlyRate * 1.1), // ✅ taux horaire majoré (+10%)
        rate: null,
        quantity: Number(summary.overtime10Hours), // ✅ nb heures en taux
        amount: calc.overtimeAmount10,
        isTaxable: true,
        isCnss: true,
        order: ++order,
      });
    }
    if (calc.overtimeAmount25 > 0) {
      const hourlyRate = Number(emp.baseSalary) / LEGAL_WORK_HOURS_PER_MONTH; // ✅ taux contractuel brut
      items.push({
        payrollId,
        code: 'HS_25',
        label: 'Heures supplémentaires +25%',
        type: 'GAIN',
        base: Math.round(hourlyRate * 1.25), // ✅ taux horaire majoré (+25%)
        rate: null,
        quantity: Number(summary.overtime25Hours),
        amount: calc.overtimeAmount25,
        isTaxable: true,
        isCnss: true,
        order: ++order,
      });
    }
    if (calc.overtimeAmount50 > 0) {
      const hourlyRate = Number(emp.baseSalary) / LEGAL_WORK_HOURS_PER_MONTH; // ✅ taux contractuel brut
      items.push({
        payrollId,
        code: 'HS_50',
        label: 'Heures supplémentaires +50%',
        type: 'GAIN',
        base: Math.round(hourlyRate * 1.5), // ✅ taux horaire majoré (+50%)
        rate: null,
        quantity: Number(summary.overtime50Hours),
        amount: calc.overtimeAmount50,
        isTaxable: true,
        isCnss: true,
        order: ++order,
      });
    }
    if (calc.overtimeAmount100 > 0) {
      const hourlyRate = Number(emp.baseSalary) / LEGAL_WORK_HOURS_PER_MONTH; // ✅ taux contractuel brut
      items.push({
        payrollId,
        code: 'HS_100',
        label: 'Heures supplémentaires +100%',
        type: 'GAIN',
        base: Math.round(hourlyRate * 2.0), // ✅ taux horaire majoré (+100%)
        rate: null,
        quantity: Number(summary.overtime100Hours),
        amount: calc.overtimeAmount100,
        isTaxable: true,
        isCnss: true,
        order: ++order,
      });
    }

    // ─── 5. CNSS salariale ───────────────────────────────────────────────────
    if (calc.cnssSalarial > 0) {
      items.push({
        payrollId,
        code: 'CNSS_SAL',
        label: 'Cotisation CNSS',
        type: 'DEDUCTION',
        base: calc.grossSalary,
        rate: 0.04,
        quantity: null,
        empRate: isStagiaire ? '2,25%' : '20,28%', // taux patronal CNSS affiché (total)
        empAmount: calc.cnssEmployer, // montant patronal total
        amount: calc.cnssSalarial,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }

    // ─── 6. ITS / IRPP ou BNC ────────────────────────────────────────────────
    if (calc.its > 0) {
      const fiscalMode = calc.irppDetails?.fiscalMode ?? 'ITS_2026';
      const itsCode = isBncWorker ? 'BNC_SOURCE' : 'ITS';
      const itsLabel = isBncWorker
        ? (calc.bncLabel ?? 'BNC retenu à la source')
        : fiscalMode === 'FORFAIT'
          ? 'Impôt forfaitaire — Barème BNC'
          : fiscalMode === 'IRPP_LEGACY'
            ? 'IRPP — Barème progressif'
            : 'ITS — Barème progressif';

      items.push({
        payrollId,
        code: itsCode,
        label: itsLabel,
        type: 'DEDUCTION',
        base: calc.grossSalary,
        rate: null,
        quantity: null,
        amount: calc.its,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }

    // ─── 7. Taxes custom — part salariale ────────────────────────────────────
    if (calc.customTaxDetails?.length > 0) {
      for (const tax of calc.customTaxDetails) {
        if (tax.employeeAmount > 0) {
          items.push({
            payrollId,
            code: `CTAX_${tax.code}`,
            label: tax.name,
            type: 'DEDUCTION',
            base: tax.base > 0 ? tax.base : null,
            // ✅ FIX — avant ce patch, rate=1 était codé en dur dès que
            // base > 0, pour TOUTES les taxes custom, y compris celles au
            // pourcentage (ex: CAMU solidarité = 0,5%). Le bulletin
            // affichait alors "1" au lieu du vrai taux. Maintenant : taxe
            // à montant fixe (TOL...) → rate=1 (flag d'affichage, base
            // affichée = montant) ; taxe au pourcentage (CAMU...) → le
            // vrai taux (ex: 0.005), affiché "0,5" côté front.
            rate: tax.baseType === 'FIXED'
              ? (tax.base > 0 ? 1 : null)
              : (tax.employeeRate ?? null),
            quantity: null,
            amount: tax.employeeAmount,
            isTaxable: false,
            isCnss: false,
            order: ++order,
          });
        }
      }
    }

    // ─── 8. Prêts ────────────────────────────────────────────────────────────
    for (const loan of loans) {
      // _deduction est posé par smicProtection ; fallback : mensualité normale
      const deductionAmount =
        loan._deduction ?? Number(loan.monthlyRepayment ?? 0);
      if (!deductionAmount || deductionAmount <= 0) continue;
      items.push({
        payrollId,
        code: 'LOAN',
        label: 'Remboursement prêt',
        type: 'DEDUCTION',
        base: null,
        rate: null,
        quantity: null,
        amount: deductionAmount,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }

    // ─── 9. Avances ──────────────────────────────────────────────────────────
    for (const adv of advances) {
      // _deduction est posé par smicProtection ; fallback : montant de l'avance
      const deductionAmount = adv._deduction ?? Number(adv.amount ?? 0);
      if (!deductionAmount || deductionAmount <= 0) continue;
      items.push({
        payrollId,
        code: 'ADVANCE',
        label: 'Récupération avance',
        type: 'DEDUCTION',
        base: null,
        rate: null,
        quantity: null,
        amount: deductionAmount,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }

    // ─── 9bis. Retenues diverses (pharmacie, cantine, casse matériel...) ─────
    // Une ligne PAR retenue (pas un total groupé) pour que le libellé saisi
    // par le RH ("Pharmacie", "Casse ordinateur"...) reste visible sur le
    // bulletin — même logique que prêts/avances ci-dessus.
    for (const cd of companyDeductionEntries) {
      if (!cd.amount || cd.amount <= 0) continue;
      items.push({
        payrollId,
        code: 'COMPANY_DEDUCTION',
        label: cd.label || 'Retenue diverse',
        type: 'DEDUCTION',
        base: null,
        rate: null,
        quantity: null,
        amount: cd.amount,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }

    // ─── 10. CNSS patronale — 3 lignes distinctes (ou 1 pour stagiaire) ──────
    if (isStagiaire && calc.cnssEmployerAccident > 0) {
      // Stagiaire : uniquement Accidents du Travail
      items.push({
        payrollId,
        code: 'CNSS_EMP_AT',
        label: 'CNSS Accidents',
        type: 'EMPLOYER_COST',
        base: calc.grossSalary,
        rate: 0.0225,
        quantity: null,
        empRate: '2,25%',
        empAmount: calc.cnssEmployerAccident,
        amount: calc.cnssEmployerAccident,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    } else if (!isStagiaire && calc.cnssEmployer > 0) {
      // Employé classique : 3 branches séparées
      if (calc.cnssEmployerPension > 0) {
        items.push({
          payrollId,
          code: 'CNSS_EMP_PENSION',
          label: 'CNSS Pension',
          type: 'EMPLOYER_COST',
          base: calc.grossSalary,
          rate: 0.08,
          quantity: null,
          empRate: '8%',
          empAmount: calc.cnssEmployerPension,
          amount: calc.cnssEmployerPension,
          isTaxable: false,
          isCnss: false,
          order: ++order,
        });
      }
      if (calc.cnssEmployerFamily > 0) {
        items.push({
          payrollId,
          code: 'CNSS_EMP_FAM',
          label: 'CNSS Famille',
          type: 'EMPLOYER_COST',
          base: calc.grossSalary,
          rate: 0.1003,
          quantity: null,
          empRate: '10,03%',
          empAmount: calc.cnssEmployerFamily,
          amount: calc.cnssEmployerFamily,
          isTaxable: false,
          isCnss: false,
          order: ++order,
        });
      }
      if (calc.cnssEmployerAccident > 0) {
        items.push({
          payrollId,
          code: 'CNSS_EMP_AT',
          label: 'CNSS Accidents',
          type: 'EMPLOYER_COST',
          base: calc.grossSalary,
          rate: 0.0225,
          quantity: null,
          empRate: '2,25%',
          empAmount: calc.cnssEmployerAccident,
          amount: calc.cnssEmployerAccident,
          isTaxable: false,
          isCnss: false,
          order: ++order,
        });
      }
    }

    // ─── 11. TUS — 2 lignes DGI + CNSS ───────────────────────────────────────
    if (calc.tusDgiAmount > 0) {
      items.push({
        payrollId,
        code: 'TUS_DGI',
        label: 'TUS DGI',
        type: 'EMPLOYER_COST',
        base: calc.grossSalary,
        rate: 0.02025,
        quantity: null,
        empRate: '2,025%',
        empAmount: calc.tusDgiAmount,
        amount: calc.tusDgiAmount,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }
    if (calc.tusCnssAmount > 0) {
      items.push({
        payrollId,
        code: 'TUS_CNSS',
        label: 'TUS CNSS',
        type: 'EMPLOYER_COST',
        base: calc.grossSalary,
        rate: 0.05475,
        quantity: null,
        empRate: '5,475%',
        empAmount: calc.tusCnssAmount,
        amount: calc.tusCnssAmount,
        isTaxable: false,
        isCnss: false,
        order: ++order,
      });
    }

    // ─── 12. Taxes custom — part patronale ───────────────────────────────────
    if (calc.customTaxDetails?.length > 0) {
      for (const tax of calc.customTaxDetails) {
        if (tax.employerAmount > 0) {
          items.push({
            payrollId,
            code: `CTAX_EMP_${tax.code}`,
            label: tax.name,
            type: 'EMPLOYER_COST',
            base: tax.base > 0 ? tax.base : null,
            // ✅ FIX — même correction que côté salarié (§7) : rate était
            // toujours null ici, donc aucune taxe custom patronale
            // n'affichait de taux. Taxe à montant fixe → 1 (flag) ; taxe
            // au pourcentage → le vrai taux (ex: employerRate).
            rate: tax.baseType === 'FIXED'
              ? (tax.base > 0 ? 1 : null)
              : (tax.employerRate ?? null),
            quantity: null,
            empRate: null,
            empAmount: tax.employerAmount,
            amount: tax.employerAmount,
            isTaxable: false,
            isCnss: false,
            order: ++order,
          });
        }
      }
    }

    // ─── 13. Snapshot solde de congés — items INFO figés au moment de la génération ─
    // ✅ Ces 3 items sont immuables : le bulletin affichera toujours les valeurs
    // de CE mois, même consulté 2 ans plus tard. Plus besoin de lire LeaveBalance live.
    if (leaveSnapshot) {
      for (const [code, label, amount] of [
        ['LEAVE_DROITS', 'Congés acquis (snapshot)', leaveSnapshot.droits],
        ['LEAVE_PRIS', 'Congés pris (snapshot)', leaveSnapshot.pris],
        ['LEAVE_SOLDE', 'Solde congés (snapshot)', leaveSnapshot.solde],
      ] as [string, string, number][]) {
        items.push({
          payrollId,
          code,
          label,
          type: 'INFO',
          base: null,
          rate: null,
          quantity: null,
          amount,
          isTaxable: false,
          isCnss: false,
          order: ++order,
        });
      }
    }

    // ─── Persistance ─────────────────────────────────────────────────────────
    if (items.length > 0) {
      await tx.payrollItem.createMany({ data: items });
    }

    return items;
  }
}