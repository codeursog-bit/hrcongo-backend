import { adviseRequest, type AdvisorContext } from './request-advisor';

const D = (s: string) => new Date(s + 'T00:00:00Z');
const weekday = (d: Date) => ![0, 6].includes(d.getUTCDay());
const ctx = (over: Partial<AdvisorContext> = {}): AdvisorContext => ({
  deptSize: 8,
  colleagueAbsences: [],
  pendingOverlaps: 0,
  history: { absenceRequests90d: 0, absenceDays90d: 0, unjustifiedDays90d: 0, permissions30d: 0 },
  isWorkingDay: weekday,
  ...over,
});
const week = { start: D('2026-12-07'), end: D('2026-12-11') };
const busy = [
  { start: D('2026-12-07'), end: D('2026-12-18') },
  { start: D('2026-12-09'), end: D('2026-12-11') },
];

describe('adviseRequest', () => {
  it('avis favorable quand le département est couvert', () => {
    const r = adviseRequest(
      { kind: 'LEAVE', ...week, days: 5, leaveType: 'ANNUAL' },
      ctx({ balanceRemaining: 20 }),
    );
    expect(r.verdict).toBe('FAVORABLE');
  });

  it('repousse et propose une période libre quand trop de collègues sont absents', () => {
    const r = adviseRequest(
      { kind: 'LEAVE', ...week, days: 5, leaveType: 'ANNUAL' },
      ctx({ colleagueAbsences: busy, balanceRemaining: 20 }),
    );
    expect(r.verdict).toBe('DEFER');
    expect(r.alternative?.start.toISOString().slice(0, 10)).toBe('2026-12-14');
  });

  it('ne repousse jamais un motif urgent ou un droit', () => {
    const urgent = adviseRequest(
      { kind: 'ABSENCE', start: D('2026-12-09'), end: D('2026-12-10'), days: 2, urgent: true },
      ctx({ colleagueAbsences: busy }),
    );
    expect(urgent.verdict).toBe('URGENT');
    expect(urgent.alternative).toBeNull();
    const legal = adviseRequest(
      { kind: 'LEAVE', ...week, days: 5, leaveType: 'MATERNITY', legalRight: true },
      ctx({ colleagueAbsences: busy }),
    );
    expect(legal.verdict).toBe('URGENT');
  });

  it('signale un historique d’absences sans l’utiliser contre un droit', () => {
    const history = { absenceRequests90d: 4, absenceDays90d: 8, unjustifiedDays90d: 2, permissions30d: 0 };
    const r = adviseRequest(
      { kind: 'ABSENCE', start: D('2027-02-01'), end: D('2027-02-01'), days: 1 },
      ctx({ history }),
    );
    expect(r.verdict).toBe('RESERVE');
    expect(r.findings.map((f) => f.code)).toContain('FREQUENT_ABSENCES');
    const legal = adviseRequest(
      { kind: 'ABSENCE', start: D('2027-02-01'), end: D('2027-02-01'), days: 1, legalRight: true },
      ctx({ history }),
    );
    expect(legal.findings.map((f) => f.code)).not.toContain('FREQUENT_ABSENCES');
  });

  it('réserve une permission trop longue ou trop fréquente', () => {
    const r = adviseRequest(
      {
        kind: 'PERMISSION',
        start: new Date('2026-12-07T09:00:00Z'),
        end: new Date('2026-12-07T15:00:00Z'),
        days: 0,
      },
      ctx({ history: { absenceRequests90d: 0, absenceDays90d: 0, unjustifiedDays90d: 0, permissions30d: 5 } }),
    );
    expect(r.verdict).toBe('RESERVE');
    expect(r.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['LONG_PERMISSION', 'FREQUENT_PERMISSIONS']),
    );
  });

  it('prévient quand l’employé est seul dans son département', () => {
    const r = adviseRequest(
      { kind: 'LEAVE', ...week, days: 5, leaveType: 'ANNUAL' },
      ctx({ deptSize: 1, balanceRemaining: 20 }),
    );
    expect(r.verdict).toBe('RESERVE');
  });
});