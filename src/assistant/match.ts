/** Rapprochement simple question / mots-clés, insensible aux accents et au pluriel. */
const strip = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sing = (w: string) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w);
export const tokens = (s: string): string[] => strip(s).split(' ').filter(Boolean).map(sing);
export const tokenSet = (s: string) => new Set(tokens(s));
/** Score d'une liste de mots-clés : doublons (pluriel/singulier) ignorés, expressions plus longues plus fortes. */
export const score = (q: Set<string>, keywords: string[]) => {
  const seen = new Set<string>();
  let n = 0;
  for (const k of keywords) {
    const key = tokens(k).join(' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (hits(q, k)) n += key.split(' ').length;
  }
  return n;
};
/** Vrai si tous les mots du mot-clé figurent dans la question (dans n'importe quel ordre). */
export const hits = (q: Set<string>, keyword: string) => {
  const t = tokens(keyword);
  return t.length > 0 && t.every((w) => q.has(w));
};