import { describe, it, expect } from 'vitest';
import { dayLabel, formatDay, formatStamp, isoDay, shiftDay } from './format';

describe('formatStamp', () => {
  it('renders day, month and time from the stored shape', () => {
    expect(formatStamp('2026-07-04T21:40')).toBe('04/07 21:40');
  });

  it('accepts a space instead of the T separator', () => {
    expect(formatStamp('2026-07-04 21:40')).toBe('04/07 21:40');
  });

  it('drops the time when the stamp carries none', () => {
    expect(formatStamp('2026-07-09')).toBe('09/07');
  });

  it('ignores trailing seconds and offsets rather than failing on them', () => {
    expect(formatStamp('2026-07-04T21:40:07Z')).toBe('04/07 21:40');
  });

  it('returns null for a missing date so the caller can say so', () => {
    expect(formatStamp(null)).toBeNull();
    expect(formatStamp(undefined)).toBeNull();
    expect(formatStamp('')).toBeNull();
  });

  // The column is free text. Truncating an unrecognised value is how
  // '1er contact Jan 5, 2026' used to print as 'Jan 5, 202'.
  it('returns an unrecognised value unchanged instead of slicing it', () => {
    expect(formatStamp('Jan 5, 2026')).toBe('Jan 5, 2026');
    expect(formatStamp('hier')).toBe('hier');
  });

  it('does not reorder day and month', () => {
    // 2026-01-12 is 12 January, so the day must lead.
    expect(formatStamp('2026-01-12T08:00')).toBe('12/01 08:00');
  });
});

describe('formatDay', () => {
  it('drops the time even when the stamp carries one', () => {
    expect(formatDay('2026-07-04T21:40')).toBe('04/07');
  });

  it('behaves like formatStamp on missing and unrecognised values', () => {
    expect(formatDay(null)).toBeNull();
    expect(formatDay('Jan 5, 2026')).toBe('Jan 5, 2026');
  });
});

describe('dayLabel — the shelf between two days, decided against one clock', () => {
  it('names today, yesterday, and a weekday with its month', () => {
    expect(dayLabel('2026-09-04 10:15', '2026-09-04')).toBe('aujourd’hui');
    expect(dayLabel('2026-09-03T22:15:00Z', '2026-09-04')).toBe('hier');
    expect(dayLabel('2026-08-17 09:26', '2026-09-04')).toBe('lundi 17 août');
  });
  it('adds the year when it is not this one', () => {
    expect(dayLabel('2025-08-17 09:26', '2026-09-04')).toBe('dimanche 17 août 2025');
  });
  it('answers nothing on an undatable stamp', () => {
    expect(dayLabel('date inconnue', '2026-09-04')).toBeNull();
    expect(dayLabel(null, '2026-09-04')).toBeNull();
  });
});

describe('isoDay — the one value in this file meant to be compared', () => {
  it('reads the day out of every stamp shape the ingester writes', () => {
    expect(isoDay('2026-09-07T08:15:00')).toBe('2026-09-07');
    expect(isoDay('2026-09-07 08:15')).toBe('2026-09-07');
    expect(isoDay('2026-09-07')).toBe('2026-09-07');
  });

  it('sorts as a string exactly as it sorts in time', () => {
    // The whole reason this exists: the journal windows a period and shelves a
    // day with `>=` on these values, never with a Date.
    expect(isoDay('2026-09-07')! > isoDay('2026-08-31')!).toBe(true);
    expect(isoDay('2027-01-01')! > isoDay('2026-12-31')!).toBe(true);
  });

  it('answers null rather than the raw string, unlike the formatters above', () => {
    // A caller that cannot read a day has to DROP the row: almost any string
    // compares greater than a date, so a fallback would land it in every window.
    expect(isoDay('hier soir')).toBeNull();
    expect(isoDay('')).toBeNull();
    expect(isoDay(null)).toBeNull();
  });
});

describe('shiftDay', () => {
  it('walks calendar days, across a month and a year', () => {
    expect(shiftDay('2026-09-07', -6)).toBe('2026-09-01');
    expect(shiftDay('2026-09-07', -13)).toBe('2026-08-25');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2026-09-07', 1)).toBe('2026-09-08');
  });

  it('lands on the leap day rather than beside it', () => {
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('answers null on anything that is not an ISO day', () => {
    expect(shiftDay('pas une date', -7)).toBeNull();
  });
});
