
/**
 * Conseiller de décision pour les PRÊTS et les AVANCES SUR SALAIRE.
 *
 * Fonction PURE : ni base, ni réseau, ni modèle d'IA. Le serveur lit les données (en lecture seule),
 * les passe ici sous forme de nombres, et obtient un verdict + des constats codés. Le modèle d'IA
 * ne reçoit que le verdict, les codes et des marqueurs ; il reformule et dialogue, il ne décide
 * jamais. La décision finale reste à l'administrateur.
 *
 * Plafonds repris de loans.constants.ts : mensualité de prêt ≤ 30 % du salaire de base,
 * avance ≤ 50 % du salaire de base.
 *
 * Avance sur salaire (≠ quinzaine) : l'argent est versé AVANT le travail correspondant puis
 * retenu sur la paie d'un mois donné. Le risque est donc de ne pas pouvoir la récupérer
 * (contrat qui se termine, départ, essai non confirmé) et d'étouffer le salaire net.
 * La quinzaine, elle, paie du travail déjà effectué : elle n'entre pas dans ces règles.
 */
import type { Severity, Verdict } from './request-advisor';

export interface FinanceFinding {
  code: string;
  severity: Severity;
  /** Clés finissant par Fcfa = montant, Pct = pourcentage, Months = mois. */
  values: Record<string, number>;
}

export interface FinanceInput {
  kind: 'LOAN' | 'ADVANCE';
  amount: number;
  /** Prêt : mensualité demandée et durée (mois). */
  monthlyRepayment?: number;
  durationMonths?: number;
  /** Avance : mois de retenue par rapport au mois courant (0 = ce mois-ci). */
  deductMonthsAhead?: number;
  /** Avance faite ce mois-ci : part du mois déjà écoulée (0 à 1). */
  monthElapsedShare?: number;
  baseSalary: number | null;
  tenureMonths: number | null;
  trialInProgress?: boolean;
  /** Mois restants avant la fin du contrat (CDD) ou la sortie ; null si aucun terme connu. */
  monthsToContractEnd: number | null;
  loans: {
    activeCount: number;
    remainingFcfa: number;
    monthlyFcfa: number;
    /** Prêts actifs démarrés depuis plus d'un mois sans aucun remboursement enregistré. */
    neverRepaidCount: number;
    /** Mensualités échues non remboursées (somme sur les prêts actifs). */
    arrearsMonths: number;
    borrowed12mFcfa: number;
  };
  advances: {
    openCount: number;
    openFcfa: number;
    last6mCount: number;
    /** Un mois sur chacun des 3 derniers mois avec une avance. */
    threeMonthsInARow: boolean;
  };
}

export interface FinanceAdvice {
  verdict: Verdict;
  findings: FinanceFinding[];
}

export const LIMITS = {
  loanMonthlyRatio: 0.3,
  advanceRatio: 0.5,
  advanceWarnRatio: 0.3,
  loanAmountWarnMonths: 6,
  loanAmountBlockMonths: 12,
  totalDebtWarnMonths: 5,
  totalDebtBlockMonths: 8,
  shortTenureLoanMonths: 6,
  shortTenureAdvanceMonths: 3,
  frequentAdvances6m: 3,
  advanceFarMonths: 2,
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.round(n * 100);
const floor5k = (n: number) => Math.max(0, Math.floor(n / 5000) * 5000);

export function adviseFinance(i: FinanceInput): FinanceAdvice {
  const f: FinanceFinding[] = [];
  const add = (code: string, severity: Severity, values: Record<string, number> = {}) =>
    f.push({ code, severity, values });
  const salary = i.baseSalary && i.baseSalary > 0 ? i.baseSalary : null;

  if (!salary) add('NO_SALARY', 'warn');

  // ---- Situation de l'employé --------------------------------------------------------------
  if (i.trialInProgress) add('TRIAL_PERIOD', 'warn');
  const shortLimit =
    i.kind === 'LOAN' ? LIMITS.shortTenureLoanMonths : LIMITS.shortTenureAdvanceMonths;
  if (typeof i.tenureMonths === 'number' && i.tenureMonths < shortLimit)
    add('SHORT_TENURE', 'warn', { tenureMonths: r1(i.tenureMonths), limitMonths: shortLimit });

  // ---- Recouvrement : le contrat couvre-t-il le remboursement ? ----------------------------
  if (typeof i.monthsToContractEnd === 'number') {
    const horizon =
      i.kind === 'LOAN' ? i.durationMonths ?? 0 : (i.deductMonthsAhead ?? 0) + 1;
    if (i.monthsToContractEnd < horizon)
      add('CONTRACT_ENDS_BEFORE', 'block', {
        contractMonths: Math.max(0, r1(i.monthsToContractEnd)),
        horizonMonths: horizon,
      });
  }

  // ---- Prêts en cours ------------------------------------------------------------------------
  const L = i.loans;
  if (L.activeCount > 0) {
    add('EXISTING_LOANS', i.kind === 'LOAN' ? 'warn' : 'info', {
      count: L.activeCount,
      remainingFcfa: Math.round(L.remainingFcfa),
      monthlyFcfa: Math.round(L.monthlyFcfa),
    });
    if (L.neverRepaidCount > 0)
      add('LOAN_NOT_REPAID_YET', i.kind === 'LOAN' ? 'block' : 'warn', {
        count: L.neverRepaidCount,
      });
    if (L.arrearsMonths >= 2)
      add('LOAN_ARREARS', 'warn', { arrearsMonths: Math.round(L.arrearsMonths) });
  }

  if (i.kind === 'LOAN') {
    const A = i.advances;
    if (salary) {
      const months = i.amount / salary;
      if (months > LIMITS.loanAmountWarnMonths)
        add(
          'LOAN_AMOUNT_HIGH',
          months > LIMITS.loanAmountBlockMonths ? 'block' : 'warn',
          { salaryMonths: r1(months), amountFcfa: Math.round(i.amount) },
        );

      const monthly = i.monthlyRepayment ?? (i.durationMonths ? i.amount / i.durationMonths : 0);
      if (monthly > 0) {
        const ratio = (L.monthlyFcfa + monthly) / salary;
        if (ratio > LIMITS.loanMonthlyRatio) {
          add('LOAN_MONTHLY_RATIO', 'block', {
            ratioPct: pct(ratio),
            limitPct: pct(LIMITS.loanMonthlyRatio),
            monthlyFcfa: Math.round(monthly),
          });
          // Contre-proposition : durée plus longue, ou montant réduit, qui respecte le plafond.
          const allowed = LIMITS.loanMonthlyRatio * salary - L.monthlyFcfa;
          if (allowed > 0) {
            const needMonths = Math.ceil(i.amount / allowed);
            if (needMonths <= 60) add('SUGGEST_DURATION', 'info', { months: needMonths });
            if (i.durationMonths)
              add('SUGGEST_AMOUNT', 'info', { amountFcfa: floor5k(allowed * i.durationMonths) });
          }
        }
      }

      const exposure = (L.remainingFcfa + A.openFcfa + i.amount) / salary;
      if (exposure > LIMITS.totalDebtWarnMonths)
        add(
          'TOTAL_DEBT',
          exposure > LIMITS.totalDebtBlockMonths ? 'block' : 'warn',
          {
            salaryMonths: r1(exposure),
            remainingFcfa: Math.round(L.remainingFcfa + A.openFcfa),
          },
        );
    }
    if (L.borrowed12mFcfa > 0)
      add('BORROWED_YEAR', 'info', { borrowedFcfa: Math.round(L.borrowed12mFcfa) });
    if (A.openCount > 0)
      add('ADVANCE_OPEN', 'warn', { count: A.openCount, openFcfa: Math.round(A.openFcfa) });
  }

  // ---- Avances ---------------------------------------------------------------------------------
  if (i.kind === 'ADVANCE') {
    const A = i.advances;
    if (salary) {
      const ratio = i.amount / salary;
      if (ratio > LIMITS.advanceWarnRatio)
        add('ADVANCE_RATIO', ratio > LIMITS.advanceRatio ? 'block' : 'warn', {
          ratioPct: pct(ratio),
          limitPct: pct(LIMITS.advanceRatio),
        });
      const cumul = (A.openFcfa + i.amount) / salary;
      if (A.openCount > 0) {
        add('ADVANCE_OPEN', cumul > LIMITS.advanceRatio ? 'block' : 'warn', {
          count: A.openCount,
          openFcfa: Math.round(A.openFcfa),
          ratioPct: pct(cumul),
        });
      }
      if (cumul > LIMITS.advanceRatio || ratio > LIMITS.advanceRatio) {
        const room = LIMITS.advanceRatio * salary - A.openFcfa;
        if (room > 0) add('SUGGEST_AMOUNT', 'info', { amountFcfa: floor5k(room) });
      }
      // Pression sur le net : avance + mensualités de prêt retenues sur la même paie.
      if (L.monthlyFcfa > 0) {
        const pressure = (i.amount + L.monthlyFcfa) / salary;
        if (pressure > LIMITS.advanceRatio)
          add('NET_PAY_PRESSURE', 'warn', { ratioPct: pct(pressure) });
      }
      // Avance sur le mois en cours : au-delà de la part de salaire déjà gagnée, on paie du travail à venir.
      if (
        (i.deductMonthsAhead ?? 0) === 0 &&
        typeof i.monthElapsedShare === 'number' &&
        i.amount > salary * i.monthElapsedShare
      )
        add('ABOVE_EARNED', 'info', {
          earnedFcfa: Math.round(salary * i.monthElapsedShare),
          elapsedPct: pct(i.monthElapsedShare),
        });
    }
    if (A.last6mCount >= LIMITS.frequentAdvances6m || A.threeMonthsInARow)
      add('ADVANCE_FREQUENT', A.threeMonthsInARow ? 'warn' : 'warn', {
        count: A.last6mCount,
        windowMonths: 6,
        inARow: A.threeMonthsInARow ? 1 : 0,
      });
    if ((i.deductMonthsAhead ?? 0) > LIMITS.advanceFarMonths)
      add('DEDUCT_FAR', 'warn', { monthsAhead: i.deductMonthsAhead! });
  }

  // ---- Verdict ---------------------------------------------------------------------------------
  const verdict: Verdict = f.some((x) => x.severity === 'block')
    ? 'DEFER'
    : f.some((x) => x.severity === 'warn')
      ? 'RESERVE'
      : 'FAVORABLE';
  if (verdict === 'FAVORABLE') add('CLEAR_FINANCE', 'info');
  return { verdict, findings: f };
}

const fc = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' FCFA';

/** Phrase locale (français) d'un constat : lisible sans modèle. */
export function financeFindingText(f: FinanceFinding): string | null {
  const v = f.values;
  switch (f.code) {
    case 'NO_SALARY':
      return 'Salaire de base non renseigné : les plafonds ne peuvent pas être vérifiés.';
    case 'TRIAL_PERIOD':
      return 'L’employé est encore en période d’essai.';
    case 'SHORT_TENURE':
      return `Ancienneté de ${v.tenureMonths} mois seulement (repère : ${v.limitMonths} mois).`;
    case 'CONTRACT_ENDS_BEFORE':
      return `Le contrat se termine dans ${v.contractMonths} mois, avant la fin du remboursement (${v.horizonMonths} mois) : risque de ne pas récupérer la somme.`;
    case 'EXISTING_LOANS':
      return `${v.count} prêt(s) en cours : ${fc(v.remainingFcfa)} restant à rembourser, ${fc(v.monthlyFcfa)} retenus par mois.`;
    case 'LOAN_NOT_REPAID_YET':
      return `${v.count} prêt(s) en cours démarré(s) depuis plus d’un mois sans aucun remboursement enregistré.`;
    case 'LOAN_ARREARS':
      return `Environ ${v.arrearsMonths} mensualité(s) échue(s) non remboursée(s) sur les prêts en cours.`;
    case 'LOAN_AMOUNT_HIGH':
      return `Montant demandé : ${fc(v.amountFcfa)}, soit ${v.salaryMonths} mois de salaire de base.`;
    case 'LOAN_MONTHLY_RATIO':
      return `Mensualité de ${fc(v.monthlyFcfa)} : avec les prêts en cours, les retenues atteindraient ${v.ratioPct} % du salaire de base (plafond ${v.limitPct} %).`;
    case 'TOTAL_DEBT':
      return `Endettement total envisagé : ${v.salaryMonths} mois de salaire de base (dont ${fc(v.remainingFcfa)} déjà dus).`;
    case 'BORROWED_YEAR':
      return `${fc(v.borrowedFcfa)} déjà empruntés sur les 12 derniers mois.`;
    case 'ADVANCE_OPEN':
      return `${v.count} avance(s) non encore retenue(s) sur la paie, pour ${fc(v.openFcfa)}.`;
    case 'ADVANCE_RATIO':
      return `Avance de ${v.ratioPct} % du salaire de base (plafond ${v.limitPct} %).`;
    case 'NET_PAY_PRESSURE':
      return `Avance et mensualités de prêt retenues sur la même paie : ${v.ratioPct} % du salaire de base.`;
    case 'ABOVE_EARNED':
      return `L’avance dépasse la part de salaire déjà gagnée ce mois-ci (${fc(v.earnedFcfa)}, ${v.elapsedPct} % du mois écoulé) : une partie correspond à du travail à venir.`;
    case 'ADVANCE_FREQUENT':
      return v.inARow
        ? 'Avances demandées trois mois de suite : à discuter avec l’employé.'
        : `${v.count} avances sur les ${v.windowMonths} derniers mois.`;
    case 'DEDUCT_FAR':
      return `Retenue prévue dans ${v.monthsAhead} mois : plus la retenue est lointaine, plus le risque de non-recouvrement augmente.`;
    case 'SUGGEST_DURATION':
      return `Pour respecter le plafond, le remboursement pourrait être étalé sur ${v.months} mois.`;
    case 'SUGGEST_AMOUNT':
      return `Montant compatible avec les plafonds : environ ${fc(v.amountFcfa)}.`;
    case 'CLEAR_FINANCE':
      return 'Aucun point d’attention : la demande respecte les plafonds et l’historique est sain.';
    default:
      return null;
  }
}

export const FINANCE_VERDICT_TEXT: Record<Verdict, string> = {
  FAVORABLE: 'Avis favorable',
  RESERVE: 'Avis réservé : points d’attention',
  DEFER: 'Avis défavorable en l’état : à revoir ou à réduire',
  URGENT: 'À traiter en priorité',
};