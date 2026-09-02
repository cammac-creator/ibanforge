import { describe, it, expect } from 'vitest';
import { getBicDB } from './db.js';
import {
  getBdeListDate,
  getBdeMfiCount,
  getEcbListDate,
  getEcbMfiCount,
  officialIdentityByLei,
  officialIdentityByNationalCode,
  type OfficialIdentity,
} from './official-identity.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

/**
 * These read the shipped data/bic.sqlite, like the PRA and register tests next
 * door, and skip rather than fail on a database seeded before
 * scripts/seed-ecb-mfi.ts existed — the module's whole contract in that case is
 * "say nothing".
 *
 * Rows are sampled LIVE from the table rather than pinned as literals. Both
 * lists are republished daily; a fixture naming a specific institution would go
 * stale within the week, and a test that goes stale gets deleted rather than
 * fixed.
 */
const ecbLoaded = getEcbMfiCount() > 0;
const bdeLoaded = getBdeMfiCount() > 0;

function sampleEcbByLei(): { lei: string; name: string } | undefined {
  if (!ecbLoaded) return undefined;
  return getBicDB()
    .prepare("SELECT lei, name FROM ecb_mfi WHERE lei IS NOT NULL AND lei != '' LIMIT 1")
    .get() as { lei: string; name: string } | undefined;
}

function sampleFrenchCode(): { national_bank_code: string; name: string } | undefined {
  if (!ecbLoaded) return undefined;
  return getBicDB()
    .prepare(
      "SELECT national_bank_code, name FROM ecb_mfi WHERE country = 'FR' AND national_bank_code IS NOT NULL LIMIT 1",
    )
    .get() as { national_bank_code: string; name: string } | undefined;
}

function sampleSpanishCode(): { code: string; name: string } | undefined {
  if (!bdeLoaded) return undefined;
  return getBicDB().prepare('SELECT code, name FROM bde_mfi LIMIT 1').get() as
    { code: string; name: string } | undefined;
}

// ---------------------------------------------------------------------------
// THE PROVENANCE CONTRACT
// ---------------------------------------------------------------------------

/**
 * Both licences permit this reuse on conditions that travel WITH the data, not
 * on a documentation page:
 *
 *   - the publisher must be cited as the source, on every reproduction;
 *   - because this API is sold, buyers must be told the information is
 *     available free of charge from the publisher's own website "each time they
 *     access" it (ECB), "on each occasion that the information ... is made
 *     available to them" (Banco de España);
 *   - and the date is what keeps a dated claim about a bank code honest.
 *
 * So this block asserts on the SERIALISED object, not on named fields. A field
 * rename that drops the free-of-charge sentence would still pass a
 * `expect(x.free_of_charge).toBeDefined()` written against the new name; it
 * cannot pass this. A block reaching a customer without one of these three
 * things is a licence breach, so it is a red test.
 */
function expectProvenanceContract(block: OfficialIdentity): void {
  const serialised = JSON.stringify(block);
  expect(block.source, 'every block names its publisher').toBeTruthy();
  expect(block.as_of, 'every block is dated by the list it came from').toMatch(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  expect(serialised, 'every block tells buyers the data is free at the source').toMatch(
    /free of charge|free at/i,
  );
  // Never presented as authoritative: both publishers relay, neither allocates
  // bank codes, and the Banco de España disclaims decisions taken on its data.
  expect(block.authoritative).toBe(false);
}

describe('the provenance contract', () => {
  it.skipIf(!ecbLoaded)('holds on an ECB block reached by LEI', () => {
    const row = sampleEcbByLei()!;
    const block = officialIdentityByLei(row.lei)!;
    expect(block).not.toBeNull();
    expectProvenanceContract(block);
    expect(block.source).toContain('European Central Bank');
  });

  it.skipIf(!ecbLoaded)('holds on an ECB block reached by the French bank code', () => {
    const row = sampleFrenchCode()!;
    const block = officialIdentityByNationalCode('FR', row.national_bank_code)!;
    expect(block).not.toBeNull();
    expectProvenanceContract(block);
  });

  it.skipIf(!bdeLoaded)(
    'holds on a Banco de España block, and carries their formula verbatim',
    () => {
      const row = sampleSpanishCode()!;
      const block = officialIdentityByNationalCode('ES', row.code)!;
      expect(block).not.toBeNull();
      expectProvenanceContract(block);
      expect(block.source).toBe('Banco de España, list of MFIs');
      // Word for word. Their terms require reproduction "faithfully, without any
      // manipulation or alteration"; a paraphrased credit line is not the credit
      // line we were given.
      expect(block.attribution).toBe(
        'Own elaboration based on data from the Banco de España website (www.bde.es)',
      );
    },
  );

  it.skipIf(!bdeLoaded)(
    'states the free-of-charge notice for the right publisher on a Spanish block',
    () => {
      // The brief scoped this notice to the ECB. The Banco de España's own legal
      // notice imposes the identical duty for information sold or transferred for
      // consideration, so the Spanish block carries it too — pointing at bde.es,
      // not at the ECB.
      const row = sampleSpanishCode()!;
      const block = officialIdentityByNationalCode('ES', row.code)!;
      expect(block.free_of_charge).toContain('bde.es');
      expect(block.free_of_charge).not.toContain('ecb.europa.eu');
    },
  );
});

// ---------------------------------------------------------------------------
// Joins
// ---------------------------------------------------------------------------

describe('officialIdentityByLei', () => {
  it('says nothing without an LEI', () => {
    expect(officialIdentityByLei(null)).toBeNull();
    expect(officialIdentityByLei(undefined)).toBeNull();
    expect(officialIdentityByLei('')).toBeNull();
  });

  it('refuses anything that is not LEI-shaped rather than part-matching it', () => {
    expect(officialIdentityByLei('EXAMPLE0LEI00000000')).toBeNull();
    expect(officialIdentityByLei('EXAMPLE0LEI0000000012')).toBeNull();
  });

  it('says nothing — never a negative block — about an LEI the list omits', () => {
    // Absence from the list is not evidence about the institution. Same
    // discipline as pra_authorisation and iban_issuer: 'not_listed'.
    expect(officialIdentityByLei('ZZZZ0000000000000000')).toBeNull();
  });

  it.skipIf(!ecbLoaded)('names the holder of a listed LEI', () => {
    const row = sampleEcbByLei()!;
    const block = officialIdentityByLei(row.lei)!;
    expect(block.name).toBe(row.name);
    expect(block.lei).toBe(row.lei);
    expect(block.matched_by).toBe('lei');
  });

  it.skipIf(!ecbLoaded)('is case-insensitive on the LEI it is handed', () => {
    const row = sampleEcbByLei()!;
    expect(officialIdentityByLei(row.lei.toLowerCase())?.name).toBe(row.name);
  });

  it.skipIf(!ecbLoaded)(
    'serves one identity to every BIC an institution owns (the LEI fan-out)',
    () => {
      // A single LEI carries many BICs — measured 2026-08-26, 232 of the LEIs on
      // this list map to more than one BIC8, and one of them covers 42 across as
      // many countries. So one row legitimately answers many different BIC
      // lookups, and it must answer the SAME thing each time: the identity is a
      // fact about the legal entity, not about which of its BICs was asked.
      const fanned = getBicDB()
        .prepare(
          `SELECT m.lei AS lei, COUNT(DISTINCT b.bic8) AS n
           FROM ecb_mfi m JOIN bic_entries b ON b.lei = m.lei
          GROUP BY m.lei HAVING n > 1 LIMIT 1`,
        )
        .get() as { lei: string; n: number } | undefined;
      if (!fanned) return;

      const bics = getBicDB()
        .prepare('SELECT DISTINCT bic8, country_code FROM bic_entries WHERE lei = ? ORDER BY bic8')
        .all(fanned.lei) as Array<{ bic8: string; country_code: string }>;
      expect(bics.length).toBeGreaterThan(1);

      const blocks = bics.map(() => officialIdentityByLei(fanned.lei));
      for (const block of blocks) {
        expect(block).not.toBeNull();
        expectProvenanceContract(block!);
      }
      // Identical, whichever BIC was the way in — and in particular not
      // suppressed for the entity's foreign BICs, which is where a country scope
      // borrowed from pra-banks.ts would have silently dropped the identity.
      const distinct = new Set(blocks.map((b) => JSON.stringify(b)));
      expect(distinct.size).toBe(1);
    },
  );
});

describe('officialIdentityByNationalCode', () => {
  it('answers only for the two countries whose publisher gives a bank code', () => {
    expect(officialIdentityByNationalCode(null, '30004')).toBeNull();
    expect(officialIdentityByNationalCode('FR', null)).toBeNull();
    // Germany and Poland carry the identical XX+5-digit RIAD shape, and it is
    // NOT their Bankleitzahl. Answering here would put one institution's name
    // behind another's IBAN.
    expect(officialIdentityByNationalCode('DE', '07802')).toBeNull();
    expect(officialIdentityByNationalCode('PL', '00105')).toBeNull();
    // Portugal's circulating mapping heuristic is undocumented and stays out.
    expect(officialIdentityByNationalCode('PT', '0010')).toBeNull();
  });

  it('refuses a code of the wrong length for its country', () => {
    expect(officialIdentityByNationalCode('FR', '3000')).toBeNull();
    expect(officialIdentityByNationalCode('FR', '300041')).toBeNull();
    expect(officialIdentityByNationalCode('ES', '21000')).toBeNull();
    expect(officialIdentityByNationalCode('ES', 'ABCD')).toBeNull();
  });

  it.skipIf(!ecbLoaded)('names the French institution behind a code banque', () => {
    const row = sampleFrenchCode()!;
    const block = officialIdentityByNationalCode('FR', row.national_bank_code)!;
    expect(block.name).toBe(row.name);
    expect(block.matched_by).toBe('national_code');
  });

  it.skipIf(!bdeLoaded)('names the Spanish institution behind a supervisory code', () => {
    const row = sampleSpanishCode()!;
    const block = officialIdentityByNationalCode('ES', row.code)!;
    expect(block.name).toBe(row.name);
    expect(block.matched_by).toBe('national_code');
  });

  it.skipIf(!bdeLoaded)('says nothing about a four-digit code Spain does not allocate', () => {
    const taken = new Set(
      (getBicDB().prepare('SELECT code FROM bde_mfi').all() as Array<{ code: string }>).map(
        (r) => r.code,
      ),
    );
    const free = ['9999', '9998', '9997'].find((c) => !taken.has(c));
    expect(free).toBeDefined();
    expect(officialIdentityByNationalCode('ES', free!)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wiring, and what must NOT move
// ---------------------------------------------------------------------------

describe('enrichResult wiring', () => {
  it('answers live counts and dates instead of literals', () => {
    expect(typeof getEcbMfiCount()).toBe('number');
    expect(typeof getBdeMfiCount()).toBe('number');
    if (ecbLoaded) expect(getEcbListDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    else expect(getEcbListDate()).toBeNull();
    if (bdeLoaded) expect(getBdeListDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    else expect(getBdeListDate()).toBeNull();
  });

  it.skipIf(!ecbLoaded)('attaches the block to a French IBAN carrying a listed code banque', () => {
    const row = sampleFrenchCode()!;
    // Account digits are arbitrary; only the bank code is being exercised.
    const result = validateIBAN(
      buildIban('FR', row.national_bank_code + '01005' + '0500013M02606'),
    );
    if (!result.valid) return;
    enrichResult(result);
    expect(result.official_identity).toBeDefined();
    expectProvenanceContract(result.official_identity!);
    expect(result.official_identity!.name).toBe(row.name);
  });

  it.skipIf(!bdeLoaded)(
    'attaches the block to a Spanish IBAN carrying a listed supervisory code',
    () => {
      const row = sampleSpanishCode()!;
      const result = validateIBAN(buildIban('ES', row.code + '0418450200051332'));
      if (!result.valid) return;
      enrichResult(result);
      expect(result.official_identity).toBeDefined();
      expectProvenanceContract(result.official_identity!);
      expect(result.official_identity!.name).toBe(row.name);
    },
  );

  it.skipIf(!ecbLoaded || !bdeLoaded)('changes neither `valid` nor `bank_code_check`', () => {
    // The whole safety argument of this feature. Both publishers relay rather
    // than allocate, and the Banco de España's terms forbid presenting its data
    // as having legal effect — so the block is additive identity and nothing
    // else. If it ever starts driving the verdict, it has to be re-licensed.
    for (const [cc, bban] of [
      ['FR', sampleFrenchCode()!.national_bank_code + '010050500013M02606'],
      ['ES', sampleSpanishCode()!.code + '0418450200051332'],
    ] as const) {
      const result = validateIBAN(buildIban(cc, bban));
      if (!result.valid) continue;
      enrichResult(result);
      expect(result.valid).toBe(true);
      expect(result.official_identity).toBeDefined();
      // Never promoted to a register: an absence from these lists must not be
      // readable as "this bank code is not allocated".
      expect(result.bank_code_check!.authoritative).toBe(false);
      expect(result.bank_code_check!.register).toContain('composite bank-code map');
    }
  });
});

/** Build a checksum-correct IBAN from a BBAN. Fixture accounts, owned by nobody. */
function buildIban(cc: string, bban: string): string {
  const rearranged = (bban + cc + '00')
    .split('')
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  let remainder = 0;
  for (const ch of rearranged) remainder = (remainder * 10 + Number(ch)) % 97;
  return cc + String(98 - remainder).padStart(2, '0') + bban;
}
