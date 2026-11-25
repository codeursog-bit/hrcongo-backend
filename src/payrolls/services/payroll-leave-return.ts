import type { Prisma } from '@prisma/client';
import { getCompanyWorkDays, nextWorkingDay } from '../../common/working-days.util';
import type { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;
/** Dates de reprise réelles, sinon dates prévues selon le calendrier de l'entreprise. */
export async function payrollAnnualLeaves(db: Db, employeeId: string) {
  const leaves = await db.leave.findMany({
    where: { employeeId, status: 'APPROVED', type: 'ANNUAL', carriedFromLeaveId: null },
    orderBy: { startDate: 'asc' },
  });
  if (!leaves.length) return [];
  const companyId = leaves[0].companyId;
  const [workDays, holidays] = await Promise.all([
    getCompanyWorkDays(db as PrismaService, companyId),
    db.publicHoliday.findMany({ where: { companyId }, select: { date: true } }),
  ]);
  const calendar = new Set(holidays.map(day => day.date));
  return leaves.map(leave => ({ ...leave, returnDate: leave.actualReturnDate ?? new Date(nextWorkingDay(leave.endDate, workDays, calendar)) }));
}

/** Un nouveau cycle n'efface que les mois antérieurs à la reprise. */
export async function payrollReturnCheckpoint(db: Db, employeeId: string, year: number, month: number) {
  const cutoff = new Date(Date.UTC(year, month, 1));
  const returns = (await payrollAnnualLeaves(db, employeeId)).filter(leave => leave.returnDate < cutoff);
  const latest = returns.sort((a, b) => b.returnDate.getTime() - a.returnDate.getTime())[0];
  if (!latest) return null;
  return { effectiveDate: new Date(Date.UTC(latest.returnDate.getUTCFullYear(), latest.returnDate.getUTCMonth(), 1)),
    brut: 0, netImp: 0, netSalary: 0, chargesSal: 0, chargesPat: 0 };
}
