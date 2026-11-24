
import { LeavesService } from './leaves.service';

describe('Payable leave planning', () => {
  function setup() {
    const service: any = Object.create(LeavesService.prototype);
    const leave = { id: 'leave', employeeId: 'emp', type: 'ANNUAL', daysCount: 26, payrollIndemnityDays: { toString: () => '0' }, payrollSeniorityDays: 3, employee: {} };
    Object.assign(service, {
      indemnityService: { resolveAnnualIndemnityDays: jest.fn().mockResolvedValue({ totalDays: 29, seniorityDays: 3 }) },
      logger: { error: jest.fn() },
      getUserWithCompany: jest.fn().mockResolvedValue({ role: 'ADMIN', companyId: 'company' }),
      prisma: { leave: { findMany: jest.fn().mockResolvedValue([leave]) } },
      calculateLeaveIndemnity: jest.fn().mockResolvedValue({ indemnity: 32500, monthsUsed: 1 }),
      buildDepartureRows: jest.fn().mockResolvedValue([]),
    });
    return service;
  }
  it('uses the full entitlement when a legacy Decimal snapshot is zero', async () => {
    const service = setup();
    const rows = await service.getMonthlyPlanning('admin', 10, 2026, undefined, 'payable');
    expect(service.calculateLeaveIndemnity).toHaveBeenCalledWith('emp', 29, 'company', 10, 2026, undefined, { estimateCurrentMonth: true });
    expect(rows[0]).toMatchObject({ indemnityAmount: 32500, monthsKnown: 1, calculationError: false });
    expect(service.prisma.leave.findMany.mock.calls[0][0].where.OR[1]).toMatchObject({
      carriedFromLeaveId: null, startDate: { gte: new Date(2026, 10, 1), lt: new Date(2026, 11, 1) },
    });
  });
  it('identifies a calculation error instead of presenting it as a zero allocation', async () => {
    const service = setup();
    service.calculateLeaveIndemnity.mockRejectedValue(new Error('unavailable'));
    const rows = await service.getMonthlyPlanning('admin', 10, 2026, undefined, 'payable');
    expect(rows[0].calculationError).toBe(true);
    expect(rows[0].monthsKnown).toBeNull();
  });
});
