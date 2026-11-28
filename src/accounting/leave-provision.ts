// ============================================================================
// 📁 src/accounting/leave-provision.ts
// Provision des congés payés (compte 4281) : écriture de VARIATION entre le stock
// de congés à payer à la date (calculé par le module Congés : solde de jours x
// taux journalier) et le stock déjà comptabilisé.
//   Dotation : Débit 6613 / Crédit 4281, charges sociales : Débit 6641 / Crédit 4382
//   Reprise  : écriture inverse.
// Le taux de charges sociales vient des paramètres légaux (CNSS patronale).
// ============================================================================
import { AccountPlan, DEFAULT_PLAN, resolveAccount } from './syscohada';
import type { JournalEntry } from './payroll-journal-entries';

export function leaveProvisionEntries(input: {
  stock: number; previousStock: number; employerSocialRate: number; date: Date; label?: string;
  mappings?: Record<string, string> | null; plan?: Readonly<AccountPlan>;
}): JournalEntry[] {
  const { stock, previousStock, employerSocialRate, date } = input;
  for (const [n, v] of [['stock', stock], ['previousStock', previousStock]] as const)
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`MONTANT_XAF_INVALIDE : ${n} doit être un entier XAF positif ou nul.`);
  if (!(employerSocialRate >= 0 && employerSocialRate < 1)) throw new Error('TAUX_CHARGES_INVALIDE.');
  const variation = stock - previousStock;
  if (variation === 0) return [];
  const plan = input.plan ?? DEFAULT_PLAN;
  const acc = (k: string) => { const a = resolveAccount(k, input.mappings, plan); if (!a) throw new Error(`AFFECTATION_ABSENTE : ${k}.`); return a; };
  const up = variation > 0, amount = Math.abs(variation), social = Math.round(amount * employerSocialRate);
  const piece = `PROV-CP-${date.toISOString().slice(0, 7)}`;
  const kind = up ? 'Dotation' : 'Reprise';
  const mk = (key: string, label: string, debit: number, credit: number): JournalEntry => {
    const a = acc(key); return { date, journal: 'OD', piece, account: a.code, accountName: a.name, label, debit, credit };
  };
  const out = [
    mk('PAY_LEAVE', `${kind} provision congés payés`, up ? amount : 0, up ? 0 : amount),
    mk('LEAVE_PROVISION_LIABILITY', `${kind} provision congés payés`, up ? 0 : amount, up ? amount : 0),
  ];
  if (social > 0) out.push(
    mk('CNSS_EMP_EXPENSE', `${kind} charges sociales sur congés à payer`, up ? social : 0, up ? 0 : social),
    mk('LEAVE_PROVISION_SOCIAL_LIABILITY', `${kind} charges sociales sur congés à payer`, up ? 0 : social, up ? social : 0),
  );
  return out;
}