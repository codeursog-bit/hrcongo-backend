import { BadRequestException } from '@nestjs/common';
import { calculateWorkingDays, calculateReturnDate, firstWorkingDayOnOrAfter } from './working-days.util';

describe('Working date validation', () => {
  const prisma: any = { publicHoliday: { findMany: jest.fn().mockResolvedValue([]) } };
  beforeEach(() => jest.clearAllMocks());
  it.each([new Date('invalid'), new Date('0026-11-02')])('rejects invalid or incomplete years before querying holidays: %s', async date => {
    await expect(calculateWorkingDays(prisma, 'company', date, new Date('2026-11-30'), [1,2,3,4,5])).rejects.toBeInstanceOf(BadRequestException);
    await expect(calculateReturnDate(prisma, 'company', date, 26, true, [1,2,3,4,5])).rejects.toBeInstanceOf(BadRequestException);
    await expect(firstWorkingDayOnOrAfter(prisma, 'company', date, [1,2,3,4,5])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.publicHoliday.findMany).not.toHaveBeenCalled();
  });
  it('keeps a valid November departure and October-to-November day count', async () => {
    expect(await firstWorkingDayOnOrAfter(prisma, 'company', new Date('2026-11-01'), [1,2,3,4,5])).toEqual(new Date('2026-11-02'));
    expect(await calculateWorkingDays(prisma, 'company', new Date('2026-10-30'), new Date('2026-11-02'), [1,2,3,4,5])).toBe(2);
    expect(prisma.publicHoliday.findMany).toHaveBeenLastCalledWith({ where: { companyId: 'company', year: { in: [2026] } }, select: { date: true } });
  });
});
