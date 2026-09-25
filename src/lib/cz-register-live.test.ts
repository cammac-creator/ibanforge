import { describe, expect, it } from 'vitest';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import {
  allocatedCodes,
  lookupNationalCode,
  nationalRegisterAvailable,
  nationalRegisterCredit,
  nationalRegisterEdition,
} from './national-registers.js';

/**
 * Czechia on the database this repository SHIPS: only what must hold whatever
 * edition the monthly refresh has just loaded.
 *
 * The monthly workflow reseeds the ČNB register and then runs this suite before
 * committing, so a test that froze one edition's facts (a bank's name, a code
 * that exists) would fail the whole month on an ordinary edition. The facts of
 * one edition are held in cz-register.test.ts, on a fixed copy. Nothing here
 * is skipped when the table is missing: a database shipped without the Czech
 * register must turn this file red.
 */

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

/** A valid Czech IBAN for any bank code, on the SWIFT registry example's account. */
function czIban(code: string): string {
  const bban = `${code}0000192000145399`;
  const digits = `${bban}CZ00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const checkDigits = 98n - (BigInt(digits) % 97n);
  return `CZ${checkDigits.toString().padStart(2, '0')}${bban}`;
}

const edition = nationalRegisterEdition('CZ');
const allocated = [...allocatedCodes('CZ')];

describe('the shipped Czech register', () => {
  it('is loaded, dated and credited by the edition it holds', () => {
    expect(nationalRegisterAvailable('CZ')).toBe(true);
    expect(edition.source).toMatch(/^Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze \d+$/);
    expect(edition.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nationalRegisterCredit('CZ')).toBe(`${edition.source} (platný od ${edition.as_of})`);
    expect(nationalRegisterCredit('CZ')).not.toMatch(/Zdroj: Zdroj/);
    expect(allocated.length).toBeGreaterThan(0);
  });

  it('refuses a code nobody holds, with authority and the edition date', () => {
    const r = check(czIban('9999'));
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.as_of).toBe(edition.as_of?.slice(0, 7));
    expect(r.bank_code_check?.register).toContain('Zdroj: ČNB');
  });

  it('serves every allocated code as the register writes it', () => {
    // Held on the ANSWER: the name and, where the ČNB publishes one, the BIC
    // come from the edition in force, whatever the composite map says.
    for (const code of allocated) {
      const reg = lookupNationalCode('CZ', code)!;
      const r = check(czIban(code));
      expect(r.bank_code_check?.status, code).toBe('verified');
      expect(r.bank_code_check?.authoritative, code).toBe(true);
      expect(r.bank_code_check?.institution?.name, code).toBe(reg.name);
      if (reg.bic) {
        expect(r.bic?.code, code).toBe(reg.bic);
        expect(r.bic?.basis, code).toBe('national_register');
        expect(r.bic?.source, code).toBe(edition.source);
      }
    }
  });

  it('names nobody for the codes the ČNB removed, as long as they stay removed', () => {
    for (const [code, trace] of [
      ['4000', /EXPOBANK|Max banka|EXPNCZPP/i],
      ['8280', /BEFKCZP1|B-Efekt/i],
    ] as const) {
      if (allocatedCodes('CZ').has(code)) continue;
      const r = check(czIban(code));
      expect(r.bank_code_check?.reason, code).toBe('not_allocated');
      expect(r.bic ?? null, code).toBeNull();
      expect(JSON.stringify(r), code).not.toMatch(trace);
    }
  });
});
