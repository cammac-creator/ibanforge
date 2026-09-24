import { afterAll, describe, it, expect, vi } from 'vitest';

/**
 * Les lignes autrichiennes, belges et saint-marinaises ci-dessous sont
 * INVENTÉES (src/test-support/restricted-fixtures.ts) : ces trois registres
 * quittent le dépôt public (décision du 24/09/2026), et un test de recherche
 * qui se sautait sans eux ne testait rien sur une copie publique. Les lignes
 * slovaques sont les vraies, publiques : les conditions de la NBS en permettent
 * la réutilisation avec la citation.
 */
const { fixture, FX } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  return { fixture: m.installRestrictedFixture(), FX: m.FIXTURE };
});
afterAll(() => fixture.restore());

const {
  lookupNationalCode,
  nationalRegisterAvailable,
  nationalRegisterCredit,
  nationalRegisterEdition,
  normaliseCode,
} = await import('./national-registers.js');

/**
 * Austria, Belgium and Slovakia share one table because they are structurally
 * the same register: an authority allocates a fixed-width numeric code to an
 * institution and publishes the whole allocation. None carries the
 * retirement/successor pair the Bundesbank does, so none needs de-blz's extra
 * columns.
 */
describe('normaliseCode', () => {
  it('pads an Austrian code to the width the IBAN carries', () => {
    // The OeNB file writes the central bank as '100'; an Austrian IBAN carries
    // '00100'. Comparing them unpadded would call a real bank unallocated.
    expect(normaliseCode('AT', '100')).toBe('00100');
    expect(normaliseCode('AT', '00100')).toBe('00100');
    expect(normaliseCode('AT', '12000')).toBe('12000');
  });

  it('pads a Belgian code to three', () => {
    expect(normaliseCode('BE', '1')).toBe('001');
    expect(normaliseCode('BE', '001')).toBe('001');
  });

  it('pads a Slovak code to four', () => {
    // The NBS CSV writes Slovakia's largest bank as '200' and MONETA as '600';
    // a Slovak IBAN carries them in positions 5-8 as '0200' and '0600'. The
    // register's own PDF writes them padded, so this restores what the
    // publisher itself prints everywhere but in the CSV.
    expect(normaliseCode('SK', '200')).toBe('0200');
    expect(normaliseCode('SK', '0200')).toBe('0200');
    expect(normaliseCode('SK', '1100')).toBe('1100');
  });

  it('pads a San Marino ABI to five', () => {
    // The BCSM prints them padded already; the width is asserted anyway,
    // because IBAN positions 6-10 are what the lookup is compared against.
    expect(normaliseCode('SM', '3034')).toBe('03034');
    expect(normaliseCode('SM', '03034')).toBe('03034');
  });

  it('refuses anything that is not the digits of a bank code', () => {
    expect(normaliseCode('AT', '')).toBeNull();
    expect(normaliseCode('AT', '123456')).toBeNull();
    expect(normaliseCode('BE', '12X')).toBeNull();
    expect(normaliseCode('SK', '12345')).toBeNull();
    expect(normaliseCode('SM', '123456')).toBeNull();
  });
});

describe('lookupNationalCode', () => {
  const skipIf = (cc: string) => !nationalRegisterAvailable(cc);

  it('resolves an Austrian institution', () => {
    const hit = lookupNationalCode('AT', FX.AT.central.code);
    // The OeNB publishes 11 characters on every row, head offices included, and
    // the seeder stores what it publishes. This used to read 'BKAUATWW': the
    // truncation was invisible here because for a head office the trimmed three
    // characters are XXX, while one code group over they name a different bank.
    expect(hit?.bic).toBe(FX.AT.central.bic);
    expect(hit?.name).toBe(FX.AT.central.name);
  });

  it('resolves the code the register writes unpadded', () => {
    // L'OeNB écrit son propre code '100', un IBAN porte '00100' ; la ligne
    // inventée est stockée comme le fait le seeder, complétée.
    expect(lookupNationalCode('AT', FX.AT.padded.code.replace(/^0+/, ''))?.bic).toBe(
      FX.AT.padded.bic,
    );
    expect(lookupNationalCode('AT', FX.AT.padded.code)?.bic).toBe(FX.AT.padded.bic);
  });

  it('denies an Austrian code the register does not carry', () => {
    expect(lookupNationalCode('AT', FX.AT.unallocatedCode)).toBeNull();
  });

  it('resolves a Belgian institution', () => {
    expect(lookupNationalCode('BE', FX.BE.bank.code)?.bic).toBe(FX.BE.bank.bic);
    expect(lookupNationalCode('BE', FX.BE.emi.code)?.bic).toBe(FX.BE.emi.bic);
  });

  it('denies a Belgian slot the register marks free', () => {
    // The NBB publishes all 1000 slots and writes 'VRIJ' in the BIC column for
    // the 210 it has not allocated. Storing those would turn an explicit
    // "nobody holds this" into a resolved bank, which is the exact opposite of
    // what the register says.
    expect(lookupNationalCode('BE', FX.BE.unallocatedCode)).toBeNull();
  });

  it.skipIf(skipIf('SK'))('resolves a Slovak institution', () => {
    expect(lookupNationalCode('SK', '1100')?.bic).toBe('TATRSKBX');
    expect(lookupNationalCode('SK', '7500')?.name).toBe('Československá obchodná banka, a.s.');
  });

  it.skipIf(skipIf('SK'))('resolves the code the register writes unpadded', () => {
    // Published as '200', carried in an IBAN as '0200'.
    expect(lookupNationalCode('SK', '0200')?.bic).toBe('SUBASKBX');
  });

  it.skipIf(skipIf('SK'))('denies a Slovak code the register does not carry', () => {
    expect(lookupNationalCode('SK', '9999')).toBeNull();
    // 1200 is the bank code of the SWIFT registry's own Slovak example IBAN,
    // and the prevodník does not list it. An authoritative register has to say
    // so, which is the finding the 06/08/2026 post is about.
    expect(lookupNationalCode('SK', '1200')).toBeNull();
  });

  it.skipIf(skipIf('SK'))('carries the credit and the effective date on the row', () => {
    const hit = lookupNationalCode('SK', '1100');
    expect(hit?.source).toMatch(/^Národná banka Slovenska,/);
    expect(hit?.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves the credit columns null where the publisher asks for none', () => {
    const hit = lookupNationalCode('AT', FX.AT.bank.code);
    expect(hit?.source).toBeNull();
    expect(hit?.as_of).toBeNull();
  });

  it('resolves a San Marino operating bank, address included', () => {
    const hit = lookupNationalCode('SM', FX.SM.bank.code);
    expect(hit?.bic).toBe(FX.SM.bank.bic);
    expect(hit?.name).toBe(FX.SM.bank.name);
    expect(hit?.town).toBe(FX.SM.bank.town);
  });

  it('answers nothing for a code the BCSM page does not list', () => {
    // 03225 is the ABI of the ISO registry's own San Marino example IBAN. Null
    // here is NOT a denial — the caller in enrich.ts falls through to the
    // composite map rather than reading it as one. See sm-enrich.test.ts.
    expect(lookupNationalCode('SM', '03225')).toBeNull();
  });

  it('answers nothing for a country it does not hold', () => {
    expect(lookupNationalCode('FR', '30001')).toBeNull();
    expect(nationalRegisterAvailable('FR')).toBe(false);
  });
});

/**
 * The edition, read from the rows rather than from a clock.
 *
 * Slovakia is the country this exists for: the NBS terms make citing the source
 * a condition of reuse, and its page states a versioned effective date that our
 * monthly refresh month would misreport in both directions.
 */
describe('nationalRegisterEdition', () => {
  const skipIf = (cc: string) => !nationalRegisterAvailable(cc);

  it.skipIf(skipIf('SK'))('reads the Slovak version and effective date together', () => {
    const { source, as_of } = nationalRegisterEdition('SK');
    expect(source).toMatch(/^Národná banka Slovenska, .*version \d+$/);
    expect(as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // One query, so a version from one edition can never be printed beside a
    // date from another.
    expect(nationalRegisterCredit('SK')).toBe(`Zdroj: ${source} (${as_of})`);
  });

  it('answers null for a register that states no edition of its own', () => {
    expect(nationalRegisterEdition('AT')).toEqual({ source: null, as_of: null });
    expect(nationalRegisterEdition('BE')).toEqual({ source: null, as_of: null });
    expect(nationalRegisterEdition('FR')).toEqual({ source: null, as_of: null });
  });
});
