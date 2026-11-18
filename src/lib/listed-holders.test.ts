/**
 * Les codes qu'une liste nationale publique nomme sans BIC (src/lib/listed-holders.ts,
 * 18/11/2026) : Aircash en Croatie (liste de la HNB), Trade Republic en Suède (liste de
 * Bankinfrastruktur i Sverige AB).
 *
 * Ce qui est tenu : la réponse nomme l'établissement avec la source et sa date, sans
 * BIC ; un code voisin que la liste ne porte pas garde la réponse d'avant, jamais un
 * refus ; aucun code listé n'a de clé dans la carte (le module ne répond que là où la
 * carte se tait, une clé le rendrait muet) ; la mention suédoise est celle de la carte.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { enrichResult, registerCoverage } from './enrich.js';
import { validateIBAN } from './iban.js';
import { curatedMapSource } from './bic-lookup.js';
import { registerCountries } from './positioning.js';
import {
  HR_LIST_CREDIT,
  SE_LIST_CREDIT,
  listedHolderKeys,
  lookupListedHolder,
} from './listed-holders.js';

const here = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(resolve(here, '../db/bic_data.json'), 'utf8')) as Record<
  string,
  unknown
>;

/** An IBAN of `country` over `bban`, with its two check digits computed (mod 97). */
function ibanOver(country: string, bban: string): string {
  const digits = `${bban}${country}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const check = 98n - (BigInt(digits) % 97n);
  return `${country}${check.toString().padStart(2, '0')}${bban}`;
}

function enriched(iban: string) {
  const result = validateIBAN(iban);
  expect(result.valid, iban).toBe(true);
  enrichResult(result);
  return result;
}

// HR : 7 chiffres de banque, 10 de compte. SE : 3 chiffres d'IBAN ID, 17 de compte.
const hr = (code: string) => ibanOver('HR', `${code}3200000001`);
const se = (code: string) => ibanOver('SE', `${code}${'0'.repeat(6)}${code}0${'1234567'}`);

describe('codes a public national list names without a BIC', () => {
  it('names Aircash for the Croatian code 4501006, with the HNB credit and the file date', () => {
    const r = enriched(hr('4501006'));
    expect(r.bank_code_check).toEqual({
      value: '4501006',
      status: 'verified',
      match: 'register',
      register: expect.stringContaining(`${HR_LIST_CREDIT}.`),
      authoritative: false,
      institution: {
        name: 'AIRCASH d.o.o. Zagreb',
        street: null,
        post_code: null,
        town: null,
        country: 'HR',
      },
      as_of: '2025-03',
    });
    expect(r.bank_code_check?.register).toMatch(/^Hrvatska narodna banka/);
    expect(r.bank_code_check?.register).toContain('file dated 2025-03-27');
    expect(r.bank_code_holder).toBe('confirmed');
    expect(r.checks?.bank_code).toBe('pass');
    // No BIC: the list gives none, and none is guessed from the name.
    expect(r.bic).toBeNull();
  });

  it('names Trade Republic for the Swedish IBAN ID 216, with the credit of the Swedish list', () => {
    const r = enriched(se('216'));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.match).toBe('register');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bank_code_check?.institution?.name).toBe('Trade Republic Bank');
    expect(r.bank_code_check?.institution?.country).toBe('SE');
    expect(r.bank_code_check?.register).toContain(SE_LIST_CREDIT);
    expect(r.bank_code_check?.register).toContain('read on 2026-11-06');
    expect(r.bank_code_check?.as_of).toBe('2026-11');
    expect(r.bank_code_holder).toBe('confirmed');
    expect(r.bic).toBeNull();
  });

  it('leaves a code the list does not carry with the answer it had, never a refusal', () => {
    // 4501007 and 783 are in no list and have no key: absent from our data, as before.
    for (const iban of [hr('4501007'), se('783')]) {
      const r = enriched(iban);
      expect(r.bank_code_check?.status, iban).toBe('not_in_register');
      expect(r.bank_code_check?.reason, iban).toBe('absent_from_reference_data');
      expect(r.bank_code_check?.authoritative, iban).toBe(false);
      expect(r.bank_code_holder, iban).toBe('unknown');
      expect(r.bic, iban).toBeNull();
    }
  });

  it('never shadows a key of the composite map', () => {
    expect(listedHolderKeys().sort()).toEqual(['HR:4501006', 'SE:216']);
    for (const key of listedHolderKeys()) expect(map[key], key).toBeUndefined();
  });

  it('carries the Swedish credit word for word as the map keys do', () => {
    expect(curatedMapSource('SE').endsWith(`; ${SE_LIST_CREDIT}`)).toBe(true);
    expect(curatedMapSource('HR').endsWith(`; ${HR_LIST_CREDIT}`)).toBe(true);
  });

  it('leaves Croatia and Sweden out of the registers the public texts describe', () => {
    // Two named codes do not make a register: the texts that describe coverage by
    // country (positioning.ts, register-lists.ts) keep both countries where they were.
    for (const cc of ['HR', 'SE']) {
      expect(registerCoverage(cc).basis, cc).toBe('none');
      expect(registerCountries().authoritative, cc).not.toContain(cc);
      expect(registerCountries().partial, cc).not.toContain(cc);
    }
  });

  it('answers nothing for a country it does not list', () => {
    expect(lookupListedHolder('DK', '6695')).toBeNull();
    expect(lookupListedHolder('se', '216')?.name).toBe('Trade Republic Bank');
  });
});
