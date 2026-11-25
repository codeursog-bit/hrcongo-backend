import { alignSalaryRounding } from './payroll-salary-rounding';

describe('arrondi facultatif du salaire', () => {
  it.each([
    [20010, 0, -10, 20000],
    [22023, 0, -23, 22000],
    [20050, 0, 0, 20050],
    [20010, 10, 0, 20000],
    [20010, 11, -49, 19950],
  ])('arrondit %i avec %i de retenue complémentaire', (raw, deduction, adjustment, payable) => {
    const calc = { netSalary: raw, salaryRoundingAmount: 0 };
    alignSalaryRounding(calc, true, deduction);
    expect(calc.salaryRoundingAmount).toBe(adjustment);
    expect(calc.netSalary - deduction).toBe(payable);
  });

  it('préserve le net quand la fonction est désactivée', () => {
    const calc = { netSalary: 20010, salaryRoundingAmount: 0 };
    alignSalaryRounding(calc, false, 0);
    expect(calc.netSalary).toBe(20010);
  });

  it('recalcule à partir du net avant le premier arrondi', () => {
    const calc = { netSalary: 20000, totalDeductions: 510, salaryRoundingAmount: -10 };
    alignSalaryRounding(calc, true, 10);
    expect(calc.salaryRoundingAmount).toBe(0);
    expect(calc.totalDeductions).toBe(500);
    expect(calc.netSalary - 10).toBe(20000);
  });
});
