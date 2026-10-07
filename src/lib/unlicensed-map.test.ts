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
import { buildComplianceResponse } from './compliance-response.js';
import { BANK_CODE_DATA_UNAVAILABLE_FLOOR, calculateRiskScore } from './compliance.js';

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

/** The Italian keys added on 07/10/2026, from the trace scripts/derive-map-keys.ts wrote. */
const itAdditions = Object.entries(
  (
    JSON.parse(
      readFileSync(
        new URL('../../scripts/data/it-map-additions-2026-10-07.json', import.meta.url),
        'utf8',
      ),
    ) as { keys: Record<string, { bic: string | null; via?: string }> }
  ).keys,
).filter((entry): entry is [string, { bic: string; via: string }] => entry[1].bic !== null);
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

describe('the compliance score of an IBAN whose bank-code data was withdrawn', () => {
  // Until the withdrawal these IBANs named a bank, which the sanctions lists
  // screened, and a handful of them named a listed bank. Without a bank the
  // bank axis is silent, and a silence must not add up to `low`.
  it.each([...UNLICENSED_MAP_COUNTRIES].sort())(
    '%s: no bank screened, and the score held at elevated at least',
    (cc) => {
      const r = buildComplianceResponse(EXAMPLE_IBANS[cc]!);
      expect(r.valid).toBe(true);
      const c = r.compliance;
      expect(c.sanctions.bank_screened).toBe(false);
      expect(c.sanctions.institution_listed).toBeNull();
      expect(c.sanctions.matched_lists).toEqual([]);
      expect(c.flags).toContain('no_bank_resolved');
      expect(c.flags).toContain('bank_code_data_unavailable');
      expect(c.risk_score).toBeGreaterThanOrEqual(BANK_CODE_DATA_UNAVAILABLE_FLOOR);
      expect(['elevated', 'high', 'critical']).toContain(c.risk_level);
    },
  );

  it('a country that keeps its data does not raise the flag when a code misses', () => {
    // A French code absent from the map: no bank either, but the map was
    // consulted and simply does not carry it.
    const r = buildComplianceResponse('FR1499999000010123456789A42');
    expect(r.bic ?? null).toBeNull();
    expect(r.compliance.flags).not.toContain('bank_code_data_unavailable');
  });

  it('is a floor, never a weight: an established risk is not lowered, a resolved bank never raises it', () => {
    const noBank = {
      country_sanctioned: false,
      bank_sanctioned: false,
      matched_lists: [],
      fatf_status: 'non_member' as const,
      bank_screened: false,
    };
    const reach = { sepa_instant: false, sct: false, sdd: false, screened: false };
    const vop = { participant: false, status: 'not_found' as const, screened: false };
    const floored = calculateRiskScore(
      noBank,
      reach,
      vop,
      'bank',
      'standard',
      false,
      'unverified',
      false,
      [],
      true,
    );
    expect(floored.risk_score).toBe(BANK_CODE_DATA_UNAVAILABLE_FLOOR);
    expect(floored.risk_level).toBe('elevated');
    // A sanctioned country already scores above the floor: it stays there.
    const sanctionedCountry = calculateRiskScore(
      { ...noBank, country_sanctioned: true, fatf_status: 'black_list' },
      reach,
      vop,
      'bank',
      'high',
      false,
      'unverified',
      false,
      [],
      true,
    );
    expect(sanctionedCountry.risk_score).toBeGreaterThan(BANK_CODE_DATA_UNAVAILABLE_FLOOR);
    // A resolved bank is screened: the flag belongs to the no-bank case only.
    const screened = calculateRiskScore(
      { ...noBank, bank_screened: true },
      { ...reach, screened: true },
      { ...vop, screened: true },
      'bank',
      'standard',
      false,
      'confirmed',
      true,
      [],
      true,
    );
    expect(screened.flags).not.toContain('bank_code_data_unavailable');
  });
});

describe('the countries that kept part of their keys', () => {
  // Ceilings, not counts to reproduce: they only stop an import that would
  // bring the withdrawn keys back in bulk. Spain kept the keys taken from
  // national files through sigalor/iban-to-bic and a few manual ones; Italy
  // those plus the ones rebuilt from the Banca d'Italia's LEI and GLEIF.
  it('Spain and Italy stay under the size they had once the keys were withdrawn', () => {
    expect(keysOf('ES').length).toBeLessThanOrEqual(145);
    // 07/10/2026: Italy may also hold the keys added from open sources for the
    // codes the 29/09 rebuild left without a BIC, each one in the trace with
    // the chain of sources behind it, and none other.
    expect(keysOf('IT').length).toBeLessThanOrEqual(250 + itAdditions.length);
  });

  it('every Italian key added on 07/10/2026 holds the BIC its trace names, and says where it comes from', () => {
    expect(itAdditions.length).toBeGreaterThan(0);
    for (const [key, outcome] of itAdditions) {
      expect(map[key]?.bic, key).toBe(outcome.bic);
      expect(['gleif-lei', 'ecb-head-office', 'bank-site'], key).toContain(outcome.via);
    }
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
