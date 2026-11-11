
import { PayrollsService } from './payrolls.service';

describe('Scheduled leave indemnity on recalculation', () => {
  function setup() {
    const payroll = { id: 'pay', employeeId: 'emp', companyId: 'company', month: 10, year: 2026, status: 'DRAFT', baseSalary: 260000, workedDays: 26 };
    const employee = { id: 'emp', baseSalary: 260000 };
    const impact = { leaveId: 'leave', leaveIndemnity: 260000, leaveIndemnityBase: 260000, leaveIndemnitySeniority: 0, isPaid: true, leaveDays: 0, indemnifiedDays: 26 };
    const tx: any = {
      payroll: { update: jest.fn(async ({ data }) => ({ ...payroll, ...data })), aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      payrollItem: { deleteMany: jest.fn().mockResolvedValue({}) },
      leaveBalance: { findFirst: jest.fn().mockResolvedValue(null) },
      leave: { update: jest.fn().mockResolvedValue({}) },
      employee: { findUnique: jest.fn().mockResolvedValue({}) },
      ytdCheckpoint: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service: any = Object.create(PayrollsService.prototype);
    Object.assign(service, {
      prisma: {
        payroll: { findUnique: jest.fn().mockResolvedValue(payroll) },
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN', companyId: 'company' }) },
        comptaDelivery: { findFirst: jest.fn().mockResolvedValue(null) },
        employee: { findUnique: jest.fn().mockResolvedValue(employee) },
        company: { findUnique: jest.fn().mockResolvedValue({}) },
        $transaction: async (callback) => callback(tx),
      },
      payrollSettingsService: { getSettingsByCompanyId: jest.fn().mockResolvedValue({ workDaysPerMonth: 26 }) },
      companyTaxService: { findActive: jest.fn().mockResolvedValue([]) },
      bonusesService: { calculateEmployeeBonuses: jest.fn().mockResolvedValue([]) },
      deductionsService: {
        getAppliedLoanDeductionsForEmployee: jest.fn().mockResolvedValue([]),
        getAppliedAdvanceDeductionsForEmployee: jest.fn().mockResolvedValue([]),
        getAppliedCompanyDeductionsForEmployee: jest.fn().mockResolvedValue([]),
      },
      calculator: { calculate: jest.fn((...args) => ({ grossSalary: 260000 + (args[13]?.leaveIndemnity ?? 0), netSalary: 200000, totalDeductions: 60000 })) },
      leavesService: { getLeaveImpactForPayroll: jest.fn().mockResolvedValue(impact) },
      itemsService: { create: jest.fn().mockResolvedValue(undefined) },
      ytdCheckpointService: { reconcile: jest.fn().mockResolvedValue(undefined) },
    });
    return { service, tx };
  }
  it('restores both the indemnity line and the gross amount on an existing October draft', async () => {
    const { service, tx } = setup();
    const result = await service.recalculatePayroll('pay', 'admin');
    expect(result.grossSalary).toBe(520000);
    expect((await service.recalculatePayroll('pay', 'admin')).grossSalary).toBe(520000);
    expect(service.leavesService.getLeaveImpactForPayroll).toHaveBeenCalledWith('emp', 10, 2026, 260000);
    expect(service.itemsService.create.mock.calls[0][9]).toMatchObject({ leaveIndemnity: 260000, indemnifiedDays: 26 });
    expect(tx.leave.update).toHaveBeenCalledWith({ where: { id: 'leave' }, data: { paidIndemnityAmount: 260000 } });
  });
  it('does not replace the draft when the indemnity calculation fails', async () => {
    const { service, tx } = setup();
    service.leavesService.getLeaveImpactForPayroll.mockRejectedValue(new Error('leave unavailable'));
    await expect(service.recalculatePayroll('pay', 'admin')).rejects.toThrow('leave unavailable');
    expect(tx.payroll.update).not.toHaveBeenCalled();
    expect(tx.payrollItem.deleteMany).not.toHaveBeenCalled();
  });
});
