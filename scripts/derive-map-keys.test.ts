import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deriveItalian,
  deriveKey,
  derivePrefix,
  parseEcbItalianRows,
  readEcbList,
  rebuild,
  type BankSiteBic,
  type EcbItalianRow,
  type ItalianSources,
} from './derive-map-keys.js';
import { ECB_MFI_COLUMNS } from './seed-ecb-mfi.js';

/**
 * The derivations that rebuild map keys from open data. Every row below is
 * INVENTED (XMPL… BICs, 9999x codes, made-up LEIs): the rules are what is
 * tested, not a bank.
 */

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE national_bank_codes (country TEXT, code TEXT, name TEXT, lei TEXT, town TEXT,
      PRIMARY KEY (country, code));
    CREATE TABLE bic_entries (bic8 TEXT, bic11 TEXT UNIQUE, country_code TEXT, lei TEXT,
      source TEXT);
  `);
  const code = db.prepare(
    "INSERT INTO national_bank_codes (country, code, name, lei) VALUES ('IT', ?, 'Banca di Esempio', ?)",
  );
  code.run('99991', 'LEI00000000000000001'); // one BIC
  code.run('99992', 'LEI00000000000000002'); // two BICs, one head office
  code.run('99993', 'LEI00000000000000003'); // two BICs, no head office
  code.run('99994', null); // no LEI
  code.run('99995', 'LEI00000000000000005'); // LEI GLEIF pairs with no BIC
  code.run('99996', 'LEI00000000000000006'); // its only BIC is abroad
  const bic = db.prepare('INSERT INTO bic_entries VALUES (?, ?, ?, ?, ?)');
  bic.run('XMPLITM1', 'XMPLITM1ABC', 'IT', 'LEI00000000000000001', 'gleif');
  bic.run('XMPLITM2', 'XMPLITM2XXX', 'IT', 'LEI00000000000000002', 'gleif');
  bic.run('XMPLITM2', 'XMPLITM2BR1', 'IT', 'LEI00000000000000002', 'gleif');
  bic.run('XMPAITM3', 'XMPAITM3AAA', 'IT', 'LEI00000000000000003', 'gleif');
  bic.run('XMPBITM3', 'XMPBITM3BBB', 'IT', 'LEI00000000000000003', 'gleif');
  bic.run('XMPLFRP6', 'XMPLFRP6XXX', 'FR', 'LEI00000000000000006', 'gleif');
  // A swiftcodes row carrying the LEI: the derivation reads GLEIF's pairing only.
  bic.run('XMPSITM5', 'XMPSITM5XXX', 'IT', 'LEI00000000000000005', 'swiftcodes');
  // Romania: GLEIF rows decide, SwiftCodes rows never do.
  bic.run('XMPLRO22', 'XMPLRO22XXX', 'RO', 'LEI0000000000000RO01', 'gleif');
  bic.run('XMPLRO22', 'XMPLRO22BR1', 'RO', null, 'swiftcodes');
  bic.run('XMPDRO21', 'XMPDRO21XXX', 'RO', 'LEI0000000000000RO02', 'gleif');
  bic.run('XMPDRO22', 'XMPDRO22XXX', 'RO', 'LEI0000000000000RO03', 'gleif');
  bic.run('XMPSRO22', 'XMPSRO22XXX', 'RO', null, 'swiftcodes');
  bic.run('XMPMRO21', 'XMPMRO21XXX', 'RO', 'LEI0000000000000RO04', 'gleif');
  bic.run('XMPMRO22', 'XMPMRO22XXX', 'RO', null, 'swiftcodes');
  bic.run('XMPLIE2D', 'XMPLIE2DXXX', 'IE', 'LEI0000000000000IE01', 'gleif');
});

describe('it-lei: ABI code -> LEI (Banca d’Italia) -> BIC (GLEIF)', () => {
  it('serves the one Italian BIC GLEIF pairs with the LEI, branch code and all', () => {
    expect(deriveItalian(db, '99991')).toMatchObject({ bic: 'XMPLITM1ABC', via: 'gleif-lei' });
  });

  it('picks the single head-office BIC among several, and nothing when there is none', () => {
    expect(deriveItalian(db, '99992')).toMatchObject({ bic: 'XMPLITM2XXX', via: 'gleif-lei' });
    expect(deriveItalian(db, '99993')).toEqual({ bic: null, reason: 'ambiguous' });
  });

  it('says why it rebuilds nothing', () => {
    expect(deriveItalian(db, '99990')).toEqual({ bic: null, reason: 'not_in_register' });
    expect(deriveItalian(db, '99994')).toEqual({ bic: null, reason: 'no_lei' });
    expect(deriveItalian(db, '99995')).toEqual({ bic: null, reason: 'lei_without_bic' });
    expect(deriveItalian(db, '99996')).toEqual({ bic: null, reason: 'lei_without_bic' });
  });
});

describe('gleif-prefix: the bank code is the first four letters of the BIC, read in GLEIF', () => {
  it('serves the one GLEIF BIC8 that begins with the code, as its head office', () => {
    expect(derivePrefix(db, 'RO', 'XMPL')).toEqual({ bic: 'XMPLRO22XXX', via: 'gleif-prefix' });
  });

  it('never reads the SwiftCodes copy, not even to break a tie or fill a gap', () => {
    // Only SwiftCodes carries it: nothing.
    expect(derivePrefix(db, 'RO', 'XMPS')).toEqual({ bic: null, reason: 'absent' });
    // GLEIF names one, SwiftCodes another: GLEIF's, and no ambiguity.
    expect(derivePrefix(db, 'RO', 'XMPM')).toEqual({ bic: 'XMPMRO21XXX', via: 'gleif-prefix' });
  });

  it('leaves an ambiguous or unknown prefix, and a code that is not four letters, alone', () => {
    expect(derivePrefix(db, 'RO', 'XMPD')).toEqual({ bic: null, reason: 'ambiguous' });
    expect(derivePrefix(db, 'RO', 'XMPZ')).toEqual({ bic: null, reason: 'absent' });
    expect(derivePrefix(db, 'RO', '1234')).toEqual({ bic: null, reason: 'not_a_bic_prefix' });
    // Another country's BIC never answers: XMPD exists in Romania only.
    expect(derivePrefix(db, 'IE', 'XMPD')).toEqual({ bic: null, reason: 'absent' });
  });
});

describe('deriveKey', () => {
  it('withdraws every country without a derivation', () => {
    for (const key of ['TR:99999', 'ES:9999', 'GE:XM', 'AE:999', 'IE:XMPL', 'BG:XMPL']) {
      expect(deriveKey(db, key), key).toEqual({ bic: null, reason: 'no_derivation' });
    }
  });
});

describe('rebuild', () => {
  it('keeps every other key in place, rebuilds what derives, and drops the rest', () => {
    const before = {
      'DE:10000000': { bic: 'XMPLDEF1XXX' },
      'IT:99991': { bic: 'XMPLITM1XXX', bank_name: 'Old name' },
      'TR:99999': { bic: 'XMPLTRIS' },
      'RO:XMPL': { bic: 'XMPLRO22XXX' },
      'NL:XMPL': { bic: 'XMPLNL2A' },
    };
    const { map, report } = rebuild(db, before, ['IT:99991', 'TR:99999', 'RO:XMPL']);
    expect(Object.keys(map)).toEqual(['DE:10000000', 'IT:99991', 'RO:XMPL', 'NL:XMPL']);
    // The rebuilt key holds the derived BIC and nothing carried over from the old entry.
    expect(map['IT:99991']).toEqual({ bic: 'XMPLITM1ABC' });
    expect(map['RO:XMPL']).toEqual({ bic: 'XMPLRO22XXX' });
    expect(report).toEqual({
      IT: { other_bic: 1 },
      TR: { withdrawn_no_derivation: 1 },
      RO: { same_bic: 1 },
    });
  });

  it('never uses the old value to choose among candidates', () => {
    // The old BIC is one of the two candidates: the derivation is still
    // ambiguous, and the key goes.
    const { map, report } = rebuild(db, { 'RO:XMPD': { bic: 'XMPDRO22XXX' } }, ['RO:XMPD']);
    expect(map).toEqual({});
    expect(report).toEqual({ RO: { withdrawn_ambiguous: 1 } });
  });
});

/**
 * 07/10/2026: the Italian codes the rebuild of 29/09/2026 left without a BIC.
 * Still invented rows only: XMP… BICs, 9998x codes, made-up LEIs and RIAD codes.
 */
describe('it-lei, step 2: the head office the ECB names for an Italian branch', () => {
  let sources: ItalianSources;

  beforeEach(() => {
    const code = db.prepare(
      "INSERT INTO national_bank_codes (country, code, name, lei, town) VALUES ('IT', ?, ?, ?, ?)",
    );
    code.run('99981', 'BANCA ESTERA UNO AG', null, 'MILANO'); // no LEI: found by name and town
    code.run('99982', 'BANCA ESTERA DUE SE', 'LEI0000000000BRANCH2', 'MILANO'); // a branch LEI
    code.run('99984', 'BANCA ESTERA QUATTRO SA', null, 'ROMA'); // the ECB places it elsewhere
    code.run('99985', 'BANCA GEMELLA SPA', null, 'TORINO'); // two codes, one name
    code.run('99986', 'BANCA GEMELLA SPA', null, 'TORINO');
    code.run('99987', 'BANCA ESTERA SETTE NV', null, 'MILANO'); // head office with two head BICs
    code.run('99988', 'BANCA ESTERA OTTO SA', null, 'MILANO'); // head office without an Italian BIC
    const bic = db.prepare('INSERT INTO bic_entries VALUES (?, ?, ?, ?, ?)');
    bic.run('XMPHITM1', 'XMPHITM1XXX', 'IT', 'LEI00000000000HEAD01', 'gleif');
    bic.run('XMPHDEF1', 'XMPHDEF1XXX', 'DE', 'LEI00000000000HEAD01', 'gleif');
    bic.run('XMPKITM2', 'XMPKITM2XXX', 'IT', 'LEI00000000000HEAD02', 'gleif');
    bic.run('XMPQITM4', 'XMPQITM4XXX', 'IT', 'LEI00000000000HEAD04', 'gleif');
    bic.run('XMPGITM5', 'XMPGITM5XXX', 'IT', 'LEI00000000000HEAD05', 'gleif');
    bic.run('XMPSITM7', 'XMPSITM7XXX', 'IT', 'LEI00000000000HEAD07', 'gleif');
    bic.run('XMPTITM7', 'XMPTITM7XXX', 'IT', 'LEI00000000000HEAD07', 'gleif');
    const row = (
      r: Partial<EcbItalianRow> & { riad_code: string; name: string },
    ): EcbItalianRow => ({
      city: 'Milano',
      lei: null,
      head_lei: null,
      ...r,
    });
    sources = {
      ecb: {
        list_date: '2099-01-02',
        rows: [
          row({
            riad_code: 'IT0000000000081',
            name: 'Banca Estera Uno AG',
            head_lei: 'LEI00000000000HEAD01',
          }),
          row({
            riad_code: 'IT0000000000082',
            name: 'Banca Estera Due SE',
            lei: 'LEI0000000000BRANCH2',
            head_lei: 'LEI00000000000HEAD02',
          }),
          row({
            riad_code: 'IT0000000000084',
            name: 'Banca Estera Quattro SA',
            head_lei: 'LEI00000000000HEAD04',
          }),
          row({
            riad_code: 'IT0000000000085',
            name: 'Banca Gemella SpA',
            city: 'Torino',
            head_lei: 'LEI00000000000HEAD05',
          }),
          row({
            riad_code: 'IT0000000000087',
            name: 'Banca Estera Sette NV',
            head_lei: 'LEI00000000000HEAD07',
          }),
          row({
            riad_code: 'IT0000000000088',
            name: 'Banca Estera Otto SA',
            head_lei: 'LEI00000000000HEAD08',
          }),
        ],
      },
    };
  });

  it('serves the Italian BIC GLEIF pairs with the head office, and says where it comes from', () => {
    expect(deriveItalian(db, '99981', sources)).toEqual({
      bic: 'XMPHITM1XXX',
      via: 'ecb-head-office',
      evidence: {
        ecb_riad_code: 'IT0000000000081',
        ecb_list_date: '2099-01-02',
        head_lei: 'LEI00000000000HEAD01',
      },
    });
  });

  it('finds the branch by the LEI the Banca d’Italia publishes when GLEIF pairs no BIC with it', () => {
    expect(deriveItalian(db, '99982', sources)).toMatchObject({
      bic: 'XMPKITM2XXX',
      via: 'ecb-head-office',
    });
  });

  it('never joins on a name alone: another town, or a name two codes share, is no match', () => {
    expect(deriveItalian(db, '99984', sources)).toEqual({ bic: null, reason: 'no_lei' });
    expect(deriveItalian(db, '99985', sources)).toEqual({ bic: null, reason: 'no_lei' });
  });

  it('says when the head office the ECB names has no Italian BIC in GLEIF', () => {
    expect(deriveItalian(db, '99988', sources)).toEqual({ bic: null, reason: 'lei_without_bic' });
  });

  it('keeps the head-office rule: two head-office BICs are ambiguous', () => {
    expect(deriveItalian(db, '99987', sources)).toEqual({ bic: null, reason: 'ambiguous' });
  });

  it('reads nothing of the ECB without its list', () => {
    expect(deriveItalian(db, '99981')).toEqual({ bic: null, reason: 'no_lei' });
  });

  it('never lets a website overrule GLEIF: it may only choose among its head offices', () => {
    const site = (bic: string): BankSiteBic => ({
      bic,
      holder: 'Banca Estera Sette NV',
      url: 'https://bank.example.net/contatti',
      consulted: '2099-01-03',
      quote: `Codice BIC: ${bic}`,
    });
    expect(
      deriveItalian(db, '99987', { ...sources, bankSites: { '99987': site('XMPSITM7') } }),
    ).toMatchObject({ bic: 'XMPSITM7XXX', via: 'bank-site' });
    expect(
      deriveItalian(db, '99987', { ...sources, bankSites: { '99987': site('XMPZITM7') } }),
    ).toEqual({ bic: null, reason: 'bank_site_conflict' });
  });
});

describe('it-lei, step 3: the BIC the bank publishes on its own website', () => {
  const site = (bic: string, quote: string): BankSiteBic => ({
    bic,
    holder: 'Banca di Esempio',
    url: 'https://bank.example.net/trasparenza',
    consulted: '2099-01-03',
    quote,
  });

  it('fills a code whose LEI GLEIF pairs with no BIC, and keeps the words that say it', () => {
    expect(
      deriveItalian(db, '99995', { bankSites: { '99995': site('XMPWITM5', 'BIC XMPWITM5') } }),
    ).toEqual({
      bic: 'XMPWITM5XXX',
      via: 'bank-site',
      evidence: {
        url: 'https://bank.example.net/trasparenza',
        consulted: '2099-01-03',
        quote: 'BIC XMPWITM5',
      },
    });
  });

  it('cannot choose between branch BICs with no head office among them', () => {
    expect(
      deriveItalian(db, '99993', {
        bankSites: { '99993': site('XMPAITM3AAA', 'BIC XMPAITM3AAA') },
      }),
    ).toEqual({ bic: null, reason: 'bank_site_conflict' });
  });

  it('ties a code the registers do not list to a bank only when the quoted words carry the code', () => {
    expect(
      deriveItalian(db, '99990', {
        bankSites: { '99990': site('XMPPITRR', 'ABI 99990, BIC XMPPITRR') },
      }),
    ).toMatchObject({ bic: 'XMPPITRRXXX', via: 'bank-site' });
    expect(
      deriveItalian(db, '99990', { bankSites: { '99990': site('XMPPITRR', 'BIC XMPPITRR') } }),
    ).toEqual({ bic: null, reason: 'not_in_register' });
  });
});

describe('the ECB list as published', () => {
  const header = ECB_MFI_COLUMNS.join('\t');
  const line = (country: string, name: string, lei: string, headLei: string) =>
    [
      'XX0001',
      lei,
      country,
      name,
      '',
      'Via Esempio 1',
      '20100',
      'Milano',
      'Credit Institution',
      'DE',
      'Head',
      'DE0001',
      headLei,
      'full',
    ].join('\t');

  it('keeps the Italian rows with their head-office LEI', () => {
    const text = [
      header,
      line('IT', 'Banca Estera Uno AG', '', 'LEI00000000000HEAD01'),
      line('DE', 'Bank Eins AG', 'LEI00000000000HEAD01', ''),
    ].join('\r\n');
    expect(parseEcbItalianRows(text)).toEqual([
      {
        riad_code: 'XX0001',
        name: 'Banca Estera Uno AG',
        city: 'Milano',
        lei: null,
        head_lei: 'LEI00000000000HEAD01',
      },
    ]);
  });

  it('refuses a file whose columns moved', () => {
    expect(() => parseEcbItalianRows(`RIAD_CODE\tNAME\n`)).toThrow(/columns moved/);
  });

  it('dates the list by its published file name, and refuses any other name', () => {
    expect(() => readEcbList('/nowhere/ecb.csv')).toThrow(/mfi_csv_YYMMDD/);
  });
});

describe('rebuild --add', () => {
  it('adds the keys the map lacks after the last key of their country, and reports why others stay out', () => {
    const before = {
      'IT:00001': { bic: 'XMPLITM9XXX' },
      'DE:10000000': { bic: 'XMPLDEF1XXX' },
      'IT:00002': { bic: 'XMPLITM8XXX' },
      'NL:XMPL': { bic: 'XMPLNL2A' },
    };
    const { map, report, trace } = rebuild(db, before, ['IT:99991', 'IT:99994'], { add: true });
    expect(Object.keys(map)).toEqual([
      'IT:00001',
      'DE:10000000',
      'IT:00002',
      'IT:99991',
      'NL:XMPL',
    ]);
    expect(map['IT:99991']).toEqual({ bic: 'XMPLITM1ABC' });
    expect(report).toEqual({ IT: { added: 1, not_added_no_lei: 1 } });
    expect(trace['IT:99994']).toEqual({ bic: null, reason: 'no_lei' });
  });

  it('leaves the map alone without --add', () => {
    const before = { 'IT:00001': { bic: 'XMPLITM9XXX' } };
    const { map, report } = rebuild(db, before, ['IT:99991']);
    expect(map).toEqual(before);
    expect(report).toEqual({});
  });
});

describe('it-lei, step 3: what the website file must hold', () => {
  const base: BankSiteBic = {
    bic: 'XMPPITRRXXX',
    holder: 'Banca di Esempio',
    url: 'https://bank.example.net/bonifici',
    consulted: '2099-01-03',
    quote: 'il seguente codice BIC: XMPPITRRXXX',
  };

  it('takes the code from a second sentence of the bank when the BIC page does not carry it', () => {
    const site = {
      ...base,
      abi_url: 'https://bank.example.net/trasparenza.pdf',
      abi_quote: 'Banca di Esempio SpA, codice ABI 99990',
    };
    expect(deriveItalian(db, '99990', { bankSites: { '99990': site } })).toEqual({
      bic: 'XMPPITRRXXX',
      via: 'bank-site',
      evidence: {
        url: 'https://bank.example.net/bonifici',
        consulted: '2099-01-03',
        quote: 'il seguente codice BIC: XMPPITRRXXX',
        abi_url: 'https://bank.example.net/trasparenza.pdf',
        abi_quote: 'Banca di Esempio SpA, codice ABI 99990',
      },
    });
  });

  it('refuses a file whose quoted words do not spell the BIC it records, spaces aside', () => {
    expect(
      deriveItalian(db, '99995', {
        bankSites: { '99995': { ...base, bic: 'XMPWITM5XXX', quote: 'Codice BIC XMPW IT M5' } },
      }),
    ).toMatchObject({ bic: 'XMPWITM5XXX' });
    expect(() =>
      deriveItalian(db, '99995', {
        bankSites: { '99995': { ...base, bic: 'XMPWITM5XXX', quote: 'Codice BIC XMPZITM5' } },
      }),
    ).toThrow(/do not spell/);
  });
});
