import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IBANValidationResult } from '../types.js';

/**
 * 🚨 The edition in force is the one whose date has come, in Prague — not the
 * one the seeder read last.
 *
 * The ČNB publishes each číselník ahead of its effective date. This file loads
 * a copy of the shipped database with TWO Czech editions: the one in force
 * (called 253 here, from 1 July 2026) and an announced one (254, from
 * 1 September 2026) waiting in the pending table, as the seeder leaves them
 * during that window. Then it moves the clock across midnight in Prague.
 *
 * The two editions differ the way real ones do, in both directions:
 *   - 8190 (Sparkasse Oberlausitz-Niederschlesien) is in 253 and removed by
 *     254, as it really was;
 *   - 6363 is left out of the invented 253 so that 254 CREATES it — the case
 *     where switching late would refuse a code the ČNB has just allocated.
 *
 * Everything else is the shipped edition's rows, relabelled.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const IBAN_8190 = 'CZ0381900000192000145399';
const IBAN_6363 = 'CZ8863630000192000145399';
const IBAN_0800 = 'CZ6508000000192000145399';

const OLD = { version: '253', as_of: '2026-07-01' };
const NEW = { version: '254', as_of: '2026-09-01' };
const source = (v: string) => `Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze ${v}`;

let tmpDir: string;
let previousPath: string | undefined;
let check: (iban: string) => IBANValidationResult;
let lib: typeof import('./national-registers.js');
let closeAll: () => void;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ibanforge-cz-'));
  const dbPath = join(tmpDir, 'bic.sqlite');
  copyFileSync(resolve(__dirname, '../../data/bic.sqlite'), dbPath);

  const db = new Database(dbPath);
  const shipped = db
    .prepare(`SELECT code, name, bic FROM national_bank_codes WHERE country = 'CZ'`)
    .all() as Array<{ code: string; name: string; bic: string | null }>;
  if (shipped.length < 35) throw new Error('the shipped database carries no Czech register');
  db.exec(
    `CREATE TABLE IF NOT EXISTS national_bank_codes_pending AS SELECT * FROM national_bank_codes WHERE 0`,
  );
  db.exec(`DELETE FROM national_bank_codes WHERE country = 'CZ'`);
  db.exec(`DELETE FROM national_bank_codes_pending`);
  const insert = (table: string, rows: typeof shipped, ed: typeof OLD) => {
    const ins = db.prepare(
      `INSERT INTO ${table} (country, code, name, bic, street, post_code, town, lei, source, as_of)
       VALUES ('CZ', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    );
    for (const r of rows) ins.run(r.code, r.name, r.bic, source(ed.version), ed.as_of);
  };
  const withoutRemoved = shipped.filter((r) => r.code !== '8190');
  const oldEdition = [
    ...withoutRemoved.filter((r) => r.code !== '6363'),
    { code: '8190', name: 'Sparkasse Oberlausitz-Niederschlesien', bic: null },
  ];
  insert('national_bank_codes', oldEdition, OLD);
  insert('national_bank_codes_pending', withoutRemoved, NEW);
  db.close();

  // Set BEFORE the first import of anything that reaches db.js: the path is
  // captured in a module-level const there (same discipline as bg-bae.test.ts).
  previousPath = process.env.BIC_DB_PATH;
  process.env.BIC_DB_PATH = dbPath;

  const { validateIBAN } = await import('./iban.js');
  const { enrichResult } = await import('./enrich.js');
  lib = await import('./national-registers.js');
  closeAll = (await import('./db.js')).closeAll;
  check = (iban: string): IBANValidationResult => {
    const r = validateIBAN(iban);
    expect(r.valid, iban).toBe(true);
    enrichResult(r);
    return r;
  };
}, 60_000);

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  closeAll?.();
  if (previousPath === undefined) delete process.env.BIC_DB_PATH;
  else process.env.BIC_DB_PATH = previousPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Pin the clock; only Date is faked, so the database driver keeps its timers. */
function at(instant: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
}

describe('registerToday reads the date in Prague', () => {
  it('is already 1 September in Prague at 22:30 UTC on 31 August', () => {
    expect(lib.registerToday('CZ', new Date('2026-08-31T22:30:00Z'))).toBe('2026-09-01');
    expect(lib.registerToday('CZ', new Date('2026-08-31T21:30:00Z'))).toBe('2026-08-31');
    // A register with no time zone of its own is read in UTC.
    expect(lib.registerToday('SK', new Date('2026-08-31T22:30:00Z'))).toBe('2026-08-31');
  });
});

describe('the day before the announced edition takes effect', () => {
  it('keeps answering from the edition in force', () => {
    at('2026-08-31T12:00:00Z');
    expect(lib.nationalRegisterEdition('CZ')).toEqual({ source: source('253'), as_of: OLD.as_of });
    expect(lib.nationalRegisterCredit('CZ')).toBe(`${source('253')} (platný od 2026-07-01)`);
  });

  it('still verifies a code the next edition removes', () => {
    at('2026-08-31T21:30:00Z'); // 23:30 in Prague
    const r = check(IBAN_8190);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.institution?.name).toBe('Sparkasse Oberlausitz-Niederschlesien');
    expect(r.bank_code_check?.as_of).toBe('2026-07');
  });

  it('does not yet allocate a code only the next edition creates', () => {
    at('2026-08-31T12:00:00Z');
    const r = check(IBAN_6363);
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
  });
});

describe('from midnight in Prague on the effective date', () => {
  it('answers from the announced edition, credited as such', () => {
    at('2026-08-31T22:30:00Z'); // 00:30 on 1 September in Prague
    expect(lib.nationalRegisterEdition('CZ')).toEqual({ source: source('254'), as_of: NEW.as_of });
    const r = check(IBAN_0800);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.as_of).toBe('2026-09');
    expect(r.bic?.source).toBe(source('254'));
  });

  it('refuses the removed code, and names no bank for it', () => {
    at('2026-09-01T08:00:00Z');
    const r = check(IBAN_8190);
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Sparkasse Oberlausitz/);
  });

  it('allocates the created code', () => {
    at('2026-09-01T08:00:00Z');
    const r = check(IBAN_6363);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
  });

  it('counts the allocated set from the edition in force', () => {
    at('2026-08-31T12:00:00Z');
    expect(lib.allocatedCodes('CZ').has('8190')).toBe(true);
    expect(lib.allocatedCodes('CZ').has('6363')).toBe(false);
    at('2026-09-01T12:00:00Z');
    expect(lib.allocatedCodes('CZ').has('8190')).toBe(false);
    expect(lib.allocatedCodes('CZ').has('6363')).toBe(true);
  });
});

describe('other registers are untouched by the Czech announcement', () => {
  it('keeps Slovakia on its own table and its own date', () => {
    at('2026-09-01T12:00:00Z');
    const sk = lib.nationalRegisterEdition('SK');
    expect(sk.source).toMatch(/^Národná banka Slovenska/);
  });
});
