import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getBicDB } from './db.js';
import {
  UNLICENSED_MAP_COUNTRIES,
  WITHDRAWN_BANK_CODE_COUNTRIES,
  countryHasReferenceData,
  lookupByCountryBank,
} from './bic-lookup.js';
import { EXAMPLE_IBANS } from './countries.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

/**
 * The map keys no publisher granted, out of the repository AND out of the
 * service (29/09/2026, decision of Claude-Alain on the licence inventory of
 * src/db/bic_data.json).
 *
 * Eight countries lost every key, Spain and Italy part of theirs; Italy and
 * Romania were rebuilt from open data (scripts/derive-map-keys.ts). What must
 * hold from now on: the eight countries stay empty and say "not consulted",
 * never "absent"; no bulk import brings the Spanish and Italian keys back
 * unnoticed; every Romanian key is the derivation it claims to be.
 */

const map = JSON.parse(
  readFileSync(new URL('../db/bic_data.json', import.meta.url), 'utf8'),
) as Record<string, { bic: string }>;
const keysOf = (cc: string) => Object.keys(map).filter((k) => k.startsWith(`${cc}:`));

describe('the countries whose every map key was withdrawn', () => {
  const countries = [...UNLICENSED_MAP_COUNTRIES].sort();

  it('are the eight of the decision, and none of them comes back through a private file', () => {
    expect(countries).toEqual(['AE', 'BA', 'EE', 'GE', 'KZ', 'MD', 'RS', 'TR']);
    for (const cc of countries) expect(WITHDRAWN_BANK_CODE_COUNTRIES.has(cc), cc).toBe(false);
  });

  it.each(countries)('%s carries no key in bic_data.json', (cc) => {
    expect(keysOf(cc)).toEqual([]);
  });

  it.each(countries)(
    '%s: the registry example answers "no reference data", never "absent"',
    (cc) => {
      const r = validateIBAN(EXAMPLE_IBANS[cc]!);
      expect(r.valid).toBe(true);
      enrichResult(r);
      expect(r.bic ?? null).toBeNull();
      expect(r.bank_code_check?.status).toBe('unavailable');
      expect(r.bank_code_check?.reason).toBe('no_reference_data_for_country');
      expect(r.bank_code_check?.authoritative).toBe(false);
      expect(r.bank_code_holder).toBe('unknown');
      expect(countryHasReferenceData(cc)).toBe(false);
    },
  );

  it('does not let the prefix search name a bank in the map’s place', () => {
    // Moldovan and Georgian bank codes are two letters, and `bic8 LIKE code%`
    // finds a BIC for many of them in the public directory. Take one the
    // directory would match, and check the lookup still answers nothing.
    for (const cc of ['MD', 'GE']) {
      const row = getBicDB()
        .prepare('SELECT substr(bic8, 1, 2) AS p FROM bic_entries WHERE country_code = ? LIMIT 1')
        .get(cc) as { p: string } | undefined;
      if (!row) continue;
      expect(lookupByCountryBank(cc, row.p), `${cc}:${row.p}`).toBeNull();
    }
  });
});

describe('the countries that kept part of their keys', () => {
  // Ceilings, not counts to reproduce: they only stop an import that would
  // bring the withdrawn keys back in bulk. Spain kept the keys taken from
  // national files through sigalor/iban-to-bic and a few manual ones; Italy
  // those plus the ones rebuilt from the Banca d'Italia's LEI and GLEIF.
  it('Spain and Italy stay under the size they had once the keys were withdrawn', () => {
    expect(keysOf('ES').length).toBeLessThanOrEqual(145);
    expect(keysOf('IT').length).toBeLessThanOrEqual(250);
  });
});

describe('the Romanian keys rebuilt from the BIC directory', () => {
  it('each key is the first four letters of a Romanian BIC, served as its head office', () => {
    const ro = keysOf('RO');
    expect(ro.length).toBeGreaterThan(0);
    for (const key of ro) {
      const bic = map[key]!.bic;
      expect(bic.slice(0, 4), key).toBe(key.slice(3));
      expect(bic.slice(4, 6), key).toBe('RO');
      expect(bic, key).toMatch(/^[A-Z0-9]{8}XXX$/);
    }
  });
});
