/**
 * Écrans et actions de l'application pour Sofia : libellés exacts des boutons, champs et onglets,
 * extraits automatiquement du code de l'interface (scripts/export-app-actions.mjs côté front).
 * Aucun texte n'est écrit à la main : on relance l'export après chaque évolution de l'interface.
 */
import ACTIONS from './data/app-actions.json';
import { pagesFor } from './app-map';
import { tokens } from './match';

export interface Screen {
  path: string;
  titles: string[];
  buttons: string[];
  fields: string[];
  tabs: string[];
}
const SCREENS = ACTIONS as Screen[];
const strip = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
const words = (s: string) => tokens(s).filter((w) => w.length >= 4);
const tidy = (v: string) => v.replace(/\s*\*$/, '').trim();
const norm = (p: string) => p.replace(/\/:[^/]+/g, '/:id');

/** Les écrans les plus proches de la question, avec leurs libellés réels (3 au plus). */
export function screensFor(message: string, max = 3) {
  const q = new Set(words(message));
  const byPath = new Map(SCREENS.map((s) => [norm(s.path), s]));
  const picked = new Map<string, Screen>();
  for (const p of pagesFor(message, max)) {
    const s = byPath.get(norm(p.path));
    if (s) picked.set(s.path, s);
  }
  if (picked.size < max)
    SCREENS.map((s) => {
      const hay = new Set(words([...s.titles, ...s.buttons, ...s.fields].join(' ')));
      let score = 0;
      for (const w of q) if (hay.has(w)) score++;
      return { s, score };
    })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, max - picked.size)
      .forEach((x) => picked.set(x.s.path, x.s));
  return [...picked.values()].map((s) => ({
    page: s.path,
    titres: s.titles.map(tidy).slice(0, 5),
    boutons: s.buttons.map(tidy).slice(0, 12),
    champs: s.fields.map(tidy).slice(0, 12),
    onglets: s.tabs.map(tidy).slice(0, 10),
  }));
}