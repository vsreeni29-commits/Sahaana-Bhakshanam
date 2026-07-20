import { describe, expect, it } from 'vitest';
import {
  deliveryWindowLabel,
  isOrderingOpen,
  istDateString,
  istEpoch,
  mealWindowAt,
  mealDef,
  scheduleAt,
} from '../shared/meals';

// Helper: epoch for an IST wall-clock time on 2026-07-20 (a Monday).
const ist = (h: number, m: number, day = 20) => istEpoch(2026, 7, day, h * 60 + m);

describe('meal session windows (IST)', () => {
  it('opens lunch at exactly 8:00 AM and not a second before', () => {
    expect(isOrderingOpen('lunch', ist(7, 59))).toBeNull();
    expect(isOrderingOpen('lunch', ist(8, 0))).not.toBeNull();
  });

  it('locks lunch at the exact 11:00 AM cutoff boundary', () => {
    expect(isOrderingOpen('lunch', ist(11, 0) - 1000)).not.toBeNull();
    expect(isOrderingOpen('lunch', ist(11, 0))).toBeNull();
    expect(isOrderingOpen('lunch', ist(11, 0) + 1)).toBeNull();
  });

  it('opens breakfast the previous evening at 6:00 PM', () => {
    // At 7 PM on the 19th, breakfast for the 20th is open.
    const w = isOrderingOpen('breakfast', ist(19, 0, 19));
    expect(w).not.toBeNull();
    expect(w?.date).toBe('2026-07-20');
    // At 5:59 PM on the 19th it is not yet open.
    expect(isOrderingOpen('breakfast', ist(17, 59, 19))).toBeNull();
  });

  it('locks breakfast at 7:00 AM sharp', () => {
    expect(isOrderingOpen('breakfast', ist(6, 59))).not.toBeNull();
    expect(isOrderingOpen('breakfast', ist(7, 0))).toBeNull();
  });

  it('locks dinner at 7:30 PM sharp', () => {
    expect(isOrderingOpen('dinner', ist(19, 29))).not.toBeNull();
    expect(isOrderingOpen('dinner', ist(19, 30))).toBeNull();
  });

  it('rolls to the next day after cutoff', () => {
    const w = mealWindowAt(mealDef('lunch')!, ist(11, 0));
    expect(w.status).toBe('upcoming');
    expect(w.date).toBe('2026-07-21');
    expect(w.opensAt).toBe(ist(8, 0, 21));
  });

  it('rejects unknown meals', () => {
    expect(isOrderingOpen('supper', ist(9, 0))).toBeNull();
  });

  it('reports all four fixed sessions', () => {
    const schedule = scheduleAt(ist(9, 0));
    expect(schedule.map((w) => w.mealId)).toEqual(['breakfast', 'lunch', 'snacks', 'dinner']);
    const open = schedule.filter((w) => w.status === 'open').map((w) => w.mealId);
    expect(open).toEqual(['lunch']); // 9:00 AM IST: only lunch ordering is open
  });

  it('formats delivery windows in IST', () => {
    const w = mealWindowAt(mealDef('lunch')!, ist(9, 0));
    expect(deliveryWindowLabel(w)).toBe('12:30 PM–2:00 PM IST');
  });

  it('computes IST dates across the UTC midnight boundary', () => {
    // 01:00 IST on the 20th is 19:30 UTC on the 19th.
    const epoch = istEpoch(2026, 7, 20, 60);
    expect(new Date(epoch).toISOString()).toBe('2026-07-19T19:30:00.000Z');
    expect(istDateString(epoch)).toBe('2026-07-20');
  });
});
