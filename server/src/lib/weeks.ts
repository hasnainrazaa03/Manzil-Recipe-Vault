/**
 * Calendar weeks, handled as plain dates.
 *
 * A meal plan is a fact about a calendar — "Tuesday is biryani" — not about an
 * instant. Storing a `Date` means storing a moment in time, and a moment lands
 * on different calendar days depending on the reader's timezone: a plan made at
 * 9pm in Karachi is the previous afternoon in New York, so the biryani moves to
 * Monday. Every date here is therefore a `YYYY-MM-DD` string and no `Date`
 * object is ever serialised.
 *
 * Weeks start on Monday, which is what "this week" means to most of the world
 * and, more practically, keeps a weekend's cooking in one row.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Rejects 2026-02-30 and friends: constructing the date normalises overflow,
  // so a round trip that changes the value means the input was not a real day.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Parsed at UTC noon, so a DST transition can never shift the calendar day. */
function toUtc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week containing this date. Idempotent. */
export function startOfWeek(date: string): string {
  const parsed = toUtc(date);
  const day = parsed.getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;

  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return toIso(parsed);
}

/** The seven dates of the week beginning on `weekStart`, Monday first. */
export function weekDates(weekStart: string): string[] {
  const monday = toUtc(weekStart);

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return toIso(day);
  });
}

/** True when the date falls inside the week beginning on `weekStart`. */
export function isInWeek(date: string, weekStart: string): boolean {
  return weekDates(weekStart).includes(date);
}

export function shiftWeek(weekStart: string, weeks: number): string {
  const monday = toUtc(weekStart);
  monday.setUTCDate(monday.getUTCDate() + weeks * 7);
  return toIso(monday);
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];
