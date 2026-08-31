// ============================================================================
// 📁 src/common/working-days.util.ts
// ✅ Moteur "jours ouvrables" partagé — congé annuel ET absences utilisent le
//    même calcul (lundi-samedi, jours fériés de l'entreprise exclus).
// ============================================================================

import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compte les jours ouvrables (lun-sam, hors fériés) entre deux dates incluses. */
export async function calculateWorkingDays(
  prisma: PrismaService,
  companyId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const years = [start.getFullYear()];
  if (end.getFullYear() !== start.getFullYear()) years.push(end.getFullYear());

  const holidays = await prisma.publicHoliday.findMany({
    where: { companyId, year: { in: years } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.date));

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    const ds = formatDate(cur);
    if (dow >= 1 && dow <= 6 && !holidaySet.has(ds)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Calcule la date de retour à partir d'une date de départ et d'un nombre de
 * jours ouvrables souhaité — avance jour par jour en sautant dimanches et
 * jours fériés. `returnDate` = dernier jour de congé/absence + 1 jour.
 */
export async function calculateReturnDate(
  prisma: PrismaService,
  companyId: string,
  startDate: Date,
  workingDaysNeeded: number,
) {
  if (workingDaysNeeded <= 0) {
    throw new BadRequestException(
      'Le nombre de jours doit être supérieur à 0.',
    );
  }

  const searchYears = [
    startDate.getFullYear(),
    startDate.getFullYear() + 1,
    startDate.getFullYear() + 2,
  ];
  const holidays = await prisma.publicHoliday.findMany({
    where: { companyId, year: { in: searchYears } },
    select: { date: true, name: true },
  });
  const holidayMap = new Map(holidays.map((h) => [h.date, h.name]));

  const excludedHolidays: { date: string; name: string }[] = [];
  let sundaysSkipped = 0;
  let workingDaysCounted = 0;
  let lastLeaveDay: Date | null = null;

  const cur = new Date(startDate);
  const maxIterations = 365 * 3; // garde-fou
  for (
    let i = 0;
    i < maxIterations && workingDaysCounted < workingDaysNeeded;
    i++
  ) {
    const dow = cur.getDay();
    const ds = formatDate(cur);

    if (dow === 0) {
      sundaysSkipped++;
    } else if (holidayMap.has(ds)) {
      excludedHolidays.push({ date: ds, name: holidayMap.get(ds)! });
    } else {
      workingDaysCounted++;
      if (workingDaysCounted >= workingDaysNeeded) lastLeaveDay = new Date(cur);
    }

    if (workingDaysCounted < workingDaysNeeded) cur.setDate(cur.getDate() + 1);
  }

  if (!lastLeaveDay) {
    throw new BadRequestException(
      'Impossible de calculer la date de retour — période de recherche dépassée.',
    );
  }

  const returnDate = new Date(lastLeaveDay);
  returnDate.setDate(returnDate.getDate() + 1);

  return {
    startDate: formatDate(startDate),
    workingDaysNeeded,
    lastLeaveDay: formatDate(lastLeaveDay),
    returnDate: formatDate(returnDate),
    excludedHolidays,
    sundaysSkipped,
  };
}