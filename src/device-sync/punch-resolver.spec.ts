// 📁 EMPLACEMENT (projet backend) : src/device-sync/punch-resolver.spec.ts
import { resolveDay } from './punch-resolver';

const t = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00.000Z`);
const p = (id: string, hhmm: string) => ({ id, punchedAt: t(hhmm) });

describe('resolveDay', () => {
  it('entrée = premier passage, sortie = dernier', () => {
    const r = resolveDay([p('a', '07:55'), p('b', '12:01'), p('c', '13:02'), p('d', '17:10')])!;
    expect(r.kind).toBe('COMPLETE');
    expect(r.checkIn).toEqual(t('07:55'));
    expect(r.checkOut).toEqual(t('17:10'));
    expect(r.keptIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignore un double badgeage rapproché', () => {
    const r = resolveDay([p('a', '08:00'), p('b', '08:01'), p('c', '17:00')])!;
    expect(r.kind).toBe('COMPLETE');
    expect(r.ignoredIds).toEqual(['b']);
  });

  it('un seul passage → SINGLE, rien d\'inventé', () => {
    const r = resolveDay([p('a', '08:00')])!;
    expect(r.kind).toBe('SINGLE');
    expect(r.checkOut).toBeUndefined();
  });

  it('deux passages trop proches → SINGLE', () => {
    expect(resolveDay([p('a', '08:00'), p('b', '08:05')])!.kind).toBe('SINGLE');
  });

  it('ordre d\'arrivée quelconque', () => {
    const r = resolveDay([p('c', '17:00'), p('a', '08:00')])!;
    expect(r.checkIn).toEqual(t('08:00'));
    expect(r.checkOut).toEqual(t('17:00'));
  });

  it('liste vide → null', () => expect(resolveDay([])).toBeNull());
});