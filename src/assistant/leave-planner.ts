/**
 * Proposition de planning de congés : calcul déterministe, sans modèle d'IA ni accès direct à la base.
 * Le modèle ne voit jamais les soldes ni les dates : il ne fait que commenter le résultat, et le
 * serveur remet les vrais noms et chiffres. Ce n'est qu'une suggestion : aucune demande de congé
 * n'est créée, et la décision reste à la direction selon l'activité.
 *
 * Règles (volontairement simples et lisibles) :
 *  - on ne propose que les employés dont le solde restant atteint `minRemaining` jours ;
 *  - on écarte ceux déjà en congé sur la période ou revenus depuis moins de `recentReturnDays` jours ;
 *  - priorité : solde le plus élevé, puis ancienneté la plus grande ;
 *  - dans un même département, au plus max(1, 25 % de l'effectif) personnes absentes le même jour ;
 *  - une période proposée dure au plus `maxDays` jours ouvrés, et jamais plus que le solde.
 */
export interface PlanEmployee {
  id: string;
  departmentId: string;
  hireDate: Date;
  remaining: number;
  /** Jours d'ancienneté acquis (dans le solde restant), pour la répartition base / ancienneté. */
  seniorityDays?: number;
  lastReturn: Date | null;
}
export interface PlanLeave {
  employeeId: string;
  departmentId: string;
  start: Date;
  end: Date; // dernier jour d'absence, inclus
}
export interface PlanInput {
  periodStart: Date; // inclus
  periodEnd: Date; // exclu
  employees: PlanEmployee[];
  leaves: PlanLeave[];
  workDays: number[]; // 0 = dimanche … 6 = samedi
  holidays: Set<string>; // AAAA-MM-JJ
  deptSize: Map<string, number>;
  minRemaining?: number;
  maxDays?: number;
  recentReturnDays?: number;
  max?: number;
}
export interface PlanProposal {
  employeeId: string;
  start: Date;
  end: Date; // dernier jour d'absence, inclus
  workingDays: number;
  remaining: number;
  seniorityDays: number;
  seniorityYears: number;
}
export interface PlanResult {
  proposals: PlanProposal[];
  eligible: number;
  alreadyOnLeave: number;
  recentlyBack: number;
  lowBalance: number;
  noSlot: number;
}
const DAY = 86400000;
const key = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const seniorityYears = (hire: Date, at: Date) =>
  Math.max(0, Math.floor((at.getTime() - hire.getTime()) / (365.25 * DAY)));

export function planLeaves(p: PlanInput): PlanResult {
  const minRemaining = p.minRemaining ?? 5,
    maxDays = p.maxDays ?? 10,
    recent = p.recentReturnDays ?? 45,
    max = p.max ?? 20;
  const result: PlanResult = {
    proposals: [],
    eligible: 0,
    alreadyOnLeave: 0,
    recentlyBack: 0,
    lowBalance: 0,
    noSlot: 0,
  };
  const worked = new Set(p.workDays);
  const isWorking = (d: Date) => worked.has(d.getUTCDay()) && !p.holidays.has(key(d));
  // Jours ouvrés de la période, puis une marge pour que les dernières périodes puissent déborder.
  const days: Date[] = [];
  for (let d = p.periodStart; d < addDays(p.periodEnd, 45); d = addDays(d, 1))
    if (isWorking(d)) days.push(d);
  const startIdx = days.findIndex((d) => d >= p.periodStart);
  const lastStartIdx = days.filter((d) => d < p.periodEnd).length - 1;
  // Occupation existante par département et par jour (congés approuvés).
  const busy = new Map<string, Map<string, number>>();
  const mark = (dept: string, k: string) => {
    const m = busy.get(dept) || new Map<string, number>();
    m.set(k, (m.get(k) || 0) + 1);
    busy.set(dept, m);
  };
  const onLeave = new Set<string>();
  for (const l of p.leaves) {
    if (l.start < p.periodEnd && l.end >= p.periodStart) onLeave.add(l.employeeId);
    for (const d of days) if (d >= l.start && d <= l.end) mark(l.departmentId, key(d));
  }
  const candidates = p.employees.filter((e) => {
    if (onLeave.has(e.id)) return (result.alreadyOnLeave++, false);
    if (e.lastReturn && p.periodStart.getTime() - e.lastReturn.getTime() < recent * DAY)
      return (result.recentlyBack++, false);
    if (!(e.remaining >= minRemaining)) return (result.lowBalance++, false);
    return true;
  });
  result.eligible = candidates.length;
  candidates.sort(
    (a, b) =>
      b.remaining - a.remaining ||
      a.hireDate.getTime() - b.hireDate.getTime() ||
      a.id.localeCompare(b.id),
  );
  for (const e of candidates) {
    if (result.proposals.length >= max) break;
    const length = Math.min(maxDays, Math.floor(e.remaining));
    const cap = Math.max(1, Math.floor((p.deptSize.get(e.departmentId) || 1) * 0.25));
    const occupied = busy.get(e.departmentId) || new Map<string, number>();
    let chosen = -1;
    for (let s = Math.max(0, startIdx); s <= lastStartIdx && chosen < 0; s++) {
      if (s + length > days.length) break;
      let free = true;
      for (let k = s; k < s + length; k++)
        if ((occupied.get(key(days[k])) || 0) >= cap) {
          free = false;
          break;
        }
      if (free) chosen = s;
    }
    if (chosen < 0) {
      result.noSlot++;
      continue;
    }
    for (let k = chosen; k < chosen + length; k++) mark(e.departmentId, key(days[k]));
    result.proposals.push({
      employeeId: e.id,
      start: days[chosen],
      end: days[chosen + length - 1],
      workingDays: length,
      remaining: e.remaining,
      seniorityDays: e.seniorityDays ?? 0,
      seniorityYears: seniorityYears(e.hireDate, p.periodStart),
    });
  }
  result.proposals.sort((a, b) => a.start.getTime() - b.start.getTime() || a.employeeId.localeCompare(b.employeeId));
  return result;
}