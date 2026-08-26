import { describe, it, expect } from 'vitest';
import {
  ECB_MFI_COLUMNS,
  BDE_MFI_COLUMNS,
  composeAddress,
  decodeEcbCsv,
  nationalBankCode,
  normaliseLei,
  parseBdeMfi,
  parseCsvRecords,
  parseEcbMfi,
} from './seed-ecb-mfi.js';

/**
 * Fixtures are INVENTED, in the real published shape. "Alpha Bank Example" and
 * friends exist nowhere; the LEIs are 20 alphanumerics that belong to no one.
 * The shapes — UTF-16LE with a BOM, tab delimiters, ~900 trailing spaces per
 * Spanish field — are copied from the live files because those shapes are
 * exactly what breaks.
 */

const ECB_HEADER = ECB_MFI_COLUMNS.join('\t');

/** One tab-delimited ECB row from its 14 fields. */
function ecbRow(f: Partial<Record<(typeof ECB_MFI_COLUMNS)[number], string>>): string {
  return ECB_MFI_COLUMNS.map((c) => f[c] ?? '').join('\t');
}

function ecbFile(...rows: string[]): string {
  // CRLF, as published.
  return [ECB_HEADER, ...rows].join('\r\n') + '\r\n';
}

/**
 * Encode a document the way the ECB actually serves it: UTF-16 little-endian
 * with a byte-order mark. Built here rather than hand-decoded in the test so
 * decodeEcbCsv() is exercised on real bytes — the encoding is the single most
 * likely thing to change upstream, and a test that starts from a JS string
 * would never notice.
 */
function asUtf16le(text: string): Uint8Array {
  const body = Buffer.from(text, 'utf16le');
  const bom = Buffer.from([0xff, 0xfe]);
  return new Uint8Array(Buffer.concat([bom, body]));
}

describe('decodeEcbCsv', () => {
  it('reads UTF-16LE and strips the BOM', () => {
    const text = ecbFile(
      ecbRow({ RIAD_CODE: 'FR99001', COUNTRY_OF_REGISTRATION: 'FR', NAME: 'Alpha Bank Example' }),
    );
    const decoded = decodeEcbCsv(asUtf16le(text));
    // A leftover BOM becomes part of the first header cell and no column
    // comparison ever matches again.
    expect(decoded.charCodeAt(0)).not.toBe(0xfeff);
    expect(decoded.startsWith('RIAD_CODE\t')).toBe(true);
    expect(decoded).toContain('Alpha Bank Example');
  });

  it('survives the accented and non-Latin names the list actually carries', () => {
    // The Latvian, Polish and Spanish rows are why the encoding matters at all.
    const text = ecbFile(
      ecbRow({ RIAD_CODE: 'PL99001', COUNTRY_OF_REGISTRATION: 'PL', NAME: 'Bank Przykładowy Śląski S.A.' }),
    );
    const parsed = parseEcbMfi(decodeEcbCsv(asUtf16le(text)));
    expect(parsed.rows[0].name).toBe('Bank Przykładowy Śląski S.A.');
  });

  it('round-trips a document read as UTF-8 into something parseEcbMfi rejects', () => {
    // The failure this guards is silent, not loud: UTF-16 bytes read as UTF-8
    // still split on tabs and still produce rows. The header check is what
    // turns that into a thrown error instead of a database full of mojibake.
    const bytes = asUtf16le(ecbFile(ecbRow({ RIAD_CODE: 'FR99001', COUNTRY_OF_REGISTRATION: 'FR', NAME: 'X' })));
    const wrong = new TextDecoder('utf-8').decode(bytes);
    expect(() => parseEcbMfi(wrong)).toThrow(/columns moved/i);
  });
});

describe('parseEcbMfi', () => {
  it('reads the published columns into rows', () => {
    const text = ecbFile(
      ecbRow({
        RIAD_CODE: 'FR30099',
        LEI: 'EXAMPLE0LEI000000001',
        COUNTRY_OF_REGISTRATION: 'FR',
        NAME: 'Alpha Bank Example, S.A.',
        ADDRESS: '1 RUE DE LA PAIX',
        POSTAL: '75002',
        CITY: 'PARIS',
        CATEGORY: 'Credit Institution',
      }),
    );
    const { rows } = parseEcbMfi(decodeEcbCsv(asUtf16le(text)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      riad_code: 'FR30099',
      country: 'FR',
      // The name carries a comma and survives it — the delimiter is a tab, and
      // this is the row that proves a comma split would shred the file.
      name: 'Alpha Bank Example, S.A.',
      lei: 'EXAMPLE0LEI000000001',
      address: '1 RUE DE LA PAIX, 75002 PARIS',
      category: 'Credit Institution',
      national_bank_code: '30099',
    });
  });

  it('throws rather than guessing when a column is inserted upstream', () => {
    // A silent insertion shifts ADDRESS into POSTAL and hands every institution
    // its neighbour's street. It parses perfectly and reads plausibly, which is
    // why it has to be a throw and not a warning.
    const shifted = ['RIAD_CODE\tLEI\tNEW_COLUMN\tCOUNTRY_OF_REGISTRATION', 'a\tb\tc\td'].join('\r\n');
    expect(() => parseEcbMfi(shifted)).toThrow(/columns moved/i);
  });

  it('throws on a row with the wrong number of fields', () => {
    const text = [ECB_HEADER, 'FR30099\tonly\ttwo'].join('\r\n');
    expect(() => parseEcbMfi(text)).toThrow(/fields, expected 14/);
  });

  it('throws on a row with no name, rather than storing a nameless institution', () => {
    const text = ecbFile(ecbRow({ RIAD_CODE: 'FR30099', COUNTRY_OF_REGISTRATION: 'FR', NAME: '' }));
    expect(() => parseEcbMfi(text)).toThrow(/missing RIAD code or name/);
  });

  it("keeps the euro-area 'E$' rows as published without treating them as a country", () => {
    // Two real rows (the ECB itself and the EIB) carry 'E$' where an ISO code
    // would go. Stored verbatim, and no national-code path can reach them.
    const text = ecbFile(
      ecbRow({ RIAD_CODE: 'E$0EXAMPLE00001', COUNTRY_OF_REGISTRATION: 'E$', NAME: 'Example Central Bank', CATEGORY: 'Central Bank' }),
    );
    const { rows } = parseEcbMfi(text);
    expect(rows[0].country).toBe('E$');
    expect(rows[0].national_bank_code).toBeNull();
  });
});

describe('nationalBankCode', () => {
  it('reads the French code banque out of a French RIAD code', () => {
    expect(nationalBankCode('FR', 'FR30099')).toBe('30099');
  });

  it('refuses the identical shape from any other country', () => {
    // This is the whole guard. On the live file 1,240 German rows and 569
    // Polish ones have the same XX+5-digit shape, and DE07802 is a Bausparkasse
    // whose Bankleitzahl is 60430000 — nothing to do with 07802. Shape alone
    // would serve a German institution's name behind a French IBAN.
    expect(nationalBankCode('DE', 'DE07802')).toBeNull();
    expect(nationalBankCode('PL', 'PL00105')).toBeNull();
    expect(nationalBankCode('ES', 'ES0182')).toBeNull();
    // Portugal's mapping heuristic is undocumented and deliberately absent.
    expect(nationalBankCode('PT', 'PT00010')).toBeNull();
  });

  it('refuses a French registry serial that is not five digits', () => {
    // 121 of the 623 French rows on the live file are not bank codes at all.
    expect(nationalBankCode('FR', 'FRO000743C00010')).toBeNull();
    expect(nationalBankCode('FR', 'FR3009')).toBeNull();
    expect(nationalBankCode('FR', 'FR300999')).toBeNull();
  });
});

describe('normaliseLei', () => {
  it('accepts 20 alphanumerics and upper-cases them', () => {
    expect(normaliseLei(' example0lei000000001 ')).toBe('EXAMPLE0LEI000000001');
  });

  it('answers null rather than guessing at anything else', () => {
    // 643 ECB rows and 74 Spanish ones publish no LEI. They belong in the
    // table; they simply never join.
    expect(normaliseLei('')).toBeNull();
    expect(normaliseLei(undefined)).toBeNull();
    expect(normaliseLei('TOOSHORT')).toBeNull();
    expect(normaliseLei('EXAMPLE-LEI-00000001')).toBeNull();
  });
});

describe('composeAddress', () => {
  it('joins street, postal code and city in postal order', () => {
    expect(composeAddress({ street: '1 RUE DE LA PAIX', postal: '75002', city: 'PARIS' })).toBe(
      '1 RUE DE LA PAIX, 75002 PARIS',
    );
  });

  it('folds a PO box in beside the street', () => {
    expect(composeAddress({ box: 'Postfach 1', street: 'Hauptstrasse 5', postal: '74821', city: 'Mosbach' })).toBe(
      'Hauptstrasse 5, Postfach 1, 74821 Mosbach',
    );
  });

  it('answers null rather than an address made of punctuation', () => {
    // ", ," looks like data. No field at all is the honest shape of nothing.
    expect(composeAddress({})).toBeNull();
    expect(composeAddress({ street: '  ', city: '' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Banco de España
// ---------------------------------------------------------------------------

/**
 * Pad a field the way the Banco de España's export does — it is a fixed-width
 * dump wearing a CSV extension, and every field arrives followed by hundreds of
 * blanks. An untrimmed "0182" joins nothing, forever, and silently.
 */
function pad(value: string): string {
  return value + ' '.repeat(900);
}

function bdeFile(...rows: string[][]): string {
  const quote = (f: string) => `"${f.replace(/"/g, '""')}"`;
  const header = BDE_MFI_COLUMNS.join(',');
  const body = rows.map((r) => r.map((f, i) => (i === 0 ? f : quote(f))).join(','));
  // A UTF-8 BOM, as served.
  return '﻿' + [header, ...body].join('\r\n') + '\r\n';
}

describe('parseCsvRecords', () => {
  it('keeps commas that live inside quoted fields', () => {
    // Every Spanish name and every Spanish address contains commas. A naive
    // split(',') shreds all 242 rows.
    const [record] = parseCsvRecords('"Alpha Bank Example, S.A.","Calle Uno, 1, 28001, Madrid"\n');
    expect(record).toEqual(['Alpha Bank Example, S.A.', 'Calle Uno, 1, 28001, Madrid']);
  });

  it('unescapes doubled quotes', () => {
    const [record] = parseCsvRecords('"Alpha ""Example"" Bank"\n');
    expect(record).toEqual(['Alpha "Example" Bank']);
  });
});

describe('parseBdeMfi', () => {
  it('reads a padded row into a trimmed one', () => {
    const text = bdeFile([
      'ES0199',
      'EXAMPLE0LEI000000002',
      pad('Alpha Bank Example, S.A.'),
      pad('Credit institution'),
      pad('Calle Uno, 1, 28001, Madrid'),
      'No',
      '',
      pad('0199'),
    ]);
    expect(parseBdeMfi(text)).toEqual([
      {
        code: '0199',
        name: 'Alpha Bank Example, S.A.',
        lei: 'EXAMPLE0LEI000000002',
        address: 'Calle Uno, 1, 28001, Madrid',
        category: 'Credit institution',
      },
    ]);
  });

  it('keeps a row whose LEI is blank', () => {
    const text = bdeFile(['ES0198', '', pad('Beta Example Branch'), pad('Other institution'), pad('Calle Dos, 2, 28002, Madrid'), 'No', 'MTA999000', pad('0198')]);
    expect(parseBdeMfi(text)[0].lei).toBeNull();
  });

  it('drops a supervisory code that is not a four-digit bank code', () => {
    // Four rows on the live list publish codes like FI2680 — money market
    // funds. Their identifier is not a bank code and must never be offered as
    // the holder of an IBAN's first four digits.
    const text = bdeFile(
      ['ESV99999999', 'EXAMPLE0LEI000000003', pad('Example Monetary Fund, FI'), pad('Money Market Fund'), pad('Calle Tres, 3, 28003, Madrid'), 'No', '', pad('FI9999')],
      ['ES0197', 'EXAMPLE0LEI000000004', pad('Gamma Bank Example, S.A.'), pad('Credit institution'), pad('Calle Cuatro, 4, 28004, Madrid'), 'Yes', '', pad('0197')],
    );
    const rows = parseBdeMfi(text);
    expect(rows.map((r) => r.code)).toEqual(['0197']);
  });

  it('throws rather than guessing when a column is inserted upstream', () => {
    const text = '﻿' + ['EUROPEAN CODE,LEI,NEW,NAME', 'a,b,c,d'].join('\r\n');
    expect(() => parseBdeMfi(text)).toThrow(/columns moved/i);
  });
});
