// 📁 EMPLACEMENT (projet backend) : src/device-sync/punch-resolver.ts
// ============================================================================
// ✅ Logique PURE (aucune base de données) : à partir des passages bruts d'un
//    employé sur UNE journée, décide entrée / sortie.
//    Isolée exprès pour être testable sans démarrer Nest.
//
// Règles (v1) :
//  1. Deux passages à moins de DEBOUNCE_MINUTES = un seul (double badgeage).
//  2. ≥ 2 passages distincts espacés d'au moins MIN_SPAN_MINUTES
//       → entrée = le premier, sortie = le dernier (les passages du milieu,
//         ex. pause déjeuner, sont conservés mais n'influencent pas le calcul).
//  3. Sinon → journée « SINGLE » (un seul passage) : on n'invente RIEN.
//     Le service la marque INCOMPLETE (jour passé) ou la laisse en attente
//     (jour en cours, l'employé est peut-être encore au travail).
// ============================================================================

export const DEBOUNCE_MINUTES = 3;
export const MIN_SPAN_MINUTES = 10;

export interface PunchLike {
  id: string;
  punchedAt: Date;
}

export interface DayResolution {
  kind: 'COMPLETE' | 'SINGLE';
  /** Premier passage retenu. */
  checkIn: Date;
  /** Dernier passage retenu (uniquement si COMPLETE). */
  checkOut?: Date;
  /** Passages pris en compte (premier, intermédiaires, dernier). */
  keptIds: string[];
  /** Doubles badgeages écartés. */
  ignoredIds: string[];
}

export function resolveDay(
  punches: PunchLike[],
  opts: { debounceMinutes?: number; minSpanMinutes?: number } = {},
): DayResolution | null {
  if (punches.length === 0) return null;
  const debounceMs = (opts.debounceMinutes ?? DEBOUNCE_MINUTES) * 60_000;
  const minSpanMs = (opts.minSpanMinutes ?? MIN_SPAN_MINUTES) * 60_000;

  const sorted = [...punches].sort(
    (a, b) => a.punchedAt.getTime() - b.punchedAt.getTime() || a.id.localeCompare(b.id),
  );

  const kept: PunchLike[] = [];
  const ignoredIds: string[] = [];
  for (const p of sorted) {
    const last = kept[kept.length - 1];
    if (last && p.punchedAt.getTime() - last.punchedAt.getTime() < debounceMs) {
      ignoredIds.push(p.id);
    } else {
      kept.push(p);
    }
  }

  const first = kept[0];
  const last = kept[kept.length - 1];
  const keptIds = kept.map((p) => p.id);

  if (kept.length >= 2 && last.punchedAt.getTime() - first.punchedAt.getTime() >= minSpanMs) {
    return { kind: 'COMPLETE', checkIn: first.punchedAt, checkOut: last.punchedAt, keptIds, ignoredIds };
  }
  return { kind: 'SINGLE', checkIn: first.punchedAt, keptIds, ignoredIds };
}

/** Groupe des passages par clé (ex. `${employeeId}|${date}`). */
export function groupBy<T>(items: T[], keyOf: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const arr = out.get(k);
    if (arr) arr.push(it);
    else out.set(k, [it]);
  }
  return out;
}