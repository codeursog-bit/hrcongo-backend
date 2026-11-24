import { validateSimulationInput } from './payroll-simulation-validation';

describe('Payroll simulation input', () => {
  it('accepts a valid period and fractional attendance days', () => {
    expect(() => validateSimulationInput(11, 2026, { workedDays: 25.5, workDays: 26 })).not.toThrow();
  });
  it.each([0, 13, 99, 1.5, NaN])('rejects invalid month %s', month => {
    expect(() => validateSimulationInput(month, 2026)).toThrow();
  });
  it.each([
    { workedDays: -10 }, { workedDays: 1000 }, { workedDays: null },
    { workDays: 0 }, { baseSalary: -1 }, { overtimeHours25: Infinity },
    { manualBonuses: [{ amount: -1 }] }, { manualDeductions: [null] },
    { manualBonuses: [{ amount: 1000, isTaxable: 'false' }] },
    { manualBonuses: [{ amount: 1000, isCnss: 'false' }] },
  ])('rejects invalid monetary or attendance values', overrides => {
    expect(() => validateSimulationInput(11, 2026, overrides)).toThrow();
  });
});
