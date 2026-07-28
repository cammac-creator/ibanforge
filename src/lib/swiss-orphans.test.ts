import { describe, expect, it } from 'vitest';
import { lookupByCountryBank } from './bic-lookup.js';

/**
 * A Swiss bank code the SIX BankMaster does not list must not be given an
 * institution name. See pruneStaleSwissCodes in bic-lookup.ts for the four
 * that were, and why 00762 is the interesting one.
 */
describe('stale Swiss bank codes are not named', () => {
  const ORPHANS: Array<[string, string]> = [
    ['00762', 'the canonical example IBAN bank code, never an allocated IID'],
    ['31100', 'radicant bank ag, wound down'],
    ['83015', 'MBaer, in liquidation, and the name carried a ++ artifact'],
    ['83036', 'radicant bank ag, second code'],
  ];

  for (const [code, why] of ORPHANS) {
    it(`${code}: ${why}`, () => {
      expect(lookupByCountryBank('CH', code)).toBeNull();
    });
  }

  it('still resolves a bank code the register does list', () => {
    // The guard must not empty the Swiss map: 00230 is UBS in the BankMaster.
    const hit = lookupByCountryBank('CH', '00230');
    expect(hit).not.toBeNull();
    expect(hit?.code).toMatch(/^UBSW/);
  });

  it('no CH bank name reaching a customer carries a parsing artifact', () => {
    for (const code of ['00230', '00779', '08704']) {
      const hit = lookupByCountryBank('CH', code);
      if (hit?.bank_name) expect(hit.bank_name).not.toMatch(/^\+\+/);
    }
  });
});
