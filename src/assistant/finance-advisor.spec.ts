import { adviseFinance, type FinanceInput } from './finance-advisor';

const base: Omit<FinanceInput, 'kind' | 'amount'> = {
  baseSalary: 400000,
  tenureMonths: 36,
  monthsToContractEnd: null,
  loans: { activeCount: 0, remainingFcfa: 0, monthlyFcfa: 0, neverRepaidCount: 0, arrearsMonths: 0, borrowed12mFcfa: 0 },
  advances: { openCount: 0, openFcfa: 0, last6mCount: 0, threeMonthsInARow: false },
};
const codes = (r: ReturnType<typeof adviseFinance>) => r.findings.map((f) => f.code);

describe('adviseFinance — prêts', () => {
  it('avis favorable pour un prêt raisonnable', () => {
    const r = adviseFinance({ ...base, kind: 'LOAN', amount: 600000, monthlyRepayment: 50000, durationMonths: 12 });
    expect(r.verdict).toBe('FAVORABLE');
  });

  it('alerte sur un prêt non remboursé et dépasse le plafond de 30 %, avec contre-proposition', () => {
    const r = adviseFinance({
      ...base,
      kind: 'LOAN',
      amount: 2000000,
      monthlyRepayment: 100000,
      durationMonths: 20,
      loans: { activeCount: 1, remainingFcfa: 1000000, monthlyFcfa: 50000, neverRepaidCount: 1, arrearsMonths: 3, borrowed12mFcfa: 1000000 },
    });
    expect(r.verdict).toBe('DEFER');
    expect(codes(r)).toEqual(
      expect.arrayContaining(['LOAN_NOT_REPAID_YET', 'LOAN_MONTHLY_RATIO', 'SUGGEST_DURATION', 'SUGGEST_AMOUNT']),
    );
  });

  it('bloque quand le contrat se termine avant la fin du remboursement', () => {
    const r = adviseFinance({
      ...base, kind: 'LOAN', amount: 300000, monthlyRepayment: 25000, durationMonths: 12, monthsToContractEnd: 4,
    });
    expect(r.verdict).toBe('DEFER');
    expect(codes(r)).toContain('CONTRACT_ENDS_BEFORE');
  });
});

describe('adviseFinance — avances', () => {
  it('avis favorable pour une avance raisonnable', () => {
    const r = adviseFinance({ ...base, kind: 'ADVANCE', amount: 80000, deductMonthsAhead: 0, monthElapsedShare: 0.6 });
    expect(r.verdict).toBe('FAVORABLE');
  });

  it('plafonne le cumul des avances à 50 % du salaire et propose un montant', () => {
    const r = adviseFinance({
      ...base, kind: 'ADVANCE', amount: 150000, deductMonthsAhead: 0, monthElapsedShare: 0.2,
      advances: { openCount: 1, openFcfa: 100000, last6mCount: 3, threeMonthsInARow: true },
    });
    expect(r.verdict).toBe('DEFER');
    const s = r.findings.find((f) => f.code === 'SUGGEST_AMOUNT');
    expect(s?.values.amountFcfa).toBe(100000);
    expect(codes(r)).toContain('ADVANCE_FREQUENT');
  });

  it('signale une avance supérieure au salaire déjà gagné, sans la bloquer', () => {
    const r = adviseFinance({ ...base, kind: 'ADVANCE', amount: 80000, deductMonthsAhead: 0, monthElapsedShare: 0.1 });
    expect(codes(r)).toContain('ABOVE_EARNED');
    expect(r.verdict).toBe('FAVORABLE');
  });
});