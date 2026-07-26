import { describe, it, expect } from 'vitest';
import { formatDay, formatStamp } from './format';

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
