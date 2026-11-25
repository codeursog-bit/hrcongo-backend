import { accruedLeaveDays } from './leave-accrual-math';

describe('Acquisition mensuelle des droits à congé', () => {
  it('conserve les fractions et atteint exactement le droit annuel', () => {
    expect(Array.from({ length: 12 }, (_, i) => accruedLeaveDays(i + 1, 26))).toEqual([
      2.17, 4.33, 6.5, 8.67, 10.83, 13, 15.17, 17.33, 19.5, 21.67, 23.83, 26,
    ]);
  });
  it('calcule une cible stable, avec la règle annuelle configurée', () => {
    expect(accruedLeaveDays(12, 30)).toBe(30);
    expect(accruedLeaveDays(6, 26)).toBe(accruedLeaveDays(6, 26));
    expect(accruedLeaveDays(0, 26)).toBe(0);
    expect(accruedLeaveDays(18, 26)).toBe(26);
  });
});
