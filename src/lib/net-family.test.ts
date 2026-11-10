import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ANTHROPIC_OUTBOUND_V4,
  expandV4,
  familyHashes,
  MIN_V4_PREFIX,
  v4Spellings,
} from './net-family.js';

/** A stand-in for hashIp: same shape (16 hex), its own salt. */
const fakeHash = (ip: string): string =>
  createHash('sha256').update(`test:${ip}`).digest('hex').slice(0, 16);

describe('expandV4', () => {
  it('lists every address of the block, network and broadcast included', () => {
    expect(expandV4('192.0.2.0/30')).toEqual(['192.0.2.0', '192.0.2.1', '192.0.2.2', '192.0.2.3']);
    expect(expandV4('198.51.100.7/32')).toEqual(['198.51.100.7']);
  });

  it('refuses a block wider than /16', () => {
    expect(MIN_V4_PREFIX).toBe(16);
    expect(() => expandV4('10.0.0.0/8')).toThrow(/too wide/);
    expect(() => expandV4('10.0.0.0/15')).toThrow(/too wide/);
    expect(expandV4('10.0.0.0/16')).toHaveLength(65536);
  });

  it('refuses what is not a network address', () => {
    for (const bad of ['192.0.2.1/30', '192.0.2.0', '192.0.2/24', '256.0.0.0/24', '1.2.3.04/32']) {
      expect(() => expandV4(bad), bad).toThrow();
    }
  });

  it("Anthropic's two published outbound ranges hold 6 144 addresses", () => {
    expect(ANTHROPIC_OUTBOUND_V4).toEqual(['160.79.104.0/21', '153.61.208.0/20']);
    const addresses = ANTHROPIC_OUTBOUND_V4.flatMap((cidr) => expandV4(cidr));
    expect(addresses).toHaveLength(6144);
    expect(new Set(addresses).size).toBe(6144);
    expect(addresses[0]).toBe('160.79.104.0');
    expect(addresses.at(-1)).toBe('153.61.223.255');
  });
});

describe('familyHashes', () => {
  it('hashes both spellings of each address: 6 144 addresses, 12 288 hashes', () => {
    const hashes = familyHashes(ANTHROPIC_OUTBOUND_V4, fakeHash);
    expect(hashes.size).toBe(6144 * 2);
    expect(hashes.has(fakeHash('160.79.104.7'))).toBe(true);
    expect(hashes.has(fakeHash('::ffff:153.61.223.255'))).toBe(true);
    expect(hashes.has(fakeHash('160.79.112.0'))).toBe(false);
  });

  it('writes the mapped spelling the way a proxy hands it over', () => {
    expect(v4Spellings('192.0.2.5')).toEqual(['192.0.2.5', '::ffff:192.0.2.5']);
  });

  it('is memoised per hash function and per list of blocks', () => {
    const first = familyHashes(['192.0.2.0/30'], fakeHash);
    expect(familyHashes(['192.0.2.0/30'], fakeHash)).toBe(first);
    const other = (ip: string): string => fakeHash(`x${ip}`);
    expect(familyHashes(['192.0.2.0/30'], other)).not.toBe(first);
    expect(familyHashes(['192.0.2.0/31'], fakeHash).size).toBe(4);
  });

  it('skips an address the hash declines', () => {
    expect(familyHashes(['192.0.2.0/30'], () => null).size).toBe(0);
  });
});
