// ============================================================================
// 📁 src/common/utils/congo-time.ts
// 🕐 HEURE DU CONGO (Africa/Brazzaville = UTC+1, sans heure d'été)
//
// Les règles de pointage (retard, arrivée anticipée, fin de journée, nuit, jour de la semaine,
// date du jour) doivent dépendre UNIQUEMENT de l'heure réelle du Congo — jamais du fuseau du
// serveur (UTC sur Render) ni de l'horloge du téléphone de l'employé.
//
// ⚠️ Fuseau fixe (+1 h) volontairement : le Congo n'a pas d'heure d'été, et on évite toute
// dépendance à Intl/ICU (plus rapide et identique sur tous les environnements).
// ============================================================================

export const CONGO_TZ = 'Africa/Brazzaville';
const OFFSET_MS = 3_600_000; // UTC+1
const DAY_MS = 86_400_000;

/** Décale l'instant pour lire les composantes « murales » du Congo via les getters UTC. */
const wall = (d: Date) => new Date(d.getTime() + OFFSET_MS);

export const congoHours = (d: Date): number => wall(d).getUTCHours();
export const congoMinutes = (d: Date): number => wall(d).getUTCMinutes();
export const congoMinutesOfDay = (d: Date): number => congoHours(d) * 60 + congoMinutes(d);

/** 0 = dimanche … 6 = samedi, selon le calendrier du Congo. */
export const congoDayOfWeek = (d: Date): number => wall(d).getUTCDay();

/** 'YYYY-MM-DD' du jour calendaire du Congo. */
export function congoDateString(d: Date = new Date()): string {
  const w = wall(d);
  const y = w.getUTCFullYear();
  const m = String(w.getUTCMonth() + 1).padStart(2, '0');
  const day = String(w.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Instant correspondant à `hour:minute` (heure du Congo) le jour calendaire de `base`.
 * `base` = un instant (Date) ou une date 'YYYY-MM-DD'.
 */
export function atCongoTime(base: Date | string, hour: number, minute = 0): Date {
  let y: number, m: number, d: number;
  if (typeof base === 'string') {
    [y, m, d] = base.slice(0, 10).split('-').map(Number);
  } else {
    const w = wall(base);
    y = w.getUTCFullYear();
    m = w.getUTCMonth() + 1;
    d = w.getUTCDate();
  }
  return new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0) - OFFSET_MS);
}

/** Ajoute n jours (le Congo n'a pas d'heure d'été : 24 h exactes). */
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);