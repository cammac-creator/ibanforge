import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deriveBulgarian,
  deriveItalian,
  deriveKey,
  derivePrefix,
  rebuild,
} from './derive-map-keys.js';

/**
 * The derivations that rebuild map keys from open data. Every row below is
 * INVENTED (XMPL… BICs, 9999x codes, made-up LEIs): the rules are what is
 * tested, not a bank.
 */

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE national_bank_codes (country TEXT, code TEXT, name TEXT, lei TEXT,
      PRIMARY KEY (country, code));
    CREATE TABLE bic_entries (bic8 TEXT, bic11 TEXT UNIQUE, country_code TEXT, lei TEXT,
      source TEXT);
    CREATE TABLE bg_bae (bae TEXT PRIMARY KEY, bank_code TEXT, branch_code TEXT, bic TEXT);
  `);
  const code = db.prepare(
    "INSERT INTO national_bank_codes VALUES ('IT', ?, 'Banca di Esempio', ?)",
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
  // Prefix countries.
  bic.run('XMPLRO22', 'XMPLRO22XXX', 'RO', null, 'gleif');
  bic.run('XMPLRO22', 'XMPLRO22BR1', 'RO', null, 'swiftcodes');
  bic.run('XMPDRO21', 'XMPDRO21XXX', 'RO', null, 'gleif');
  bic.run('XMPDRO22', 'XMPDRO22XXX', 'RO', null, 'swiftcodes');
  bic.run('XMPLBGSF', 'XMPLBGSFXXX', 'BG', null, 'swiftcodes');
  const bae = db.prepare('INSERT INTO bg_bae VALUES (?, ?, ?, ?)');
  bae.run('XMPB0001', 'XMPB', '0001', 'XMPBBGSF');
  bae.run('XMPB0002', 'XMPB', '0002', null);
  bae.run('XMPL0001', 'XMPL', '0001', null);
});

describe('it-lei: ABI code -> LEI (Banca d’Italia) -> BIC (GLEIF)', () => {
  it('serves the one Italian BIC GLEIF pairs with the LEI, branch code and all', () => {
    expect(deriveItalian(db, '99991')).toEqual({ bic: 'XMPLITM1ABC' });
  });

  it('picks the single head-office BIC among several, and nothing when there is none', () => {
    expect(deriveItalian(db, '99992')).toEqual({ bic: 'XMPLITM2XXX' });
    expect(deriveItalian(db, '99993')).toEqual({ bic: null, reason: 'ambiguous' });
  });

  it('says why it rebuilds nothing', () => {
    expect(deriveItalian(db, '99990')).toEqual({ bic: null, reason: 'not_in_register' });
    expect(deriveItalian(db, '99994')).toEqual({ bic: null, reason: 'no_lei' });
    expect(deriveItalian(db, '99995')).toEqual({ bic: null, reason: 'lei_without_bic' });
    expect(deriveItalian(db, '99996')).toEqual({ bic: null, reason: 'lei_without_bic' });
  });
});

describe('bic-prefix: the bank code is the first four letters of the BIC', () => {
  it('serves the one BIC8 that begins with the code, as its head office', () => {
    expect(derivePrefix(db, 'RO', 'XMPL')).toEqual({ bic: 'XMPLRO22XXX' });
  });

  it('leaves an ambiguous or unknown prefix, and a code that is not four letters, alone', () => {
    expect(derivePrefix(db, 'RO', 'XMPD')).toEqual({ bic: null, reason: 'ambiguous' });
    expect(derivePrefix(db, 'RO', 'XMPZ')).toEqual({ bic: null, reason: 'absent' });
    expect(derivePrefix(db, 'RO', '1234')).toEqual({ bic: null, reason: 'not_a_bic_prefix' });
    // Another country's BIC never answers.
    expect(derivePrefix(db, 'IE', 'XMPL')).toEqual({ bic: null, reason: 'absent' });
  });
});

describe('bg-bae: the BIC the BNB register gives the code, else the prefix rule', () => {
  it('reads the register first', () => {
    expect(deriveBulgarian(db, 'XMPB')).toEqual({ bic: 'XMPBBGSFXXX' });
  });

  it('falls back to the directory when the register gives no BIC', () => {
    expect(deriveBulgarian(db, 'XMPL')).toEqual({ bic: 'XMPLBGSFXXX' });
  });
});

describe('deriveKey', () => {
  it('withdraws every country without a derivation', () => {
    for (const key of ['TR:99999', 'ES:9999', 'GE:XM', 'AE:999']) {
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
