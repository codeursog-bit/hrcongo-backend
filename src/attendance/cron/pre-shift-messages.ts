// ============================================================================
// 📁 src/attendance/cron/pre-shift-messages.ts
// 💬 Messages du rappel « avant le début du service » — variés, amicaux, jamais
//    deux jours de suite le même texte pour un même employé.
//
// Principe : module PUR (aucun accès base, aucune horloge) → facile à tester.
//  • Le titre et le corps sont tirés séparément → des centaines de combinaisons.
//  • Rotation déterministe par (employé, jour) : chaque employé parcourt TOUT
//    le catalogue avant qu'un texte ne revienne, et ne reçoit jamais le même
//    titre ni le même corps deux jours de suite. Aucun état à stocker : un
//    retry ou un second process redonne exactement le même message.
//  • Point de départ et pas de rotation propres à chaque employé → deux
//    collègues d'une même entreprise ne reçoivent pas le même texte le même jour.
//  • Chaque jour de la semaine a ses petites variantes (lundi « on repart »,
//    mercredi « mi-semaine », vendredi « week-end en vue », dimanche « merci
//    d'être là »…) : un titre OU un corps « du jour » remplace le tirage
//    habituel une fois sur deux, donc le ton change aussi au fil de la semaine.
//  • Le ton s'adapte au moment du rappel (matin / après-midi / soir / nuit),
//    donc une entreprise qui démarre à 3h n'a pas droit à un « Belle matinée ☀️ ».
// ============================================================================

export type DaySlot = 'morning' | 'afternoon' | 'evening' | 'night';

export interface PreShiftMessageInput {
  /** Prénom de l'employé tel qu'en base (la casse est normalisée ici). */
  firstName: string;
  /** Nom commercial de l'entreprise, sinon raison sociale. */
  companyName: string;
  /** Minutes restantes avant le début (≥ 1). */
  minutesLeft: number;
  /** Heure officielle de début de l'entreprise (0-23). */
  startHour: number;
  /** Minute officielle de début (0-59) — 8h30 → startHour 8 + startMinute 30. Défaut : 0. */
  startMinute?: number;
  /** Minute du jour (heure du Congo) au moment de l'envoi, 0-1439. */
  nowMinuteOfDay: number;
  /** Jour de la semaine du service concerné : 0 = dimanche … 6 = samedi. */
  dayOfWeek: number;
  /** Date du service concerné, 'YYYY-MM-DD'. */
  date: string;
  /** Sert à varier les tirages d'un employé à l'autre. */
  employeeId: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
}

interface Ctx {
  name: string;
  company: string;
  mins: string; // « 20 min » / « 1 minute »
  start: string; // « 7h00 »
  ready: string | null; // « prêt » / « prête » / null si genre inconnu
}

type Tpl = (c: Ctx) => string;

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/** « JEAN-pierre » → « Jean-Pierre », « o'neil » → « O'Neil ». */
export function titleCaseName(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function slotOf(minuteOfDay: number): DaySlot {
  const h = Math.floor((((minuteOfDay % 1440) + 1440) % 1440) / 60);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 22) return 'evening';
  return 'night'; // 22h → 4h59 : les services très tôt ou très tard
}

/** FNV-1a 32 bits. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Entier dans [0, n) — déterministe pour une graine donnée. */
function seededIndex(seed: string, n: number): number {
  // mulberry32 sur la graine hachée : bien mieux réparti qu'un simple modulo.
  let t = (hash32(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return Math.floor(r * n);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const strideCache = new Map<number, number[]>();
/** Pas de rotation premiers avec n (donc cycle complet), en évitant 1 et n-1 (ordre « évident »). */
function strides(n: number): number[] {
  let list = strideCache.get(n);
  if (!list) {
    list = [];
    for (let s = 2; s <= n - 2; s++) if (gcd(s, n) === 1) list.push(s);
    if (list.length === 0) list = [1];
    strideCache.set(n, list);
  }
  return list;
}

/**
 * Index dans [0, n) qui change CHAQUE jour et ne revient qu'après n jours :
 * index = départ + jour × pas (mod n), avec pas premier avec n.
 * Deux jours consécutifs → toujours deux index différents (pas ≠ 0 mod n).
 */
function rotatingIndex(n: number, key: string, dayNumber: number): number {
  const base = seededIndex(`${key}|base`, n);
  const list = strides(n);
  const stride = list[seededIndex(`${key}|stride`, list.length)];
  return (base + (((dayNumber % n) + n) % n) * stride) % n;
}

/** Nombre de jours depuis 1970 pour une date 'YYYY-MM-DD'. */
function dayNumberOf(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000);
}

// ─── Titres ──────────────────────────────────────────────────────────────────
// Le prénom est surtout dans les titres (c'est ce qu'on voit en premier).

const TITLES_ANY: Tpl[] = [
  (c) => `⏳ ${c.name}, c'est bientôt l'heure !`,
  (c) => `👋 Coucou ${c.name} !`,
  (c) => `🔔 Petit rappel pour vous, ${c.name}`,
  (c) => `🚀 ${c.name}, on se prépare ?`,
  (c) => `⏰ L'heure approche, ${c.name}`,
  (c) => `😊 ${c.name}, un petit coucou de Konza RH`,
  (c) => `📲 ${c.name}, pensez à votre pointage`,
  () => '🔔 Rappel de pointage',
  () => '⏳ Votre service approche',
  () => '🕐 Bientôt le top départ',
];

const TITLES_BY_SLOT: Record<DaySlot, Tpl[]> = {
  morning: [
    (c) => `🌅 Bonjour ${c.name} !`,
    (c) => `☀️ Belle matinée en vue, ${c.name}`,
    () => '☕ Le café, puis le pointage !',
  ],
  afternoon: [
    (c) => `🌤️ Bon après-midi ${c.name} !`,
    (c) => `☀️ ${c.name}, l'après-midi s'annonce`,
  ],
  evening: [
    (c) => `🌆 Bonsoir ${c.name} !`,
    (c) => `🌙 ${c.name}, le service du soir approche`,
  ],
  night: [
    (c) => `🌙 ${c.name}, déjà debout ?`,
    () => '🦉 Lève-tôt (ou couche-tard) !',
    (c) => `⭐ Courage ${c.name}, ça va bientôt commencer`,
  ],
};

const TITLES_BY_DOW: Partial<Record<number, Tpl[]>> = {
  0: [(c) => `🙏 Merci d'être là ce dimanche, ${c.name}`, () => '🌟 Dimanche de service : respect !'],
  1: [(c) => `💪 Nouvelle semaine, ${c.name} !`, () => '🚀 Lundi : on repart du bon pied'],
  2: [(c) => `⚡ Mardi, ${c.name} : on garde le rythme`, () => '📈 Mardi : la semaine est lancée'],
  3: [(c) => `🌗 Mercredi, ${c.name} : mi-semaine !`, () => '⛰️ Milieu de semaine, on tient bon'],
  4: [(c) => `😉 Jeudi, ${c.name} : demain c'est vendredi`, () => '🌟 Jeudi : le bout du tunnel approche'],
  5: [(c) => `🎉 Vendredi, ${c.name} !`, () => '🙌 Dernière ligne droite avant le week-end'],
  6: [(c) => `☀️ Samedi, ${c.name} : on assure !`, () => '💪 Samedi de service, merci à vous'],
};

// ─── Corps ───────────────────────────────────────────────────────────────────
// Chaque corps contient TOUJOURS l'info utile (heure de début et/ou minutes
// restantes) pour qu'aucune combinaison titre + corps ne soit hors sujet.

const BODIES_ANY: Tpl[] = [
  (c) => `Votre service commence à ${c.start}, dans ${c.mins}. Pensez à pointer votre arrivée 😉`,
  (c) => `Plus que ${c.mins} avant ${c.start}. Un petit pointage dès votre arrivée et c'est parti 🙌`,
  (c) => `${c.company} vous attend à ${c.start} (dans ${c.mins}). Pointez en arrivant ✅`,
  (c) => `Votre équipe chez ${c.company} compte sur vous à ${c.start}. Pointer prend 2 secondes ⚡`,
  (c) => `Début de service à ${c.start}, dans ${c.mins}. Un pointage à l'heure, et vos heures sont bien comptées 😉`,
  (c) => `Rendez-vous à ${c.start} chez ${c.company}. Pointer dès l'arrivée évite les oublis 👍`,
  (c) => `Un dernier café avant ${c.start} ? Votre service démarre dans ${c.mins} ☕`,
  (c) => `Tout est prêt chez ${c.company} 😄 Il ne manque que votre pointage, à ${c.start}.`,
  (c) => `Ça démarre à ${c.start} (dans ${c.mins}). Un petit pointage en arrivant et on n'en parle plus 😊`,
  (c) => `À ${c.start}, pensez à valider votre arrivée sur Konza RH 📲`,
  (c) => `Plus que ${c.mins} ! Pointez dès votre arrivée pour que tout soit bien enregistré 🕐`,
  (c) => `${c.company} démarre à ${c.start}. Pointez à votre arrivée, on s'occupe du reste 🤝`,
  (c) => `Petit rappel amical : début à ${c.start}, dans ${c.mins}. Bonne route si vous êtes en chemin 🚗`,
  (c) => `Gardez votre téléphone sous la main pour pointer à l'arrivée (${c.start}) 📱`,
  (c) => `Bon début de service chez ${c.company} ! Pointage à ${c.start}, dans ${c.mins} 🌟`,
  (c) => `Une journée qui commence bien, c'est une arrivée pointée à l'heure. Rendez-vous à ${c.start} 🎯`,
];

const BODIES_BY_SLOT: Record<DaySlot, Tpl[]> = {
  morning: [
    (c) => `Bien démarrer la matinée, c'est aussi pointer à ${c.start} (dans ${c.mins}) ☀️`,
    (c) => `La matinée chez ${c.company} commence à ${c.start}. Pointez à votre arrivée 🌤️`,
  ],
  afternoon: [
    (c) => `L'après-midi reprend à ${c.start}, dans ${c.mins}. Un petit pointage en arrivant ✅`,
    (c) => `${c.company} vous retrouve à ${c.start}. Pensez à pointer votre arrivée 😊`,
  ],
  evening: [
    (c) => `Service du soir à ${c.start}, dans ${c.mins}. Pointez en arrivant, et bon courage 💪`,
    (c) => `${c.company} compte sur vous ce soir à ${c.start}. Un petit pointage et c'est lancé 🌆`,
  ],
  night: [
    (c) => `Début à ${c.start}, dans ${c.mins}. Respect pour celles et ceux qui démarrent quand tout le monde dort 🌙`,
    (c) => `Service à ${c.start} chez ${c.company}. N'oubliez pas de pointer, on veille avec vous ⭐`,
  ],
};

const BODIES_BY_DOW: Partial<Record<number, Tpl[]>> = {
  0: [(c) => `Dimanche de service : merci d'être là ! Début à ${c.start}, dans ${c.mins} 🌟`],
  1: [(c) => `Lundi, c'est reparti ! Service à ${c.start}, dans ${c.mins} 💪`],
  2: [(c) => `Mardi, on garde le rythme ! Service à ${c.start}, dans ${c.mins} 🚀`],
  3: [(c) => `Mercredi : déjà la moitié de la semaine ! Début à ${c.start}, dans ${c.mins} 🌗`],
  4: [(c) => `Demain c'est vendredi, mais d'abord : service à ${c.start}, dans ${c.mins} 😉`],
  5: [(c) => `Dernière ligne droite avant le week-end 🎉 Début à ${c.start}, dans ${c.mins}.`],
  6: [(c) => `Samedi de service chez ${c.company} : début à ${c.start}, dans ${c.mins}. Merci d'être là 🙏`],
};

// ─── API ─────────────────────────────────────────────────────────────────────

export function buildPreShiftMessage(input: PreShiftMessageInput): { title: string; body: string } {
  const slot = slotOf(input.nowMinuteOfDay);
  const mins = input.minutesLeft <= 1 ? '1 minute' : `${input.minutesLeft} min`;

  const g = input.gender;
  const ctx: Ctx = {
    name: titleCaseName(input.firstName) || 'vous',
    company: input.companyName.trim() || 'votre entreprise',
    mins,
    start: `${input.startHour}h${String(input.startMinute ?? 0).padStart(2, '0')}`,
    ready: g === 'FEMALE' ? 'prête' : g === 'MALE' ? 'prêt' : null,
  };

  // Catalogues de base : stables d'un jour à l'autre (condition de la rotation sans répétition).
  const titles: Tpl[] = [...TITLES_ANY, ...TITLES_BY_SLOT[slot]];
  if (ctx.ready) titles.push((c) => `📍 ${c.name}, ${c.ready} à pointer ?`);
  const bodies: Tpl[] = [...BODIES_ANY, ...BODIES_BY_SLOT[slot]];

  const day = dayNumberOf(input.date);
  let title = titles[rotatingIndex(titles.length, `${input.employeeId}|title`, day)];
  let body = bodies[rotatingIndex(bodies.length, `${input.employeeId}|body`, day)];

  // Variante « du jour » : un titre OU un corps spécifique au jour de la semaine, une fois sur deux.
  const roll = seededIndex(`${input.employeeId}|flavor|${input.date}`, 100);
  const dowTitles = TITLES_BY_DOW[input.dayOfWeek];
  const dowBodies = BODIES_BY_DOW[input.dayOfWeek];
  if (dowTitles && roll < 25) {
    title = dowTitles[seededIndex(`${input.employeeId}|dt|${input.date}`, dowTitles.length)];
  } else if (dowBodies && roll >= 25 && roll < 50) {
    body = dowBodies[seededIndex(`${input.employeeId}|db|${input.date}`, dowBodies.length)];
  }

  return { title: title(ctx), body: body(ctx) };
}