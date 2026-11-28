// ============================================================================
// 📁 src/accounting/payroll-journal-entries.ts
// Écritures de paie pour l'écran « Journal comptable » et l'export Sage.
// Construites sur computeLines() (même source que le connecteur Konza Connect).
// Un bulletin qui ne peut pas être comptabilisé correctement est SIGNALÉ dans
// `issues` et exclu : jamais d'écriture déséquilibrée ni de compte inventé.
// ============================================================================
import { accountLines, computeLines, PayrollSnapshot } from '../compta-connector/payroll-contract';
import { AccountPlan, getPlanForPeriod } from './syscohada';

export type JournalEntry = { date: Date; journal: string; piece: string; account: string; accountName: string; label: string; debit: number; credit: number };
export type JournalIssue = { payrollId: string; piece: string; message: string };

export function buildJournalEntries(
  payrolls: Array<PayrollSnapshot & { employee: PayrollSnapshot['employee'] & { employeeNumber?: string | null } }>,
  mappings?: Record<string, string> | null,
  planFor: (p: PayrollSnapshot) => Readonly<AccountPlan> = (p) => getPlanForPeriod(p.year, p.month),
): { entries: JournalEntry[]; issues: JournalIssue[] } {
  const entries: JournalEntry[] = [];
  const issues: JournalIssue[] = [];
  for (const p of payrolls) {
    const name = `${p.employee.firstName} ${p.employee.lastName}`.trim();
    const piece = `PAY-${p.employee.employeeNumber ?? p.employee.id.slice(0, 8)}-${p.month}-${p.year}`;
    try {
      for (const l of accountLines(computeLines(p), mappings, planFor(p))) {
        entries.push({ date: p.periodEnd, journal: 'PAIE', piece, account: l.accountCode, accountName: l.accountName, label: `${l.label} - ${name}`, debit: l.debit, credit: l.credit });
      }
    } catch (e) {
      issues.push({ payrollId: p.id, piece, message: e instanceof Error ? e.message : 'Bulletin non comptabilisable.' });
    }
  }
  return { entries, issues };
}