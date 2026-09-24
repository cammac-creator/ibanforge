import { describe, expect, it } from 'vitest';
import { servedAt } from './served-at.js';

describe('servedAt', () => {
  it('is ISO 8601 in UTC, to the second', () => {
    expect(servedAt(new Date('2026-09-24T19:40:12.345Z'))).toBe('2026-09-24T19:40:12Z');
  });

  it('reads the clock when no instant is given', () => {
    const before = Date.now();
    const stamp = servedAt();
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // The stamp drops the milliseconds: compare to the second.
    expect(Date.parse(stamp)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(Date.parse(stamp)).toBeLessThanOrEqual(Date.now());
  });
});
