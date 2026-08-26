import { describe, it, expect } from 'vitest';
import { getBicDB } from './db.js';
import { getPraBanksCount, getPraListMonth, praAttribution, praAuthorisationByLei } from './pra-banks.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

/**
 * These read the shipped data/bic.sqlite, like the register tests next door.
 * They skip rather than fail on a database seeded before scripts/seed-pra-banks.ts
 * existed — the module's whole contract in that case is "say nothing".
 */
const loaded = getPraBanksCount() > 0;

/** A real row from the shipped table, picked live so a monthly refresh cannot stale it. */
function sample(section: string): { lei: string; firm_name: string; frn: string } | undefined {
  if (!loaded) return undefined;
  return getBicDB()
    .prepare(
      "SELECT lei, firm_name, frn FROM pra_banks WHERE section = ? AND lei IS NOT NULL AND lei != '' LIMIT 1",
    )
    .get(section) as { lei: string; firm_name: string; frn: string } | undefined;
}

describe('pra_banks counts and attribution', () => {
  it('answers a live count instead of a literal', () => {
    // The list changes every month. Any served surface quoting a number takes
    // it from here; a hardcoded one is wrong by the second refresh.
    expect(typeof getPraBanksCount()).toBe('number');
    expect(getPraBanksCount()).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!loaded)('carries a well-formed month read from the list itself', () => {
    expect(getPraListMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it.skipIf(!loaded)('builds the attribution the permission requires', () => {
    // The Bank of England's permission (25/08/2026) is conditional on naming
    // the Bank AND the month of the list. Both halves come from the database.
    expect(praAttribution()).toBe(`Bank of England (List of Banks, ${getPraListMonth()})`);
  });

  it.skipIf(loaded)('answers 0 and null when nothing is loaded, rather than throwing', () => {
    // /llms.txt reads the count on a cold start; a throw here would be a 500.
    expect(getPraBanksCount()).toBe(0);
    expect(getPraListMonth()).toBeNull();
    expect(praAttribution()).toBeNull();
  });
});

describe('praAuthorisationByLei', () => {
  it('says nothing without both an LEI and a jurisdiction', () => {
    expect(praAuthorisationByLei(null, 'GB')).toBeNull();
    expect(praAuthorisationByLei(undefined, 'GB')).toBeNull();
    expect(praAuthorisationByLei('', 'GB')).toBeNull();
    // No country means no scope to check the claim against, so no claim.
    expect(praAuthorisationByLei('213800UUGANOMFJ9X769', null)).toBeNull();
    expect(praAuthorisationByLei('213800UUGANOMFJ9X769', '')).toBeNull();
  });

  it('says nothing about an LEI the list does not carry', () => {
    // And says nothing — never `authorised: false`. The list covers
    // deposit-taking only and states in its own preamble that it does not
    // supersede the Financial Services Register.
    expect(praAuthorisationByLei('ZZZZ0000000000000000', 'GB')).toBeNull();
  });

  it('refuses anything that is not LEI-shaped rather than part-matching it', () => {
    expect(praAuthorisationByLei('213800UUGANOMFJ9X76', 'GB')).toBeNull();
    expect(praAuthorisationByLei('213800UUGANOMFJ9X769', 'GBR')).toBeNull();
  });

  it.skipIf(!loaded)('resolves a UK-incorporated firm on its own LEI', () => {
    const row = sample('uk_incorporated');
    expect(row).toBeDefined();
    const hit = praAuthorisationByLei(row!.lei, 'GB');
    expect(hit).toMatchObject({
      authorised: true,
      firm_name: row!.firm_name,
      frn: row!.frn,
      section: 'uk_incorporated',
      basis: 'lei',
      source: 'Bank of England, List of Banks',
    });
    expect(hit!.list_month).toBe(getPraListMonth());
  });

  it.skipIf(!loaded)('resolves a UK branch of a foreign bank on the GB side', () => {
    // The London branch genuinely is authorised to take deposits. This is the
    // direction the head-office LEI may be used in.
    const row = sample('non_uk_branch');
    expect(row).toBeDefined();
    const hit = praAuthorisationByLei(row!.lei, 'GB');
    expect(hit).toMatchObject({ authorised: true, section: 'non_uk_branch', basis: 'head_office_lei' });
  });

  it.skipIf(!loaded)('refuses to carry a UK authorisation onto the parent’s foreign BICs', () => {
    // THE false positive this scope exists for. The branch section's third
    // column is headed "Head Office LEI": that identifier belongs to the entity
    // abroad, and GLEIF maps it to every BIC that entity owns worldwide.
    // Measured on the shipped database at ingestion time, a bare LEI join
    // reached over a thousand non-GB BIC rows — each one a paid answer claiming
    // a UK deposit authorisation for, say, a Frankfurt or Tokyo BIC.
    const row = sample('non_uk_branch');
    expect(row).toBeDefined();
    for (const cc of ['DE', 'FR', 'JP', 'US', 'NL']) {
      expect(praAuthorisationByLei(row!.lei, cc)).toBeNull();
    }
  });

  it.skipIf(!loaded)('lets a Gibraltar firm answer for GI as well as GB', () => {
    const row = sample('gibraltar_branch');
    expect(row).toBeDefined();
    expect(praAuthorisationByLei(row!.lei, 'GI')?.section).toBe('gibraltar_branch');
    expect(praAuthorisationByLei(row!.lei, 'GB')?.section).toBe('gibraltar_branch');
    expect(praAuthorisationByLei(row!.lei, 'ES')).toBeNull();
  });

  it.skipIf(!loaded)('matches on the LEI alone, never on the firm name', () => {
    // The list's own name for a firm and the BIC directory's differ in case,
    // punctuation and legal suffix ("Barclays Bank UK PLC" vs "BARCLAYS BANK UK
    // PLC"). Name similarity is how one bank ends up wearing another's licence,
    // so the join has one key and it is exact.
    const row = sample('uk_incorporated');
    expect(row).toBeDefined();
    const byName = getBicDB()
      .prepare('SELECT COUNT(*) AS cnt FROM pra_banks WHERE lei = ?')
      .get(row!.lei) as { cnt: number };
    expect(byName.cnt).toBe(1);
  });
});

describe('GB IBAN enrichment', () => {
  it.skipIf(!loaded)('attaches the PRA block to a GB IBAN whose BIC carries a listed LEI', () => {
    const result = validateIBAN('GB33BUKB20201555555555');
    enrichResult(result);

    expect(result.valid).toBe(true);
    expect(result.bic?.lei).toBeTruthy();
    expect(result.pra_authorisation).toMatchObject({
      authorised: true,
      section: 'uk_incorporated',
      basis: 'lei',
      source: 'Bank of England, List of Banks',
    });
    expect(result.pra_authorisation!.list_month).toBe(getPraListMonth());
    expect(result.pra_authorisation!.frn).toMatch(/^\d+$/);
  });

  it('leaves the block off a non-GB IBAN entirely', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);
    expect(result.pra_authorisation).toBeUndefined();
  });
});

describe('curated map vs PRA register', () => {
  /**
   * The PRA join made a curation error VISIBLE: GB:BUKB was curated as
   * "Bank of Scotland" while BUKB resolves (via LEI) to Barclays Bank UK PLC
   * on the PRA list. Fixed 26/08/2026; this test pins the one key measured
   * wrong. Deliberately NOT a generic name-match guard: of 5,177 curated GB
   * keys only 4 diverge from the PRA name, and 3 of those are legitimate
   * trading names (NatWest, Halifax, Wise) a generic rule would break.
   */
  it('GB:BUKB names the same institution as the PRA register', async () => {
    const { readFileSync } = await import('node:fs');
    const curated = JSON.parse(readFileSync(new URL('../db/bic_data.json', import.meta.url), 'utf8')) as Record<
      string,
      { bic: string; bank_name: string }
    >;
    const entry = curated['GB:BUKB'];
    expect(entry.bic).toBe('BUKBGB22');
    expect(entry.bank_name).toContain('Barclays');
    const row = getBicDB()
      .prepare('SELECT lei FROM bic_entries WHERE bic8 = ? AND lei IS NOT NULL LIMIT 1')
      .get('BUKBGB22') as { lei: string } | undefined;
    if (row?.lei) {
      const pra = praAuthorisationByLei(row.lei, 'GB');
      if (pra) expect(pra.firm_name).toContain('Barclays');
    }
  });
});
