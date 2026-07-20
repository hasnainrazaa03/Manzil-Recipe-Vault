import { afterEach, describe, expect, it } from 'vitest';
import {
  DATE_PATTERN,
  MEAL_TYPES,
  isInWeek,
  isValidDate,
  shiftWeek,
  startOfWeek,
  weekDates,
} from '../src/lib/weeks.js';

/**
 * The calendar helpers, tested as pure functions.
 *
 * The governing design decision (DESIGN.md §6.2) is that every date is a
 * `YYYY-MM-DD` string and no `Date` object is ever serialised, because a meal
 * plan is a fact about a calendar rather than about an instant. The timezone
 * block at the bottom is the one that guarantees that property holds.
 */

/** Day of week for a `YYYY-MM-DD` string, computed independently of weeks.ts. */
function dayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

/** `count` consecutive dates beginning at `start`, computed independently. */
function walk(start: string, count: number): string[] {
  const [year, month, day] = start.split('-').map(Number) as [number, number, number];
  const cursor = new Date(Date.UTC(year, month - 1, day, 12));

  return Array.from({ length: count }, () => {
    const iso = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return iso;
  });
}

// 2026-07-20 is a Monday; the seven dates below are that whole week.
const MONDAY = '2026-07-20';
const WEEK = walk(MONDAY, 7);

// === startOfWeek =============================================================

describe('startOfWeek', () => {
  it('returns the Monday for every day of a week', () => {
    for (const date of WEEK) {
      expect(startOfWeek(date), `startOfWeek(${date})`).toBe(MONDAY);
    }
  });

  it('puts Sunday in the week that started the *previous* Monday', () => {
    // The classic off-by-one: 2026-07-26 is a Sunday, and it belongs to the week
    // beginning 2026-07-20, not the one beginning 2026-07-27.
    expect(dayOfWeek('2026-07-26')).toBe(0);
    expect(startOfWeek('2026-07-26')).toBe('2026-07-20');
    expect(startOfWeek('2026-07-26')).not.toBe('2026-07-27');
  });

  it('leaves a Monday alone', () => {
    expect(startOfWeek(MONDAY)).toBe(MONDAY);
  });

  it('is idempotent', () => {
    for (const date of walk('2026-01-01', 400)) {
      const once = startOfWeek(date);
      expect(startOfWeek(once), `startOfWeek(startOfWeek(${date}))`).toBe(once);
    }
  });

  it('always returns a Monday, for every day of a year and a bit', () => {
    for (const date of walk('2025-11-15', 500)) {
      const monday = startOfWeek(date);
      expect(DATE_PATTERN.test(monday), `${monday} is not YYYY-MM-DD`).toBe(true);
      expect(dayOfWeek(monday), `startOfWeek(${date}) = ${monday} is not a Monday`).toBe(1);
      // …and the Monday it returns is the one at or before the date itself.
      expect(monday <= date).toBe(true);
      expect(walk(monday, 7)).toContain(date);
    }
  });

  it('crosses a month boundary', () => {
    // Saturday 1 August 2026 belongs to the week that started in July.
    expect(dayOfWeek('2026-08-01')).toBe(6);
    expect(startOfWeek('2026-08-01')).toBe('2026-07-27');
    expect(startOfWeek('2026-08-02')).toBe('2026-07-27'); // the Sunday after it
    expect(startOfWeek('2026-08-03')).toBe('2026-08-03'); // the next Monday
  });

  it('crosses a year boundary', () => {
    expect(startOfWeek('2026-12-31')).toBe('2026-12-28');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
    expect(startOfWeek('2027-01-03')).toBe('2026-12-28'); // Sunday, still 2026
    expect(startOfWeek('2027-01-04')).toBe('2027-01-04');
    // …and the other direction.
    expect(startOfWeek('2026-01-04')).toBe('2025-12-29');
  });

  it('handles a leap day', () => {
    expect(startOfWeek('2028-02-29')).toBe('2028-02-28');
    expect(startOfWeek('2028-03-01')).toBe('2028-02-28');
    // The non-leap year immediately before it must not shift.
    expect(startOfWeek('2026-02-28')).toBe('2026-02-23');
    expect(startOfWeek('2026-03-01')).toBe('2026-02-23');
  });
});

// === weekDates ===============================================================

describe('weekDates', () => {
  it('returns exactly seven consecutive dates starting at the Monday', () => {
    const dates = weekDates(MONDAY);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe(MONDAY);
    expect(dates).toEqual(WEEK);
    expect(new Set(dates).size).toBe(7);
  });

  it('is consecutive across a month, a year and a leap day', () => {
    expect(weekDates('2026-07-27')).toEqual(walk('2026-07-27', 7));
    expect(weekDates('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(weekDates('2028-02-28')).toEqual(walk('2028-02-28', 7));
    expect(weekDates('2028-02-28')).toContain('2028-02-29');
  });

  it('starts every returned week on a Monday when fed a real weekStart', () => {
    for (const date of walk('2026-01-01', 200)) {
      const dates = weekDates(startOfWeek(date));
      expect(dayOfWeek(dates[0]!)).toBe(1);
      expect(dates).toHaveLength(7);
    }
  });
});

// === isInWeek ================================================================

describe('isInWeek', () => {
  it('is true for all seven days of the week', () => {
    for (const date of WEEK) {
      expect(isInWeek(date, MONDAY), `${date} should be in the week of ${MONDAY}`).toBe(true);
    }
  });

  it('is false for the day before and the day after', () => {
    expect(isInWeek('2026-07-19', MONDAY)).toBe(false); // the preceding Sunday
    expect(isInWeek('2026-07-27', MONDAY)).toBe(false); // the following Monday
  });

  it('is false across a year boundary for a date in the neighbouring week', () => {
    expect(isInWeek('2027-01-03', '2026-12-28')).toBe(true);
    expect(isInWeek('2027-01-04', '2026-12-28')).toBe(false);
    expect(isInWeek('2026-12-27', '2026-12-28')).toBe(false);
  });
});

// === shiftWeek ===============================================================

describe('shiftWeek', () => {
  it('moves forwards and backwards', () => {
    expect(shiftWeek(MONDAY, 1)).toBe('2026-07-27');
    expect(shiftWeek(MONDAY, -1)).toBe('2026-07-13');
    expect(shiftWeek(MONDAY, 0)).toBe(MONDAY);
    expect(shiftWeek(MONDAY, 4)).toBe('2026-08-17');
  });

  it('crosses a year boundary in both directions', () => {
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04');
    expect(shiftWeek('2027-01-04', -1)).toBe('2026-12-28');
    expect(shiftWeek('2026-01-05', -2)).toBe('2025-12-22');
    expect(shiftWeek(MONDAY, 52)).toBe('2027-07-19');
  });

  it('always lands on a Monday and round-trips', () => {
    for (let weeks = -60; weeks <= 60; weeks += 1) {
      const shifted = shiftWeek(MONDAY, weeks);
      expect(dayOfWeek(shifted), `shiftWeek(${MONDAY}, ${weeks}) = ${shifted}`).toBe(1);
      expect(shiftWeek(shifted, -weeks)).toBe(MONDAY);
      expect(startOfWeek(shifted)).toBe(shifted);
    }
  });

  it('steps through a leap day without losing a day', () => {
    expect(shiftWeek('2028-02-21', 1)).toBe('2028-02-28');
    expect(shiftWeek('2028-02-28', 1)).toBe('2028-03-06'); // 29 Feb exists in between
  });
});

// === isValidDate =============================================================

describe('isValidDate', () => {
  it('accepts real, zero-padded dates', () => {
    for (const date of ['2026-07-20', '2026-01-01', '2026-12-31', '2028-02-29']) {
      expect(isValidDate(date), date).toBe(true);
    }
  });

  it('rejects impossible months and days', () => {
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-04-31')).toBe(false);
    expect(isValidDate('2026-07-00')).toBe(false);
    expect(isValidDate('2026-07-32')).toBe(false);
  });

  it('knows which Februaries have 29 days', () => {
    expect(isValidDate('2028-02-29')).toBe(true); // leap
    expect(isValidDate('2026-02-29')).toBe(false); // not leap
    expect(isValidDate('2000-02-29')).toBe(true); // divisible by 400
    expect(isValidDate('1900-02-29')).toBe(false); // divisible by 100, not 400
  });

  it('rejects anything not in the exact YYYY-MM-DD shape', () => {
    for (const value of [
      '2026-2-1', // unpadded
      '2026-02-1',
      '2026-2-01',
      'not-a-date',
      '',
      '   ',
      '2026-07-20T00:00:00Z',
      '2026/07/20',
      '20-07-2026',
      '2026-07-20 ',
      '02026-07-20',
    ]) {
      expect(isValidDate(value), JSON.stringify(value)).toBe(false);
    }
  });
});

// === MEAL_TYPES ==============================================================

describe('MEAL_TYPES', () => {
  it('is the three meals of a day, in order', () => {
    expect([...MEAL_TYPES]).toEqual(['breakfast', 'lunch', 'dinner']);
  });
});

// === Timezone stability ======================================================

/**
 * The whole point of the string-date design. `process.env.TZ` is honoured by
 * Node's Date at the moment it changes, so setting it here really does move the
 * process's local timezone — which is exactly what would break a helper that
 * used local-time accessors anywhere.
 */
describe('timezone stability', () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  /** Everything the helpers can say about a spread of dates, as one snapshot. */
  function snapshot() {
    const probes = [
      '2026-07-19', // Sunday
      '2026-07-20', // Monday
      '2026-07-26', // Sunday, end of the week
      '2026-01-01',
      '2026-12-31',
      '2027-01-01',
      '2028-02-29',
      '2026-03-29', // European DST forward
      '2026-11-01', // US DST back
      '2026-10-04',
    ];

    return probes.map((date) => ({
      date,
      startOfWeek: startOfWeek(date),
      weekDates: weekDates(startOfWeek(date)),
      forward: shiftWeek(startOfWeek(date), 3),
      back: shiftWeek(startOfWeek(date), -3),
      inWeek: weekDates(startOfWeek(date)).map((day) => isInWeek(day, startOfWeek(date))),
      valid: isValidDate(date),
    }));
  }

  it('returns identical results at UTC+14 and UTC-11', () => {
    process.env.TZ = 'UTC';
    const utc = snapshot();

    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14, the furthest ahead there is
    const ahead = snapshot();

    process.env.TZ = 'Pacific/Niue'; // UTC-11, the furthest behind that is inhabited
    const behind = snapshot();

    expect(ahead).toEqual(utc);
    expect(behind).toEqual(utc);
    // Guard against the tautology of TZ being ignored entirely: the process
    // offset really did move between the two readings.
    process.env.TZ = 'Pacific/Kiritimati';
    const aheadOffset = new Date('2026-07-20T00:00:00Z').getTimezoneOffset();
    process.env.TZ = 'Pacific/Niue';
    const behindOffset = new Date('2026-07-20T00:00:00Z').getTimezoneOffset();
    expect(aheadOffset).not.toBe(behindOffset);
  });

  it('keeps Sunday in the same week under every extreme offset', () => {
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Niue', 'America/Anchorage', 'Asia/Karachi']) {
      process.env.TZ = tz;
      expect(startOfWeek('2026-07-26'), tz).toBe('2026-07-20');
      expect(startOfWeek('2026-07-27'), tz).toBe('2026-07-27');
      expect(weekDates('2026-07-20')[6], tz).toBe('2026-07-26');
      expect(shiftWeek('2026-12-28', 1), tz).toBe('2027-01-04');
    }
  });

  it('never returns a Date object or an ISO timestamp', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    const monday = startOfWeek('2026-07-22');
    expect(typeof monday).toBe('string');
    expect(monday).toMatch(DATE_PATTERN);
    for (const day of weekDates(monday)) {
      expect(typeof day).toBe('string');
      expect(day).toMatch(DATE_PATTERN);
      expect(day).not.toContain('T');
    }
    expect(typeof shiftWeek(monday, 1)).toBe('string');
  });
});
