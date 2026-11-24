// ============================================================================
// 📁 src/common/utils/work-days.ts
// Jours travaillés de l'entreprise — convention UNIQUE : 0 = dimanche … 6 = samedi.
//
// Pourquoi : deux écrans de configuration enregistraient le dimanche différemment
// (Paramètres → Paie : 0 ; Paramètres → Entreprise : 7). Selon l'écran utilisé en dernier,
// le serveur croyait que le dimanche était un jour de repos alors que l'entreprise travaille.
// Ici on accepte les DEUX écritures (7 est lu comme 0), on retire les doublons et on trie.
// ============================================================================
export const DEFAULT_WORK_DAYS_FALLBACK = [1, 2, 3, 4, 5];

export function normalizeWorkDays(raw: unknown, fallback: number[] = DEFAULT_WORK_DAYS_FALLBACK): number[] {
  let arr: unknown = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { return fallback; }
  }
  if (!Array.isArray(arr)) return fallback;
  const out = new Set<number>();
  for (const v of arr) {
    const n = Number(v);
    if (!Number.isInteger(n)) continue;
    if (n === 7) out.add(0);          // dimanche écrit « 7 » → 0
    else if (n >= 0 && n <= 6) out.add(n);
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : fallback;
}