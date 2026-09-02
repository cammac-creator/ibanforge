import { describe, it, expect } from 'vitest';
import {
  packAdrLines,
  stripRedundantSegments,
  toIso20022PostalAddress,
  type DirectoryAddressRow,
} from './postal-address.js';
import type { ChClearingSeatAddress } from './ch-clearing.js';

/** A SIX BankMaster seat, the only source with StrtNm and BldgNb really apart. */
const sixSeat: ChClearingSeatAddress = {
  iid: '00100',
  street: 'Börsenstrasse',
  building_number: '15',
  post_code: '8022',
  town: 'Zürich',
  country: 'CH',
  valid_on: '2026-08-03',
};

/** A GLEIF row: post code and city apart, street a single concatenated line. */
const gleifRow: DirectoryAddressRow = {
  country_code: 'DE',
  city: 'Karlsruhe',
  street: 'Schlossplatz 12',
  post_code: '76131',
  address_en: 'Schlossplatz 12',
  address_source: 'GLEIF',
  address_as_of: '2026-03-17',
  source: 'gleif',
};

/** The majority shape of the directory: a city, a country, and nothing else. */
const cityOnlyRow: DirectoryAddressRow = {
  country_code: 'CH',
  city: 'ZURICH',
  street: null,
  post_code: null,
  address_en: null,
  address_source: null,
  address_as_of: null,
  source: 'swiftcodes',
};

describe('toIso20022PostalAddress — the SIX case is the only structured street', () => {
  it('emits StrtNm and BldgNb from a SIX row, with no AdrLine at all', () => {
    const pa = toIso20022PostalAddress(null, sixSeat);

    expect(pa).not.toBeNull();
    expect(pa).toMatchObject({
      strt_nm: 'Börsenstrasse',
      bldg_nb: '15',
      pst_cd: '8022',
      twn_nm: 'Zürich',
      ctry: 'CH',
      format: 'structured',
      source: 'SIX BankMaster (Swiss IID register)',
      as_of: '2026-08-03',
    });
    // Everything SIX publishes has its own element, so a line here could only
    // repeat one of them — which the SPS guideline forbids outright.
    expect(pa?.adr_line).toBeUndefined();
  });

  it('prefers the SIX seat over the directory row when both are available', () => {
    const pa = toIso20022PostalAddress({ ...gleifRow, country_code: 'CH', city: 'Bern' }, sixSeat);
    expect(pa?.strt_nm).toBe('Börsenstrasse');
    expect(pa?.source).toBe('SIX BankMaster (Swiss IID register)');
  });

  it('falls back to the directory row when the SIX row carries no town', () => {
    const pa = toIso20022PostalAddress(gleifRow, { ...sixSeat, town: null });
    expect(pa?.source).toBe('GLEIF');
    expect(pa?.twn_nm).toBe('Karlsruhe');
  });
});

describe('toIso20022PostalAddress — a GLEIF street can only ever be an AdrLine', () => {
  it('never promotes the concatenated GLEIF line to StrtNm, and says the format is hybrid', () => {
    const pa = toIso20022PostalAddress(gleifRow);

    expect(pa).toMatchObject({
      pst_cd: '76131',
      twn_nm: 'Karlsruhe',
      ctry: 'DE',
      adr_line: ['Schlossplatz 12'],
      format: 'hybrid',
      source: 'GLEIF',
      as_of: '2026-03-17',
    });
    // The non-negotiable of this whole module. GLEIF ships `addressLines`
    // joined into one string; splitting it into a street and a number would be
    // a guess, and a guess is exactly what a payment rail bounces.
    expect(pa?.strt_nm).toBeUndefined();
    expect(pa?.bldg_nb).toBeUndefined();
  });

  it('drops the segment of the line that merely repeats the town', () => {
    const pa = toIso20022PostalAddress({
      ...gleifRow,
      country_code: 'NG',
      city: 'LAGOS',
      post_code: '100221',
      street: 'FIRST CITY PLAZA, 44 MARINA, LAGOS',
      address_en: 'FIRST CITY PLAZA, 44 MARINA, LAGOS',
    });

    expect(pa?.adr_line).toEqual(['FIRST CITY PLAZA, 44 MARINA']);
    expect(pa?.twn_nm).toBe('LAGOS');
  });

  it('is structured, not hybrid, when stripping leaves nothing to say', () => {
    const pa = toIso20022PostalAddress({
      ...gleifRow,
      city: 'Karlsruhe',
      post_code: '76131',
      street: '76131 Karlsruhe',
      address_en: '76131 Karlsruhe',
    });

    // `format` is derived from the block's final shape, never declared up
    // front, so it cannot disagree with the fields it labels.
    expect(pa?.adr_line).toBeUndefined();
    expect(pa?.format).toBe('structured');
  });

  it('omits the AdrLine rather than truncate a line that will not fit in 2 x 70', () => {
    const monster =
      'ROOM 1601, FLOOR 3, FLOOR 13 (ACTUAL FLOOR 12), FLOOR 15 (ACTUAL FLOOR 13), FLOOR 16 ' +
      '(ACTUAL FLOOR 14), FLOOR 17 (ACTUAL FLOOR 15), FLOOR 18 (ACTUAL FLOOR 16), UOB Building, ' +
      'NO. 116, 128, YIN CHENG ROAD, PUDONG NEW AREA';
    const pa = toIso20022PostalAddress({
      ...gleifRow,
      country_code: 'CN',
      city: 'SHANGHAI',
      street: monster,
      address_en: monster,
    });

    // A wrong address is worse than an incomplete one, and nothing is lost from
    // the response: the untouched line is still served in the `address` block.
    expect(pa?.adr_line).toBeUndefined();
    expect(pa?.format).toBe('structured');
    expect(pa?.twn_nm).toBe('SHANGHAI');
  });

  it('serves the GLEIF English alternative when the stored line is non-Latin, and no line at all when there is none', () => {
    const withEnglish = toIso20022PostalAddress({
      ...gleifRow,
      country_code: 'GR',
      city: 'ATHENS',
      street: 'Πανεπιστημίου 40',
      address_en: '40 Panepistimiou Street',
    });
    expect(withEnglish?.adr_line).toEqual(['40 Panepistimiou Street']);

    const withoutEnglish = toIso20022PostalAddress({
      ...gleifRow,
      country_code: 'GR',
      city: 'ATHENS',
      street: 'Πανεπιστημίου 40',
      address_en: null,
    });
    // A transliteration is never invented — here no more than anywhere else.
    expect(withoutEnglish?.adr_line).toBeUndefined();
    expect(withoutEnglish?.twn_nm).toBe('ATHENS');
  });
});

describe('toIso20022PostalAddress — town and country are the core, and the floor', () => {
  it('builds a complete structured block from a city and a country alone', () => {
    // This is the shape of the great majority of the directory, and the reason
    // the greffon exists: town + country is exactly, and only, what the three
    // corpora require of an AGENT address. It is complete, not degraded.
    const pa = toIso20022PostalAddress(cityOnlyRow);

    expect(pa).toEqual({
      twn_nm: 'ZURICH',
      ctry: 'CH',
      format: 'structured',
      source: 'Redistributed SWIFT BIC directory (PeterNotenboom/SwiftCodes, MIT)',
      as_of: null,
    });
  });

  it('returns null when the town is missing, even with a street in hand', () => {
    // A PostalAddress without TwnNm is rejected by all three rails. Serving one
    // would be serving a block nobody can put in a message.
    const pa = toIso20022PostalAddress({ ...gleifRow, city: null });
    expect(pa).toBeNull();
  });

  it('returns null on a null row and no SIX seat', () => {
    expect(toIso20022PostalAddress(null)).toBeNull();
    expect(toIso20022PostalAddress(undefined, null)).toBeNull();
  });

  it('upper-cases the country and treats a blank field as absent', () => {
    const pa = toIso20022PostalAddress({ ...cityOnlyRow, country_code: 'ch', post_code: '   ' });
    expect(pa?.ctry).toBe('CH');
    expect(pa?.pst_cd).toBeUndefined();
  });
});

describe('provenance is locked, not decorated', () => {
  it('never reads a clock: as_of is null when the dataset publishes no date', () => {
    // An address dated today from a file published last year is a false
    // statement about the register. If this test ever fails, someone has
    // "improved" the mapping with a Date.now().
    const pa = toIso20022PostalAddress({ ...gleifRow, address_as_of: null });
    expect(pa?.as_of).toBeNull();
  });

  it('credits the dataset that named the row, not GLEIF, when there is no GLEIF address block', () => {
    // The SwiftCodes rows carry a city and no address block at all. Crediting
    // GLEIF for their town would attribute data to a registry that never
    // published it.
    expect(toIso20022PostalAddress(cityOnlyRow)?.source).toContain('SwiftCodes');
    expect(toIso20022PostalAddress({ ...cityOnlyRow, source: 'bundesbank' })?.source).toBe(
      'Deutsche Bundesbank Bankleitzahlendatei',
    );
  });

  it('carries the SIX validity date on a SIX block and the GLEIF filing date on a GLEIF one', () => {
    expect(toIso20022PostalAddress(null, sixSeat)?.as_of).toBe('2026-08-03');
    expect(toIso20022PostalAddress(gleifRow)?.as_of).toBe('2026-03-17');
  });
});

describe('stripRedundantSegments — segment level, never token level', () => {
  it('drops a whole segment that equals a structured value', () => {
    const out = stripRedundantSegments('FIRST CITY PLAZA, 44 MARINA, LAGOS', new Set(['lagos']));
    expect(out).toBe('FIRST CITY PLAZA, 44 MARINA');
  });

  it('leaves a street whose NAME contains the town untouched', () => {
    // The reason the strip is segment level. A token-level strip would have
    // turned this into "Rue de 5" — mangling a street name is a worse failure
    // than leaving one redundant word standing.
    const out = stripRedundantSegments('Rue de Lausanne 5', new Set(['lausanne']));
    expect(out).toBe('Rue de Lausanne 5');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(
      stripRedundantSegments('Bahnhofstrasse 45,  8001   ZURICH', new Set(['8001 zurich'])),
    ).toBe('Bahnhofstrasse 45');
  });
});

describe('packAdrLines — at most 2 lines of at most 70 characters', () => {
  it('keeps a short line as one line', () => {
    expect(packAdrLines('Schlossplatz 12')).toEqual(['Schlossplatz 12']);
  });

  it('splits on a segment boundary before splitting on a space', () => {
    const long = `${'A'.repeat(60)}, ${'B'.repeat(60)}`;
    expect(packAdrLines(long)).toEqual(['A'.repeat(60), 'B'.repeat(60)]);
  });

  it('falls back to word boundaries when there are no segments', () => {
    const words = `${'word '.repeat(20)}end`.trim();
    const lines = packAdrLines(words);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(70);
  });

  it('returns nothing when the content cannot fit in two lines', () => {
    expect(packAdrLines('x'.repeat(200))).toEqual([]);
    expect(packAdrLines(`${'word '.repeat(60)}end`)).toEqual([]);
  });

  it('returns nothing for an empty line', () => {
    expect(packAdrLines('   ')).toEqual([]);
  });
});
