import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IBANValidationResult } from '../types.js';

/**
 * Czechia end to end, on a FIXED edition.
 *
 * The ČNB číselník is the allocation of the Czech payment codes, by law
 * (vyhláška č. 169/2011 Sb., § 4 c) and § 6 (2)): IBAN positions 5-8 are the
 * code, and the ČNB publishes every code it has allocated. So a code it holds
 * is `verified` with `authoritative: true`, and a code it does not hold is
 * `not_allocated`, also with `authoritative: true` — the strongest answer this
 * API gives.
 *
 * The facts asserted here — which bank holds 0100, that 6600 has no BIC, that
 * 4000 and 8280 are gone — are the ČNB's, and the ČNB changes them with any
 * edition. Asserted against the shipped database, they would fail the monthly
 * refresh (which reseeds the register, then runs the tests before committing)
 * on an ordinary renaming. So this file loads its OWN edition into a copy of
 * the database: the rows below, as edition 254 of 1 September 2026 printed
 * them. What must hold on the shipped database whatever the edition lives in
 * cz-register-live.test.ts.
 *
 * Every IBAN carries the account of the Czech example of the SWIFT IBAN
 * Registry (prefix 000019, number 2000145399) behind a different bank code, with
 * mod-97 recomputed; each is asserted valid before anything is read from it.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE = 'Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze 254';
const AS_OF = '2026-09-01';

/** Edition 254 as the ČNB wrote these rows (public bank names and codes). */
const EDITION: Array<{ code: string; name: string; bic: string | null }> = [
  { code: '0100', name: 'Komerční banka, a.s.', bic: 'KOMBCZPP' },
  { code: '0300', name: 'Československá obchodní banka, a. s.', bic: 'CEKOCZPP' },
  { code: '0800', name: 'Česká spořitelna, a.s.', bic: 'GIBACZPX' },
  { code: '2010', name: 'Fio banka, a.s.', bic: 'FIOBCZPP' },
  { code: '6363', name: 'Partners Banka, a.s.', bic: 'PTBNCZPP' },
  { code: '6600', name: 'Banking Circle S.A., Czech Republic', bic: null },
  { code: '7990', name: 'Modrá pyramida stavební spořitelna, a.s.', bic: null },
];

let tmpDir: string;
let previousPath: string | undefined;
let check: (iban: string) => IBANValidationResult;
let enrich: typeof import('./enrich.js');
let lib: typeof import('./national-registers.js');
let closeAll: () => void;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ibanforge-cz-fixed-'));
  const dbPath = join(tmpDir, 'bic.sqlite');
  copyFileSync(resolve(__dirname, '../../data/bic.sqlite'), dbPath);
  const db = new Database(dbPath);
  db.exec(
    'CREATE TABLE IF NOT EXISTS national_bank_codes_pending AS SELECT * FROM national_bank_codes WHERE 0',
  );
  db.exec(`DELETE FROM national_bank_codes WHERE country = 'CZ'`);
  db.exec(`DELETE FROM national_bank_codes_pending WHERE country = 'CZ'`);
  const ins = db.prepare(
    `INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei, source, as_of)
     VALUES ('CZ', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
  );
  for (const r of EDITION) ins.run(r.code, r.name, r.bic, SOURCE, AS_OF);
  db.close();

  // Set BEFORE the first import of anything that reaches db.js: the path is
  // captured in a module-level const there (same discipline as bg-bae.test.ts).
  previousPath = process.env.BIC_DB_PATH;
  process.env.BIC_DB_PATH = dbPath;

  const { validateIBAN } = await import('./iban.js');
  enrich = await import('./enrich.js');
  lib = await import('./national-registers.js');
  closeAll = (await import('./db.js')).closeAll;
  check = (iban: string): IBANValidationResult => {
    const r = validateIBAN(iban);
    expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
    enrich.enrichResult(r);
    return r;
  };
}, 60_000);

afterAll(() => {
  closeAll?.();
  if (previousPath === undefined) delete process.env.BIC_DB_PATH;
  else process.env.BIC_DB_PATH = previousPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

/** A valid Czech IBAN for any bank code, on the SWIFT registry example's account. */
function czIban(code: string): string {
  const bban = `${code}0000192000145399`;
  const digits = `${bban}CZ00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const checkDigits = 98n - (BigInt(digits) % 97n);
  return `CZ${checkDigits.toString().padStart(2, '0')}${bban}`;
}

describe('the fixture is the register the answers come from', () => {
  it('loads the invented copy, not the shipped rows', () => {
    // If module isolation stopped working, every assertion below would silently
    // describe the shipped database instead. This one fails first and says so.
    expect([...lib.allocatedCodes('CZ')].sort()).toEqual(EDITION.map((r) => r.code).sort());
    expect(lib.nationalRegisterEdition('CZ')).toEqual({ source: SOURCE, as_of: AS_OF });
  });

  it('builds the credit the ČNB terms ask for, once', () => {
    expect(lib.nationalRegisterCredit('CZ')).toBe(`${SOURCE} (platný od ${AS_OF})`);
  });
});

describe('a code the ČNB allocates is verified, with authority', () => {
  it.each([
    ['0100', 'Komerční banka, a.s.', 'KOMBCZPP'],
    ['0800', 'Česká spořitelna, a.s.', 'GIBACZPX'],
  ])('%s names the holder and its BIC as the ČNB writes them', (code, name, bic) => {
    const r = check(czIban(code));
    expect(r.bank_code_check?.value).toBe(code);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.match).toBe('register');
    // Verbatim, diacritics included: the terms forbid changing the facts.
    expect(r.bank_code_check?.institution?.name).toBe(name);
    expect(r.bank_code_check?.institution?.country).toBe('CZ');
    // Dated by the edition in force, never by our refresh month.
    expect(r.bank_code_check?.as_of).toBe('2026-09');
    // The BIC is the register's pairing, served as published (8 characters).
    expect(r.bic?.code).toBe(bic);
    expect(r.bic?.bank_name).toBe(name);
    expect(r.bic?.source).toBe(SOURCE);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });

  it('is the SWIFT registry example itself for 0800', () => {
    expect(czIban('0800')).toBe('CZ6508000000192000145399');
  });

  it('verifies a payment institution the číselník lists without a BIC', () => {
    // Banking Circle 6600 answered `not_in_register` until 25/09/2026 — the
    // same answer as a code that does not exist — because no BIC directory
    // could carry a code that holds no BIC.
    const r = check(czIban('6600'));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.institution?.name).toBe('Banking Circle S.A., Czech Republic');
  });

  it('serves, for every code the edition pairs with a BIC, that BIC', () => {
    for (const row of EDITION.filter((r) => r.bic)) {
      const r = check(czIban(row.code));
      expect(r.bic?.code, row.code).toBe(row.bic);
      expect(r.bic?.basis, row.code).toBe('national_register');
    }
  });
});

describe('a code the ČNB does not allocate is refused, with authority', () => {
  it.each(['4000', '8280', '9999'])('%s is not allocated', (code) => {
    const r = check(czIban(code));
    expect(r.bank_code_check?.value).toBe(code);
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(true);
    // Dated on the negative branch too: a refusal must say how current the
    // list behind it is.
    expect(r.bank_code_check?.as_of).toBe('2026-09');
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });

  it('serves no trace of the institutions the removed codes belonged to, anywhere', () => {
    // 4000 answered `verified`, "EXPOBANK CZ A.S.", until 25/09/2026: a code
    // removed in April 2025, when Max banka (formerly Expobank CZ) merged into
    // Banka CREDITAS. 8280 answered `verified` with a BIC and no name. The whole
    // answer is searched, not only `bic`.
    const r4000 = check(czIban('4000'));
    expect(r4000.bic ?? null).toBeNull();
    expect(JSON.stringify(r4000)).not.toMatch(/EXPOBANK|Max banka|EXPNCZPP/i);
    const r8280 = check(czIban('8280'));
    expect(r8280.bic ?? null).toBeNull();
    expect(JSON.stringify(r8280)).not.toMatch(/BEFKCZP1|B-Efekt/i);
  });
});

describe('"Zdroj: ČNB" rides on every answer the register decides', () => {
  it.each(['0100', '0800', '6600', '4000', '9999'])('%s carries the ČNB credit', (code) => {
    const r = check(czIban(code));
    // The verdict carries it in every case, refusals and BIC-less codes
    // included; the bic block, where there is one, carries the edition too.
    expect(r.bank_code_check?.register).toContain('Zdroj: ČNB');
    if (r.bic?.basis === 'national_register') expect(r.bic.source).toBe(SOURCE);
  });

  it('is an authoritative register, named with its credit', () => {
    const coverage = enrich.registerCoverage('CZ');
    expect(coverage.basis).toBe('authoritative');
    expect(coverage.register).toContain('Česká národní banka');
    expect(coverage.register).toContain('Zdroj: ČNB');
  });
});

describe('the composite map cannot resurrect a code the edition does not allocate', () => {
  it('serves no BIC for any Czech key of the map the edition leaves out', () => {
    // A sentinel for a future rebuild of bic_data.json that would bring back a
    // key the ČNB no longer allocates: the load-time prune is what drops it.
    // Against this short edition most of the map's Czech keys are such keys,
    // so the loop is never empty.
    const curated = JSON.parse(
      readFileSync(resolve(__dirname, '../db/bic_data.json'), 'utf8'),
    ) as Record<string, { bic: string }>;
    const allocated = lib.allocatedCodes('CZ');
    const outside = Object.keys(curated)
      .filter((k) => k.startsWith('CZ:'))
      .map((k) => k.slice(3))
      .filter((code) => !allocated.has(code));
    expect(outside.length).toBeGreaterThan(0);
    for (const code of outside) {
      const r = check(czIban(code));
      expect(r.bank_code_check?.reason, code).toBe('not_allocated');
      expect(r.bic ?? null, code).toBeNull();
    }
    // The two keys the ČNB had removed are gone from the file itself too.
    expect(curated['CZ:4000']).toBeUndefined();
    expect(curated['CZ:8280']).toBeUndefined();
  });
});
