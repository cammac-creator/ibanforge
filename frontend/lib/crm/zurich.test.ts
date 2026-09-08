import { describe, expect, it } from 'vitest';
import { toZurich, zurichOffsetMinutes } from './zurich';

describe('toZurich', () => {
  it('adds two hours in summer time: the draft scheduled for 10:22 Swiss reads 10:22, not 08:22', () => {
    expect(toZurich('2026-09-08T08:22')).toBe('2026-09-08T10:22');
    expect(toZurich('2026-09-08T08:22:00')).toBe('2026-09-08T10:22:00');
  });

  it('adds one hour in winter time', () => {
    expect(toZurich('2026-01-15T08:22')).toBe('2026-01-15T09:22');
  });

  it('moves a late-evening UTC stamp to the next Swiss day', () => {
    expect(toZurich('2026-09-08T22:30')).toBe('2026-09-09T00:30');
  });

  it('switches exactly at the European rule: last Sunday of March and October, 01:00 UTC', () => {
    // 2026: DST starts 29 March, ends 25 October.
    expect(zurichOffsetMinutes(Date.UTC(2026, 2, 29, 0, 59))).toBe(60);
    expect(zurichOffsetMinutes(Date.UTC(2026, 2, 29, 1, 0))).toBe(120);
    expect(zurichOffsetMinutes(Date.UTC(2026, 9, 25, 0, 59))).toBe(120);
    expect(zurichOffsetMinutes(Date.UTC(2026, 9, 25, 1, 0))).toBe(60);
    expect(toZurich('2026-10-25T00:30')).toBe('2026-10-25T02:30');
    expect(toZurich('2026-10-25T01:30')).toBe('2026-10-25T02:30');
  });

  it('accepts a space instead of the T and leaves anything else alone', () => {
    expect(toZurich('2026-09-08 08:22:05')).toBe('2026-09-08T10:22:05');
    expect(toZurich('')).toBe('');
    expect(toZurich('hier')).toBe('hier');
  });
});
