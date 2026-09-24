import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IBANValidationResult } from '../types.js';

/**
 * 🚨 The edition in force is the one whose date has come, in Prague — not the
 * one the seeder read last.
 *
 * The ČNB publishes each číselník ahead of its effective date. This file loads
 * a copy of the shipped database with TWO Czech editions of its own: the one
 * in force (called 253 here, from 1 July 2026) and an announced one (254, from
 * 1 September 2026) waiting in the pending table, as the seeder leaves them
 * during that window. Then it moves the clock across midnight in Prague.
 *
 * The rows are written here, not copied from the shipped edition, so the next
 * edition of the ČNB cannot change what this file proves. They differ the way
 * real editions do:
 *   - 8190 (Sparkasse Oberlausitz-Niederschlesien) is in 253 and removed by
 *     254, as it really was;
 *   - 6363 is in 254 only, so 254 CREATES it — the case where switching late
 *     would refuse a code the ČNB has just allocated;
 *   - one code the composite map (bic_data.json) carries is in 253 WITHOUT a
 *     BIC and removed by 254, so before the switch its BIC can only come from
 *     the map, and after it the map must stop serving it — the guard in
 *     lookupByCountryBank, which the load-time prune cannot replace because
 *     it runs once per process.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLD = { version: '253', as_of: '2026-07-01' };
const NEW = { version: '254', as_of: '2026-09-01' };
const source = (v: string) => `Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze ${v}`;

type Row = { code: string; name: string; bic: string | null };

/** Rows both editions carry (public bank names and codes). */
const COMMON: Row[] = [
  { code: '0100', name: 'Komerční banka, a.s.', bic: 'KOMBCZPP' },
  { code: '0800', name: 'Česká spořitelna, a.s.', bic: 'GIBACZPX' },
  { code: '2010', name: 'Fio banka, a.s.', bic: 'FIOBCZPP' },
];
const REMOVED_BY_254: Row = {
  code: '8190',
  name: 'Sparkasse Oberlausitz-Niederschlesien',
  bic: null,
};
const CREATED_BY_254: Row = { code: '6363', name: 'Partners Banka, a.s.', bic: 'PTBNCZPP' };

/**
 * A code the composite map carries and neither fixture edition already uses,
 * chosen from the file rather than typed, so a rebuild of the map cannot make
 * this test stop covering the guard in silence: beforeAll refuses to run
 * without one.
 */
const curated = JSON.parse(
  readFileSync(resolve(__dirname, '../db/bic_data.json'), 'utf8'),
) as Record<string, { bic: string }>;
const MAPPED_CODE =
  Object.keys(curated)
    .filter((k) => k.startsWith('CZ:'))
    .map((k) => k.slice(3))
    .find((code) => ![...COMMON, REMOVED_BY_254, CREATED_BY_254].some((r) => r.code === code)) ??
  '';
const MAPPED_BIC = curated[`CZ:${MAPPED_CODE}`]?.bic ?? '';
const MAPPED_ROW: Row = { code: MAPPED_CODE, name: 'Příkladová banka, a.s.', bic: null };

let tmpDir: string;
let previousPath: string | undefined;
let check: (iban: string) => IBANValidationResult;
let lib: typeof import('./national-registers.js');
let buildApp: typeof import('../app.js').buildApp;
let closeAll: () => void;

/** A valid Czech IBAN for any bank code, on the SWIFT registry example's account. */
function czIban(code: string): string {
  const bban = `${code}0000192000145399`;
  const digits = `${bban}CZ00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const checkDigits = 98n - (BigInt(digits) % 97n);
  return `CZ${checkDigits.toString().padStart(2, '0')}${bban}`;
}

beforeAll(async () => {
  if (!MAPPED_CODE || !MAPPED_BIC) {
    throw new Error('bic_data.json carries no Czech key this test can use to hold the guard');
  }
  tmpDir = mkdtempSync(join(tmpdir(), 'ibanforge-cz-'));
  const dbPath = join(tmpDir, 'bic.sqlite');
  copyFileSync(resolve(__dirname, '../../data/bic.sqlite'), dbPath);

  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS national_bank_codes_pending AS SELECT * FROM national_bank_codes WHERE 0`,
  );
  db.exec(`DELETE FROM national_bank_codes WHERE country = 'CZ'`);
  db.exec(`DELETE FROM national_bank_codes_pending`);
  const insert = (table: string, rows: Row[], ed: typeof OLD) => {
    const ins = db.prepare(
      `INSERT INTO ${table} (country, code, name, bic, street, post_code, town, lei, source, as_of)
       VALUES ('CZ', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    );
    for (const r of rows) ins.run(r.code, r.name, r.bic, source(ed.version), ed.as_of);
  };
  insert('national_bank_codes', [...COMMON, REMOVED_BY_254, MAPPED_ROW], OLD);
  insert('national_bank_codes_pending', [...COMMON, CREATED_BY_254], NEW);
  db.close();

  // Set BEFORE the first import of anything that reaches db.js: the path is
  // captured in a module-level const there (same discipline as bg-bae.test.ts).
  previousPath = process.env.BIC_DB_PATH;
  process.env.BIC_DB_PATH = dbPath;

  const { validateIBAN } = await import('./iban.js');
  const { enrichResult } = await import('./enrich.js');
  lib = await import('./national-registers.js');
  buildApp = (await import('../app.js')).buildApp;
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

// FIRST in the file on purpose: the composite map is built, and pruned, on
// the first lookup of the process. Built after the switch, the prune alone
// would drop the key and the guard would go untested; built here, under 253,
// the key survives the prune, and only the guard can stop it after the switch.
describe('the composite map follows the switch without a restart', () => {
  it('serves the map BIC under the old edition and nothing once the new one removes the code', () => {
    at('2026-08-31T21:30:00Z'); // 23:30 in Prague, 253 in force
    const before = check(czIban(MAPPED_CODE));
    expect(before.bank_code_check?.status).toBe('verified');
    // 253 publishes no BIC for it, so this BIC can only come from the map: the
    // map was built now, under 253, and kept the key.
    expect(before.bic?.code).toBe(MAPPED_BIC);
    expect(before.bic?.basis).toBe('curated_map');

    at('2026-09-01T08:00:00Z'); // 254 in force, the code removed
    const after = check(czIban(MAPPED_CODE));
    expect(after.bank_code_check?.reason).toBe('not_allocated');
    expect(after.bank_code_check?.authoritative).toBe(true);
    expect(after.bic ?? null).toBeNull();
    expect(JSON.stringify(after)).not.toContain(MAPPED_BIC.slice(0, 8));
  });
});

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
    const r = check(czIban(REMOVED_BY_254.code));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.institution?.name).toBe(REMOVED_BY_254.name);
    expect(r.bank_code_check?.as_of).toBe('2026-07');
  });

  it('does not yet allocate a code only the next edition creates', () => {
    at('2026-08-31T12:00:00Z');
    const r = check(czIban(CREATED_BY_254.code));
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
  });
});

describe('from midnight in Prague on the effective date', () => {
  it('answers from the announced edition, credited as such', () => {
    at('2026-08-31T22:30:00Z'); // 00:30 on 1 September in Prague
    expect(lib.nationalRegisterEdition('CZ')).toEqual({ source: source('254'), as_of: NEW.as_of });
    const r = check(czIban('0800'));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.as_of).toBe('2026-09');
    expect(r.bic?.source).toBe(source('254'));
  });

  it('refuses the removed code, and names no bank for it', () => {
    at('2026-09-01T08:00:00Z');
    const r = check(czIban(REMOVED_BY_254.code));
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Sparkasse Oberlausitz/);
  });

  it('allocates the created code', () => {
    at('2026-09-01T08:00:00Z');
    const r = check(czIban(CREATED_BY_254.code));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bic?.code).toBe(CREATED_BY_254.bic);
  });

  it('counts the allocated set from the edition in force', () => {
    at('2026-08-31T12:00:00Z');
    expect(lib.allocatedCodes('CZ').has(REMOVED_BY_254.code)).toBe(true);
    expect(lib.allocatedCodes('CZ').has(CREATED_BY_254.code)).toBe(false);
    at('2026-09-01T12:00:00Z');
    expect(lib.allocatedCodes('CZ').has(REMOVED_BY_254.code)).toBe(false);
    expect(lib.allocatedCodes('CZ').has(CREATED_BY_254.code)).toBe(true);
  });
});

describe('/llms.txt of the API follows the switch in the same process', () => {
  it('credits the old edition before midnight in Prague and the new one after', async () => {
    // ONE app for both requests: /llms.txt is memoized per process, and a fresh
    // module per request would hide exactly the staleness this guards against.
    at('2026-08-31T21:59:00Z');
    const app = buildApp();
    const line = async () =>
      (await (await app.request('/llms.txt')).text())
        .split('\n')
        .find((l) => l.startsWith('- Czech bank codes:'));
    expect(await line()).toContain(`${source('253')} (platný od 2026-07-01)`);
    at('2026-08-31T22:01:00Z');
    expect(await line()).toContain(`${source('254')} (platný od 2026-09-01)`);
  }, 60_000);
});

describe('other registers are untouched by the Czech announcement', () => {
  it('keeps Slovakia on its own table and its own date', () => {
    at('2026-09-01T12:00:00Z');
    const sk = lib.nationalRegisterEdition('SK');
    expect(sk.source).toMatch(/^Národná banka Slovenska/);
  });
});
