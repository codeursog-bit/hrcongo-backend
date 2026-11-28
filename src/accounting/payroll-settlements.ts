// ============================================================================
// 📁 src/accounting/payroll-settlements.ts
// Écritures de RÈGLEMENT de la paie d'un mois (net, CNSS, DGI, TOL), construites
// à partir des dettes de chaque bulletin (computeLines) : aucun montant recalculé.
//   Net      : Débit 422                         / Crédit 521
//   CNSS     : Débit 4313-4311-4312 + 4421 (TUS) / Crédit 521
//   DGI      : Débit 4472 + 4421 + 4474 + ...    / Crédit 521
//   TOL      : Débit 4478                        / Crédit 521
// Comptes = liaison entreprise > plan en vigueur (superadmin) > défaut du code.
// ============================================================================
import { accountLines, ACCOUNTABLE_STATUSES, computeLines, PayrollSnapshot } from '../compta-connector/payroll-contract';
import { AccountPlan, getPlanForPeriod, resolveAccount } from './syscohada';
import type { JournalEntry, JournalIssue } from './payroll-journal-entries';

type Group = 'NET' | 'CNSS' | 'DGI' | 'TOL';
const CNSS_KEYS = new Set(['CNSS_SAL', 'CNSS_EMP_PENSION_LIABILITY', 'CNSS_EMP_FAMILY_LIABILITY', 'CNSS_EMP_ACCIDENT_LIABILITY', 'CNSS_EMP_LIABILITY', 'TUS_CNSS_LIABILITY']);
const DGI_KEYS = new Set(['ITS', 'BNC', 'TUS_DGI_LIABILITY']);
const GROUP_LABEL: Record<Group, string> = { NET: 'Règlement des salaires nets', CNSS: 'Reversement CNSS', DGI: 'Reversement DGI', TOL: 'Reversement TOL' };

/** Dettes de paie qui se règlent en trésorerie. ADVANCE, LOAN, arrondi, retenues diverses : jamais. */
export function groupOf(key: string): Group | null {
  if (key === 'NET') return 'NET';
  if (CNSS_KEYS.has(key)) return 'CNSS';
  if (key === 'CTAX_TOL') return 'TOL';
  if (DGI_KEYS.has(key) || key.startsWith('CTAX_')) return 'DGI';
  return null;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
/** Échéances par défaut : net 8 jours après la fin du mois (C. travail art. 88) ; CNSS et DGI le 15 du mois suivant (20 pour la paie d'août). */
export function dueDates(year: number, month: number): Record<Group, Date> {
  const eom = utc(year, month, 0);
  const net = new Date(eom.getTime() + 8 * 86400000);
  const next = (d: number) => utc(year, month, d); // month est 1-12 : utc(year, month, d) = mois suivant
  const fiscalDay = month === 8 ? 20 : 15;
  return { NET: net, CNSS: next(15), DGI: next(fiscalDay), TOL: next(fiscalDay) };
}

export function buildSettlementEntries(
  payrolls: PayrollSnapshot[],
  mappings: Record<string, string> | null | undefined,
  opts: { year: number; month: number; netPaidOnly?: boolean; dates?: Partial<Record<Group, Date>>; plan?: Readonly<AccountPlan> },
): { entries: JournalEntry[]; issues: JournalIssue[] } {
  const plan = opts.plan ?? getPlanForPeriod(opts.year, opts.month);
  const dates = { ...dueDates(opts.year, opts.month), ...(opts.dates ?? {}) };
  const issues: JournalIssue[] = [];
  const totals: Record<Group, Map<string, { label: string; amount: number }>> = { NET: new Map(), CNSS: new Map(), DGI: new Map(), TOL: new Map() };
  for (const p of payrolls) {
    if (!(ACCOUNTABLE_STATUSES as readonly string[]).includes(p.status)) continue;
    try {
      const lines = computeLines(p);
      accountLines(lines, mappings, plan); // refuse tout bulletin dont une rubrique n'a pas de compte
      for (const l of lines) {
        const g = groupOf(l.key);
        if (!g || l.credit <= 0) continue;
        if (g === 'NET' && opts.netPaidOnly !== false && !(p.paid || p.status === 'PAID')) continue;
        const cur = totals[g].get(l.key) ?? { label: l.label, amount: 0 };
        cur.amount += l.credit;
        totals[g].set(l.key, cur);
      }
    } catch (e) {
      issues.push({ payrollId: p.id, piece: `${p.employee.firstName} ${p.employee.lastName}`.trim(), message: e instanceof Error ? e.message : 'Bulletin non comptabilisable.' });
    }
  }
  const bank = resolveAccount('BANK', mappings, plan);
  if (!bank) throw new Error('AFFECTATION_ABSENTE : Banque (BANK).');
  const mm = String(opts.month).padStart(2, '0');
  const entries: JournalEntry[] = [];
  for (const g of ['NET', 'CNSS', 'DGI', 'TOL'] as Group[]) {
    const piece = `REG-${opts.year}-${mm}-${g}`;
    let sum = 0;
    for (const [key, v] of totals[g]) {
      const acc = resolveAccount(key, mappings, plan)!;
      sum += v.amount;
      entries.push({ date: dates[g], journal: 'BQ', piece, account: acc.code, accountName: acc.name, label: `${GROUP_LABEL[g]} - ${v.label}`, debit: v.amount, credit: 0 });
    }
    if (sum > 0) entries.push({ date: dates[g], journal: 'BQ', piece, account: bank.code, accountName: bank.name, label: GROUP_LABEL[g], debit: 0, credit: sum });
  }
  return { entries, issues };
}