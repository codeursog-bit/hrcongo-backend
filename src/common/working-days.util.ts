// ============================================================================
// 📁 src/common/working-days.util.ts
// ✅ Moteur "jours ouvrables" partagé — congé annuel ET absences utilisent le
//    même calcul : les jours travaillés CONFIGURÉS par l'entreprise (repli
//    lundi-vendredi) et ses jours fériés sont ignorés ; la reprise tombe
//    toujours sur le prochain jour travaillé.
// ============================================================================

import { normalizeWorkDays } from './utils/work-days';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compte les jours ouvrables (jours travaillés de l'entreprise, hors fériés) entre deux dates incluses. */
export async function calculateWorkingDays(
  prisma: PrismaService,
  companyId: string,
  start: Date,
  end: Date,
  // Optionnel — jours travaillés de l'entreprise (0=dim … 6=sam). Absent =
  // lus dans la configuration de l'entreprise.
  workDays?: number[],
): Promise<number> {
  if (!workDays) workDays = await getCompanyWorkDays(prisma, companyId);
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
    const isWorkDay = workDays.includes(dow);
    if (isWorkDay && !holidaySet.has(ds)) count++;
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
  // Optionnels — par défaut : reprise = prochain jour travaillé (saute repos +
  // fériés) et jours travaillés lus dans la configuration de l'entreprise.
  returnOnNextWorkingDay = true,
  workDays?: number[],            // jours travaillés de l'entreprise (0=dim … 6=sam)
) {
  if (!workDays) workDays = await getCompanyWorkDays(prisma, companyId);
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

    const isRestDay = !workDays.includes(dow);
    if (isRestDay) {
      sundaysSkipped++; // = jours de repos sautés (dimanche par défaut, ou selon la config entreprise)
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
  if (returnOnNextWorkingDay) {
    for (let i = 0; i < 30; i++) {
      const d = returnDate.getDay();
      const rest = !workDays.includes(d);
      if (!rest && !holidayMap.has(formatDate(returnDate))) break;
      returnDate.setDate(returnDate.getDate() + 1);
    }
  }

  return {
    startDate: formatDate(startDate),
    workingDaysNeeded,
    lastLeaveDay: formatDate(lastLeaveDay),
    returnDate: formatDate(returnDate),
    excludedHolidays,
    sundaysSkipped,
  };
}

/**
 * 🆕 Jour de REPRISE réel = premier jour travaillé APRÈS le dernier jour d'absence
 * (`lastAbsenceDay`, inclus, tel qu'enregistré dans `endDate`).
 * Repos hebdomadaires de l'entreprise (`workDays`) et jours fériés (`holidaySet`,
 * dates « YYYY-MM-DD ») sautés. Fonction pure : le chargement des jours travaillés
 * et des fériés se fait une seule fois par l'appelant (voir attachReturnDates).
 */
export function nextWorkingDay(
  lastAbsenceDay: Date,
  workDays: number[] | undefined,
  holidaySet: Set<string>,
): string {
  const cur = new Date(lastAbsenceDay);
  for (let i = 0; i < 60; i++) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    const rest = workDays ? !workDays.includes(dow) : dow === 0;
    if (!rest && !holidaySet.has(formatDate(cur))) break;
  }
  return formatDate(cur);
}

// ============================================================================
// 🆕 JOURS TRAVAILLÉS DE L'ENTREPRISE (configuration paie)
// ============================================================================

/** Jours travaillés configurés (0=dim … 6=sam). Défaut : lundi-vendredi. */
export async function getCompanyWorkDays(
  prisma: PrismaService,
  companyId: string,
): Promise<number[]> {
  const ps = await prisma.payrollSettings.findFirst({
    where: { companyId },
    orderBy: { effectiveDate: 'desc' },
    select: { workDays: true },
  });
  return normalizeWorkDays(ps?.workDays); // 🕐 dimanche = 0, repli Lun–Ven
}

// ============================================================================
// 🆕 COUVERTURE D'UNE ABSENCE (Modèle 2 — droits conventionnels)
// ----------------------------------------------------------------------------
// Une demande peut couvrir PLUS de jours que le droit conventionnel (ex :
// mariage = 4 jours, l'employé demande du 1er au 6). Seuls les N premiers
// jours ouvrables (selon la config de l'entreprise, hors fériés) sont
// "justifiés" (= `coveredDays`). Les jours au-delà ne sont PAS bloqués : ils
// suivent la règle normale du pointage (présent si l'employé vient, absent
// non justifié sinon).
//
// coveredDays = null  → toute la période est couverte (absence hors catalogue,
//                       et anciennes demandes d'avant cette évolution).
// ============================================================================

/** Jours (YYYY-MM-DD) justifiés d'une période. `null` = toute la période couverte. */
export function computeCoveredDates(
  start: Date,
  end: Date,
  coveredDays: number | null | undefined,
  holidaySet: Set<string>,
  workDays: number[],
): Set<string> | null {
  if (coveredDays === null || coveredDays === undefined) return null;
  const limit = Number(coveredDays);
  const covered = new Set<string>();
  let counted = 0;
  const cur = new Date(start);
  while (cur <= end && counted < limit) {
    const ds = formatDate(cur);
    if (workDays.includes(cur.getDay()) && !holidaySet.has(ds)) {
      covered.add(ds);
      counted++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return covered;
}

/**
 * Charge fériés + jours travaillés une seule fois puis calcule, pour chaque
 * demande, l'ensemble des jours justifiés. Map<requestId, Set<date> | null>
 * (null = tout couvert).
 */
export async function loadCoveredDatesMap(
  prisma: PrismaService,
  companyId: string,
  requests: Array<{ id: string; startDate: Date; endDate: Date; coveredDays?: any }>,
): Promise<Map<string, Set<string> | null>> {
  const result = new Map<string, Set<string> | null>();
  const partial = requests.filter((r) => r.coveredDays !== null && r.coveredDays !== undefined);

  let holidaySet = new Set<string>();
  let workDays: number[] = [1, 2, 3, 4, 5];
  if (partial.length > 0) {
    const years = new Set<number>();
    partial.forEach((r) => {
      for (let y = new Date(r.startDate).getFullYear(); y <= new Date(r.endDate).getFullYear(); y++) years.add(y);
    });
    const [holidays, wd] = await Promise.all([
      prisma.publicHoliday.findMany({
        where: { companyId, year: { in: [...years] } },
        select: { date: true },
      }),
      getCompanyWorkDays(prisma, companyId),
    ]);
    holidaySet = new Set(holidays.map((h) => h.date));
    workDays = wd;
  }

  for (const r of requests) {
    const covered =
      r.coveredDays === null || r.coveredDays === undefined
        ? null
        : computeCoveredDates(new Date(r.startDate), new Date(r.endDate), Number(r.coveredDays), holidaySet, workDays);
    result.set(r.id, covered);
  }
  return result;
}
/**
 * 🆕 Un congé ne peut pas COMMENCER un jour de repos ou férié de l'entreprise :
 * renvoie la date elle-même si c'est un jour travaillé, sinon le premier jour
 * travaillé suivant (jours travaillés + fériés lus dans la configuration).
 * Même forme que `new Date('YYYY-MM-DD')` (minuit UTC) pour rester compatible
 * avec le reste du module.
 */
export async function firstWorkingDayOnOrAfter(
  prisma: PrismaService,
  companyId: string,
  date: Date,
  workDays?: number[],
): Promise<Date> {
  if (!workDays) workDays = await getCompanyWorkDays(prisma, companyId);
  const years = [date.getFullYear(), date.getFullYear() + 1];
  const holidays = await prisma.publicHoliday.findMany({
    where: { companyId, year: { in: years } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.date));
  const cur = new Date(date);
  for (let i = 0; i < 60; i++) {
    if (workDays.includes(cur.getDay()) && !holidaySet.has(formatDate(cur))) break;
    cur.setDate(cur.getDate() + 1);
  }
  return new Date(formatDate(cur));
}

export { formatDate as formatLocalDate };