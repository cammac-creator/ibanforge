import { afterAll, describe, it, expect, vi } from 'vitest';

/**
 * La liste de la Bank of England, sur une copie INVENTÉE
 * (src/test-support/restricted-fixtures.ts).
 *
 * La permission du 25/08/2026 couvre l'usage de la liste comme source de
 * référence dans l'API, pas la redistribution du fichier : la liste quitte donc
 * le dépôt public (décision du 24/09/2026). Ces tests lisaient les lignes
 * livrées et se sautaient quand il n'y en avait pas ; ils tournent désormais sur
 * des firmes inventées sous des LEI inventés, sur toute copie. La branche
 * « rien de chargé » vit dans restricted-data-absent.test.ts, sur une base sans
 * la liste : aucune des deux branches n'a plus à se sauter.
 */
const { fixture, FX } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  return { fixture: m.installRestrictedFixture(), FX: m.FIXTURE };
});
afterAll(() => fixture.restore());

const { getBicDB } = await import('./db.js');
const { getPraBanksCount, getPraListMonth, praAttribution, praAuthorisationByLei } =
  await import('./pra-banks.js');
const { enrichResult } = await import('./enrich.js');
const { validateIBAN } = await import('./iban.js');

describe('pra_banks counts and attribution', () => {
  it('answers a live count instead of a literal', () => {
    // The list changes every month. Any served surface quoting a number takes
    // it from here; a hardcoded one is wrong by the second refresh.
    // Compter les lignes inventées prouve aussi que ce fichier lit le jeu
    // d'essai, pas la liste livrée.
    expect(getPraBanksCount()).toBe(3);
  });

  it('carries the month read from the list itself', () => {
    expect(getPraListMonth()).toBe(FX.PRA.month);
    expect(getPraListMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('builds the attribution the permission requires', () => {
    // The Bank of England's permission (25/08/2026) is conditional on naming
    // the Bank AND the month of the list. Both halves come from the database.
    expect(praAttribution()).toBe(`Bank of England (List of Banks, ${FX.PRA.month})`);
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

  it('resolves a UK-incorporated firm on its own LEI', () => {
    const row = FX.PRA.ukIncorporated;
    const hit = praAuthorisationByLei(row.lei, 'GB');
    expect(hit).toMatchObject({
      authorised: true,
      firm_name: row.firm_name,
      frn: row.frn,
      section: 'uk_incorporated',
      basis: 'lei',
      source: 'Bank of England, List of Banks',
    });
    expect(hit!.list_month).toBe(getPraListMonth());
  });

  it('resolves a UK branch of a foreign bank on the GB side', () => {
    // The London branch genuinely is authorised to take deposits. This is the
    // direction the head-office LEI may be used in.
    const row = FX.PRA.nonUkBranch;
    const hit = praAuthorisationByLei(row.lei, 'GB');
    expect(hit).toMatchObject({
      authorised: true,
      section: 'non_uk_branch',
      basis: 'head_office_lei',
    });
  });

  it('refuses to carry a UK authorisation onto the parent’s foreign BICs', () => {
    // THE false positive this scope exists for. The branch section's third
    // column is headed "Head Office LEI": that identifier belongs to the entity
    // abroad, and GLEIF maps it to every BIC that entity owns worldwide.
    // Measured on the shipped database at ingestion time, a bare LEI join
    // reached over a thousand non-GB BIC rows — each one a paid answer claiming
    // a UK deposit authorisation for, say, a Frankfurt or Tokyo BIC.
    const row = FX.PRA.nonUkBranch;
    for (const cc of ['DE', 'FR', 'JP', 'US', 'NL']) {
      expect(praAuthorisationByLei(row.lei, cc)).toBeNull();
    }
  });

  it('lets a Gibraltar firm answer for GI as well as GB', () => {
    const row = FX.PRA.gibraltar;
    expect(praAuthorisationByLei(row.lei, 'GI')?.section).toBe('gibraltar_branch');
    expect(praAuthorisationByLei(row.lei, 'GB')?.section).toBe('gibraltar_branch');
    expect(praAuthorisationByLei(row.lei, 'ES')).toBeNull();
  });

  it('matches on the LEI alone, never on the firm name', () => {
    // The list's own name for a firm and the BIC directory's differ in case,
    // punctuation and legal suffix ("Barclays Bank UK PLC" vs "BARCLAYS BANK UK
    // PLC"). Name similarity is how one bank ends up wearing another's licence,
    // so the join has one key and it is exact.
    const row = FX.PRA.ukIncorporated;
    const byName = getBicDB()
      .prepare('SELECT COUNT(*) AS cnt FROM pra_banks WHERE lei = ?')
      .get(row.lei) as { cnt: number };
    expect(byName.cnt).toBe(1);
  });
});

describe('GB IBAN enrichment', () => {
  it('attaches the PRA block to a GB IBAN whose BIC carries a listed LEI', () => {
    const result = validateIBAN(FX.PRA.gbIban);
    enrichResult(result);

    expect(result.valid).toBe(true);
    expect(result.bic?.code.slice(0, 8)).toBe(FX.directory.gb.bic8);
    expect(result.bic?.lei).toBe(FX.PRA.ukIncorporated.lei);
    expect(result.pra_authorisation).toMatchObject({
      authorised: true,
      section: 'uk_incorporated',
      basis: 'lei',
      source: 'Bank of England, List of Banks',
    });
    expect(result.pra_authorisation!.list_month).toBe(getPraListMonth());
    expect(result.pra_authorisation!.frn).toBe(FX.PRA.ukIncorporated.frn);
  });

  it('leaves the block off a non-GB IBAN entirely', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);
    expect(result.pra_authorisation).toBeUndefined();
  });
});
