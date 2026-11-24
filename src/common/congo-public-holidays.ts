// ============================================================================
// 📁 src/common/congo-public-holidays.ts
// 🇨🇬 Jours fériés légaux du Congo-Brazzaville (loi n°2-94 du 1er mars 1994 :
//    "fêtes légales, chômées et payées").
//
// Utilisé à la création d'une entreprise pour remplir la table public_holidays
// (lue par les présences, les absences, les congés et la paie).
// ============================================================================

import { Prisma } from '@prisma/client';

export interface CongoHoliday {
  name: string;
  date: string; // YYYY-MM-DD (format attendu par PublicHoliday.date)
}

/** Fériés à date fixe : [mois (1-12), jour, libellé] */
const FIXED_HOLIDAYS: Array<[number, number, string]> = [
  [1, 1, "Jour de l'An"],
  [5, 1, 'Fête du Travail'],
  [6, 10, 'Commémoration de la Conférence nationale souveraine'],
  [8, 15, 'Fête nationale (Indépendance)'],
  [11, 1, 'Toussaint'],
  [12, 25, 'Noël'],
  [11, 28, 'Journée de la République'],
];

/** Dimanche de Pâques (algorithme grégorien de Meeus/Jones/Butcher). */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function toIso(year: number, month: number, day: number): string {
  // UTC pour éviter tout décalage de fuseau
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** Liste des fériés légaux d'une année (fixes + mobiles), triés par date. */
export function getCongoPublicHolidays(year: number): CongoHoliday[] {
  const easter = easterSunday(year);
  const list: CongoHoliday[] = FIXED_HOLIDAYS.map(([m, d, name]) => ({
    name,
    date: toIso(year, m, d),
  }));

  list.push(
    { name: 'Lundi de Pâques', date: toIso(year, easter.month, easter.day + 1) },
    { name: 'Ascension', date: toIso(year, easter.month, easter.day + 39) },
    { name: 'Lundi de Pentecôte', date: toIso(year, easter.month, easter.day + 50) },
  );

  // Une même date ne peut exister qu'une fois par entreprise (unique companyId+date) :
  // si un férié mobile tombe sur un férié fixe (ex : lundi de Pentecôte le 10 juin
  // en 2030), on fusionne les libellés au lieu d'en perdre un.
  const byDate = new Map<string, CongoHoliday>();
  for (const h of list) {
    const existing = byDate.get(h.date);
    if (existing) existing.name = `${existing.name} / ${h.name}`;
    else byDate.set(h.date, { ...h });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Crée les fériés légaux d'une entreprise pour une plage d'années
 * (défaut : année précédente → +5 ans). Idempotent : les dates déjà présentes
 * (unique companyId+date) sont ignorées, donc rien n'est écrasé.
 * Accepte PrismaService ou un client de transaction.
 */
export async function seedCongoPublicHolidays(
  db: Pick<Prisma.TransactionClient, 'publicHoliday'>,
  companyId: string,
  fromYear = new Date().getFullYear() - 1,
  toYear = new Date().getFullYear() + 5,
): Promise<number> {
  const data: Array<{ companyId: string; name: string; date: string; year: number }> = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (const h of getCongoPublicHolidays(year)) {
      data.push({ companyId, name: h.name, date: h.date, year });
    }
  }
  const res = await db.publicHoliday.createMany({ data, skipDuplicates: true });
  return res.count;
}