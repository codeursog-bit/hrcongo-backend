// Planning de congés : calcul déterministe, sans base ni modèle.
import { planLeaves, type PlanEmployee, type PlanLeave } from '../src/assistant/leave-planner';

let ok = 0, ko = 0;
const t = (name: string, cond: boolean) => {
  if (cond) ok++;
  else {
    ko++;
    console.log('ECHEC ' + name);
  }
};
const D = (s: string) => new Date(s + 'T00:00:00Z');
const base = {
  periodStart: D('2026-12-01'),
  periodEnd: D('2027-01-01'),
  workDays: [1, 2, 3, 4, 5],
  holidays: new Set(['2026-12-25']),
  deptSize: new Map([['A', 8], ['B', 2]]),
};
const emp = (id: string, dept: string, hire: string, remaining: number, lastReturn: string | null = null): PlanEmployee => ({
  id, departmentId: dept, hireDate: D(hire), remaining, lastReturn: lastReturn ? D(lastReturn) : null,
});

// 1. priorité : solde puis ancienneté
let r = planLeaves({ ...base, employees: [emp('e1', 'A', '2020-01-01', 12), emp('e2', 'A', '2015-01-01', 20), emp('e3', 'A', '2010-01-01', 12)], leaves: [] });
t('3 propositions', r.proposals.length === 3);
const order = [...r.proposals].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
t('périodes ≤ 10 jours ouvrés', order.every((p) => p.workingDays <= 10));
// capacité département A : 8 × 25 % = 2 absents simultanés au plus
const overlap = (a: any, b: any) => a.start <= b.end && b.start <= a.end;
const simult = r.proposals.filter((p) => r.proposals.some((q) => q !== p && overlap(p, q))).length;
t('capacité département respectée (≤ 2 en même temps)', !(r.proposals.length === 3 && r.proposals.filter((p) => overlap(p, r.proposals[0])).length > 2) && simult >= 0);
t('premier servi : e2 (solde 20) commence en premier jour ouvré', r.proposals.find((p) => p.employeeId === 'e2')!.start.toISOString().slice(0, 10) === '2026-12-01');
// 2. département de 2 personnes : une seule absente à la fois (cap = max(1, 0))
r = planLeaves({ ...base, employees: [emp('b1', 'B', '2018-01-01', 10), emp('b2', 'B', '2019-01-01', 10)], leaves: [] });
const [p1, p2] = r.proposals;
t('département de 2 : pas de chevauchement', r.proposals.length === 2 && !overlap(p1, p2));
// 3. exclusions
r = planLeaves({
  ...base,
  employees: [emp('x1', 'A', '2018-01-01', 15), emp('x2', 'A', '2018-01-01', 3), emp('x3', 'A', '2018-01-01', 15, '2026-11-20'), emp('x4', 'A', '2018-01-01', 15)],
  leaves: [{ employeeId: 'x4', departmentId: 'A', start: D('2026-12-14'), end: D('2026-12-18') } as PlanLeave],
});
t('x1 seul proposé', r.proposals.length === 1 && r.proposals[0].employeeId === 'x1');
t('compteurs exclusions', r.lowBalance === 1 && r.recentlyBack === 1 && r.alreadyOnLeave === 1);
// 4. jours fériés et week-ends non comptés
r = planLeaves({ ...base, periodStart: D('2026-12-21'), employees: [emp('h1', 'A', '2018-01-01', 6)], leaves: [] });
const h = r.proposals[0];
// du 21/12 : 21, 22, 23, 24, (25 férié), 28, 29 → 6 jours ouvrés, fin le 29/12
t('jours fériés et week-ends non comptés', h && h.workingDays === 6 && h.start.toISOString().slice(0, 10) === '2026-12-21' && h.end.toISOString().slice(0, 10) === '2026-12-29');
// 5. déterminisme
const a = JSON.stringify(planLeaves({ ...base, employees: [emp('d1', 'A', '2019-01-01', 9), emp('d2', 'A', '2019-01-01', 9)], leaves: [] }));
const b = JSON.stringify(planLeaves({ ...base, employees: [emp('d2', 'A', '2019-01-01', 9), emp('d1', 'A', '2019-01-01', 9)], leaves: [] }));
t('résultat identique quel que soit l’ordre d’entrée', a === b);
// 6. plafond de propositions
r = planLeaves({ ...base, max: 2, employees: Array.from({ length: 6 }, (_, i) => emp('m' + i, 'A', '2018-01-01', 10)), leaves: [] });
t('max respecté', r.proposals.length <= 2);
// 7. aucun créneau
r = planLeaves({ ...base, periodEnd: D('2026-12-03'), deptSize: new Map([['B', 2]]), employees: [emp('n1', 'B', '2018-01-01', 10)], leaves: [{ employeeId: 'z', departmentId: 'B', start: D('2026-11-01'), end: D('2027-02-28') }] });
t('aucun créneau signalé', r.proposals.length === 0 && r.noSlot === 1);
console.log(`OK ${ok} KO ${ko}`);
process.exit(ko ? 1 : 0);