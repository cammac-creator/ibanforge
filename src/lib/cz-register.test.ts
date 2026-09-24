import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';
import { enrichResult, registerCoverage } from './enrich.js';
import {
  allocatedCodes,
  lookupNationalCode,
  nationalRegisterAvailable,
  nationalRegisterCredit,
  nationalRegisterEdition,
} from './national-registers.js';

/**
 * Czechia end to end, against the database this repository ships.
 *
 * The ČNB číselník is the allocation of the Czech payment codes, by law
 * (vyhláška č. 169/2011 Sb., § 4 c) and § 6 (2)): IBAN positions 5-8 are the
 * code, and the ČNB publishes every code it has allocated. So a code it holds
 * is `verified` with `authoritative: true`, and a code it does not hold is
 * `not_allocated`, also with `authoritative: true` — the strongest answer this
 * API gives, which is why nothing here is skipped when the table is missing: a
 * database shipped without the Czech register must turn this file red.
 *
 * Every IBAN below carries the account of the Czech example of the SWIFT IBAN
 * Registry (prefix 000019, number 2000145399) behind a different bank code, with
 * mod-97 recomputed; each is asserted valid before anything is read from it.
 * The first is that example itself.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

const EXAMPLE_0800 = 'CZ6508000000192000145399'; // Česká spořitelna, the SWIFT registry's example
const KB_0100 = 'CZ0801000000192000145399'; // Komerční banka
const BANKING_CIRCLE_6600 = 'CZ8066000000192000145399'; // a payment institution, no BIC in the číselník
const REMOVED_4000 = 'CZ9040000000192000145399'; // removed on 9 April 2025 (bank merger)
const REMOVED_8280 = 'CZ8182800000192000145399'; // removed on 1 December 2024
const NEVER_9999 = 'CZ7799990000192000145399'; // allocated to nobody, ever

/** The edition in force, read from the rows: the tests must survive the monthly refresh. */
const edition = nationalRegisterEdition('CZ');

describe('the Czech register is loaded and credited', () => {
  it('ships in the database, dated and credited by the edition it holds', () => {
    expect(nationalRegisterAvailable('CZ')).toBe(true);
    expect(edition.source).toMatch(/^Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze \d+$/);
    expect(edition.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('builds the credit the ČNB terms ask for, once', () => {
    const credit = nationalRegisterCredit('CZ');
    expect(credit).toBe(`${edition.source} (platný od ${edition.as_of})`);
    // The stored source already opens on the prescribed words; the format must
    // not add a second pair.
    expect(credit).not.toMatch(/Zdroj: Zdroj/);
  });

  it('is an authoritative register, named with its credit', () => {
    const coverage = registerCoverage('CZ');
    expect(coverage.basis).toBe('authoritative');
    expect(coverage.register).toContain('Česká národní banka');
    expect(coverage.register).toContain('Zdroj: ČNB');
  });
});

describe('a code the ČNB allocates is verified, with authority', () => {
  it.each([
    [KB_0100, '0100', 'Komerční banka, a.s.', 'KOMBCZPP'],
    [EXAMPLE_0800, '0800', 'Česká spořitelna, a.s.', 'GIBACZPX'],
  ])('%s (%s) names the holder and its BIC as the ČNB writes them', (iban, code, name, bic) => {
    const r = check(iban);
    expect(r.bank_code_check?.value).toBe(code);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.match).toBe('register');
    // Verbatim, diacritics included: the terms forbid changing the facts.
    expect(r.bank_code_check?.institution?.name).toBe(name);
    expect(r.bank_code_check?.institution?.country).toBe('CZ');
    // Dated by the edition in force, never by our refresh month.
    expect(r.bank_code_check?.as_of).toBe(edition.as_of?.slice(0, 7));
    // The BIC is the register's pairing, served as published (8 characters).
    expect(r.bic?.code).toBe(bic);
    expect(r.bic?.bank_name).toBe(name);
    expect(r.bic?.source).toBe(edition.source);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });

  it('verifies a payment institution the číselník lists without a BIC', () => {
    // Banking Circle 6600 answered `not_in_register` until 25/09/2026 — the
    // same answer as a code that does not exist — because no BIC directory
    // could carry a code that holds no BIC.
    const r = check(BANKING_CIRCLE_6600);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.institution?.name).toBe('Banking Circle S.A., Czech Republic');
  });
});

describe('a code the ČNB does not allocate is refused, with authority', () => {
  it.each([
    [REMOVED_4000, '4000'],
    [REMOVED_8280, '8280'],
    [NEVER_9999, '9999'],
  ])('%s (%s) is not allocated', (iban, code) => {
    const r = check(iban);
    expect(r.bank_code_check?.value).toBe(code);
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(true);
    // Dated on the negative branch too: a refusal must say how current the
    // list behind it is.
    expect(r.bank_code_check?.as_of).toBe(edition.as_of?.slice(0, 7));
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });

  it('serves no name of the bank the removed code used to belong to, anywhere', () => {
    // 4000 answered `verified`, "EXPOBANK CZ A.S.", until 25/09/2026: a code
    // removed in April 2025, when Max banka (formerly Expobank CZ) merged into
    // Banka CREDITAS. The whole answer is searched, not only `bic`.
    const r = check(REMOVED_4000);
    expect(r.bic ?? null).toBeNull();
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/EXPOBANK|Max banka|EXPNCZPP/i);
    expect(JSON.stringify(check(REMOVED_8280))).not.toMatch(/BEFKCZP1|B-Efekt/i);
  });
});

describe('"Zdroj: ČNB" rides on every answer the register decides', () => {
  it.each([KB_0100, EXAMPLE_0800, BANKING_CIRCLE_6600, REMOVED_4000, NEVER_9999])(
    '%s carries the ČNB credit',
    (iban) => {
      const r = check(iban);
      // The verdict carries it in every case, refusals and BIC-less codes
      // included; the bic block, where there is one, carries the edition too.
      expect(r.bank_code_check?.register).toContain('Zdroj: ČNB');
      if (r.bic?.basis === 'national_register') expect(r.bic.source).toMatch(/^Zdroj: ČNB, /);
    },
  );
});

describe('the composite map agrees with the číselník', () => {
  const curated = JSON.parse(
    readFileSync(resolve(__dirname, '../db/bic_data.json'), 'utf8'),
  ) as Record<string, { bic: string }>;
  const czKeys = Object.entries(curated).filter(([k]) => k.startsWith('CZ:'));

  it('holds no key the ČNB has removed', () => {
    expect(curated['CZ:4000']).toBeUndefined();
    expect(curated['CZ:8280']).toBeUndefined();
    const allocated = allocatedCodes('CZ');
    const stale = czKeys.map(([k]) => k.slice(3)).filter((code) => !allocated.has(code));
    expect(stale).toEqual([]);
  });

  it('pairs every Czech key with the BIC the ČNB publishes for it', () => {
    const disagreements = czKeys
      .map(([k, v]) => ({
        code: k.slice(3),
        mine: v.bic.slice(0, 8),
        reg: lookupNationalCode('CZ', k.slice(3))?.bic,
      }))
      .filter((d) => d.reg && d.reg.slice(0, 8) !== d.mine);
    expect(disagreements).toEqual([]);
  });
});
