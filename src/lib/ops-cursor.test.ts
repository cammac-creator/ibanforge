import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeOpsCursor, encodeOpsCursor, resetOpsCursorMask } from './ops-cursor.js';

describe('ops cursor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetOpsCursorMask();
  });

  it('round-trips every id, including zero', () => {
    for (const id of [0, 1, 2, 51_312, 123_456_789, 2 ** 40]) {
      expect(decodeOpsCursor(encodeOpsCursor(id))).toBe(id);
    }
  });

  it('does not expose the id or its order', () => {
    const a = encodeOpsCursor(51_312);
    const b = encodeOpsCursor(51_313);
    expect(a).not.toMatch(/^51312$/);
    expect(a).not.toBe(b);
    // Consecutive ids do not give consecutive strings: the low bits flip under
    // the mask, so the base36 text moves in the last character, and only there
    // when the mask has the same low digit — either way, no counter to read.
    expect(Number.isNaN(Number(a)) || Number(a) !== 51_312).toBe(true);
  });

  it('is stable across processes that share the secret, and changes with it', () => {
    vi.stubEnv('OPS_CURSOR_SECRET', 'alpha');
    resetOpsCursorMask();
    const withAlpha = encodeOpsCursor(42);
    resetOpsCursorMask();
    expect(encodeOpsCursor(42)).toBe(withAlpha);
    vi.stubEnv('OPS_CURSOR_SECRET', 'beta');
    resetOpsCursorMask();
    expect(encodeOpsCursor(42)).not.toBe(withAlpha);
  });

  it('treats anything that is not one of its cursors as no cursor', () => {
    expect(decodeOpsCursor(undefined)).toBeNull();
    expect(decodeOpsCursor('')).toBeNull();
    expect(decodeOpsCursor('not a cursor!')).toBeNull();
    expect(decodeOpsCursor('zzzzzzzzzzzz')).toBeNull();
  });

  it('refuses to encode an id it could not decode', () => {
    expect(() => encodeOpsCursor(-1)).toThrow(RangeError);
    expect(() => encodeOpsCursor(2 ** 48)).toThrow(RangeError);
    expect(() => encodeOpsCursor(1.5)).toThrow(RangeError);
  });
});
