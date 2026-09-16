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
    expect(Number.isNaN(Number(a)) || Number(a) !== 51_312).toBe(true);
  });

  it('keeps no arithmetic relation between consecutive cursors (audit of 16/09/2026)', () => {
    // The XOR mask of 07/09 preserved differences: read as numbers, consecutive
    // cursors were exactly one apart, and two reads of the feed gave the real
    // throughput. Whatever the encoding, the gaps between consecutive ids must
    // not be constant, and no cursor may be turned into its neighbour by
    // changing a single character.
    const ids = [51_312, 51_313, 51_314, 51_315, 51_316, 51_317, 51_318, 51_319];
    const cursors = ids.map(encodeOpsCursor);
    const asNumbers = cursors.map((c) =>
      BigInt('0x' + Buffer.from(c, 'base64url').toString('hex')),
    );
    const gaps = new Set<bigint>();
    for (let i = 1; i < asNumbers.length; i++) gaps.add(asNumbers[i] - asNumbers[i - 1]);
    expect(gaps.size).toBeGreaterThan(1);
    // Hamming distance between neighbours: an unrelated string, not a counter.
    const differing = [...cursors[0]].filter((ch, i) => ch !== cursors[1][i]).length;
    expect(differing).toBeGreaterThan(cursors[0].length / 2);
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
    // Right length and alphabet, but not one of ours: the zero prefix of the
    // decrypted block fails, so a forged cursor is "no cursor", never a window
    // of someone's choosing.
    expect(decodeOpsCursor('AAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(decodeOpsCursor('zzzzzzzzzzzzzzzzzzzzzz')).toBeNull();
  });

  it('refuses to encode an id it could not decode', () => {
    expect(() => encodeOpsCursor(-1)).toThrow(RangeError);
    expect(() => encodeOpsCursor(2 ** 48)).toThrow(RangeError);
    expect(() => encodeOpsCursor(1.5)).toThrow(RangeError);
  });
});
