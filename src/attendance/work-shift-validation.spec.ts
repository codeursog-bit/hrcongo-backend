import { buildShiftUpdate } from './work-shift-validation';

describe('Work shift boundaries', () => {
  const previous = { name: 'QA', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 };
  it('recomputes duration for minute-only edits', () => {
    expect(buildShiftUpdate({ startMinute: 30 }, previous).durationHours).toBe(7.5);
  });
  it('handles overnight shifts and midnight', () => {
    expect(buildShiftUpdate({ startHour: 23, endHour: 7 }, previous)).toMatchObject({ durationHours: 8, crossesMidnight: true });
    expect(buildShiftUpdate({ startHour: 0, endHour: 8 }, previous).durationHours).toBe(8);
  });
  it.each([{ companyId: 'foreign' }, { company: {} }, { id: 'foreign' }, { startHour: 99 }, { endHour: -1 }, { startMinute: 60 }, { startHour: null }, { isDefault: 'true' }])('rejects foreign fields and invalid times', input => {
    expect(() => buildShiftUpdate(input, previous)).toThrow();
  });
  it('does not trust client-calculated duration', () => {
    expect(buildShiftUpdate({ durationHours: -999, crossesMidnight: true }, previous)).toMatchObject({ durationHours: 8, crossesMidnight: false });
  });
});
