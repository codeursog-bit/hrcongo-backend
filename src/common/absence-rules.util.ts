// ============================================================================
// 📁 src/common/absence-rules.util.ts
// 🆕 Règle UNIQUE « à partir de quand un salarié sans pointage est-il absent AUJOURD'HUI ? »
//
// Décision métier : un salarié est ABSENT dès l'heure officielle de début de sa journée
// s'il n'est pas encore arrivé. Avant cette heure, la journée n'est pas encore « due » :
// il n'est ni présent ni absent (statut FUTURE, case vide).
//
// Heure de référence, par salarié :
//   1. shift planifié pour AUJOURD'HUI (date précise, puis planning récurrent) → heure de début du shift
//   2. sinon → heure officielle de l'entreprise (payroll_settings.officialStartHour/Minute, défaut 08:00)
//
// Fonction PURE vis-à-vis de l'appli : lecture seule via Prisma, aucune dépendance Nest.
// Utilisée par : AttendanceCalculationService (page Présences, rapport, dashboards temps réel)
// et AbsenceTrackingService (suivi des absences) → mêmes chiffres partout.
// ============================================================================

import { congoDateString, congoDayOfWeek, congoMinutesOfDay } from './utils/congo-time';

/** Minutes écoulées depuis minuit (heure du Congo) à l'instant présent. */
export const nowCongoMinutes = (): number => congoMinutesOfDay(new Date());

/**
 * Pour chaque salarié : minute du jour (heure du Congo) à partir de laquelle une absence de
 * pointage compte comme « absent » AUJOURD'HUI.
 * Lecture seule (3 requêtes max pour toute l'entreprise).
 */
export async function loadTodayAbsenceCutoffs(
  prisma: any,
  companyId: string,
  employeeIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;

  const now = new Date();
  const todayStr = congoDateString(now);
  const dow = congoDayOfWeek(now);
  const todayDate = new Date(`${todayStr}T00:00:00.000Z`);

  const [settings, assignments] = await Promise.all([
    prisma.payrollSettings.findFirst({
      where: { companyId },
      orderBy: { effectiveDate: 'desc' },
      select: { officialStartHour: true, officialStartMinute: true } as any,
    }) as Promise<any>,
    prisma.employeeShiftAssignment.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        OR: [
          { specificDate: todayStr },
          {
            specificDate: null,
            dayOfWeek: dow,
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: todayDate } }] },
              { OR: [{ validUntil: null }, { validUntil: { gte: todayDate } }] },
            ],
          },
        ],
      },
      select: {
        employeeId: true,
        specificDate: true,
        createdAt: true,
        shift: { select: { startHour: true, startMinute: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<any[]>,
  ]);

  const official =
    Number(settings?.officialStartHour ?? 8) * 60 + Number(settings?.officialStartMinute ?? 0);

  // Priorité : date précise > planning récurrent (le plus récent d'abord).
  const specific = new Map<string, number>();
  const recurring = new Map<string, number>();
  for (const a of assignments) {
    if (!a.shift) continue;
    const m = Number(a.shift.startHour) * 60 + Number(a.shift.startMinute ?? 0);
    if (a.specificDate) {
      if (!specific.has(a.employeeId)) specific.set(a.employeeId, m);
    } else if (!recurring.has(a.employeeId)) {
      recurring.set(a.employeeId, m);
    }
  }

  for (const id of employeeIds) out.set(id, specific.get(id) ?? recurring.get(id) ?? official);
  return out;
}