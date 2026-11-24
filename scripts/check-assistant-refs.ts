// Repères anonymes E1…E30 : la limite ne dépend plus d'un seul chiffre. Aucune base, aucun appel réel.
import { maskCard } from '../src/assistant/result-mask';
import { MARKER_RE } from '../src/assistant/pseudonymizer';
import { MAX_REFS } from '../src/assistant/refs';

let ok = 0, ko = 0;
const t = (name: string, cond: boolean) => {
  if (cond) ok++;
  else {
    ko++;
    console.log('ECHEC ' + name);
  }
};
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    employeeId: 'emp-' + i,
    label: 'Employé ' + i,
    detail: 'solde ' + (i + 1) + ' jours',
    value: i + 1,
    unit: 'jours',
  }));
const card = (n: number) =>
  ({ title: 'Test', period: 'novembre 2026', source: 'x', metrics: [{ label: 'Effectif', value: 40 }], rows: rows(n) }) as any;

t('limite à 30', MAX_REFS === 30);
const r12 = maskCard('top_paid_employees', card(12), 40, new Map());
t('12 lignes acceptées', r12.ok);
const refs12 = r12.ok ? [...r12.refs.keys()] : [];
t('repères E1 à E12', refs12.includes('E1') && refs12.includes('E10') && refs12.includes('E12'));
const r30 = maskCard('top_paid_employees', card(30), 40, new Map());
t('30 lignes acceptées', r30.ok && r30.refs.size >= 30);
const r31 = maskCard('top_paid_employees', card(31), 40, new Map());
t('31 lignes refusées', !r31.ok && (r31 as any).reason === 'too_many_refs');
const found = (s: string) => (s.match(MARKER_RE) || []).join(',');
t('reconnaît E10 et E30', found('E10 E30') === 'E10,E30');
t('ignore E0, E31 et E100', found('E0 E31 E100') === '');
t('reconnaît [[N15]]', found('[[N15]]') === '[[N15]]');
console.log(`OK ${ok} KO ${ko}`);
process.exit(ko ? 1 : 0);