import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bicLookup } from './bic-lookup.js';
import { lookupClearingSeatByBic } from '../lib/ch-clearing.js';
import type { HonoEnv } from '../types.js';
import type { Iso20022PostalAddress } from '../lib/postal-address.js';

/**
 * The served surface of the greffon, exercised against the real bic.sqlite that
 * ships with the repository — the unit tests in lib/postal-address.test.ts run
 * on literals and cannot catch a wiring mistake or a register that answers
 * something other than what its columns promised.
 */
function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', bicLookup);
  return app;
}

async function postalAddress(bic: string): Promise<Iso20022PostalAddress | undefined> {
  const res = await makeApp().request(`/v1/bic/${bic}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { postal_address?: Iso20022PostalAddress };
  return body.postal_address;
}

describe('GET /v1/bic/:code serves postal_address beside address, never instead of it', () => {
  it('adds the block without touching anything that was already there', async () => {
    const res = await makeApp().request('/v1/bic/SNBZCHZZXXX');
    const body = (await res.json()) as Record<string, unknown>;

    // Additive means additive: the legacy address block keeps its own shape,
    // its own source and its own untruncated street.
    expect(body.address).toMatchObject({ type: 'registered', source: 'GLEIF' });
    expect(body.address_available).toBe(true);
    expect(body.postal_address).toBeDefined();
  });

  it('gives a Swiss BIC a fully structured block, StrtNm and BldgNb apart, sourced to SIX', async () => {
    const pa = await postalAddress('SNBZCHZZXXX');

    expect(pa).toMatchObject({
      strt_nm: 'Börsenstrasse',
      bldg_nb: '15',
      twn_nm: 'Zürich',
      ctry: 'CH',
      format: 'structured',
      source: 'SIX BankMaster (Swiss IID register)',
    });
    expect(pa?.adr_line).toBeUndefined();
    // The date is SIX's own validity date, read from the row.
    expect(pa?.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('gives a GLEIF-sourced BIC a hybrid block whose street is an AdrLine, never a StrtNm', async () => {
    const pa = await postalAddress('BUKBGB22XXX');

    expect(pa?.format).toBe('hybrid');
    expect(pa?.source).toBe('GLEIF');
    expect(pa?.twn_nm).toBe('LONDON');
    expect(pa?.ctry).toBe('GB');
    expect(pa?.adr_line?.length).toBeGreaterThan(0);
    // The invention this whole module exists to prevent.
    expect(pa?.strt_nm).toBeUndefined();
    expect(pa?.bldg_nb).toBeUndefined();
  });

  it('serves town and country alone as a complete structured block', async () => {
    // The majority shape of the directory. It is what the three corpora ask of
    // an agent address, so it is complete rather than degraded — and it is
    // credited to the directory that published it, not to GLEIF.
    const pa = await postalAddress('UBSWCHZHXXX');

    expect(pa).toMatchObject({ twn_nm: 'ZURICH', ctry: 'CH', format: 'structured' });
    expect(pa?.source).toContain('SwiftCodes');
    expect(pa?.as_of).toBeNull();
    expect(pa?.strt_nm).toBeUndefined();
    expect(pa?.pst_cd).toBeUndefined();
  });
});

describe('the SIX seat lookup declines rather than answer wrongly', () => {
  it('never serves a BankMaster row for a foreign BIC', () => {
    // BankMaster carries rows for foreign euroSIC participants, where SIX is a
    // counterparty and not the allocation authority. Measured 26/08/2026 before
    // this guard existed: NDEAFIHH resolved to a row whose town column reads
    // "Nordea-Helsinki" — a postal designation that would have gone out as a
    // Finnish bank's TwnNm in preference to what GLEIF publishes.
    expect(lookupClearingSeatByBic('NDEAFIHHXXX')).toBeNull();
    expect(lookupClearingSeatByBic('COBADEFFXXX')).toBeNull();
  });

  it('serves GLEIF, not SIX, for those foreign BICs', async () => {
    const pa = await postalAddress('NDEAFIHHXXX');
    expect(pa?.source).toBe('GLEIF');
    expect(pa?.twn_nm).toBe('Helsinki');
    expect(pa?.ctry).toBe('FI');
  });

  it('declines when several head-office rows disagree on the address', () => {
    // HELNCH22XXX carries three head-office rows across St. Gallen and Basel.
    // We hold the data; we cannot name ONE seat, and picking the first row
    // would be choosing an address by row order.
    expect(lookupClearingSeatByBic('HELNCH22XXX')).toBeNull();
  });

  it('resolves a BIC8 by padding it to the head-office BIC11', () => {
    expect(lookupClearingSeatByBic('SNBZCHZZ')).toMatchObject({ town: 'Zürich', country: 'CH' });
  });
});
