// ============================================================================
// 📁 src/payrolls/services/payroll-net-target.service.ts
//
// OPTION « PAIE SUR LE NET » (calcul à l'envers) — désactivée par défaut.
//
// Contexte : certaines entreprises font payer leurs salariés sur le NET :
//     net payé = net du mois plein × jours travaillés ÷ jours théoriques
// alors que le moteur légal (PayrollCalculatorService) proratise le BRUT puis
// applique CNSS / CAMU / ITS. Les deux méthodes ne donnent jamais le même net
// (barème ITS progressif, indemnités fixes…).
//
// Ce service ne remplace RIEN du moteur légal et ne le modifie pas. Il :
//   1. calcule le net du mois plein (via le moteur, sans retenues) ;
//   2. en déduit le NET CIBLE = net plein × jours payés ÷ jours théoriques ;
//   3. cherche, par itérations successives du MÊME moteur, le montant de
//      SURSALAIRE qui fait tomber le net du bulletin sur ce net cible
//      (« calcul à l'envers », comme la rubrique net → brut de Sage Paie).
//
// Ce qui ne bouge JAMAIS : jours travaillés, salaire de base, indemnités
// (transport, salissure…), autres primes, heures sup, retenues.
// Seule la ligne « Sursalaire » est ajustée (créée si elle n'existe pas).
//
// Branchement : un seul appel `apply()` juste après la résolution des primes,
// par les services de génération de paie. Si l'option est désactivée, ou en
// cas de doute / d'erreur, les primes sont renvoyées telles quelles.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PayrollCalculatorService } from './payroll-calculator.service';

/** Libellés reconnus comme « sursalaire » : Sursalaire, Sur-salaire, Sur salaire… */
const SURSALAIRE_RE = /sur[\s_-]?salaire/i;

/** Contrats pour lesquels un bulletin classique est produit. */
const SALARIED_CONTRACTS = ['CDI', 'CDD', 'STAGE'];

const MAX_ITERATIONS = 14;

type FiscalType = 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE';

export interface NetTargetInput {
  /** Entreprise — doit contenir `netBasedProrata`. */
  company: any;
  /** Employé tel que passé au moteur (avec `_payrollYear`). */
  employee: any;
  baseSalary: number;
  settings: any;
  companyTaxes: any[];
  daysToPay: number;
  /** Jours théoriques du mois (ex. 26). */
  workDays: number;
  /** Primes résolues pour les jours réellement payés. */
  bonuses: any[];
  /** Primes résolues pour le MOIS PLEIN (sert à calculer le net plein). */
  resolveFullMonthBonuses: () => Promise<any[]>;
}

export interface NetTargetDetails {
  netFullMonth: number;
  targetNet: number;
  netBefore: number;
  netAfter: number;
  sursalaireBefore: number;
  sursalaireAfter: number;
  createdLine: boolean;
  iterations: number;
}

export interface NetTargetResult {
  /** Primes à utiliser pour le calcul (inchangées si `applied` = false). */
  bonuses: any[];
  applied: boolean;
  details?: NetTargetDetails;
  warning?: string;
}

export interface SolveResult {
  amount: number;
  net: number;
  iterations: number;
  /** true si même avec un montant à 0 le net dépasse la cible. */
  clamped: boolean;
}

/**
 * Cherche l'entier `amount ≥ 0` tel que `netAt(amount)` soit le plus proche
 * de `target` (net croissant avec le montant). Sécante rapide (le net est
 * linéaire par morceaux), puis recherche locale, puis dichotomie de secours.
 * Fonction pure : exportée pour pouvoir être testée seule.
 */
export function solveAmountForNet(
  netAt: (amount: number) => number,
  target: number,
  start: number,
): SolveResult {
  const memo = new Map<number, number>();
  let calls = 0;
  const evaluate = (s: number): number => {
    const key = Math.max(0, Math.round(s));
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    calls++;
    const n = netAt(key);
    memo.set(key, n);
    return n;
  };

  let s = Math.max(0, Math.round(start));
  let n = evaluate(s);
  let best = { s, n };
  const consider = (cs: number, cn: number) => {
    const d = Math.abs(cn - target);
    const bd = Math.abs(best.n - target);
    if (d < bd || (d === bd && cs < best.s)) best = { s: cs, n: cn };
  };

  let slope = 0.65; // part moyenne d'un franc de sursalaire qui arrive au net
  for (let i = 0; i < MAX_ITERATIONS && n !== target; i++) {
    const delta = target - n;
    let step = Math.round(delta / slope);
    if (step === 0) step = delta > 0 ? 1 : -1;
    const next = Math.max(0, s + step);
    if (next === s) break; // déjà à 0 et le net est encore trop haut
    const nn = evaluate(next);
    const measured = (nn - n) / (next - s);
    if (Number.isFinite(measured) && measured >= 0.2 && measured <= 1.05) {
      slope = measured;
    }
    s = next;
    n = nn;
    consider(s, n);
  }

  // Recherche locale autour du meilleur candidat (marches de 1 F de l'arrondi).
  if (best.n !== target) {
    for (let off = 1; off <= 3 && best.n !== target; off++) {
      for (const cs of [best.s - off, best.s + off]) {
        if (cs < 0) continue;
        consider(cs, evaluate(cs));
      }
    }
  }

  // Secours : dichotomie entre le plus grand point trop bas et le plus petit trop haut.
  if (best.n !== target) {
    let lo = -1;
    let hi = -1;
    for (const [k, v] of memo) {
      if (v < target && (lo < 0 || k > lo)) lo = k;
      if (v > target && (hi < 0 || k < hi)) hi = k;
    }
    if (lo >= 0 && hi > lo) {
      for (let i = 0; i < 40 && hi - lo > 1; i++) {
        const mid = Math.floor((lo + hi) / 2);
        const nm = evaluate(mid);
        consider(mid, nm);
        if (nm === target) break;
        if (nm < target) lo = mid;
        else hi = mid;
      }
    }
  }

  return {
    amount: best.s,
    net: best.n,
    iterations: calls,
    clamped: best.s === 0 && best.n > target,
  };
}

@Injectable()
export class PayrollNetTargetService {
  private readonly logger = new Logger(PayrollNetTargetService.name);

  constructor(private readonly calculator: PayrollCalculatorService) {}

  async apply(input: NetTargetInput): Promise<NetTargetResult> {
    const unchanged: NetTargetResult = {
      bonuses: input.bonuses,
      applied: false,
    };

    // ── Garde-fous : option off, contrat hors bulletin classique, mois plein ──
    if (input.company?.netBasedProrata !== true) return unchanged;
    const contractType = (input.employee?.contractType as string) ?? 'CDI';
    if (!SALARIED_CONTRACTS.includes(contractType)) return unchanged;

    const { baseSalary, daysToPay, workDays } = input;
    if (!(baseSalary > 0) || !(workDays > 0) || !(daysToPay > 0)) {
      return unchanged;
    }
    if (daysToPay >= workDays) return unchanged; // mois plein : rien à ajuster

    try {
      // Net « régulier » : sans heures sup, sans retenues, sans congé.
      const netOf = (bonuses: any[], days: number): number =>
        this.calculator.calculate(
          baseSalary,
          0,
          0,
          0,
          0,
          bonuses,
          [],
          input.settings,
          days,
          workDays,
          input.employee,
          input.company,
          input.companyTaxes,
        ).netSalary;

      // 1. Net du mois plein  →  2. net cible
      const fullBonuses = await input.resolveFullMonthBonuses();
      const netFullMonth = netOf(fullBonuses, workDays);
      const targetNet = Math.round((netFullMonth * daysToPay) / workDays);

      // 3. Ligne « sursalaire » existante (ou à créer)
      const idx = input.bonuses.findIndex(
        (b) =>
          SURSALAIRE_RE.test(String(b?.bonusType ?? '')) &&
          this.fiscalTypeOf(b) !== 'NON_TAXABLE',
      );
      const existing = idx >= 0 ? input.bonuses[idx] : null;
      const sursalaireBefore = existing ? Number(existing.amount) || 0 : 0;

      const withAmount = (amount: number): any[] => {
        const line = this.buildLine(existing, amount, sursalaireBefore);
        if (idx >= 0) {
          const copy = [...input.bonuses];
          copy[idx] = line;
          return copy;
        }
        return [...input.bonuses, line];
      };

      const netBefore = netOf(input.bonuses, daysToPay);
      if (netBefore === targetNet) return unchanged;

      // 4. Calcul à l'envers : sursalaire qui donne le net cible
      const solved = solveAmountForNet(
        (amount) => netOf(withAmount(amount), daysToPay),
        targetNet,
        sursalaireBefore,
      );

      const details: NetTargetDetails = {
        netFullMonth,
        targetNet,
        netBefore,
        netAfter: solved.net,
        sursalaireBefore,
        sursalaireAfter: solved.amount,
        createdLine: !existing,
        iterations: solved.iterations,
      };

      const name = `${input.employee?.firstName ?? ''} ${input.employee?.lastName ?? ''}`.trim();
      this.logger.log(
        `🧮 Paie sur le net${name ? ` (${name})` : ''} — plein: ${netFullMonth} | cible: ${targetNet} | avant: ${netBefore} | sursalaire ${sursalaireBefore} → ${solved.amount} | net obtenu: ${solved.net} (${solved.iterations} calculs)`,
      );

      // Cible inatteignable : le net du bulletin dépasse déjà la cible même avec
      // un sursalaire à 0. On ne modifie RIEN (calcul légal conservé) et on prévient.
      if (solved.clamped) {
        return {
          ...unchanged,
          details,
          warning: `Paie sur le net${name ? ` — ${name}` : ''} : le net du bulletin (${netBefore.toLocaleString('fr-FR')} F) dépasse déjà le net cible (${targetNet.toLocaleString('fr-FR')} F) même sans sursalaire ; bulletin conservé tel quel.`,
        };
      }

      // Rien à changer (même montant) → on ne touche pas aux primes.
      if (solved.amount === sursalaireBefore && existing) {
        return { ...unchanged, details };
      }

      let warning: string | undefined;
      if (Math.abs(solved.net - targetNet) > 1) {
        warning = `Paie sur le net${name ? ` — ${name}` : ''} : net cible ${targetNet.toLocaleString('fr-FR')} F non atteint exactement (net obtenu ${solved.net.toLocaleString('fr-FR')} F).`;
      }

      return {
        bonuses: withAmount(solved.amount),
        applied: true,
        details,
        warning,
      };
    } catch (err: any) {
      // Jamais bloquant : en cas de problème on retombe sur le calcul légal normal.
      this.logger.warn(
        `⚠️ Paie sur le net ignorée (calcul légal conservé) : ${err?.message ?? err}`,
      );
      return unchanged;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private fiscalTypeOf(b: any): FiscalType {
    if (b?.fiscalType === 'NON_TAXABLE') return 'NON_TAXABLE';
    if (b?.fiscalType === 'TAXABLE_NO_CNSS') return 'TAXABLE_NO_CNSS';
    if (b?.fiscalType === 'TAXABLE_CNSS') return 'TAXABLE_CNSS';
    if (b?.isTaxable === false) return 'NON_TAXABLE';
    if (b?.isCnss === false) return 'TAXABLE_NO_CNSS';
    return 'TAXABLE_CNSS';
  }

  /**
   * Ligne « Sursalaire » avec le montant ajusté. L'affichage « Nombre × Base »
   * du bulletin (prorata) est neutralisé : le montant ajusté ne correspond plus
   * à un nombre de jours, il s'affiche donc comme un simple gain.
   */
  private buildLine(existing: any | null, amount: number, before: number): any {
    if (existing) {
      return {
        ...existing,
        amount,
        isProratized: false,
        _proratized: false,
        _originalAmount: undefined,
        _seniorityRate: undefined,
        base: null,
        rate: null,
        quantityMode: null,
        unitAmount: null,
        quantity: null,
        _netTargetAdjusted: true,
        _netTargetBefore: before,
      };
    }
    return {
      id: 'net-target-sursalaire',
      bonusType: 'Sursalaire',
      amount,
      isTaxable: true,
      isCnss: true,
      fiscalType: 'TAXABLE_CNSS',
      source: 'AUTOMATIC',
      isRecurring: false,
      description: null,
      isProratized: false,
      frequency: 'MONTHLY',
      isInLeaveBase: true,
      bonusCategory: 'POSTE',
      base: null,
      rate: null,
      _netTargetAdjusted: true,
      _netTargetBefore: 0,
    };
  }
}