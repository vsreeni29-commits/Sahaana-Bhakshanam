/**
 * Fixed meal sessions for Sahaana Bhakshanam. All times are Asia/Kolkata (IST,
 * UTC+05:30, no DST). These timings are rigid: the chef can only toggle a
 * session's availability, never its schedule.
 *
 * This module is pure and shared by the Worker (authoritative checks) and the
 * web client (display + countdowns). The server always recomputes eligibility
 * with its own clock; the browser clock never decides anything.
 */

export const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MealId = 'breakfast' | 'lunch' | 'snacks' | 'dinner';

export interface MealDef {
  id: MealId;
  label: string;
  /** Ordering opens the previous IST day at openMin. */
  opensPreviousDay: boolean;
  /** Minutes after IST midnight. */
  openMin: number;
  cutoffMin: number;
  deliveryStartMin: number;
  deliveryEndMin: number;
}

export const MEALS: readonly MealDef[] = [
  {
    id: 'breakfast',
    label: 'Breakfast',
    opensPreviousDay: true,
    openMin: 18 * 60, // previous day 6:00 PM
    cutoffMin: 7 * 60, // 7:00 AM
    deliveryStartMin: 7 * 60 + 30,
    deliveryEndMin: 9 * 60 + 30,
  },
  {
    id: 'lunch',
    label: 'Lunch',
    opensPreviousDay: false,
    openMin: 8 * 60, // 8:00 AM
    cutoffMin: 11 * 60, // 11:00 AM
    deliveryStartMin: 12 * 60 + 30,
    deliveryEndMin: 14 * 60,
  },
  {
    id: 'snacks',
    label: 'Evening Snacks',
    opensPreviousDay: false,
    openMin: 12 * 60, // 12:00 PM
    cutoffMin: 16 * 60, // 4:00 PM
    deliveryStartMin: 16 * 60 + 30,
    deliveryEndMin: 18 * 60,
  },
  {
    id: 'dinner',
    label: 'Dinner',
    opensPreviousDay: false,
    openMin: 15 * 60, // 3:00 PM
    cutoffMin: 19 * 60 + 30, // 7:30 PM
    deliveryStartMin: 19 * 60 + 30,
    deliveryEndMin: 21 * 60 + 30,
  },
] as const;

export const MEAL_IDS: readonly MealId[] = MEALS.map((m) => m.id);

export function mealDef(id: string): MealDef | undefined {
  return MEALS.find((m) => m.id === id);
}

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  minuteOfDay: number;
}

export function istParts(epochMs: number): IstParts {
  const d = new Date(epochMs + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** Epoch ms for an IST wall-clock instant (minuteOfDay past IST midnight). */
export function istEpoch(year: number, month: number, day: number, minuteOfDay: number): number {
  return Date.UTC(year, month - 1, day, 0, minuteOfDay) - IST_OFFSET_MS;
}

/** IST calendar date string yyyy-mm-dd for an epoch instant. */
export function istDateString(epochMs: number): string {
  const p = istParts(epochMs);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

export type MealStatus = 'open' | 'upcoming';

export interface MealWindow {
  mealId: MealId;
  label: string;
  /** IST serving/delivery date yyyy-mm-dd. */
  date: string;
  opensAt: number;
  cutoffAt: number;
  deliveryStartAt: number;
  deliveryEndAt: number;
  /** 'open' iff opensAt <= now < cutoffAt. */
  status: MealStatus;
}

function windowFor(meal: MealDef, year: number, month: number, day: number): Omit<MealWindow, 'status'> {
  const dayStart = istEpoch(year, month, day, 0);
  const opensAt =
    istEpoch(year, month, day, meal.openMin) - (meal.opensPreviousDay ? DAY_MS : 0);
  return {
    mealId: meal.id,
    label: meal.label,
    date: istDateString(dayStart),
    opensAt,
    cutoffAt: istEpoch(year, month, day, meal.cutoffMin),
    deliveryStartAt: istEpoch(year, month, day, meal.deliveryStartMin),
    deliveryEndAt: istEpoch(year, month, day, meal.deliveryEndMin),
  };
}

/**
 * The next relevant ordering window for a meal at instant `now`:
 * today's window while now < today's cutoff, otherwise tomorrow's.
 * A window is 'open' only inside [opensAt, cutoffAt).
 */
export function mealWindowAt(meal: MealDef, now: number): MealWindow {
  const today = istParts(now);
  let w = windowFor(meal, today.year, today.month, today.day);
  if (now >= w.cutoffAt) {
    const tomorrow = istParts(now + DAY_MS);
    w = windowFor(meal, tomorrow.year, tomorrow.month, tomorrow.day);
  }
  const status: MealStatus = now >= w.opensAt && now < w.cutoffAt ? 'open' : 'upcoming';
  return { ...w, status };
}

export function scheduleAt(now: number): MealWindow[] {
  return MEALS.map((m) => mealWindowAt(m, now));
}

/** True only when ordering for this meal is open at `now` (server-side check). */
export function isOrderingOpen(mealId: string, now: number): MealWindow | null {
  const def = mealDef(mealId);
  if (!def) return null;
  const w = mealWindowAt(def, now);
  return w.status === 'open' ? w : null;
}

export function formatIstTime(epochMs: number): string {
  const p = istParts(epochMs);
  let h = Math.floor(p.minuteOfDay / 60);
  const min = p.minuteOfDay % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
}

export function deliveryWindowLabel(w: MealWindow): string {
  return `${formatIstTime(w.deliveryStartAt)}–${formatIstTime(w.deliveryEndAt)} IST`;
}
