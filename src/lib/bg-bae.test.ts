import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { IBANValidationResult } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');

/**
 * Bulgaria answers from the Bulgarian National Bank's BAE register.
 *
 * ## Why this suite brings its own database
 *
 * The register is not in the committed `data/bic.sqlite` — it arrives with the
 * first run of the monthly seeder. Asserting against it there would make this
 * file pass or fail on whether a cron has run yet, and would put real
 * institution names into a public repository's test fixtures.
 *
 * So: copy the shipped database to a temporary file, replace its `bg_bae` table
 * with an INVENTED register of the real shape, and point `BIC_DB_PATH` at the
 * copy before anything imports `db.js`. The copy is what makes the rest of
 * enrichment (the BIC directory, the compliance joins, next_steps) behave
 * normally while the Bulgarian half is entirely fabricated.
 *
 * Every code below is invented. `XMPL`, `ZZTB`, `QRTX` and `NOPE` are not
 * allocated to anyone, and the BICs are well-formed rather than real.
 */

const AS_OF = '2026-02-04';

/**
 * The invented register, written in an order that is itself a test.
 *
 * `XMPL7001` — a branch — is published BEFORE the head office `XMPL9001`, and
 * `ZZTB` has TWO head-office rows. Both mirror the published file: the Bulgarian
 * National Bank lists its SEBRA payments service as a second head-office row
 * under BNBG, and nothing guarantees a head office comes first.
 */
const REGISTER = [
  { bae: 'XMPL7001', name: 'Примерна Банка АД, кл. Пример', bic: null, ordinal: 0 },
  { bae: 'XMPL9001', name: 'Примерна Банка АД', bic: 'XMPLBGSF', ordinal: 1 },
  { bae: 'ZZTB4001', name: 'Втора Примерна ЕАД', bic: 'ZZTBBGS1', ordinal: 2 },
  { bae: 'ZZTB4002', name: 'Втора Примерна ЕАД — СЕБРА плащания', bic: 'ZZTBBGS1', ordinal: 3 },
  { bae: 'QRTX4003', name: 'Трета Примерна АД', bic: 'QRTXBGS2', ordinal: 4 },
];

/** Valid mod-97 IBANs over the invented codes. */
const IBAN_HEAD_OFFICE = 'BG49XMPL900112345678AB'; // XMPL, branch 9001 — listed
const IBAN_UNLISTED_BRANCH = 'BG54XMPL777712345678AB'; // XMPL, branch 7777 — not listed
const IBAN_TWO_HEAD_ROWS = 'BG53ZZTB400112345678AB'; // ZZTB
const IBAN_UNALLOCATED = 'BG29QQQQ123412345678AB'; // QQQQ — held by nobody

let tmpDir: string;
let dbPath: string;
let previousPath: string | undefined;
let check: (iban: string) => IBANValidationResult;
let lib: typeof import('./bg-bae.js');
let closeAll: () => void;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ibanforge-bg-'));
  dbPath = join(tmpDir, 'bic.sqlite');
  copyFileSync(resolve(__dirname, '../../data/bic.sqlite'), dbPath);

  const db = new Database(dbPath);
  db.exec('DROP TABLE IF EXISTS bg_bae');
  db.exec(`
    CREATE TABLE bg_bae (
      bae         TEXT PRIMARY KEY,
      bank_code   TEXT NOT NULL,
      branch_code TEXT NOT NULL,
      name        TEXT NOT NULL,
      bic         TEXT,
      ordinal     INTEGER NOT NULL,
      as_of       TEXT NOT NULL,
      source      TEXT NOT NULL,
      updated_at  TEXT DEFAULT (datetime('now'))
    )
  `);
  const insert = db.prepare(
    `INSERT INTO bg_bae (bae, bank_code, branch_code, name, bic, ordinal, as_of, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Bulgarian National Bank, BAE register')`,
  );
  for (const r of REGISTER) {
    insert.run(r.bae, r.bae.slice(0, 4), r.bae.slice(4), r.name, r.bic, r.ordinal, AS_OF);
  }
  db.close();

  // Set BEFORE the first import of anything that reaches db.js: the path is
  // captured in a module-level const there. Restored in afterAll, because
  // process.env is shared with every other test file in this process.
  previousPath = process.env.BIC_DB_PATH;
  process.env.BIC_DB_PATH = dbPath;

  const { validateIBAN } = await import('./iban.js');
  const { enrichResult } = await import('./enrich.js');
  lib = await import('./bg-bae.js');
  closeAll = (await import('./db.js')).closeAll;
  check = (iban: string): IBANValidationResult => {
    const r = validateIBAN(iban);
    enrichResult(r);
    return r;
  };
  // The shipped database is 35 MB and the enrichment graph is large; the
  // default 10 s hook timeout is tight on a cold cache.
}, 60_000);

afterAll(() => {
  // Close first, then release the path: a connection left open on a deleted
  // file is how a later suite inherits this one's database.
  closeAll?.();
  if (previousPath === undefined) delete process.env.BIC_DB_PATH;
  else process.env.BIC_DB_PATH = previousPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('the test register really is the invented one', () => {
  it('loads the fixture and not the shipped database', () => {
    // If module isolation ever stopped working, every assertion below would
    // silently describe production data instead. This one fails first and says
    // so.
    expect(lib.getBgBaeCount()).toBe(REGISTER.length);
    expect(lib.getBgBankCodeCount()).toBe(3);
    expect(lib.getBgAsOf()).toBe(AS_OF);
  });

  it('builds the attribution from the loaded rows', () => {
    // The Bulgarian National Bank's terms require the source to be cited. The
    // credit is read out of the data, so it cannot name a date we do not hold.
    expect(lib.bgAttribution()).toBe(`Bulgarian National Bank, BAE register (${AS_OF})`);
  });
});

describe('validate answers Bulgaria from the register', () => {
  it('carries authoritative, the register name and the register’s own date', () => {
    const r = check(IBAN_HEAD_OFFICE);
    expect(r.valid).toBe(true);
    expect(r.bank_code_check!.value).toBe('XMPL');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.match).toBe('register');
    expect(r.bank_code_check!.authoritative).toBe(true);
    expect(r.bank_code_check!.register).toMatch(/^Bulgarian National Bank, BAE register/);
    // Dated by the REGISTER, not by our monthly database refresh: the file is
    // republished on request, so our refresh month would overstate it.
    expect(r.bank_code_check!.as_of).toBe(AS_OF.slice(0, 7));
  });

  it('names the institution the register allocates the bank code to', () => {
    const r = check(IBAN_HEAD_OFFICE);
    expect(r.bank_code_check!.institution).toEqual({
      name: 'Примерна Банка АД',
      // Names only, as this register publishes them. Nulls are what Bulgaria
      // publishes, not missing data on our side.
      street: null,
      post_code: null,
      town: null,
      country: 'BG',
    });
  });

  it('serves the register’s BIC instead of a prefix coin flip', () => {
    // A Bulgarian bank code is four LETTERS, so the composite fallback matches
    // every BIC8 opening on them and an ORDER BY decides which one is served.
    // The register names one, and it is the institution the code belongs to.
    const r = check(IBAN_HEAD_OFFICE);
    expect(r.bic?.code).toBe('XMPLBGSF');
    expect(r.bic?.bank_name).toBe('Примерна Банка АД');
    expect(r.bic?.source).toBe('Bulgarian National Bank, BAE register');
    expect(r.bic?.as_of).toBe(AS_OF.slice(0, 7));
  });

  it('reports a bank code held by nobody as not allocated, with full weight', () => {
    const r = check(IBAN_UNALLOCATED);
    expect(r.valid).toBe(true); // ISO 13616 conformant — a separate question
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.authoritative).toBe(true);
    expect(r.bank_code_check!.as_of).toBe(AS_OF.slice(0, 7));
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });

  it('resolves no BIC at all for a bank code the register denies', () => {
    // The contradiction this guard exists to prevent: bank_code_check saying
    // the code is allocated to nobody while the `bic` block beside it names a
    // bank. Bulgaria needs a guard rather than the load-time prune the numeric
    // countries use, because `bic8 LIKE 'QQQQ%'` can resurrect a dropped key.
    const r = check(IBAN_UNALLOCATED);
    expect(r.bic).toBeNull();
    expect(r.risk_indicators?.issuer_type).toBeNull();
  });
});

describe('the claim stops at the bank code', () => {
  it('still verifies a bank whose branch digits the register does not list', () => {
    // The overclaim this design refuses to make. In the published register 28
    // of 36 banks list a single branch code while one lists 63, so branch
    // digits are plainly not enumerated to one standard. Denying an IBAN whose
    // branch is not separately published would be a denial off a coverage gap.
    const r = check(IBAN_UNLISTED_BRANCH);
    expect(r.bban?.branch_code).toBe('7777');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.authoritative).toBe(true);
    // And the answer is about the bank code, so it is the bank code that is
    // echoed — never eight characters on one IBAN and four on the next.
    expect(r.bank_code_check!.value).toBe('XMPL');
    expect(r.bank_code_check!.institution?.name).toBe('Примерна Банка АД');
  });

  it('says so in the register name rather than leaving it to be inferred', () => {
    expect(check(IBAN_HEAD_OFFICE).bank_code_check!.register).toMatch(
      /branch digits are not separately verified/,
    );
  });
});

describe('the institution behind a bank code is picked deterministically', () => {
  it('prefers the head-office row over a branch published before it', () => {
    // XMPL7001 (a branch) comes first in the file; XMPL9001 (the head office)
    // second. Ordering by publication order alone would name a branch as the
    // holder of the bank code.
    expect(lib.lookupBgBankCode('XMPL')).toMatchObject({
      bae: 'XMPL9001',
      name: 'Примерна Банка АД',
      bic: 'XMPLBGSF',
    });
  });

  it('breaks a tie between two head-office rows on the register’s own order', () => {
    // The Bulgarian National Bank publishes two: itself, then its SEBRA
    // payments service. Without a stored ordinal the pick is whatever SQLite
    // returns, and the served institution name changes between refreshes for
    // no reason a reader could ever see.
    expect(lib.lookupBgBankCode('ZZTB')?.name).toBe('Втора Примерна ЕАД');
    expect(check(IBAN_TWO_HEAD_ROWS).bank_code_check!.institution?.name).toBe('Втора Примерна ЕАД');
  });

  it('answers null for a code the register does not carry', () => {
    expect(lib.lookupBgBankCode('NOPE')).toBeNull();
  });

  it('answers null rather than guessing at a malformed code', () => {
    for (const bad of ['', 'XMP', 'XMPL9', 'XM-L', '1234']) {
      expect(lib.lookupBgBankCode(bad), bad).toBeNull();
    }
  });
});

describe('the rest of Europe is where it was', () => {
  it('does not promote a neighbour', () => {
    // Promoting one country must not promote another: France is still a
    // composite map and an absence there still proves nothing.
    const fr = check('FR1499999000010123456789A42');
    expect(fr.bank_code_check!.authoritative).toBe(false);
    expect(fr.bank_code_check!.register).toMatch(/not a national/i);
  });
});
