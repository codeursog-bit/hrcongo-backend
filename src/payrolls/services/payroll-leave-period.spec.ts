import { payrollLeavePeriod } from './payroll-leave-period';

jest.mock('../../common/working-days.util', () => ({
  getCompanyWorkDays: jest.fn().mockResolvedValue([1, 2, 3, 4, 5]),
  nextWorkingDay: (date: Date) => new Date(date.getTime() + 86400000),
}));

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('snapshot des congés à la fin du mois de paie', () => {
  const employee = {
    hireDate: date('2026-01-01'), leaveCycleStartDate: date('2027-01-31'),
    contractType: 'CDI',
    company: { leaveCycleMode: 'ROLLING', leaveAppliesToContractors: false,
      appliesSeniorityLeaveBonus: false },
  };
  const leave = {
    id: 'leave-1', companyId: 'company-1',
    startDate: date('2027-01-01'), endDate: date('2027-01-31'),
    actualReturnDate: date('2027-02-01'),
    debitedCycleStartDate: date('2026-01-01'),
    balanceDebitedAt: date('2027-01-01'), daysCount: 26,
  };
  const db = {
    employee: { findUnique: jest.fn().mockResolvedValue(employee) },
    leaveBalance: { findMany: jest.fn().mockResolvedValue([{
      id: 'balance-1', cycleStartDate: date('2026-01-01'),
      annualEntitled: 26, annualTaken: 26, annualRemaining: 0,
      seniorityDays: 0, adjustmentNote: null,
    }]) },
    leave: { findMany: jest.fn().mockResolvedValue([leave]) },
    publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;

  it('montre 26 jours en décembre même si le congé a ensuite été débité', async () => {
    expect(await payrollLeavePeriod(db, 'employee-1', 12, 2026)).toEqual({
      annualEntitled: 26, annualTaken: 0, annualRemaining: 26,
    });
  });

  it('reprend à 2,17 jours en février sans bulletin en janvier', async () => {
    expect(await payrollLeavePeriod(db, 'employee-1', 2, 2027)).toEqual({
      annualEntitled: 2.17, annualTaken: 0, annualRemaining: 2.17,
    });
  });
});
