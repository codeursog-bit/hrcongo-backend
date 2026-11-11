
import { AttendanceCheckService } from './attendance-check.service';
import { computeDayTotals } from './attendance-day-totals';

jest.mock('./attendance-day-totals', () => ({ computeDayTotals: jest.fn() }));

describe('Daily journal correction without a punch', () => {
  const input = {
    employeeId: 'employee', date: '2020-10-12', reason: 'Oubli de pointage',
    checkIn: '2020-10-12T07:00:00.000Z', checkOut: '2020-10-12T16:00:00.000Z',
    breakStart: '2020-10-12T11:00:00.000Z', breakEnd: '2020-10-12T12:00:00.000Z',
  };
  function setup(existing = false) {
    let row: any = existing ? { id: 'attendance', employeeId: 'employee', companyId: 'company', date: input.date, status: 'ABSENT_UNPAID', checkIn: null, checkOut: null } : null;
    const user = { companyId: 'company', role: 'ADMIN', firstName: 'Admin', lastName: 'RH' };
    const tx: any = {
      user: { findUnique: jest.fn(async () => user), findMany: jest.fn().mockResolvedValue([]) },
      attendance: {
        upsert: jest.fn(async ({ create }) => { row ??= { id: 'attendance', ...create }; return row; }),
        findUnique: jest.fn(async () => ({ ...row, employee: { id: 'employee', firstName: 'Jean', lastName: 'Test' } })),
        update: jest.fn(async ({ data }) => ({ ...row, ...data })),
      },
      attendanceLog: { create: jest.fn().mockResolvedValue({}) },
      attendanceBreak: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      user: tx.user,
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'employee' }) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const service: any = Object.create(AttendanceCheckService.prototype);
    Object.assign(service, { prisma, utils: {}, gateway: { sendAdminNotification: jest.fn() } });
    (computeDayTotals as jest.Mock).mockResolvedValue({ totalHours: 8, normalHours: 8, overtime10: 0, overtime25: 0, overtime50: 0, overtime100: 0, isNightShift: false, isLate: false });
    return { service, prisma, tx };
  }
  it.each([false, true])('saves hours and break for an absent day (existing row: %s)', async (existing) => {
    const { service, tx } = setup(existing);
    const result = await service.correctAttendanceDay('admin', input);
    expect(result.attendance).toMatchObject({ status: 'PRESENT', totalHours: 8, breakMinutes: 60, checkInMethod: 'MANUAL', checkOutMethod: 'MANUAL' });
    expect(computeDayTotals).toHaveBeenLastCalledWith(tx, {}, expect.objectContaining({ breakMinutes: 60, date: input.date }));
    expect(tx.attendanceBreak.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ minutes: 60 }) }));
    expect(tx.attendanceLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'MANUAL_CREATE', reason: input.reason }) }));
  });
  it('rejects a break outside the worked hours before updating', async () => {
    const { service, tx } = setup();
    await expect(service.correctAttendanceDay('admin', { ...input, breakEnd: '2020-10-12T17:00:00Z' })).rejects.toThrow();
    expect(tx.attendance.update).not.toHaveBeenCalled();
    expect(tx.attendanceLog.create).not.toHaveBeenCalled();
  });
  it('requires an exit time for a past day', async () => {
    const { service, tx } = setup();
    await expect(service.correctAttendanceDay('admin', { ...input, checkOut: undefined })).rejects.toThrow();
    expect(tx.attendance.update).not.toHaveBeenCalled();
  });
  it('rejects an employee outside the company without creating a row', async () => {
    const { service, prisma, tx } = setup();
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.correctAttendanceDay('admin', input)).rejects.toThrow();
    expect(tx.attendance.upsert).not.toHaveBeenCalled();
  });
  it('rejects empty hours and unauthorized users without creating a row', async () => {
    const { service, prisma, tx } = setup();
    await expect(service.correctAttendanceDay('admin', { ...input, checkIn: undefined })).rejects.toThrow();
    prisma.user.findUnique.mockResolvedValue({ role: 'EMPLOYEE', companyId: 'company' });
    await expect(service.correctAttendanceDay('employee', input)).rejects.toThrow();
    expect(tx.attendance.upsert).not.toHaveBeenCalled();
  });
});
